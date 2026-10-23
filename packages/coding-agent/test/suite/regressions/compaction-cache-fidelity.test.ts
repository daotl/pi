/** Fitting summary history preserves provider-visible conversation and image payloads.
 * Request-local accounting metadata is not part of the provider cache prefix.
 */
import {
	type Context,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	normalizeContext,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { convertMessages } from "@earendil-works/pi-ai/api/google-shared";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

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

/** Seed `pairs` user/assistant message pairs and sync agent.state.messages. */
function seedPairs(harness: Harness, pairs: number): void {
	const now = Date.now();
	for (let i = 0; i < pairs; i++) {
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: `user message ${i}` }],
			timestamp: now - (pairs - i) * 1000,
		});
		const assistant = fauxAssistantMessage(`assistant message ${i}`, {
			stopReason: "stop",
			timestamp: now - (pairs - i) * 1000 + 1,
		});
		assistant.usage = createUsage(10);
		harness.sessionManager.appendMessage(assistant);
	}
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

/** Capture the summarization request context and return a canned summary. */
function captureSummarizationRequest(harness: Harness, onCapture: (context: Context) => void): void {
	harness.session.agent.streamFunction = (_model, context: Context, _options?: SimpleStreamOptions) => {
		onCapture(context);
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => {
			const message = { ...fauxAssistantMessage("the summary"), usage: createUsage(10) };
			stream.push({ type: "done", reason: "stop", message });
		});
		return stream;
	};
}

describe("compaction cache fidelity", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("after a prior compaction, the request keeps the prior summary in its prefix (no 22K divergence)", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		const now = Date.now();
		// Two pairs to be summarized by the PRIOR compaction.
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "old user 0" }],
			timestamp: now - 6000,
		});
		const a0 = fauxAssistantMessage("old assistant 0", { stopReason: "stop", timestamp: now - 5000 });
		a0.usage = createUsage(10);
		harness.sessionManager.appendMessage(a0);
		// Kept tail that survives the PRIOR compaction.
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "kept user" }],
			timestamp: now - 3000,
		});
		const aKept = fauxAssistantMessage("kept assistant", { stopReason: "stop", timestamp: now - 2000 });
		aKept.usage = createUsage(10);
		harness.sessionManager.appendMessage(aKept);
		const firstKeptEntryId = harness.sessionManager.getEntries().at(-1)!.id;
		harness.sessionManager.appendCompaction("prior summary", firstKeptEntryId, 100, undefined, false);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "new user" }],
			timestamp: now - 500,
		});
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		const agent = harness.session.agent;
		const transformed = agent.transformContext
			? await agent.transformContext(agent.state.messages, undefined)
			: agent.state.messages;
		const expectedFirst = (await agent.convertToLlm(transformed))[0];

		let captured: Context | undefined;
		captureSummarizationRequest(harness, (ctx) => {
			captured = ctx;
		});

		await harness.session.compact({ keepRecentMessages: 1 });

		expect(captured).toBeDefined();
		// The system prompt is folded into a leading system message by the shared
		// normalizeContext pipeline. The first CONTENT message of the request MUST be
		// the prior compactionSummary (so it byte-matches the cached normal-chat prefix).
		// Skipping it is the 22K divergence.
		const capturedContent = captured!.messages.filter((message) => message.role !== "system");
		expect(capturedContent[0]).toEqual(expectedFirst);
	});

	it("preserves the provider-visible normal chat prefix while retaining canonical usage", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		// 3 user/assistant pairs = 6 messages. Keep the last 2, summarize the first 4.
		seedPairs(harness, 3);
		const canonical = structuredClone(harness.sessionManager.getEntries());

		const agent = harness.session.agent;

		// The normal chat the summary must byte-match: system prompt + the full
		// session messages exactly as a normal turn would send them (pre-compaction).
		const transformed = agent.transformContext
			? await agent.transformContext(agent.state.messages, undefined)
			: agent.state.messages;
		const expectedLlm = await agent.convertToLlm(transformed);

		let captured: Context | undefined;
		captureSummarizationRequest(harness, (ctx) => {
			captured = ctx;
		});

		await harness.session.compact({ keepRecentMessages: 2 });

		expect(captured).toBeDefined();

		// The system prompt is folded into a leading system message by the shared
		// normalizeContext pipeline; verify it is present so the prefix starts with it.
		expect(captured!.messages[0]?.role).toBe("system");
		// Drop the leading system message and the trailing summarize instruction; the
		// rest must be a PREFIX of the normal chat content (nothing injected before the
		// head, nothing skipped).
		const capturedHead = captured!.messages.filter((message) => message.role !== "system").slice(0, -1);
		const expectedContent = expectedLlm.filter((message) => message.role !== "system");
		const wireModel = getModel("google", "gemini-2.5-flash");
		if (!wireModel) throw new Error("Missing Google converter fixture model");
		expect(convertMessages(wireModel, normalizeContext({ messages: capturedHead }))).toEqual(
			convertMessages(wireModel, normalizeContext({ messages: expectedContent.slice(0, capturedHead.length) })),
		);
		for (const entry of canonical) expect(harness.sessionManager.getEntry(entry.id)).toEqual(entry);
	});

	it("preserves image payloads in the provider-visible summarization prefix", async () => {
		const harness = await createHarness({ withConfiguredAuth: false });
		harnesses.push(harness);
		const now = Date.now();
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "look at this" }],
			timestamp: now - 5000,
		});
		const a0 = fauxAssistantMessage("I will", { stopReason: "stop", timestamp: now - 4000 });
		a0.usage = createUsage(10);
		harness.sessionManager.appendMessage(a0);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [
				{ type: "text", text: "here is the image" },
				{
					type: "image",
					data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4ZcAAAAASUVORK5CYII=",
					mimeType: "image/png",
				},
			],
			timestamp: now - 3000,
		});
		const a1 = fauxAssistantMessage("I see it", { stopReason: "stop", timestamp: now - 2000 });
		a1.usage = createUsage(10);
		harness.sessionManager.appendMessage(a1);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		const canonical = structuredClone(harness.sessionManager.getEntries());

		const agent = harness.session.agent;
		const transformed = agent.transformContext
			? await agent.transformContext(agent.state.messages, undefined)
			: agent.state.messages;
		const expectedLlm = await agent.convertToLlm(transformed);

		let captured: Context | undefined;
		captureSummarizationRequest(harness, (ctx) => {
			captured = ctx;
		});

		await harness.session.compact({ keepRecentMessages: 1 });

		expect(captured).toBeDefined();
		const capturedHead = captured!.messages.filter((message) => message.role !== "system").slice(0, -1);
		const expectedContent = expectedLlm.filter((message) => message.role !== "system");
		// The single-call summarization request head must byte-match the chat prefix,
		// including the image content block. A split turn that drops the history before
		// the image would diverge here and lose the cache for everything after it.
		const wireModel = getModel("google", "gemini-2.5-flash");
		if (!wireModel) throw new Error("Missing Google converter fixture model");
		const actualWire = convertMessages(wireModel, normalizeContext({ messages: capturedHead }));
		expect(actualWire).toEqual(
			convertMessages(wireModel, normalizeContext({ messages: expectedContent.slice(0, capturedHead.length) })),
		);
		expect(actualWire).toContainEqual({
			role: "user",
			parts: [
				{ text: "here is the image" },
				{
					inlineData: {
						mimeType: "image/png",
						data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4ZcAAAAASUVORK5CYII=",
					},
				},
			],
		});
		for (const entry of canonical) expect(harness.sessionManager.getEntry(entry.id)).toEqual(entry);
	});
});
