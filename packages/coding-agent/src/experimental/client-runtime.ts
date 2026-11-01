import { basename } from "node:path";
import type { Ref } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { Client, ServerError } from "@earendil-works/pi-client";
import { createUnixTransportFactory, discoverUnixServers, type UnixServerRoute } from "@earendil-works/pi-client/unix";
import { isServerId, type ServerId } from "@earendil-works/pi-protocol";
import type { ClientCommand } from "../cli/experimental/commands/client.ts";
import { RadiusRelayAuthResolver } from "./radius-auth.ts";
import { createRadiusClientTransportFactory, RadiusClientReconnect } from "./radius-relay.ts";
import { activateServer, ENV_SERVER_ID, resolveServerDirectory, resolveSessionDirectory } from "./server.ts";
import { AgentController } from "./services/agent-controller.ts";
import {
	createServerServiceSource,
	createSessionServiceSource,
	type ServerServiceSource,
	type SessionServiceSource,
	waitForClientHostClose,
} from "./services/connection.ts";
import { Models } from "./services/models.ts";
import { PresentationPlugins } from "./services/plugins.ts";
import { SessionDirectory, SessionManagement } from "./services/sessions.ts";
import { Transcript } from "./services/transcript.ts";

export type ClientRuntimeRoute =
	| ({ readonly transport: "unix" } & UnixServerRoute)
	| { readonly transport: "radius"; readonly serverId: ServerId };

export interface ClientRuntimeServer {
	readonly route: ClientRuntimeRoute;
	readonly client: Client;
	readonly server: ServerServiceSource;
	readonly session: SessionServiceSource;
}

export interface ActivatedClientRuntimeServer extends ClientRuntimeServer {
	readonly directory: SessionDirectory;
	readonly management: SessionManagement;
	readonly plugins: PresentationPlugins;
	readonly models: Models;
	readonly agent: AgentController;
	readonly transcript: Transcript;
}

export interface ClientRuntime {
	readonly servers: readonly ClientRuntimeServer[];
	dispose(): Promise<void>;
}

export interface OpenClientRuntimeOptions {
	/** Directory searched when --connect is omitted. Defaults to PI_SERVER_DIR or ~/.pi/server. */
	readonly directory?: string;
}

/** Open live server/session service namespaces for one experimental presentation. */
export async function openClientRuntime(
	command: ClientCommand,
	options: OpenClientRuntimeOptions = {},
): Promise<ClientRuntime> {
	if (command.auth !== undefined && command.connect?.transport !== "radius") {
		throw new Error("Authentication is only supported for experimental Radius connections");
	}
	if (command.provider !== undefined && command.model === undefined) {
		throw new Error("Server model provider requires a model");
	}
	if (command.connect && command.model !== undefined) {
		throw new Error("Model selection is only valid when automatically activating a new server");
	}
	if (command.connect?.transport === "radius" && command.pluginPackages !== undefined) {
		throw new Error("Plugin package paths can only be configured on a local Unix server");
	}
	const directory = resolveServerDirectory(options.directory);
	let routes: ClientRuntimeRoute[];
	let activatedClient: Client | undefined;
	if (command.connect) {
		routes = [
			command.connect.transport === "radius"
				? { transport: "radius", serverId: command.connect.serverId }
				: { transport: "unix", ...routeFromExplicitPath(command.connect.path) },
		];
	} else {
		routes = (await discoverUnixServers({ directory })).map((route) => ({ transport: "unix", ...route }));
		if (routes.length > 0 && command.model !== undefined) {
			throw new Error("Model selection is only valid when automatically activating a new server");
		}
		if (routes.length === 0) {
			const activated = await activateServer({
				directory,
				requestedServerId: process.env[ENV_SERVER_ID],
				sessionDir: resolveSessionDirectory(),
				provider: command.provider,
				model: command.model,
			});
			routes = [{ transport: "unix", ...activated.route }];
			activatedClient = activated.client;
		}
	}
	if (command.pluginPackages !== undefined && routes.length !== 1) {
		throw new Error("Plugin selection requires exactly one local server");
	}

	const clients: Client[] = [];
	const reconnectors: RadiusClientReconnect[] = [];
	const serviceSources: Array<ServerServiceSource | SessionServiceSource> = [];
	const servers: ClientRuntimeServer[] = [];
	let disposed = false;
	const dispose = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		const reconnectResults = await Promise.allSettled(reconnectors.map((reconnector) => reconnector.dispose()));
		const sourceResults = await Promise.allSettled(
			serviceSources.map((source) => source.dispose(BACKGROUND_CONTEXT)),
		);
		const clientResults = await Promise.allSettled(clients.map((client) => client.dispose()));
		const hostResults = await Promise.allSettled(clients.map((client) => waitForClientHostClose(client)));
		const errors = [
			...new Set(
				[...reconnectResults, ...sourceResults, ...clientResults, ...hostResults].flatMap((result) =>
					result.status === "rejected" ? [result.reason] : [],
				),
			),
		];
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, "Failed to dispose experimental client runtime");
	};

	try {
		for (const route of routes) {
			let client = activatedClient;
			if (client === undefined) {
				try {
					client = await Client.connect({
						serverId: route.serverId,
						transportFactory:
							route.transport === "unix"
								? createUnixTransportFactory({ path: route.path })
								: createRadiusClientTransportFactory({
										serverId: route.serverId,
										auth: new RadiusRelayAuthResolver(command.auth),
									}),
					});
				} catch (error) {
					if (
						command.connect !== undefined ||
						route.transport !== "unix" ||
						!(error instanceof ServerError) ||
						error.code !== "version"
					) {
						throw error;
					}
					client = (
						await activateServer({
							directory,
							requestedServerId: route.serverId,
							sessionDir: resolveSessionDirectory(),
						})
					).client;
				}
			}
			activatedClient = undefined;
			clients.push(client);
			const server = createServerServiceSource(client);
			serviceSources.push(server);
			if (route.transport === "radius") {
				reconnectors.push(
					new RadiusClientReconnect(client, async (sessionId) => {
						await server.host.root(async (ctx) => {
							const plugins = await ctx.get(PresentationPlugins, {});
							await plugins.prepareSession({ sessionId, packagePaths: null }, ctx);
							const management = await ctx.get(SessionManagement, {});
							await management.attach(sessionId, ctx);
						});
					}),
				);
			}
			const session = createSessionServiceSource(client);
			serviceSources.push(session);
			servers.push({ route, client, server, session });
		}
		return { servers, dispose };
	} catch (error) {
		try {
			await dispose();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], "Experimental client startup and cleanup failed");
		}
		throw error;
	}
}

