import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

const SUMMARY_TEXT = "## Summary\n- The user started a task.";

/**
 * A tool whose execution blocks until released, so a test can act mid-run
 * (while the agent is streaming) before letting the turn complete.
 */
function createWaitTool(): {
	tool: AgentTool;
	release: () => void;
	waitForToolStart: (harness: Pick<Harness, "session">) => Promise<void>;
} {
	let releaseTool: (() => void) | undefined;
	const toolRelease = new Promise<void>((resolve) => {
		releaseTool = resolve;
	});
	const tool: AgentTool = {
		name: "wait",
		label: "Wait",
		description: "Wait for release",
		parameters: Type.Object({}),
		execute: async () => {
			await toolRelease;
			return {
				content: [{ type: "text", text: "released" }],
				details: {},
			};
		},
	};
	const waitForToolStart = (harness: Pick<Harness, "session">) =>
		new Promise<void>((resolve) => {
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "tool_execution_start" && event.toolName === "wait") {
					unsubscribe();
					resolve();
				}
			});
		});
	return { tool, release: () => releaseTool?.(), waitForToolStart };
}

function usage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

describe("AgentSession queued /compact", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("runs a /compact queued while streaming at the turn boundary, then resumes the run", async () => {
		const { tool: waitTool, release, waitForToolStart } = createWaitTool();
		const harness = await createHarness({
			tools: [waitTool],
			settings: { compaction: { keepRecentTokens: 1 } },
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage(SUMMARY_TEXT),
			fauxAssistantMessage("resumed after compact"),
		]);
		const promptPromise = harness.session.prompt("start");
		await waitForToolStart(harness);

		// The agent is mid-run; /compact must not interrupt the turn.
		expect(harness.session.isStreaming).toBe(true);
		harness.session.queueCompact();

		release();
		await promptPromise;

		// The compaction ran mid-run (before the run settled) with reason "manual".
		const compactionStarts = harness.eventsOfType("compaction_start");
		expect(compactionStarts).toHaveLength(1);
		expect(compactionStarts[0].reason).toBe("manual");
		const compactionEnds = harness.eventsOfType("compaction_end");
		expect(compactionEnds).toHaveLength(1);
		expect(compactionEnds[0].aborted).toBe(false);
		// The compaction happens mid-turn (split turn) but the whole replaced tail
		// (history + turn prefix) is summarized in a single call, so the summary is
		// that call's output.
		expect(compactionEnds[0].result?.summary).toBe(SUMMARY_TEXT);

		// Ordering: compaction completed after the tool results and before the
		// resumed assistant response, which itself completed before the run settled.
		const eventTypes = harness.events.map((event) => event.type);
		const compactionEndIndex = eventTypes.indexOf("compaction_end");
		const settledIndex = eventTypes.indexOf("agent_settled");
		expect(compactionEndIndex).toBeGreaterThanOrEqual(0);

		// The interrupted run resumed automatically after the compaction.
		expect(getAssistantTexts(harness)).toContain("resumed after compact");
		const resumedMessageEnd = harness.events.find(
			(event) =>
				event.type === "message_end" &&
				event.message.role === "assistant" &&
				event.message.content.some((part) => part.type === "text" && part.text === "resumed after compact"),
		);
		expect(resumedMessageEnd).toBeDefined();
		const resumedEndIndex = harness.events.indexOf(resumedMessageEnd!);
		expect(resumedEndIndex).toBeGreaterThan(compactionEndIndex);
		expect(settledIndex).toBeGreaterThan(resumedEndIndex);

		// The compaction entry landed in the session branch.
		expect(harness.sessionManager.getBranch().some((entry) => entry.type === "compaction")).toBe(true);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("does not auto-continue when the queued /compact lands on a turn that ended the run", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
		});
		harnesses.push(harness);

		// Hold the first (tool-less) response open so /compact can be queued
		// while it streams; the summarization request is served immediately.
		let releaseResponse: (() => void) | undefined;
		const responseRelease = new Promise<void>((resolve) => {
			releaseResponse = resolve;
		});
		let markFirstRequest = () => {};
		const firstRequest = new Promise<void>((resolve) => {
			markFirstRequest = resolve;
		});
		let requestCount = 0;
		harness.session.agent.streamFunction = (model, _context, _options) => {
			requestCount++;
			if (requestCount === 1) {
				markFirstRequest();
			}
			const stream = createAssistantMessageEventStream();
			void (async () => {
				if (requestCount === 1) {
					await responseRelease;
				}
				const text = requestCount === 1 ? "done" : SUMMARY_TEXT;
				const message: AssistantMessage = {
					...fauxAssistantMessage(text),
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: usage(10),
				};
				stream.push({ type: "done", reason: "stop", message });
			})();
			return stream;
		};

		const promptPromise = harness.session.prompt("start");
		await firstRequest;

		// The provider request is in flight: /compact is queued, not run.
		expect(harness.session.isStreaming).toBe(true);
		harness.session.queueCompact();

		releaseResponse!();
		await promptPromise;

		// Compaction ran, but the run had ended naturally: no continuation.
		const compactionStarts = harness.eventsOfType("compaction_start");
		expect(compactionStarts).toHaveLength(1);
		expect(compactionStarts[0].reason).toBe("manual");
		expect(harness.eventsOfType("compaction_end")).toHaveLength(1);
		expect(getAssistantTexts(harness)).toEqual(["done"]);
		expect(requestCount).toBe(2);
		expect(harness.events.some((event) => event.type === "agent_settled")).toBe(true);
		expect(harness.sessionManager.getBranch().some((entry) => entry.type === "compaction")).toBe(true);
	});

	it("cancelQueuedCompact clears the queued compaction without interrupting the stream", async () => {
		const { tool: waitTool, release, waitForToolStart } = createWaitTool();
		const harness = await createHarness({
			tools: [waitTool],
			settings: { compaction: { keepRecentTokens: 1 } },
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("completed without compaction"),
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForToolStart(harness);

		// Mid-run: a /compact is queued, then cancelled before the turn boundary.
		expect(harness.session.isStreaming).toBe(true);
		expect(harness.session.hasQueuedCompact).toBe(false);
		harness.session.queueCompact();
		expect(harness.session.hasQueuedCompact).toBe(true);
		harness.session.cancelQueuedCompact();
		expect(harness.session.hasQueuedCompact).toBe(false);

		release();
		await promptPromise;

		// No compaction ran; the stream completed without interruption.
		expect(harness.eventsOfType("compaction_start")).toHaveLength(0);
		expect(harness.eventsOfType("compaction_end")).toHaveLength(0);
		expect(getAssistantTexts(harness)).toContain("completed without compaction");
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.sessionManager.getBranch().some((entry) => entry.type === "compaction")).toBe(false);
	});

	it("does not resume the run when the queued compaction is cancelled", async () => {
		const { tool: waitTool, release, waitForToolStart } = createWaitTool();
		let markCompactionStarted = () => {};
		const compactionStarted = new Promise<void>((resolve) => {
			markCompactionStarted = resolve;
		});
		const harness = await createHarness({
			tools: [waitTool],
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				((pi: ExtensionAPI) => {
					pi.on("session_before_compact", async (event) => {
						return await new Promise<{ cancel: true }>((resolve) => {
							event.signal.addEventListener("abort", () => resolve({ cancel: true }), { once: true });
							markCompactionStarted();
						});
					});
				}) as never,
			],
		});
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("should not stream"),
		]);

		const promptPromise = harness.session.prompt("start");
		await waitForToolStart(harness);
		harness.session.queueCompact();
		release();

		await compactionStarted;
		harness.session.abortCompaction();
		await promptPromise;

		const compactionEnds = harness.eventsOfType("compaction_end");
		expect(compactionEnds).toHaveLength(1);
		expect(compactionEnds[0].aborted).toBe(true);
		// The run was interrupted mid-task, but a cancelled compaction must not
		// restart generation.
		expect(getAssistantTexts(harness)).not.toContain("should not stream");
		expect(harness.getPendingResponseCount()).toBe(1);
		expect(harness.events.some((event) => event.type === "agent_settled")).toBe(true);
	});
	it.each(["cancel", "failure", "cancel-with-follow-up"] as const)(
		"preserves queued compaction cancellation through SDK async stream setup (%s)",
		async (outcome) => {
			const tempDir = mkdtempSync(join(tmpdir(), "pi-queued-compact-sdk-"));
			const { tool, release, waitForToolStart } = createWaitTool();
			const faux = fauxProvider();
			const events: AgentSessionEvent[] = [];
			const requests: string[] = [];
			let preparingSummary = false;
			let summaryAuthCalls = 0;
			let releaseSetup = () => {};
			let prompt: Promise<void> | undefined;
			const { promise: setupStarted, resolve: markSetupStarted } = Promise.withResolvers<AbortSignal>();
			const modelRuntime = await ModelRuntime.create({
				credentials: AuthStorage.inMemory(),
				modelsStore: new InMemoryModelsStore(),
				modelsPath: null,
				allowModelNetwork: false,
			});
			modelRuntime.registerNativeProvider({
				...faux.provider,
				auth: {
					apiKey: {
						name: "Queued compaction test",
						check: async () => ({ type: "api_key" }),
						resolve: async ({ signal }) => {
							// The first auth resolves the summary preflight. Hold the second,
							// inside the SDK's standard stream wrapper and lazyStream setup.
							if (preparingSummary && ++summaryAuthCalls === 2) {
								let onAbort: (() => void) | undefined;
								try {
									await new Promise<void>((_resolve, reject) => {
										releaseSetup = () => reject(new Error("summary setup rejected"));
										onAbort = () => reject(signal.reason);
										signal.addEventListener("abort", onAbort, { once: true });
										markSetupStarted(signal);
									});
								} finally {
									if (onAbort) signal.removeEventListener("abort", onAbort);
								}
							}
							return { auth: { apiKey: "faux-key" } };
						},
					},
				},
			});
			await modelRuntime.refresh({ allowNetwork: false });
			const sessionManager = SessionManager.inMemory(tempDir);
			const extensionsResult = await createTestExtensionsResult(
				[
					(pi) => {
						pi.on("session_before_compact", () => {
							preparingSummary = true;
						});
					},
				],
				tempDir,
			);
			const { session } = await createAgentSession({
				cwd: tempDir,
				agentDir: tempDir,
				model: faux.getModel(),
				modelRuntime,
				sessionManager,
				settingsManager: SettingsManager.inMemory({
					compaction: { enabled: false, keepRecentTokens: 1 },
					retry: { enabled: false },
				}),
				resourceLoader: createTestResourceLoader({ extensionsResult }),
				tools: [tool.name],
				customTools: [tool],
			});
			try {
				session.subscribe((event) => events.push(event));
				faux.setResponses([
					fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
					(context) => {
						requests.push(JSON.stringify(context.messages));
						return fauxAssistantMessage("continued runnable work");
					},
				]);
				if (outcome === "cancel-with-follow-up") {
					faux.appendResponses([
						(context) => {
							requests.push(JSON.stringify(context.messages));
							return fauxAssistantMessage("answered accepted follow-up");
						},
					]);
				}
				const toolStarted = waitForToolStart({ session });
				prompt = session.prompt("start runnable task");
				await toolStarted;
				session.queueCompact();
				release();
				const setupSignal = await setupStarted;
				expect(setupSignal.aborted).toBe(false);
				expect(faux.state.callCount).toBe(1);
				expect(events.filter((event) => event.type === "tool_execution_end")).toHaveLength(1);
				if (outcome === "cancel-with-follow-up") await session.followUp("accepted next instruction");
				if (outcome === "failure") releaseSetup();
				else session.abortCompaction();
				await prompt;

				const compactionEnds = events.filter((event) => event.type === "compaction_end");
				expect(compactionEnds).toHaveLength(1);
				expect(compactionEnds[0]).toMatchObject({
					reason: "manual",
					aborted: outcome !== "failure",
					result: undefined,
				});
				if (outcome === "failure") {
					expect(compactionEnds[0].errorMessage).toBeDefined();
					expect(requests).toHaveLength(1);
					expect(requests[0]).toContain('"role":"toolResult"');
				} else if (outcome === "cancel-with-follow-up") {
					expect(requests).toHaveLength(2);
					expect(requests[0]).not.toContain("accepted next instruction");
					expect(requests[1]).toContain("accepted next instruction");
					expect(session.getFollowUpMessages()).toEqual([]);
				} else {
					expect(requests).toEqual([]);
					expect(faux.state.callCount).toBe(1);
					expect(faux.getPendingResponseCount()).toBe(1);
				}
				expect(sessionManager.getBranch().some((entry) => entry.type === "compaction")).toBe(false);
				expect(session.isCompacting).toBe(false);
				expect(session.hasQueuedCompact).toBe(false);
				expect(session.isIdle).toBe(true);
				expect(events.at(-1)?.type).toBe("agent_settled");
			} finally {
				release();
				releaseSetup();
				await session.abort();
				await prompt?.catch(() => {});
				session.dispose();
				rmSync(tempDir, { recursive: true, force: true });
			}
		},
	);
});
