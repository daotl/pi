import type { AssistantMessage, AssistantMessageEvent, Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent.ts";
import { type ProxyAssistantMessageEvent, streamProxy } from "../src/proxy.ts";

const model: Model<"openai-responses"> = {
	id: "gpt-5.4",
	name: "GPT-5.4",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

const usage: AssistantMessage["usage"] = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("streamProxy", () => {
	it("preserves tool-call metadata received only on toolcall_end", async () => {
		const proxyEvents: ProxyAssistantMessageEvent[] = [
			{ type: "start" },
			{ type: "toolcall_start", contentIndex: 0, id: "call_test|fc_test", toolName: "lookup" },
			{ type: "toolcall_delta", contentIndex: 0, delta: '{"value":"hello"}' },
			{
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: {
					type: "toolCall",
					id: "call_test|fc_test",
					name: "lookup",
					arguments: { value: "hello" },
					namespace: "dynamic_tools",
				},
			},
			{ type: "done", reason: "toolUse", usage },
		];
		const body = proxyEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);

		const stream = streamProxy(model, normalizeContext({ systemPrompt: "", messages: [] }), {
			authToken: "test-token",
			proxyUrl: "https://proxy.example.com",
		});
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) events.push(event);
		const result = await stream.result();
		const endEvent = events.find((event) => event.type === "toolcall_end");

		expect(endEvent).toMatchObject({
			type: "toolcall_end",
			toolCall: { namespace: "dynamic_tools" },
		});
		expect(result.content[0]).toMatchObject({
			type: "toolCall",
			arguments: { value: "hello" },
			namespace: "dynamic_tools",
		});
	});

	// Regression tests for https://github.com/earendil-works/pi/issues/8996
	it("processes terminal metadata when the event is not newline-terminated", async () => {
		const start = `data: ${JSON.stringify({ type: "start" })}\n\n`;
		const done = `data: ${JSON.stringify({ type: "done", reason: "stop", usage, providerThinkingLevel: "high" })}`;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(start + done, { status: 200 })),
		);

		const stream = streamProxy(model, normalizeContext({ systemPrompt: "", messages: [] }), {
			authToken: "test-token",
			proxyUrl: "https://proxy.example.com",
		});
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) events.push(event);
		const result = await stream.result();

		expect(events.map((event) => event.type)).toEqual(["start", "done"]);
		expect(result.stopReason).toBe("stop");
		expect(result.providerThinkingLevel).toBe("high");
	});

	it("emits an error instead of hanging when the stream ends without a terminal event", async () => {
		const body = `data: ${JSON.stringify({ type: "start" })}\n\n`;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(body, { status: 200 })),
		);

		const stream = streamProxy(model, normalizeContext({ systemPrompt: "", messages: [] }), {
			authToken: "test-token",
			proxyUrl: "https://proxy.example.com",
		});
		const events: AssistantMessageEvent[] = [];
		for await (const event of stream) events.push(event);
		const result = await stream.result();

		expect(events.map((event) => event.type)).toEqual(["start", "error"]);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("Connection closed by proxy server");
	});

	it("keeps raw-only tool increments after an interrupted proxy response and forwards prefill intent", async () => {
		const events = [
			{ type: "start" },
			{ type: "toolcall_start", contentIndex: 0, id: "call", toolName: "read" },
			{ type: "toolcall_delta", contentIndex: 0, delta: '{"path":"/tmp', rawDelta: "<raw-prefix>" },
			{ type: "toolcall_delta", contentIndex: 0, delta: "", rawDelta: "<raw-tail>" },
		];
		let requestOptions: Record<string, unknown> | undefined;
		vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
			requestOptions = JSON.parse(String(init?.body)).options;
			return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
		});
		const stream = streamProxy(model, normalizeContext({ messages: [] }), {
			authToken: "offline",
			proxyUrl: "https://proxy.invalid",
			returnPrefill: true,
		});
		for await (const _event of stream) {
			/* Drain actual transport. */
		}
		const response = await stream.result();
		expect(requestOptions?.returnPrefill).toBe(true);
		expect(response.stopReason).toBe("error");
		expect(response.content).toEqual([
			expect.objectContaining({
				type: "toolCall",
				id: "call",
				name: "read",
				arguments: { path: "/tmp" },
				raw: "<raw-prefix><raw-tail>",
			}),
		]);
	});

	it.each(["eof", "error"] as const)(
		"keeps interleaved raw prefixes independent when proxy ends by %s",
		async (ending) => {
			const proxyEvents = [
				{ type: "start" },
				{ type: "toolcall_start", contentIndex: 0, id: "first", toolName: "read" },
				{ type: "toolcall_start", contentIndex: 1, id: "second", toolName: "write" },
				{ type: "toolcall_delta", contentIndex: 0, delta: '{"path":"a', rawDelta: "<first>" },
				{ type: "toolcall_delta", contentIndex: 1, delta: '{"path":"b', rawDelta: "<second>" },
				{ type: "toolcall_delta", contentIndex: 0, delta: "", rawDelta: "<tail>" },
				...(ending === "error" ? [{ type: "error", reason: "error", usage, errorMessage: "interrupted" }] : []),
			];
			vi.stubGlobal(
				"fetch",
				async () => new Response(proxyEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
			);
			const stream = streamProxy(model, normalizeContext({ messages: [] }), {
				authToken: "offline",
				proxyUrl: "https://proxy.invalid",
			});
			for await (const _event of stream) {
				/* Drain actual transport. */
			}
			expect((await stream.result()).content).toEqual([
				expect.objectContaining({ id: "first", arguments: { path: "a" }, raw: "<first><tail>" }),
				expect.objectContaining({ id: "second", arguments: { path: "b" }, raw: "<second>" }),
			]);
		},
	);

	it("continues an actual Agent prefix through a backend that only echoes when prefill is forwarded", async () => {
		const selected: Model<"openai-completions"> = { ...model, api: "openai-completions" };
		const prefix: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "original prefix" }],
			api: selected.api,
			provider: selected.provider,
			model: selected.id,
			usage,
			stopReason: "aborted",
			timestamp: 1,
		};
		let requests = 0;
		vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
			requests++;
			const request = JSON.parse(String(init?.body));
			const text = request.options.returnPrefill === true ? "original prefix completed" : "new answer without echo";
			const events: ProxyAssistantMessageEvent[] = [
				{ type: "start" },
				{ type: "text_start", contentIndex: 0 },
				{ type: "text_delta", contentIndex: 0, delta: text },
				{ type: "text_end", contentIndex: 0 },
				{ type: "done", reason: "stop", usage },
			];
			return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
		});
		const agent = new Agent({
			initialState: { model: selected, messages: [{ role: "user", content: "question", timestamp: 0 }] },
			streamFn: (target, context, options) =>
				streamProxy(target, context, { ...options, authToken: "offline", proxyUrl: "https://proxy.invalid" }),
		});
		await agent.continue(prefix);
		expect(requests).toBe(1);
		expect(agent.state.messages.at(-1)).toMatchObject({
			role: "assistant",
			stopReason: "stop",
			content: [{ type: "text", text: "original prefix completed" }],
		});
	});

	it.each([undefined, "", "<final>"])("uses authoritative proxy tool end raw %j", async (raw) => {
		const final = {
			type: "toolCall" as const,
			id: "call",
			name: "read",
			arguments: { path: "a" },
			...(raw === undefined ? {} : { raw }),
		};
		const events: ProxyAssistantMessageEvent[] = [
			{ type: "start" },
			{ type: "toolcall_start", contentIndex: 0, id: "call", toolName: "read" },
			{ type: "toolcall_delta", contentIndex: 0, delta: '{"path":"a"}', rawDelta: "<stale>" },
			{ type: "toolcall_end", contentIndex: 0, toolCall: final },
			{ type: "done", reason: "toolUse", usage },
		];
		vi.stubGlobal(
			"fetch",
			async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")),
		);
		const response = await streamProxy(model, normalizeContext({ messages: [] }), {
			authToken: "offline",
			proxyUrl: "https://proxy.invalid",
		}).result();
		expect(response.content).toEqual([final]);
	});
});