/** Acquire and connect the built-in service facades used by the non-interactive client. */
export async function activateBuiltinClientServices(
	server: ClientRuntimeServer,
): Promise<ActivatedClientRuntimeServer> {
	const host = server.server.host;
	const serverRefs: { release(): void }[] = [];
	let directory: Ref<typeof SessionDirectory>;
	let remoteManagement: Ref<typeof SessionManagement>;
	let plugins: Ref<typeof PresentationPlugins>;
	try {
		directory = await host.get(SessionDirectory, {});
		serverRefs.push(directory);
		remoteManagement = await host.get(SessionManagement, {});
		serverRefs.push(remoteManagement);
		plugins = await host.get(PresentationPlugins, {});
		serverRefs.push(plugins);
	} catch (error) {
		for (const reference of serverRefs) reference.release();
		throw error;
	}
	let sessionRefs:
		| { models: Ref<typeof Models>; agent: Ref<typeof AgentController>; transcript: Ref<typeof Transcript> }
		| undefined;
	const releaseSession = (): void => {
		if (sessionRefs === undefined) return;
		sessionRefs.models.release();
		sessionRefs.agent.release();
		sessionRefs.transcript.release();
		sessionRefs = undefined;
	};
	const management: SessionManagement = {
		create: (options, ctx) => remoteManagement.create(options, ctx),
		async remove(sessionId, ctx) {
			const attachment = server.client.attachment;
			try {
				await remoteManagement.remove(sessionId, ctx);
				if (attachment?.sessionId === sessionId)
					await server.session.whenDetached(withAbortSignal(ctx.signal, BACKGROUND_CONTEXT));
			} finally {
				if (server.client.attachment !== attachment) releaseSession();
			}
		},
		async attach(sessionId, ctx) {
			const attachment = server.client.attachment;
			const acquired: { release(): void }[] = [];
			try {
				await remoteManagement.attach(sessionId, ctx);
				await server.session.whenAttached(sessionId, withAbortSignal(ctx.signal, BACKGROUND_CONTEXT));
				const models = await host.get(Models, {}, { signal: ctx.signal });
				acquired.push(models);
				const agent = await host.get(AgentController, {}, { signal: ctx.signal });
				acquired.push(agent);
				const transcript = await host.get(Transcript, {}, { signal: ctx.signal });
				acquired.push(transcript);
				ctx.signal.throwIfAborted();
				const previous = sessionRefs;
				sessionRefs = { models, agent, transcript };
				previous?.models.release();
				previous?.agent.release();
				previous?.transcript.release();
			} catch (error) {
				for (const reference of acquired) reference.release();
				if (server.client.attachment !== attachment) releaseSession();
				throw error;
			}
		},
		async detach(ctx) {
			const attachment = server.client.attachment;
			try {
				await remoteManagement.detach(ctx);
				await server.session.whenDetached(withAbortSignal(ctx.signal, BACKGROUND_CONTEXT));
			} finally {
				if (server.client.attachment !== attachment) releaseSession();
			}
		},
	};
	return {
		...server,
		directory,
		management,
		plugins,
		get models() {
			if (sessionRefs === undefined) throw new Error("No Session is attached");
			return sessionRefs.models;
		},
		get agent() {
			if (sessionRefs === undefined) throw new Error("No Session is attached");
			return sessionRefs.agent;
		},
		get transcript() {
			if (sessionRefs === undefined) throw new Error("No Session is attached");
			return sessionRefs.transcript;
		},
	};
}

function routeFromExplicitPath(path: string): UnixServerRoute {
	const name = basename(path);
	const serverId = name.endsWith(".sock") ? name.slice(0, -".sock".length) : "";
	if (!isServerId(serverId)) throw new Error("--connect path must end with <uuidv4-server-id>.sock");
	return { serverId, path };
}
