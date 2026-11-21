/**
 * Regression: a /continue issued after a completed /compact must not corrupt
 * the session.
 *
 * When compaction completes, the leaf path ends with the kept (partial)
 * assistant message followed by a compaction entry. A prefill continuation
 * captures that partial and must:
 * - compute its restore point as the message's parent (not the compaction
 *   entry's index), so a failed continuation does not throw "Entry not found"
 * - preserve the compaction entry across both successful and failed
 *   continuations (the compaction must not be "lost", which would overflow
 *   context)
 */

import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness, type HarnessOptions } from "../harness.ts";

/** An endpoint that opted in to prefill continuation; without the flag the partial is regenerated. */
const prefillHarnessOptions: HarnessOptions = {
	fauxApi: "openai-completions",
	compat: { supportsPrefillContinuation: true },
};

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/** Seed [user, assistant] (then `question` if given) plus a continuable partial assistant message. */
function seedSessionWithPartial(harness: Harness, question?: string): void {
	harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
	const now = Date.now();
	harness.sessionManager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "message to compact" }],
		timestamp: now - 1000,
	});
	const assistant = fauxAssistantMessage("assistant response to compact", {
		stopReason: "stop",
		timestamp: now - 500,
	});
	assistant.usage = createUsage(100);
	harness.sessionManager.appendMessage(assistant);
	if (question !== undefined) {
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: question }],
			timestamp: now - 100,
		});
	}
	// Continuable partial assistant message on the openai-completions provider.
	harness.sessionManager.appendMessage(
		fauxAssistantMessage("partial response", { stopReason: "length", timestamp: now }),
	);
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

/** Count compaction entries on the active leaf path. */
function compactionEntryCount(harness: Harness): number {
	return harness.sessionManager.getBranch().filter((e) => e.type === "compaction").length;
}

/** The partial message must sit immediately before a trailing compaction entry. */
function compactionFollowsPartial(harness: Harness): boolean {
	const branch = harness.sessionManager.getBranch();
	if (branch.length < 2) return false;
	return branch[branch.length - 1].type === "compaction" && branch[branch.length - 2].type === "message";
}

describe("continue after compaction preserves the compaction entry", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("compact keeps the partial message with a trailing compaction entry", async () => {
		const harness = await createHarness(prefillHarnessOptions);
		harnesses.push(harness);
		seedSessionWithPartial(harness);

		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("compact summary") });
			});
			return stream;
		};

		await harness.session.compact();

		expect(compactionEntryCount(harness)).toBe(1);
		expect(compactionFollowsPartial(harness)).toBe(true);
	});

	it("successful continue preserves the compaction entry", async () => {
		const harness = await createHarness(prefillHarnessOptions);
		harnesses.push(harness);
		seedSessionWithPartial(harness);

		// Compaction produces a summary.
		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("compact summary") });
			});
			return stream;
		};
		await harness.session.compact();
		expect(compactionEntryCount(harness)).toBe(1);

		// Continue: the partial is captured as a prefill, the provider echoes it
		// and appends new tokens.
		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({
					type: "done",
					reason: "stop",
					message: fauxAssistantMessage("partial response continued"),
				});
			});
			return stream;
		};

		await expect(harness.session.continue()).resolves.toBeUndefined();

		// No "Entry not found", no compaction lost.
		expect(compactionEntryCount(harness)).toBe(1);
		// The continuation replaced the partial with the completed response.
		const texts = harness.session.messages.filter((m) => m.role === "assistant").map((m) => getMessageText(m));
		expect(texts.some((t) => t.includes("continued"))).toBe(true);
	});

	it("failed continue restores the partial and keeps the compaction entry", async () => {
		const harness = await createHarness(prefillHarnessOptions);
		harnesses.push(harness);
		seedSessionWithPartial(harness);

		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("compact summary") });
			});
			return stream;
		};
		await harness.session.compact();
		expect(compactionEntryCount(harness)).toBe(1);

		// The prefill echo does not match (simulating a failed prefill
		// continuation): the provider returns an error message.
		harness.session.agent.streamFunction = (model) => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				const error: AssistantMessage = {
					...fauxAssistantMessage("", {
						stopReason: "error",
						errorMessage: "prefill echo mismatch",
					}),
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: createUsage(0),
				};
				stream.push({ type: "error", reason: "error", error });
			});
			return stream;
		};

		// The continuation fails; it must restore the partial without throwing
		// "Entry not found" and without losing the compaction entry. The failure
		// is handled internally (restore + non-retryable error), so continue()
		// resolves normally.
		await expect(harness.session.continue()).resolves.toBeUndefined();
		expect(compactionEntryCount(harness)).toBe(1);
		// The original partial message is restored to the transcript.
		const texts = harness.session.messages.filter((m) => m.role === "assistant").map((m) => getMessageText(m));
		expect(texts).toContain("partial response");
	});

	it("regenerating without prefill support keeps the compaction and the partial", async () => {
		// An endpoint without supportsPrefillContinuation: the partial cannot be continued.
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);
		seedSessionWithPartial(harness, "second question");

		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("compact summary") });
			});
			return stream;
		};
		await harness.session.compact();
		expect(compactionFollowsPartial(harness)).toBe(true);

		let sent: string[] = [];
		harness.session.agent.streamFunction = (_model, context) => {
			sent = context.messages.map((m) => getMessageText(m));
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("fresh response") });
			});
			return stream;
		};

		await expect(harness.session.continue()).resolves.toBeUndefined();

		// The compaction stays in effect: with keepRecentTokens 1 it kept only the partial, so the
		// request is its summary alone, without the summarized history or the partial.
		expect(compactionEntryCount(harness)).toBe(1);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("compact summary");
		expect(sent).not.toContain("second question");
		// The partial is set aside, not erased: /restore brings it back.
		const partial = harness.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && getMessageText(entry.message) === "partial response");
		expect(partial).toMatchObject({ deletedAt: expect.any(String) });
	});

	it("regenerating a partial the compaction kept first does not bring back the summarized history", async () => {
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);
		const now = Date.now();
		harness.sessionManager.appendMessage({ role: "user", content: "old question", timestamp: now - 2000 });
		harness.sessionManager.appendMessage(fauxAssistantMessage("old answer", { timestamp: now - 1000 }));
		const partialId = harness.sessionManager.appendMessage(
			fauxAssistantMessage("partial response", { stopReason: "length", timestamp: now }),
		);
		// The compaction kept only the partial; everything before it is in the summary.
		harness.sessionManager.appendCompaction("compact summary", partialId, 1000);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		let sent: string[] = [];
		harness.session.agent.streamFunction = (_model, context) => {
			sent = context.messages.map((m) => getMessageText(m));
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("fresh response") });
			});
			return stream;
		};

		await expect(harness.session.continue()).resolves.toBeUndefined();

		// The request carries the summary only, not the summarized history.
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("compact summary");
		expect(sent).not.toContain("old question");
		expect(sent).not.toContain("partial response");
	});
});
