import {
	createHost,
	type Host,
	type Link,
	type MutableReplicatedState,
	type ReplicatedState,
	replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context";
import { type Client, createClientChordLink } from "@earendil-works/pi-client";
import { raceWithAbortSignal } from "../../utils/abort.ts";
import { SessionPlugins } from "./plugins.ts";

export type ServerConnectionState =
	| { status: "connecting"; attempt: number }
	| { status: "connected"; since: string }
	| { status: "disconnected"; since: string; reason: string; retryAt: string | null };
export type SessionAttachmentState =
	| { status: "detached" }
	| { status: "attaching" | "attached" | "degraded"; sessionId: string };
export interface ServerServiceSource {
	readonly host: Host;
	readonly connection: ReplicatedState<ServerConnectionState>;
	dispose(context: Context): Promise<void>;
}
export interface SessionServiceSource {
	readonly host: Host;
	readonly attachment: ReplicatedState<SessionAttachmentState>;
	whenAttached(sessionId: string, context: Context): Promise<void>;
	whenDetached(context: Context): Promise<void>;
	dispose(context: Context): Promise<void>;
}
export interface ServiceSourceOptions {
	readonly onError?: (error: Error) => void;
}

interface ClientHosts {
	readonly host: Host;
	readonly removeConnectionListener: () => void;
	references: number;
	closePromise?: Promise<void>;
}
const clients = new WeakMap<Client, ClientHosts>();
const shutdowns = new WeakMap<Client, Promise<void>>();

function closeHost(client: Client, shared: ClientHosts): Promise<void> {
	if (shared.closePromise !== undefined) return shared.closePromise;
	shared.removeConnectionListener();
	if (clients.get(client) === shared) clients.delete(client);
	shared.closePromise = shared.host.close();
	shutdowns.set(client, shared.closePromise);
	// Disconnect listeners cannot return promises. Keep rejection observed for the runtime owner to join.
	void shared.closePromise.catch(() => {});
	return shared.closePromise;
}

/** Join cleanup started by the final source release or client disconnection. */
export async function waitForClientHostClose(client: Client): Promise<void> {
	await shutdowns.get(client);
}
function acquireHost(client: Client, options: ServiceSourceOptions): ClientHosts {
	let shared = clients.get(client);
	if (shared === undefined) {
		const host = createHost({
			name: "presentation",
			kind: "client",
			self: "presentation",
			onError: (error) => options.onError?.(error instanceof Error ? error : new Error(String(error))),
		});
		let serverLink: Link | undefined;
		let sessionLink: Link | undefined;
		host.route("server", {
			authorize: (_principal, name) => name === "server" && client.connected,
			resolve: async () => {
				if (serverLink === undefined || serverLink.closed)
					serverLink = createClientChordLink(client, () => ({ serverId: client.serverId }));
				return serverLink;
			},
			principal: () => "server",
		});
		host.route("session", {
			authorize: (_principal, name) => name === "session" && client.attachment !== undefined,
			resolve: async () => {
				if (sessionLink === undefined || sessionLink.closed)
					sessionLink = createClientChordLink(client, () => client.attachment);
				return sessionLink;
			},
			principal: () => "session",
		});
		shared = {
			host,
			references: 0,
			removeConnectionListener: client.onConnectionStateChange(({ state }) => {
				if (state !== "disconnected" || shared!.references > 0) return;
				void closeHost(client, shared!);
			}),
		};
		clients.set(client, shared);
	}
	shared.references++;
	return shared;
}
async function releaseHost(client: Client, shared: ClientHosts): Promise<void> {
	shared.references--;
	if (shared.references !== 0 || client.connected) return;
	await closeHost(client, shared);
}

export function createServerServiceSource(client: Client, options: ServiceSourceOptions = {}): ServerServiceSource {
	const shared = acquireHost(client, options);
	let attempt = client.connectionState === "connecting" ? 1 : 0;
	const state = replicatedState<ServerConnectionState>(toServerConnectionState(client, attempt));
	const remove = client.onConnectionStateChange(({ state: connection, error }) => {
		if (connection === "connecting") attempt++;
		state.replace(BACKGROUND_CONTEXT, toServerConnectionState(client, attempt, error));
	});
	let disposed = false;
	return {
		host: shared.host,
		connection: state,
		async dispose() {
			if (disposed) return;
			disposed = true;
			remove();
			await releaseHost(client, shared);
		},
	};
}

export function createSessionServiceSource(client: Client, options: ServiceSourceOptions = {}): SessionServiceSource {
	const shared = acquireHost(client, options);
	const state: MutableReplicatedState<SessionAttachmentState> = replicatedState<SessionAttachmentState>(
		client.attachment === undefined
			? { status: "detached" }
			: { status: "attaching", sessionId: client.attachment.sessionId },
	);
	let revision = 0;
	let hydration = Promise.resolve();
	let disposed = false;
	const hydrate = (): void => {
		const attachment = client.attachment;
		const current = ++revision;
		if (attachment === undefined) {
			state.replace(BACKGROUND_CONTEXT, { status: "detached" });
			hydration = Promise.resolve();
			return;
		}
		state.replace(BACKGROUND_CONTEXT, { status: "attaching", sessionId: attachment.sessionId });
		hydration = (async () => {
			const reference = await shared.host.get(SessionPlugins, {});
			reference.release();
			if (current === revision && !disposed)
				state.replace(BACKGROUND_CONTEXT, { status: "attached", sessionId: attachment.sessionId });
		})();
		void hydration.catch((error: unknown) => {
			if (current !== revision || disposed) return;
			state.replace(BACKGROUND_CONTEXT, { status: "degraded", sessionId: attachment.sessionId });
			options.onError?.(error instanceof Error ? error : new Error(String(error)));
		});
	};
	const remove = client.onAttachmentChange(hydrate);
	if (client.attachment !== undefined) hydrate();
	return {
		host: shared.host,
		attachment: state,
		async whenAttached(sessionId, context) {
			const attachment = client.attachment;
			if (attachment === undefined || attachment.sessionId !== sessionId)
				throw new Error(`Session ${sessionId} is not the current attachment`);
			const current = revision;
			await raceWithAbortSignal(hydration, context.abortSignal);
			context.abortSignal?.throwIfAborted();
			if (current !== revision || client.attachment !== attachment)
				throw new Error("Session attachment changed during hydration");
		},
		async whenDetached() {
			if (client.attachment !== undefined) throw new Error("Session is still attached");
			await hydration;
		},
		async dispose() {
			if (disposed) return;
			disposed = true;
			revision++;
			remove();
			await releaseHost(client, shared);
		},
	};
}

function toServerConnectionState(client: Client, attempt: number, error?: Error): ServerConnectionState {
	if (client.connectionState === "connecting") return { status: "connecting", attempt };
	if (client.connected) return { status: "connected", since: new Date().toISOString() };
	return {
		status: "disconnected",
		since: new Date().toISOString(),
		reason: error?.message ?? "Connection closed",
		retryAt: null,
	};
}
