import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimple } from "../src/api/openai-completions.ts";
import type { AssistantMessageEvent, Model, Tool } from "../src/types.ts";
import {
	type AssistantMessageFrame,
	AssistantMessageFrameEncoder,
	reduceAssistantMessageFrames,
} from "../src/utils/assistant-message-frame.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const mockState = vi.hoisted(() => ({
	chunks: undefined as
		| Array<null | {
				id?: string;
				choices?: Array<{ delta: Record<string, unknown>; finish_reason: string | null; usage?: unknown }>;
				usage?: {
					prompt_tokens: number;
					completion_tokens: number;
					prompt_tokens_details: { cached_tokens: number; cache_write_tokens?: number };
					completion_tokens_details: { reasoning_tokens: number };
				};
		  }>
		| undefined,
	interrupt: false,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: () => {
					const stream = {
						async *[Symbol.asyncIterator]() {
							const chunks = mockState.chunks ?? [
								{
									choices: [{ delta: {}, finish_reason: "stop" }],
									usage: {
										prompt_tokens: 1,
										completion_tokens: 1,
										prompt_tokens_details: { cached_tokens: 0 },
										completion_tokens_details: { reasoning_tokens: 0 },
									},
								},
							];
							for (const chunk of chunks) {
								yield chunk;
							}
							if (mockState.interrupt) throw new Error("Connection interrupted");
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

const model: Model<"openai-completions"> = {
	id: "raw-tool-test",
	name: "Raw tool test",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://example.test/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
};

// Simulate a transport that retains event deltas but omits the live raw snapshot.
// Exclude authoritative ends so replay must recover raw from progress alone.
function encodeProgress(
	encoder: AssistantMessageFrameEncoder,
	event: AssistantMessageEvent,
): AssistantMessageFrame | undefined {
	if (event.type === "toolcall_end" || event.type === "done" || event.type === "error") return undefined;
	const partial = {
		...event.partial,
		content: event.partial.content.map((block) => {
			if (block.type !== "toolCall") return block;
			const { raw: _raw, ...toolCall } = block;
			return toolCall;
		}),
	};
	return encoder.encode({ ...event, partial });
}

describe("openai-completions __raw tool-call capture", () => {
	beforeEach(() => {
		mockState.chunks = undefined;
		mockState.interrupt = false;
	});

	it("concatenates __raw deltas onto ToolCall.raw", async () => {
		mockState.chunks = [
			{
				id: "chatcmpl-raw",
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									type: "function",
									function: { name: "read", arguments: "" },
									__raw: "<raw-start>",
								},
							],
						},
						finish_reason: null,
					},
				],
			},
			{
				id: "chatcmpl-raw",
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									function: { arguments: '{"path":"README.md"}' },
									__raw: "<raw-mid>",
								},
							],
						},
						finish_reason: null,
					},
				],
			},
			{
				id: "chatcmpl-raw",
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									__raw: "<raw-end>",
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					prompt_tokens_details: { cached_tokens: 0 },
					completion_tokens_details: { reasoning_tokens: 0 },
				},
			},
		];

		const tool: Tool = {
			name: "read",
			description: "Read a file",
			parameters: Type.Object({ path: Type.String() }),
		};

		const s = streamSimple(
			model,
			normalizeContext({
				messages: [{ role: "user", content: "Read README.md", timestamp: Date.now() }],
				tools: [tool],
			}),
			{ apiKey: "test" },
		);

		const encoder = new AssistantMessageFrameEncoder();
		const frames: AssistantMessageFrame[] = [];
		for await (const event of s) {
			const frame = encodeProgress(encoder, event);
			if (frame) frames.push(frame);
		}
		expect(reduceAssistantMessageFrames(frames)?.content).toEqual([
			{
				type: "toolCall",
				id: "call_1",
				name: "read",
				arguments: { path: "README.md" },
				raw: "<raw-start><raw-mid><raw-end>",
			},
		]);

		const response = await s.result();
		expect(response.stopReason).toBe("toolUse");
		expect(response.content).toHaveLength(1);
		const toolCall = response.content[0];
		expect(toolCall.type).toBe("toolCall");
		if (toolCall.type !== "toolCall") {
			throw new Error("Expected toolCall content");
		}
		expect(toolCall.name).toBe("read");
		expect(toolCall.arguments).toEqual({ path: "README.md" });
		// __raw deltas are concatenated in order onto ToolCall.raw.
		expect(toolCall.raw).toBe("<raw-start><raw-mid><raw-end>");
	});

	it("preserves raw on the tool call when the stream errors mid-call", async () => {
		mockState.chunks = [
			{
				id: "chatcmpl-raw-err",
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									type: "function",
									function: { name: "read", arguments: '{"path":"/tmp' },
									__raw: "<partial-raw>",
								},
							],
						},
						finish_reason: null,
					},
				],
			},
		];

		const tool: Tool = {
			name: "read",
			description: "Read a file",
			parameters: Type.Object({ path: Type.String() }),
		};

		const s = streamSimple(
			model,
			normalizeContext({
				messages: [{ role: "user", content: "Read /tmp/x", timestamp: Date.now() }],
				tools: [tool],
			}),
			{ apiKey: "test" },
		);

		const encoder = new AssistantMessageFrameEncoder();
		const frames: AssistantMessageFrame[] = [];
		for await (const event of s) {
			const frame = encodeProgress(encoder, event);
			if (frame) frames.push(frame);
		}
		expect(reduceAssistantMessageFrames(frames)?.content).toEqual([
			{
				type: "toolCall",
				id: "call_1",
				name: "read",
				arguments: { path: "/tmp" },
				raw: "<partial-raw>",
			},
		]);

		const response = await s.result();
		// The stream ended without finish_reason -> error.
		expect(response.stopReason).toBe("error");
		const toolCall = response.content[0];
		expect(toolCall.type).toBe("toolCall");
		if (toolCall.type !== "toolCall") {
			throw new Error("Expected toolCall content");
		}
		// raw is retained on error so an interrupted assistant message can be
		// resumed via tool_calls_raw prefill.
		expect(toolCall.raw).toBe("<partial-raw>");
	});

	it("replays interleaved raw-only deltas when transport fails before toolcall_end", async () => {
		mockState.interrupt = true;
		mockState.chunks = [
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, id: "call_1", function: { name: "read", arguments: "{}" }, __raw: "<first>" },
								{ index: 1, id: "call_2", function: { name: "read", arguments: "{}" }, __raw: "<second>" },
							],
						},
						finish_reason: null,
					},
				],
			},
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 1, __raw: "second-tail" },
								{ index: 0, __raw: "first-tail" },
							],
						},
						finish_reason: null,
					},
				],
			},
		];
		const s = streamSimple(model, normalizeContext({ messages: [] }), { apiKey: "test" });
		const encoder = new AssistantMessageFrameEncoder();
		const frames: AssistantMessageFrame[] = [];
		let sawToolCallEnd = false;
		for await (const event of s) {
			if (event.type === "toolcall_end") sawToolCallEnd = true;
			const frame = encodeProgress(encoder, event);
			if (frame) frames.push(frame);
		}

		expect(sawToolCallEnd).toBe(false);
		expect((await s.result()).stopReason).toBe("error");
		expect(reduceAssistantMessageFrames(frames)?.content).toEqual([
			{ type: "toolCall", id: "call_1", name: "read", arguments: {}, raw: "<first>first-tail" },
			{ type: "toolCall", id: "call_2", name: "read", arguments: {}, raw: "<second>second-tail" },
		]);
	});

	it.each([undefined, ""])("does not invent raw progress for __raw=%s", async (raw) => {
		mockState.chunks = [
			{
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, id: "call_1", function: { name: "read", arguments: "{}" }, __raw: raw }],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		];
		const s = streamSimple(model, normalizeContext({ messages: [] }), { apiKey: "test" });
		const encoder = new AssistantMessageFrameEncoder();
		const frames: AssistantMessageFrame[] = [];
		for await (const event of s) {
			if (event.type === "toolcall_delta") expect(event.rawDelta).toBeUndefined();
			const frame = encodeProgress(encoder, event);
			if (frame) frames.push(frame);
		}
		const content = [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }];
		expect((await s.result()).content).toEqual(content);
		expect(reduceAssistantMessageFrames(frames)?.content).toEqual(content);
	});
});
