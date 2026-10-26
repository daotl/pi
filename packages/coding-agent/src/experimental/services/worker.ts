import { createHost, defineFacet, type Facet, type Frame, type Link } from "@earendil-works/chord";
import type { AgentHarness, AgentLane } from "@earendil-works/pi-agent-core";
import { createRoutedLinkPair } from "@earendil-works/pi-server";
import type { ModelRuntime } from "../../core/model-runtime.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import type { LoadedPluginFacets } from "../plugins/bundled.ts";
import { AgentController } from "./agent-controller.ts";
import { createAgentController } from "./agent-controller-provider.ts";
import { createModelsServiceFacet } from "./models-provider.ts";
import { SessionPlugins } from "./plugins.ts";
import { createTranscriptServiceFacet } from "./transcript-provider.ts";

export interface SessionWorkerRuntime {
	readonly harness: AgentHarness;
	readonly lane?: AgentLane;
	readonly modelRuntime?: ModelRuntime;
	readonly settingsManager?: SettingsManager;
	readonly facetLoader?: () => Promise<LoadedPluginFacets>;
}

export interface WorkerServiceScope {
	readonly serverConnectionId: string;
	readonly attachmentId: string;
}

export interface SessionWorkerServices {
	attach(scope: WorkerServiceScope): void;
	receive(scope: WorkerServiceScope, frame: Frame): void;
	removeAttachments(matches: (scope: WorkerServiceScope) => boolean): Promise<void>;
	dispose(): Promise<void>;
}

export async function createSessionWorkerServices(options: {
	readonly lane: AgentLane;
	readonly modelRuntime: ModelRuntime | undefined;
	readonly settingsManager?: SettingsManager;
	readonly facetLoader?: () => Promise<LoadedPluginFacets>;
	publish(scope: WorkerServiceScope, frame: Frame): Promise<void>;
}): Promise<SessionWorkerServices> {
	const host = createHost({ name: "session", self: "worker" });
	let reloadTail = Promise.resolve();
	let disposed = false;
	const pluginLoader = options.facetLoader ?? (async () => ({ facets: [], async dispose() {} }));
	let loadedPlugins = await pluginLoader();
	const reloadPlugins = (): Promise<void> => {
		const operation = reloadTail.then(async () => {
			if (disposed) throw new Error("Session worker host is closed");
			const candidate = await pluginLoader();
			try {
				await host.reload(candidate.facets, {
					remove: loadedPlugins.facets
						.filter((old) => !candidate.facets.some((next) => next.name === old.name))
						.map((facet) => facet.name),
				});
			} catch (error) {
				try {
					await candidate.dispose();
				} catch (cleanupError) {
					throw new AggregateError([error, cleanupError], "Session plugin reload and cleanup failed");
				}
				throw error;
			}
			const retired = loadedPlugins;
			loadedPlugins = candidate;
			await retired.dispose();
		});
		reloadTail = operation.catch(() => {});
		return operation;
	};
	const builtins: Facet[] = [
		{
			name: "@pi/agent-controller-runtime",
			...defineFacet(({ serve }) => {
				const controller = createAgentController(options.lane);
				serve(AgentController, () => ({ variant: "active", ...controller }));
			}),
		},
		{
			name: "@pi/session-plugins-runtime",
			...defineFacet(({ serve }) => {
				serve(SessionPlugins, () => ({ variant: "active", reload: reloadPlugins }));
			}),
		},
		createModelsServiceFacet(options),
		createTranscriptServiceFacet(options.lane),
	];
	try {
		await host.load([...builtins, ...loadedPlugins.facets]);
	} catch (error) {
		const cleanup = await Promise.allSettled([host.close(), loadedPlugins.dispose()]);
		const failures = cleanup.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
		if (failures.length)
			throw new AggregateError([error, ...failures], "Session facets failed to start and clean up");
		throw error;
	}
	const attachments = new Map<string, { scope: WorkerServiceScope; link: Link }>();
	const removeAttachments = async (matches: (scope: WorkerServiceScope) => boolean): Promise<void> => {
		const released: string[] = [];
		for (const [key, entry] of attachments) {
			if (!matches(entry.scope)) continue;
			entry.link.close("Session attachment released");
			attachments.delete(key);
			released.push(key);
		}
		await host.invalidatePrincipal((principal) => typeof principal === "string" && released.includes(principal));
	};
	return {
		attach(scope) {
			if (disposed) throw new Error("Session worker host is closed");
			const key = serviceScopeKey(scope);
			if (attachments.has(key)) return;
			const [provider, tunnel] = createRoutedLinkPair();
			attachments.set(key, { scope, link: tunnel });
			tunnel.receive((frame) => {
				void options.publish(scope, frame).catch(() => tunnel.close("Control publication failed"));
			});
			tunnel.onClose((reason) => {
				if (attachments.get(key)?.link !== tunnel) return;
				void options.publish(scope, { t: "bye", reason }).catch(() => {});
			});
			host.accept(provider, { principal: key, kind: "client" });
		},
		receive(scope, frame) {
			const entry = attachments.get(serviceScopeKey(scope));
			if (entry === undefined) throw new Error("Session worker has no active attachment");
			entry.link.send(frame);
		},
		removeAttachments,
		async dispose() {
			if (disposed) return;
			disposed = true;
			await removeAttachments(() => true);
			await reloadTail;
			const results = await Promise.allSettled([host.close(), loadedPlugins.dispose()]);
			const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, "Failed to dispose Session facets");
		},
	};
}

function serviceScopeKey(scope: WorkerServiceScope): string {
	return `${scope.serverConnectionId}\0${scope.attachmentId}`;
}
