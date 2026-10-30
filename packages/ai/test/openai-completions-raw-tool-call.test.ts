import { Type } from "typebox";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamSimple } from "../src/api/openai-completions.ts";
import type { AssistantMessageEvent, Model, Tool } from "../src/types.ts";
import {
	type AssistantMessageFrame,
	AssistantMessageFrameEncoder,
	AssistantMessageFrameReducer,
	reduceAssistantMessageFrames,
} from "../src/utils/assistant-message-frame.ts";
import { ToolCallArgumentsStream } from "../src/utils/streaming-json.ts";
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
	beforeChunk: undefined as ((index: number) => Promise<void>) | undefined,
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
							for (const [index, chunk] of chunks.entries()) {
								await mockState.beforeChunk?.(index);
								yield chunk;
							}
							if (mockState.interrupt) {
								await mockState.beforeChunk?.(chunks.length);
								throw new Error("Connection interrupted");
							}
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
		mockState.beforeChunk = undefined;
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
				argumentsError: expect.stringContaining('{"path":"/tmp'),
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

	it.each(["raw-only", "empty arguments", "metadata-only"])(
		"keeps wide argument previews aligned across %s progress, JSON resumption and interruption",
		async (progress) => {
			const fields = Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`field${index}`, ""]));
			const prefix = `${JSON.stringify(fields).slice(0, -1)},"command":"`;
			const updates: Record<string, unknown>[] = [
				{ id: "call_1", function: { name: "write", arguments: prefix } },
				...Array.from({ length: 400 }, () => ({ function: { arguments: "x" } })),
				...Array.from({ length: 16 }, () =>
					progress === "raw-only"
						? { __raw: "<raw>" }
						: progress === "empty arguments"
							? { function: { arguments: "" } }
							: { id: "call_1", function: { name: "write" } },
				),
				...Array.from({ length: 16 }, () => ({ function: { arguments: "y" } })),
				{ function: { arguments: "z".repeat(64 * 1024) } },
				{ function: { arguments: " tail" } },
			];
			const gates = Array.from({ length: updates.length + 1 }, () => Promise.withResolvers<void>());
			mockState.chunks = updates.map((update) => ({
				choices: [{ delta: { tool_calls: [{ index: 0, ...update }] }, finish_reason: null }],
			}));
			mockState.beforeChunk = (index) => gates[index]!.promise;
			mockState.interrupt = true;
			const mirror = new ToolCallArgumentsStream();
			const frameEncoder = new AssistantMessageFrameEncoder();
			const frameReducer = new AssistantMessageFrameReducer();
			const response = streamSimple(model, normalizeContext({ messages: [] }), { apiKey: "test" });
			let index = 0;
			let textLength = 0;
			let sawLag = false;
			let sawEnd = false;
			gates[0]!.resolve();
			try {
				for await (const event of response) {
					const encoded = frameEncoder.encode(event);
					if (encoded) frameReducer.apply(encoded);
					if (event.type === "toolcall_end") sawEnd = true;
					if (event.type !== "toolcall_delta") continue;
					const block = event.partial.content[event.contentIndex];
					if (block?.type !== "toolCall") throw new Error("Missing streamed tool call");
					const preview = mirror.append(event.delta);
					if (index > 0 && index <= 400) {
						textLength++;
						if ((block.arguments.command as string).length < textLength) sawLag = true;
					}
					expect(block.arguments, `event ${index}: ${progress}`).toEqual(preview);
					const replayedCall = frameReducer.message?.content[event.contentIndex];
					if (replayedCall?.type !== "toolCall") throw new Error("Missing replayed tool call");
					expect(replayedCall.arguments, `replayed event ${index}: ${progress}`).toEqual(block.arguments);
					gates[++index]?.resolve();
				}
			} finally {
				for (const gate of gates) gate.resolve();
				await response.result();
			}
			expect(sawLag).toBe(true);
			expect(sawEnd).toBe(false);
			const result = await response.result();
			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toContain("Connection interrupted");
			expect(result.content[0]).toMatchObject({
				arguments: { ...fields, command: `${"x".repeat(400)}${"y".repeat(16)}${"z".repeat(64 * 1024)} tail` },
				...(progress === "raw-only" ? { raw: "<raw>".repeat(16) } : {}),
			});
		},
	);

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

	it("preserves raw tokens and the terminal argument error for malformed streamed calls", async () => {
		mockState.chunks = [
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, id: "broken", function: { name: "read", arguments: '{"path":' }, __raw: "<raw>" },
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		];
		const response = streamSimple(model, normalizeContext({ messages: [] }), { apiKey: "test" });
		const encoder = new AssistantMessageFrameEncoder();
		const frames: AssistantMessageFrame[] = [];
		for await (const event of response) {
			const frame = encoder.encode(event);
			if (frame) frames.push(frame);
		}
		const result = await response.result();
		const call = result.content[0];
		if (call?.type !== "toolCall") throw new Error("Missing malformed tool call");
		expect(call.arguments).toEqual({});
		expect(call.argumentsError).toContain('{"path":');
		expect(call.raw).toBe("<raw>");
		expect(reduceAssistantMessageFrames(frames)?.content).toEqual(result.content);
	});
});
