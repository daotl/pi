/**
 * Integration test: after compaction, the summary is tokenized via the model
 * server's /tokenize endpoint, the exact count is stored on the compaction entry,
 * and the post-compaction context usage (footer) reflects the tokenized total
 * instead of "?". A server without /tokenize leaves both as the chars/4 / "?"
 * fallback.
 */
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeTokenizerFixture, type NativeTokenizerFixture } from "./tokenizer-fixture.ts";

describe("compaction tokenization", () => {
	const fixtures: NativeTokenizerFixture[] = [];
	afterEach(() => {
		while (fixtures.length > 0) fixtures.pop()?.cleanup();
	});

	it("stores the /tokenize count on the entry and uses /chat/completions/input_tokens for context usage", async () => {
		const fixture = await createNativeTokenizerFixture();
		fixtures.push(fixture);
		const { session, manager } = fixture;

		let tokenizeCalls = 0;
		let chatTokenizeCalls = 0;
		fixture.setTokenizer(async (url) => {
			if (url.endsWith("/tokenize")) {
				tokenizeCalls++;
				return new Response(JSON.stringify({ tokens: new Array(42).fill(0) }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.endsWith("/chat/completions/input_tokens")) {
				chatTokenizeCalls++;
				return new Response(JSON.stringify({ input_tokens: 100 }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("unexpected", { status: 404 });
		});

		await session.compact({ keepRecentMessages: 1 });

		expect(tokenizeCalls).toBeGreaterThanOrEqual(1);
		expect(chatTokenizeCalls).toBeGreaterThanOrEqual(1);
		const entries = manager.getEntries();
		const compactionEntry = entries.find((e) => e.type === "compaction") as
			| ((typeof entries)[number] & { summaryTokens?: number })
			| undefined;
		expect(compactionEntry).toBeDefined();
		expect(compactionEntry!.summaryTokens).toBe(42);

		// No post-compaction assistant yet, so context usage comes from the
		// chat-tokenized total, not "?" (percent null).
		const usage = session.getContextUsage();
		expect(usage?.percent).not.toBeNull();
		expect(usage?.tokens).toBe(100);
	});

	it("sends the full chat messages to /chat/completions/input_tokens", async () => {
		const fixture = await createNativeTokenizerFixture();
		fixtures.push(fixture);

		let chatBody: unknown;
		fixture.setTokenizer(async (url, init) => {
			if (url.endsWith("/chat/completions/input_tokens")) {
				chatBody = JSON.parse(String(init?.body));
				return new Response(JSON.stringify({ input_tokens: 100 }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("unexpected", { status: 404 });
		});

		await fixture.session.compact({ keepRecentMessages: 1 });

		expect(chatBody).toBeDefined();
		const body = chatBody as { messages?: { role: string }[]; model?: string };
		expect(Array.isArray(body.messages)).toBe(true);
		expect(body.messages!.length).toBeGreaterThan(0);
		const roles = body.messages!.map((m) => m.role);
		expect(roles).toContain("user");
		expect(roles).toContain("assistant");
	});

	it("includes the system message in the chat tokenize request when present", async () => {
		const fixture = await createNativeTokenizerFixture();
		fixtures.push(fixture);
		// A session with a system prompt carries the leading system message; the
		// chat tokenize request must include it (unlike the flattened /tokenize).
		fixture.manager.appendMessage({
			role: "system",
			content: [{ type: "text", text: "System prompt" }],
			timestamp: Date.now(),
		});
		fixture.session.refreshContext();

		let chatBody: unknown;
		fixture.setTokenizer(async (url, init) => {
			if (url.endsWith("/chat/completions/input_tokens")) {
				chatBody = JSON.parse(String(init?.body));
				return new Response(JSON.stringify({ input_tokens: 100 }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			return new Response("unexpected", { status: 404 });
		});

		await fixture.session.compact({ keepRecentMessages: 1 });

		expect(chatBody).toBeDefined();
		const body = chatBody as { messages?: { role: string }[] };
		expect(Array.isArray(body.messages)).toBe(true);
		expect(body.messages!.some((m) => m.role === "system")).toBe(true);
	});

	it("falls back to chars/4 and a null percent when the server has no /tokenize", async () => {
		const fixture = await createNativeTokenizerFixture();
		fixtures.push(fixture);

		fixture.setTokenizer(async () => new Response("no endpoint", { status: 404 }));

		await fixture.session.compact({ keepRecentMessages: 1 });

		const entries = fixture.manager.getEntries();
		const compactionEntry = entries.find((e) => e.type === "compaction") as
			| ((typeof entries)[number] & { summaryTokens?: number })
			| undefined;
		expect(compactionEntry).toBeDefined();
		expect(compactionEntry!.summaryTokens).toBeUndefined();

		// No /tokenize and no post-compaction usage: footer falls back to the
		// chars/4 estimate. Crystal never shows "?" - the count is always present.
		const usage = fixture.session.getContextUsage();
		expect(usage?.percent).not.toBeNull();
		expect(usage?.tokens).toBeGreaterThan(0);
	});

	it("does not retry /tokenize or /chat/completions/input_tokens on a transient failure and falls back to the estimate", async () => {
		const fixture = await createNativeTokenizerFixture();
		fixtures.push(fixture);

		// Both endpoints are a single attempt with no retry: a transient failure
		// must not hang the compaction. It falls back to the chars/4 estimate.
		let calls = 0;
		fixture.setTokenizer(async () => {
			calls++;
			throw new Error("ECONNREFUSED");
		});

		await fixture.session.compact({ keepRecentMessages: 1 });

		// Two counting operations (summary + context), each a single attempt: no
		// retry on the transient failure.
		expect(calls).toBe(2);
		const usage = fixture.session.getContextUsage();
		expect(usage).toBeDefined();
		expect(usage!.percent).not.toBeNull();
		expect(usage!.tokens).toBeGreaterThan(0);
	});
	it.each([
		{ mode: "manual", keepRecentTokens: 1 },
		{ mode: "manual", keepRecentTokens: 1000000 },
		{ mode: "automatic", keepRecentTokens: 1 },
		{ mode: "automatic", keepRecentTokens: 1000000 },
	] as const)(
		"stops cancelled $mode preparation before hooks or empty results (budget $keepRecentTokens)",
		async ({ mode, keepRecentTokens }) => {
			let hookCalls = 0;
			const fixture = await createNativeTokenizerFixture({
				settings: { compaction: { enabled: true, keepRecentTokens }, retry: { enabled: false } },
				extensionFactories: [
					(pi) => {
						pi.on("session_before_compact", () => {
							hookCalls++;
							return { cancel: true };
						});
					},
				],
			});
			fixtures.push(fixture);
			let markStarted = () => {};
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			let release = () => {};
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			fixture.setTokenizer(async () => {
				markStarted();
				await gate;
				return new Response("no endpoint", { status: 404 });
			});
			fixture.setResponses([
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "maximum context length exceeded" }),
			]);
			const run =
				mode === "manual" ? fixture.session.compact({ keepRecentTokens }) : fixture.session.prompt("overflow");
			const outcome = run.then(
				() => undefined,
				(error: unknown) => error,
			);
			try {
				await Promise.race([
					started,
					outcome.then(() => {
						throw new Error("Preparation tokenizer did not start");
					}),
				]);
				fixture.session.abortCompaction();
				release();
				const result = await outcome;
				if (mode === "manual") expect(result).toBeInstanceOf(Error);
				expect(hookCalls).toBe(0);
				expect(fixture.session.isCompacting).toBe(false);
				expect(fixture.manager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
			} finally {
				release();
				await outcome;
			}
		},
	);
});
