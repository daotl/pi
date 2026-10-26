import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createHost, type MutableReplicatedState, type Readable, replicatedState } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	type AgentLane,
	type LaneSnapshot,
	type LaneTranscriptSnapshot,
	type LaneWatchEvent,
	reduceLaneSnapshot,
} from "@earendil-works/pi-agent-core";
import { createRoutedLinkPair } from "@earendil-works/pi-server";
import { ProcessTerminal, TuiMainScreen } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { type ClientTuiServer, ExperimentalClientTui } from "../src/experimental/client-tui.ts";
import { createPresentationFacetData } from "../src/experimental/plugins/bundled.ts";
import {
	FACET_BUNDLE_ARTIFACT_FORMAT,
	FACET_BUNDLE_ARTIFACT_FORMAT_VERSION,
	type FacetBundleArtifact,
} from "../src/experimental/plugins/package.ts";
import { AgentController } from "../src/experimental/services/agent-controller.ts";
import { createAgentController } from "../src/experimental/services/agent-controller-provider.ts";
import type {
	ServerConnectionState,
	ServerServiceSource,
	SessionAttachmentState,
	SessionServiceSource,
} from "../src/experimental/services/connection.ts";
import { Models, type ModelsState } from "../src/experimental/services/models.ts";
import { PresentationPlugins, SessionPlugins } from "../src/experimental/services/plugins.ts";
import {
	SessionDirectory,
	type SessionDirectoryState,
	SessionManagement,
	type SessionSummary,
} from "../src/experimental/services/sessions.ts";
import { Transcript, type TranscriptState } from "../src/experimental/services/transcript.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const serverId = "00000000-0000-4000-8000-000000000001";

function session(sessionId: string, createdAt: number): SessionSummary {
	return { serverId, sessionId, createdAt };
}

function publishReplacement<T extends object>(state: MutableReplicatedState<T>, value: T): void {
	state.replace(BACKGROUND_CONTEXT, value);
}

function readable<T extends object>(state: MutableReplicatedState<T>): Readable<T> {
	return {
		get value() {
			return state.value;
		},
		subscribe: (listener) => state.subscribe(listener),
		events: (listener) =>
			state.subscribe((value, _context, delivery) =>
				listener({ type: delivery.kind === "hydrate" ? "snap" : "reset", value }),
			),
	};
}

function laneSnapshot(): LaneSnapshot {
	return {
		lane: "main",
		transcript: [],
		tipId: null,
		configuration: {
			model: { provider: "test", modelId: "one" },
			thinkingLevel: "off",
			activeToolNames: [],
		},
		stats: {
			messageCount: 0,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		},
		operation: null,
		queues: [],
		faulted: false,
	};
}

