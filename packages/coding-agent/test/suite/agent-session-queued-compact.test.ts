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

	it.each([true, false])(
		"honors natural tool-batch continuation through compact (terminate=%s)",
		async (terminate) => {
			const { tool: waitTool, release, waitForToolStart } = createWaitTool();
			const tool: AgentTool = {
				...waitTool,
				execute: async (...args) => ({ ...(await waitTool.execute(...args)), terminate }),
			};
			const harness = await createHarness({
				tools: [tool],
				settings: { compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } },
			});
			harnesses.push(harness);
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
				fauxAssistantMessage(SUMMARY_TEXT),
				fauxAssistantMessage("continued runnable work"),
			]);
			const started = waitForToolStart(harness);
			const prompt = harness.session.prompt("start");
			try {
				await started;
				harness.session.queueCompact();
				release();
				await prompt;
				expect(harness.eventsOfType("compaction_end")[0]?.result?.summary).toBe(SUMMARY_TEXT);
				expect(getAssistantTexts(harness).includes("continued runnable work")).toBe(!terminate);
				expect(harness.getPendingResponseCount()).toBe(terminate ? 1 : 0);
				expect(harness.session.isIdle).toBe(true);
			} finally {
				release();
				await harness.session.abort();
				await prompt.catch(() => {});
			}
		},
	);

	it("keeps an explicit end after queued compaction", async () => {
		const { tool, release, waitForToolStart } = createWaitTool();
		const harness = await createHarness({
			tools: [tool],
			finishTurn: () => ({ action: "end" }),
			settings: { compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } },
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage(SUMMARY_TEXT),
			fauxAssistantMessage("must not resume"),
		]);
		const started = waitForToolStart(harness);
		const prompt = harness.session.prompt("start");
		try {
			await started;
			harness.session.queueCompact();
			release();
			await prompt;
			expect(harness.eventsOfType("compaction_end")[0]?.result?.summary).toBe(SUMMARY_TEXT);
			expect(getAssistantTexts(harness)).not.toContain("must not resume");
			expect(harness.getPendingResponseCount()).toBe(1);
			expect(harness.session.isIdle).toBe(true);
		} finally {
			release();
			await harness.session.abort();
			await prompt.catch(() => {});
		}
	});

	it.each(["control", "success", "failure", "cancel"] as const)(
		"honors committed boundary input through queued compact (%s)",
		async (outcome) => {
			let handled = false;
			const requests: string[] = [];
			const harness = await createHarness({
				settings: { compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } },
				extensionFactories: [
					(pi) => {
						pi.on("turn_end", () => {
							if (handled) return;
							handled = true;
							return {
								entries: [
									{
										type: "custom_message",
										customType: "next-work",
										content: "exact next instruction",
										display: false,
									},
								],
								continue: true,
							};
						});
						pi.on("session_before_compact", (event) => {
							if (outcome === "cancel") return { cancel: true };
							if (outcome === "failure") return;
							return {
								compaction: {
									summary: SUMMARY_TEXT,
									firstKeptEntryId: event.preparation.firstKeptEntryId,
									tokensBefore: event.preparation.tokensBefore,
								},
							};
						});
					},
				],
			});
			harnesses.push(harness);
			harness.session.subscribe((event) => {
				if (event.type === "message_start" && event.message.role === "user" && outcome !== "control")
					harness.session.queueCompact();
			});
			harness.setResponses([
				fauxAssistantMessage("first completed answer"),
				...(outcome === "failure"
					? [fauxAssistantMessage("", { stopReason: "error", errorMessage: "summary rejected" })]
					: []),
				(context) => {
					requests.push(JSON.stringify(context.messages));
					return fauxAssistantMessage("answered next instruction");
				},
			]);
			await harness.session.prompt("start");
			if (outcome === "cancel") {
				expect(requests).toEqual([]);
				expect(harness.eventsOfType("compaction_end")[0]?.aborted).toBe(true);
			} else {
				expect(requests).toHaveLength(1);
				expect(requests[0]).toContain("exact next instruction");
				expect(getAssistantTexts(harness)).toContain("answered next instruction");
				if (outcome !== "control") {
					const end = harness.eventsOfType("compaction_end")[0];
					if (outcome === "failure") expect(end?.errorMessage).toBeDefined();
					else expect(end?.result?.summary).toBe(SUMMARY_TEXT);
					const providerAnswer = harness.events.findIndex(
						(event) =>
							event.type === "message_end" &&
							event.message.role === "assistant" &&
							event.message.content.some(
								(part) => part.type === "text" && part.text === "answered next instruction",
							),
					);
					expect(harness.events.findIndex((event) => event.type === "compaction_end")).toBeLessThan(
						providerAnswer,
					);
				}
			}
			expect(harness.session.isIdle).toBe(true);
		},
	);

	it.each((["prompt", "continue"] as const).flatMap((mode) => [false, true].map((cancel) => ({ mode, cancel }))))(
		"runs a compact accepted at the final $mode settle boundary (cancel $cancel)",
		async ({ mode, cancel }) => {
			let queueAtSettle = true;
			const harness = await createHarness({
				settings: { compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false } },
				extensionFactories: [
					(pi) => {
						pi.on("agent_before_settle", () => {
							if (queueAtSettle) {
								queueAtSettle = false;
								harness.session.queueCompact();
							}
						});
						pi.on("session_before_compact", (event) =>
							cancel
								? { cancel: true }
								: {
										compaction: {
											summary: SUMMARY_TEXT,
											firstKeptEntryId: event.preparation.firstKeptEntryId,
											tokensBefore: event.preparation.tokensBefore,
										},
									},
						);
					},
				],
			});
			harnesses.push(harness);
			harness.sessionManager.appendMessage({ role: "user", content: "older request", timestamp: 1 });
			harness.sessionManager.appendMessage(fauxAssistantMessage("older answer", { timestamp: 2 }));
			if (mode === "continue")
				harness.sessionManager.appendMessage({ role: "user", content: "pending request", timestamp: 3 });
			harness.session.refreshContext();
			harness.setResponses([fauxAssistantMessage("final answer")]);
			if (mode === "prompt") await harness.session.prompt("new request");
			else await harness.session.continue();
			const checkpoints = harness.sessionManager.getBranch().filter((entry) => entry.type === "compaction");
			if (cancel) expect(checkpoints).toEqual([]);
			else expect(checkpoints).toMatchObject([{ summary: SUMMARY_TEXT }]);
			expect(harness.session.hasQueuedCompact).toBe(false);
			expect(harness.faux.state.callCount).toBe(1);
			expect(harness.eventsOfType("compaction_end")).toHaveLength(1);
			expect(harness.eventsOfType("compaction_end")[0]?.aborted).toBe(cancel);
			const order = harness.events.map((event) => event.type);
			expect(order.indexOf("compaction_end")).toBeLessThan(order.indexOf("agent_settled"));
			expect(harness.session.isIdle).toBe(true);
		},
	);

	it.each(["none", "success", "failure"] as const)(
		"does not reuse a cancelled retry grant after %s queued compaction",
		async (compactOutcome) => {
			let summaryPending = false;
			const harness = await createHarness({
				settings: {
					compaction: { enabled: false, keepRecentTokens: 1 },
					retry: { enabled: true, maxRetries: 1, baseDelayMs: 10_000 },
				},
				extensionFactories: [
					(pi) => {
						pi.on("session_before_compact", (event) => {
							if (compactOutcome === "failure") {
								summaryPending = true;
								return;
							}
							return {
								compaction: {
									summary: SUMMARY_TEXT,
									firstKeptEntryId: event.preparation.firstKeptEntryId,
									tokensBefore: event.preparation.tokensBefore,
								},
							};
						});
					},
				],
			});
			harnesses.push(harness);
			harness.setResponses([fauxAssistantMessage("older answer")]);
			await harness.session.prompt("older request ".repeat(20));
			const ordinaryStream = harness.session.agent.streamFunction;
			harness.session.agent.streamFunction = (model, context, options) => {
				if (summaryPending) {
					summaryPending = false;
					const stream = createAssistantMessageEventStream();
					stream.push({
						type: "error",
						reason: "error",
						error: fauxAssistantMessage("", {
							stopReason: "error",
							errorMessage: "invalid summary request",
						}),
					});
					return stream;
				}
				return ordinaryStream(model, context, options);
			};
			const { promise: retryStarted, resolve: markRetryStarted } = Promise.withResolvers<void>();
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type === "auto_retry_start") markRetryStarted();
			});
			let requests = 0;
			harness.setResponses([
				() => {
					requests++;
					if (compactOutcome !== "none") harness.session.queueCompact();
					return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." });
				},
				() => {
					requests++;
					return fauxAssistantMessage("unwanted resumed task");
				},
			]);
			const prompt = harness.session.prompt("retry this request");
			try {
				await Promise.race([
					retryStarted,
					prompt.then(() => {
						throw new Error("Retry did not start");
					}),
				]);
				expect(harness.session.isRetrying).toBe(true);
				harness.session.abortRetry();
				await prompt;
				expect(requests).toBe(1);
				expect(getAssistantTexts(harness)).not.toContain("unwanted resumed task");
				expect(harness.session.isRetrying).toBe(false);
				expect(harness.session.isIdle).toBe(true);
				expect(harness.session.hasQueuedCompact).toBe(false);
			} finally {
				unsubscribe();
				await harness.session.abort();
				await prompt.catch(() => {});
			}
		},
	);

	it.each([
		{ policy: "control", enabled: true, maxRetries: 1, compact: false, cancel: false, expectedRequests: 2 },
		{ policy: "disabled", enabled: false, maxRetries: 1, compact: true, cancel: false, expectedRequests: 1 },
		{ policy: "zero", enabled: true, maxRetries: 0, compact: true, cancel: false, expectedRequests: 1 },
		{ policy: "one", enabled: true, maxRetries: 1, compact: true, cancel: false, expectedRequests: 2 },
		{
			policy: "unlimited",
			enabled: true,
			maxRetries: Number.POSITIVE_INFINITY,
			compact: true,
			cancel: false,
			expectedRequests: 3,
		},
		{ policy: "cancel", enabled: true, maxRetries: 1, compact: true, cancel: true, expectedRequests: 1 },
		{
			policy: "failure",
			enabled: true,
			maxRetries: 1,
			compact: true,
			cancel: false,
			failure: true,
			expectedRequests: 2,
		},
		{
			policy: "disabled-failure",
			enabled: false,
			maxRetries: 1,
			compact: true,
			cancel: false,
			failure: true,
			expectedRequests: 1,
		},
	])(
		"compacts completed retryable boundary before backoff with $policy retry/cancellation policy",
		async ({ enabled, maxRetries, compact, cancel, failure, expectedRequests }) => {
			const order: string[] = [];
			let summaryPending = false;
			const harness = await createHarness({
				settings: {
					compaction: { enabled: false, keepRecentTokens: 1 },
					retry: { enabled, maxRetries, baseDelayMs: 0 },
				},
				extensionFactories: [
					(pi) => {
						pi.on("session_before_compact", (event) => {
							if (cancel) return { cancel: true };
							if (failure) {
								summaryPending = true;
								return;
							}
							return {
								compaction: {
									summary: SUMMARY_TEXT,
									firstKeptEntryId: event.preparation.firstKeptEntryId,
									tokensBefore: event.preparation.tokensBefore,
								},
							};
						});
					},
				],
			});
			harnesses.push(harness);
			harness.session.subscribe((event) => {
				if (
					event.type === "compaction_start" ||
					event.type === "compaction_end" ||
					event.type === "auto_retry_start"
				)
					order.push(event.type);
			});
			harness.setResponses([fauxAssistantMessage("older answer")]);
			await harness.session.prompt("older request ".repeat(20));
			const ordinaryStream = harness.session.agent.streamFunction;
			harness.session.agent.streamFunction = (model, context, options) => {
				if (summaryPending) {
					summaryPending = false;
					const stream = createAssistantMessageEventStream();
					const error = fauxAssistantMessage("", { stopReason: "error", errorMessage: "invalid summary request" });
					stream.push({ type: "error", reason: "error", error });
					return stream;
				}
				return ordinaryStream(model, context, options);
			};
			let requests = 0;
			harness.setResponses(
				[0, 1, 2].map((attempt) => () => {
					requests++;
					order.push(`provider:${requests}`);
					if (attempt === 0 && compact) harness.session.queueCompact();
					return attempt < 2
						? fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." })
						: fauxAssistantMessage("bounded recovery");
				}),
			);
			await harness.session.prompt("retry this request");
			expect(requests).toBe(expectedRequests);
			if (compact) {
				expect(order.slice(0, 3)).toEqual(["provider:1", "compaction_start", "compaction_end"]);
				expect(harness.eventsOfType("compaction_end")[0]?.aborted).toBe(cancel);
				const outcome = harness.eventsOfType("compaction_end")[0];
				if (failure || cancel) {
					expect(outcome?.result).toBeUndefined();
					expect(harness.sessionManager.getBranch().some((entry) => entry.type === "compaction")).toBe(false);
				} else {
					expect(outcome?.result?.summary).toBe(SUMMARY_TEXT);
				}
			} else expect(order).not.toContain("compaction_start");
			expect(harness.eventsOfType("auto_retry_start").map((event) => event.attempt)).toEqual(
				Array.from({ length: expectedRequests - 1 }, (_, attempt) => attempt + 1),
			);
			expect(harness.session.isIdle).toBe(true);
			expect(harness.session.hasQueuedCompact).toBe(false);
			if (expectedRequests === 3) expect(getAssistantTexts(harness)).toContain("bounded recovery");
		},
	);

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

	it.each([false, true])(
		"does not restart an ended tool-less answer through compact (continue=%s)",
		async (continueDecision) => {
			const harness = await createHarness({
				settings: { compaction: { keepRecentTokens: 1 } },
				finishTurn: continueDecision
					? (turn) =>
							turn.message.content.some((part) => part.type === "text" && part.text === "done")
								? { action: "continue" }
								: undefined
					: undefined,
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
		},
	);

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
