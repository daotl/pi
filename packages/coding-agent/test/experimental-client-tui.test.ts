import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
	createHost,
	defineFacet,
	local,
	type MutableReplicatedState,
	type Readable,
	replicatedState,
} from "@earendil-works/chord";
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
import { Type } from "typebox";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { type ClientTuiServer, ExperimentalClientTui } from "../src/experimental/client-tui.ts";
import { ExperimentalChatView } from "../src/experimental/client-tui-chat.ts";
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

	test.each(["theme", "divergence", "dispose"] as const)(
		"stops detached live tool clocks on %s without stopping a replacement view",
		(transition) => {
			vi.useFakeTimers();
			const ui = new TuiMainScreen(new ProcessTerminal());
			const render = vi.spyOn(ui, "requestRender").mockImplementation(() => {});
			const view = new ExperimentalChatView(ui, process.cwd());
			const snapshot = laneSnapshot();
			snapshot.transcript.push({
				id: "user-1",
				parentId: null,
				seq: 1,
				timestamp: 1,
				type: "message",
				message: { role: "user", content: "run a command", timestamp: 1 },
			});
			snapshot.operation = {
				id: "run-1",
				kind: "run",
				status: "open",
				startedAt: 1,
				fromTipId: null,
				runningTools: [
					{
						status: "running",
						toolCallId: "call-1",
						toolName: "bash",
						args: { command: "sleep 10" },
						result: { content: [{ type: "text", text: "partial output" }], details: undefined },
					},
				],
			};
			try {
				view.apply(snapshot);
				expect(view.transcript.render(80).join("\n")).toContain("Elapsed");
				const liveTimers = vi.getTimerCount();
				if (transition === "theme") {
					view.refreshTheme(snapshot);
					expect(vi.getTimerCount()).toBe(liveTimers);
					render.mockClear();
					vi.advanceTimersByTime(1000);
					expect(render).toHaveBeenCalled();
				} else if (transition === "divergence") {
					view.apply(laneSnapshot());
					expect(vi.getTimerCount()).toBe(0);
				}
				view.dispose();
				view.dispose();
				expect(vi.getTimerCount()).toBe(0);
				render.mockClear();
				vi.advanceTimersByTime(3000);
				expect(render).not.toHaveBeenCalled();
			} finally {
				view.dispose();
				vi.useRealTimers();
			}
		},
	);

	test.each([
		["new", { command: "client" as const }, "two", 1],
		["continued", { command: "client" as const, continue: true }, "one", 0],
		["plugin-selected", { command: "client" as const, pluginPackages: ["./example-plugin"] }, "two", 1],
		["reattachment-race", { command: "client" as const }, "two", 1],
		["close-during-recovery", { command: "client" as const }, "two", 1],
		["close-before-recovery-load", { command: "client" as const }, "two", 1],
		["recovery-failure-during-close", { command: "client" as const }, "two", 1],
		["connected-detached", { command: "client" as const }, "two", 1],
		["connected-attaching", { command: "client" as const }, "two", 1],
		["connected-degraded", { command: "client" as const }, "two", 1],
		["connected-other-session", { command: "client" as const }, "two", 1],
	] as const)(
		"opens a %s Session and preserves its presentation lifecycle",
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
				sequence: 0,
				stream: null,
				events: [],
			});
			const emitTranscriptEvent = (event: LaneWatchEvent): void => {
				transcriptState.change(BACKGROUND_CONTEXT, (draft) => {
					if (reduceLaneSnapshot(draft.snapshot as unknown as LaneSnapshot, event) === "rebase") {
						throw new Error("Test transcript event unexpectedly requires a rebase");
					}
					if (event.type === "message_update") throw new Error("Fixture only publishes settled events");
					draft.events.push({ sequence: ++draft.sequence, event });
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
			const recoveryEntered = Promise.withResolvers<void>();
			const releaseRecovery = Promise.withResolvers<void>();
			let recoveryCancelled = false;
			let recovering = false;
			const recoveryFailure = new Error("Presentation activation failed during quit");
			const RecoveryProbe = local("test.tui-recovery", { version: 1, input: Type.Object({}) });
			const component = await ExperimentalClientTui.create({
				command,
				ui,
				servers: [server],
				requestRender,
				facetLoader: async () => ({
					facets:
						kind === "close-during-recovery"
							? [
									{
										name: "test-recovery-lifetime",
										...defineFacet(({ serve }) => {
											serve(
												RecoveryProbe,
												(_input, _principal, self) => {
													self.resource("activation", {
														version: 1,
														async open({ signal }) {
															if (!recovering) return;
															recoveryEntered.resolve();
															await Promise.race([
																releaseRecovery.promise,
																new Promise<void>((resolve) => {
																	const cancel = () => {
																		recoveryCancelled = true;
																		resolve();
																	};
																	if (signal.aborted) cancel();
																	else signal.addEventListener("abort", cancel, { once: true });
																}),
															]);
															await releaseRecovery.promise;
														},
													});
													return {};
												},
												{ lifetime: "host" },
											);
										}),
									},
								]
							: [],
					async dispose() {},
				}),
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

				if (kind.startsWith("connected-")) {
					// Match Client ordering: the Session link ends before attachment notification.
					sessionRemote.close("attachment replaced while connected");
					const next: SessionAttachmentState =
						kind === "connected-detached"
							? { status: "detached" }
							: kind === "connected-other-session"
								? { status: "attached", sessionId: "another-session" }
								: { status: kind === "connected-degraded" ? "degraded" : "attaching", sessionId };
					publishReplacement(attachment, next);
					await vi.waitFor(() => {
						component.refreshTheme();
						const output = component.render(80).join("\n");
						expect(output).not.toContain("test/one");
						expect(output).toContain(
							kind === "connected-attaching" || kind === "connected-degraded"
								? "Reattaching Session"
								: "Session detached",
						);
					});
					expect(connectionState.value.status).toBe("connected");
					component.handleInput("must not reach the old Session");
					component.handleInput("\r");
					expect(prompt).not.toHaveBeenCalled();
					return;
				}

				if (
					kind === "reattachment-race" ||
					kind === "close-before-recovery-load" ||
					kind === "recovery-failure-during-close"
				) {
					const loading = Promise.withResolvers<void>();
					const release = Promise.withResolvers<void>();
					const load = host.load.bind(host);
					const paused = vi.spyOn(host, "load").mockImplementationOnce(async (...args) => {
						loading.resolve();
						await release.promise;
						if (kind === "recovery-failure-during-close") throw recoveryFailure;
						await load(...args);
					});
					publishReplacement(attachment, { status: "attaching", sessionId });
					publishReplacement(attachment, { status: "attached", sessionId });
					try {
						await loading.promise;
						if (kind === "recovery-failure-during-close") {
							const closing = component.close();
							const closed = Promise.allSettled([closing]);
							release.resolve();
							const [result] = await closed;
							expect(result.status).toBe("rejected");
							if (result.status === "rejected") expect(result.reason).toBe(recoveryFailure);
							return;
						}
						await vi.waitFor(() => {
							component.refreshTheme();
							expect(component.render(80).join("\n")).not.toContain("test/one");
						});
						if (kind === "close-before-recovery-load") {
							const snapshot = laneSnapshot();
							snapshot.transcript.push({
								id: "during-close",
								parentId: null,
								seq: 1,
								timestamp: 1,
								type: "message",
								message: { role: "user", content: "must not remount after quit", timestamp: 1 },
							});
							publishReplacement(transcriptState, {
								snapshot: snapshot as LaneTranscriptSnapshot,
								sequence: 1,
								stream: null,
								events: [],
							});
							const frames: string[] = [];
							requestRender.mockImplementation(() => {
								frames.push(component.render(80).join("\n"));
							});
							const closing = component.close();
							release.resolve();
							await closing;
							const renders = requestRender.mock.calls.length;
							publishReplacement(attachment, { status: "attached", sessionId });
							expect(frames.join("\n")).not.toContain("must not remount after quit");
							expect(requestRender).toHaveBeenCalledTimes(renders);
							return;
						}
						publishReplacement(connectionState, {
							status: "disconnected",
							since: "again",
							reason: "second interruption",
							retryAt: null,
						});
						publishReplacement(attachment, { status: "attaching", sessionId });
						publishReplacement(connectionState, { status: "connected", since: "again" });
						publishReplacement(attachment, { status: "attached", sessionId });
						release.resolve();
						await vi.waitFor(() => {
							expect(component.render(80).join("\n")).toContain("test/one");
							expect(component.render(80).join("\n")).not.toContain("Reattaching");
						});
						component.handleInput("hello after recovery");
						component.handleInput("\r");
						finishPrompt();
						await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("remote answer"));
						return;
					} finally {
						release.resolve();
						paused.mockRestore();
					}
				}

				if (kind === "close-during-recovery") {
					recovering = true;
					publishReplacement(attachment, { status: "attaching", sessionId });
					publishReplacement(attachment, { status: "attached", sessionId });
					await recoveryEntered.promise;
					const closing = component.close();
					const closed = Promise.allSettled([closing]);
					let settled = false;
					void closed.then(() => {
						settled = true;
					});
					await vi.waitFor(() => expect(recoveryCancelled).toBe(true));
					expect(settled).toBe(false);
					releaseRecovery.resolve();
					await closing;
					const renders = requestRender.mock.calls.length;
					publishReplacement(transcriptState, {
						snapshot: laneSnapshot() as LaneTranscriptSnapshot,
						sequence: 1,
						stream: null,
						events: [],
					});
					expect(requestRender).toHaveBeenCalledTimes(renders);
					expect(component.render(80).join("\n")).not.toContain("remote answer");
					return;
				}
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
				releaseRecovery.resolve();
				await Promise.allSettled([
					component.close(),
					host.close(),
					serverProvider.close(),
					sessionProvider.close(),
				]);
			}
		},
	);
});