describe("experimental client TUI", () => {
	beforeAll(() => initTheme("dark"));

	test.each([
		["new", { command: "client" as const }, "two", 1],
		["continued", { command: "client" as const, continue: true }, "one", 0],
		["plugin-selected", { command: "client" as const, pluginPackages: ["./example-plugin"] }, "two", 1],
	] as const)(
		"opens a %s Session directly and exercises the full lifecycle only for a new Session",
		async (kind, command, sessionId, creates) => {
			const directoryState = replicatedState<SessionDirectoryState>({ revision: 1, sessions: [session("one", 1)] });
			const attachment = replicatedState<SessionAttachmentState>({ status: "detached" });
			const connectionState = replicatedState<ServerConnectionState>({ status: "connected", since: "now" });
			const modelsState = replicatedState<ModelsState>({
				catalog: {
					revision: 1,
					availableModels: [
						{ provider: "test", modelId: "one", name: "Model One", reasoning: false },
						{ provider: "test", modelId: "two", name: "Model Two", reasoning: true },
					],
				},
				configuration: { model: { provider: "test", modelId: "one" }, thinkingLevel: "off" },
				refresh: { status: "idle" },
			});
			const create = vi.fn(async () => {
				const created = session("two", 2);
				directoryState.change(BACKGROUND_CONTEXT, (draft) => {
					draft.revision = 2;
					draft.sessions.push(created);
				});
				return created;
			});
			const select = vi.fn(async (model: { provider: string; modelId: string }, _context: unknown) => {
				modelsState.change(BACKGROUND_CONTEXT, (draft) => {
					draft.configuration.model = model;
				});
			});
			const selectThinking = vi.fn(async (thinkingLevel: "off" | "high", _context: unknown) => {
				modelsState.change(BACKGROUND_CONTEXT, (draft) => {
					draft.configuration.thinkingLevel = thinkingLevel;
				});
			});
			const transcriptState = replicatedState<TranscriptState>({
				snapshot: laneSnapshot() as LaneTranscriptSnapshot,
				event: null,
			});
			const emitTranscriptEvent = (event: LaneWatchEvent): void => {
				transcriptState.change(BACKGROUND_CONTEXT, (draft) => {
					if (reduceLaneSnapshot(draft.snapshot as unknown as LaneSnapshot, event) === "rebase") {
						throw new Error("Test transcript event unexpectedly requires a rebase");
					}
					draft.event = event;
				});
			};
			let finishPrompt!: () => void;
			const promptFinished = new Promise<void>((resolve) => {
				finishPrompt = resolve;
			});
			const prompt = vi.fn(async () => {
				emitTranscriptEvent({
					type: "run_start",
					lane: "main",
					runId: "run-1",
					startedAt: 1,
				});
				await promptFinished;
				emitTranscriptEvent({
					type: "entry_added",
					lane: "main",
					entry: {
						id: "entry-user",
						parentId: null,
						seq: 1,
						timestamp: 1,
						type: "message",
						message: { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
					},
				});
				emitTranscriptEvent({
					type: "entry_added",
					lane: "main",
					entry: {
						id: "entry-assistant",
						parentId: "entry-user",
						seq: 2,
						timestamp: 2,
						type: "message",
						message: {
							role: "assistant",
							content: [{ type: "text", text: "remote answer" }],
							provider: "test",
							model: "one",
							api: "test",
							usage: transcriptState.value.snapshot!.stats.usage,
							stopReason: "stop",
							timestamp: 2,
						},
					},
				});
				emitTranscriptEvent({
					type: "run_end",
					lane: "main",
					runId: "run-1",
					status: "completed",
					fromTipId: null,
					tipId: "entry-assistant",
					endedAt: 2,
				});
				return {
					ok: true as const,
					value: {
						operationId: "run-1",
						kind: "run" as const,
						status: "completed" as const,
						fromTipId: null,
						tipId: "entry-assistant",
						startedAt: 1,
						endedAt: 2,
					},
				};
			});

			const reloadSource =
				'import { defineFacet } from "@earendil-works/chord"; export default defineFacet(() => {});\n';
			const reloadArtifact: FacetBundleArtifact = {
				format: FACET_BUNDLE_ARTIFACT_FORMAT,
				formatVersion: FACET_BUNDLE_ARTIFACT_FORMAT_VERSION,
				plugin: { id: "test-tui-plugin" },
				entryName: "tui",
				entry: {
					file: "tui.mjs",
					integrity: `sha256-${createHash("sha256").update(reloadSource).digest("base64")}`,
					externalImports: ["@earendil-works/chord"],
				},
				source: reloadSource,
			};
			const reloadData = createPresentationFacetData([reloadArtifact]);
			const prepareSessionPlugins = vi.fn(async () => reloadData);
			const reloadPresentationPlugins = vi.fn(async () => reloadData);
			const reloadSessionPlugins = vi.fn(async () => {});
			const serverProvider = createHost({ name: "server", self: "server" });
			serverProvider.serve(SessionDirectory, () => ({ variant: "active", state: readable(directoryState) }));
			serverProvider.serve(PresentationPlugins, () => ({
				variant: "active",
				prepareSession: prepareSessionPlugins,
				reload: reloadPresentationPlugins,
			}));
			serverProvider.serve(SessionManagement, () => ({
				variant: "active",
				create,
				async remove() {},
				async attach(sessionId) {
					publishReplacement(attachment, { status: "attaching", sessionId });
				},
				async detach() {
					publishReplacement(attachment, { status: "detached" });
				},
			}));
			const sessionProvider = createHost({ name: "session", self: "worker" });
			sessionProvider.serve(SessionPlugins, () => ({ variant: "active", reload: reloadSessionPlugins }));
			sessionProvider.serve(Models, () => ({
				variant: "active",
				state: readable(modelsState),
				async cycleThinking() {},
				getThinkingLevels: () => ["off", "high"],
				async refresh() {},
				select,
				selectThinking: (level, ctx) => selectThinking(level as "off" | "high", ctx),
			}));
			sessionProvider.serve(AgentController, () => ({
				variant: "active",
				...createAgentController({ prompt } as unknown as AgentLane),
			}));
			sessionProvider.serve(Transcript, () => ({ variant: "active", state: readable(transcriptState) }));
			const host = createHost({ name: "presentation", kind: "client", self: "presentation" });
			const [serverLink, serverRemote] = createRoutedLinkPair();
			const [sessionLink, sessionRemote] = createRoutedLinkPair();
			serverProvider.accept(serverLink, { principal: "presentation", kind: "client" });
			sessionProvider.accept(sessionLink, { principal: "presentation", kind: "client" });
			host.route("server", { authorize: () => true, resolve: async () => serverRemote, principal: () => "server" });
			host.route("session", {
				authorize: () => true,
				resolve: async () => sessionRemote,
				principal: () => "session",
			});
			const serverServices: ServerServiceSource = { host, connection: connectionState, async dispose() {} };
			const sessionServices: SessionServiceSource = {
				host,
				attachment,
				async whenAttached(sessionId) {
					publishReplacement(attachment, { status: "attached", sessionId });
				},
				async whenDetached() {
					publishReplacement(attachment, { status: "detached" });
				},
				async dispose() {},
			};
			const server: ClientTuiServer = {
				serverId,
				radius: true,
				server: serverServices,
				session: sessionServices,
			};
			let finished = false;
			const requestRender = vi.fn();
			const ui = new TuiMainScreen(new ProcessTerminal());
			const component = await ExperimentalClientTui.create({
				command,
				ui,
				servers: [server],
				requestRender,
				finish() {
					finished = true;
				},
			});
			try {
				expect(create).toHaveBeenCalledTimes(creates);
				expect(prepareSessionPlugins).toHaveBeenCalledWith(
					{
						sessionId,
						packagePaths:
							"pluginPackages" in command
								? command.pluginPackages.map((packagePath) => resolve(packagePath))
								: null,
					},
					expect.anything(),
				);
				expect(attachment.value).toEqual({ status: "attached", sessionId });
				expect(select).not.toHaveBeenCalled();
				expect(component.render(80).join("\n")).toContain(`Server: ${serverId}`);
				expect(component.render(80).join("\n")).toContain(`Session: ${sessionId}`);
				expect(component.render(80).join("\n")).toContain("test/one");
				expect(component.render(80).join("\n")).not.toContain("Experimental Sessions");
				expect(component.render(80).join("\n")).not.toContain("Experimental Models");

				// Startup selection is the only behavior specific to continue and plugin-selected Sessions.
				if (kind !== "new") return;

				component.handleInput("hello");
				component.handleInput("\r");
				await vi.waitFor(() => expect(prompt).toHaveBeenCalledWith("hello", undefined, expect.anything()));
				await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("Working..."));
				finishPrompt();
				await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("remote answer"));
				expect(component.render(80).join("\n")).toContain("hello");
				expect(component.render(80).join("\n")).not.toContain("Working...");
				expect(component.render(80).join("\n")).not.toContain("Operation run-1 completed");

				component.handleInput("/reload");
				component.handleInput("\u001b");
				component.handleInput("\r");
				await vi.waitFor(() => {
					expect(reloadPresentationPlugins).toHaveBeenCalledOnce();
					expect(reloadSessionPlugins).toHaveBeenCalledOnce();
				});
				await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("Reloaded plugins."));

				publishReplacement(attachment, { status: "detached" });
				publishReplacement(connectionState, {
					status: "disconnected",
					since: "later",
					reason: "network lost",
					retryAt: null,
				});
				await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("retrying"));
				component.handleInput("\u0003");
				expect(finished).toBe(true);
				finished = false;
				component.handleInput("\u0004");
				expect(finished).toBe(true);
				finished = false;
				publishReplacement(connectionState, { status: "connecting", attempt: 1 });
				publishReplacement(connectionState, { status: "connected", since: "reconnected" });
				publishReplacement(attachment, { status: "attached", sessionId });
				await vi.waitFor(() => expect(component.render(80).join("\n")).not.toContain("Reattaching"));

				component.handleInput("/model");
				component.handleInput("\u001b");
				component.handleInput("\r");
				await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("Select model:"));
				component.handleInput("\u001b[B");
				component.handleInput("\r");
				await vi.waitFor(() =>
					expect(select).toHaveBeenCalledWith({ provider: "test", modelId: "two" }, expect.anything()),
				);
				expect(modelsState.value.configuration.model).toEqual({ provider: "test", modelId: "two" });
				await vi.waitFor(() => expect(component.render(80).join("\n")).not.toContain("Select model:"));

				component.handleInput("/thinking");
				component.handleInput("\u001b");
				component.handleInput("\r");
				await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("Select thinking level:"));
				component.handleInput("\u001b[B");
				component.handleInput("\r");
				await vi.waitFor(() => expect(selectThinking).toHaveBeenCalledWith("high", expect.anything()));
				expect(modelsState.value.configuration.thinkingLevel).toBe("high");

				component.handleInput("\u0003");
				await vi.waitFor(() => expect(finished).toBe(true));

				await component.close();
				const rendersAfterClose = requestRender.mock.calls.length;
				directoryState.change(BACKGROUND_CONTEXT, (draft) => {
					draft.revision = 3;
					draft.sessions = [];
				});
				publishReplacement(attachment, { status: "detached" });
				modelsState.change(BACKGROUND_CONTEXT, (draft) => {
					draft.refresh = { status: "refreshing" };
				});
				expect(requestRender).toHaveBeenCalledTimes(rendersAfterClose);
			} finally {
				await component.close();
				await Promise.all([host.close(), serverProvider.close(), sessionProvider.close()]);
			}
		},
	);
});
