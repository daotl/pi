import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vitest";
import { processResponsesStream } from "../src/api/openai-responses-shared.ts";
import type { AssistantMessage, AssistantMessageEvent, Model } from "../src/types.ts";
import { AssistantMessageFrameEncoder, AssistantMessageFrameReducer } from "../src/utils/assistant-message-frame.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { ToolCallArgumentsStream } from "../src/utils/streaming-json.ts";

function createOutput(model: Model<"openai-responses">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

async function* createFunctionCallEvents(argumentsJson: string): AsyncIterable<ResponseStreamEvent> {
	yield {
		type: "response.output_item.added",
		item: {
			type: "function_call",
			id: "fc_test",
			call_id: "call_test",
			name: "edit",
			arguments: "",
		},
	} as ResponseStreamEvent;
	yield {
		type: "response.function_call_arguments.delta",
		delta: '{"path":"README.md"',
	} as ResponseStreamEvent;
	yield {
		type: "response.function_call_arguments.delta",
		delta: ',"content":"updated"}',
	} as ResponseStreamEvent;
	yield {
		type: "response.function_call_arguments.done",
		arguments: argumentsJson,
	} as ResponseStreamEvent;
	yield {
		type: "response.output_item.done",
		item: {
			type: "function_call",
			id: "fc_test",
			call_id: "call_test",
			name: "edit",
			arguments: argumentsJson,
		},
	} as ResponseStreamEvent;
	yield {
		type: "response.completed",
		sequence_number: 5,
		response: { id: "resp_test", status: "completed" },
	} as ResponseStreamEvent;
}

describe("openai responses partialJson cleanup", () => {
	it("removes partialJson from persisted tool-call blocks at output_item.done", async () => {
		const model: Model<"openai-responses"> = {
			id: "gpt-5-mini",
			name: "GPT-5 Mini",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};
		const output = createOutput(model);
		const stream = new AssistantMessageEventStream();
		const pushSpy = vi.spyOn(stream, "push");
		const argumentsJson = '{"path":"README.md","content":"updated"}';

		await processResponsesStream(createFunctionCallEvents(argumentsJson), output, stream, model);

		expect(output.content).toHaveLength(1);
		const persistedToolCall = output.content[0];
		expect(persistedToolCall?.type).toBe("toolCall");
		if (!persistedToolCall || persistedToolCall.type !== "toolCall") {
			throw new Error("Expected toolCall block");
		}
		expect(persistedToolCall.arguments).toEqual({ path: "README.md", content: "updated" });
		expect("partialJson" in persistedToolCall).toBe(false);

		const emittedEvents = pushSpy.mock.calls.map(([event]) => event as AssistantMessageEvent);
		const toolCallEnd = emittedEvents.find((event) => event.type === "toolcall_end");
		expect(toolCallEnd).toBeDefined();
		if (!toolCallEnd || toolCallEnd.type !== "toolcall_end") {
			throw new Error("Expected toolcall_end event");
		}
		expect(toolCallEnd.toolCall).toBe(persistedToolCall);
		expect("partialJson" in toolCallEnd.toolCall).toBe(false);
	});

	it("publishes previews refreshed by unchanged argument replacements before interruption", async () => {
		const model: Model<"openai-responses"> = {
			id: "gpt-test",
			name: "GPT test",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://example.test/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 64_000,
		};
		const output = createOutput(model);
		const stream = new AssistantMessageEventStream();
		const mirror = new ToolCallArgumentsStream();
		const frameEncoder = new AssistantMessageFrameEncoder();
		const frameReducer = new AssistantMessageFrameReducer();
		const start = frameEncoder.encode({ type: "start", partial: output });
		if (start) frameReducer.apply(start);
		let replayed: Record<string, unknown> = {};
		let sawLag = false;
		// Observe each published partial synchronously: later upstream events mutate the same output object.
		const push = stream.push.bind(stream);
		stream.push = (event) => {
			const encoded = frameEncoder.encode(event);
			if (encoded) frameReducer.apply(encoded);
			if (event.type === "toolcall_delta") {
				replayed = mirror.append(event.delta);
				const call = event.partial.content[event.contentIndex];
				if (call?.type !== "toolCall") throw new Error("Missing streamed tool call");
				expect(replayed).toEqual(call.arguments);
				const replayedCall = frameReducer.message?.content[event.contentIndex];
				if (replayedCall?.type !== "toolCall") throw new Error("Missing replayed tool call");
				expect(replayedCall.arguments).toEqual(call.arguments);
			}
			push(event);
		};
		const fields = Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`field${index}`, ""]));
		let text = `${JSON.stringify(fields).slice(0, -1)},"command":"`;
		async function* events(): AsyncIterable<ResponseStreamEvent> {
			yield {
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "function_call", id: "fc_test", call_id: "call_test", name: "write", arguments: "" },
			} as ResponseStreamEvent;
			yield {
				type: "response.function_call_arguments.delta",
				output_index: 0,
				delta: text,
			} as ResponseStreamEvent;
			for (let length = 1; length <= 400; length++) {
				text += "x";
				yield {
					type: "response.function_call_arguments.delta",
					output_index: 0,
					delta: "x",
				} as ResponseStreamEvent;
				const call = output.content[0];
				if (call?.type !== "toolCall") throw new Error("Missing streamed tool call");
				if ((call.arguments.command as string).length < length) {
					sawLag = true;
					break;
				}
			}
			// A provider may repeat its complete text without supplying a missing suffix. An empty append still
			// pays copy credit and can publish a fresher preview, even when the argument text is malformed.
			for (let count = 0; count < 16; count++) {
				yield {
					type: "response.function_call_arguments.done",
					output_index: 0,
					arguments: text,
				} as ResponseStreamEvent;
			}
			throw new Error("Connection interrupted");
		}
		await expect(processResponsesStream(events(), output, stream, model)).rejects.toThrow("Connection interrupted");
		expect(sawLag).toBe(true);
		const call = output.content[0];
		if (call?.type !== "toolCall") throw new Error("Missing interrupted tool call");
		expect(call.arguments).toEqual({ ...fields, command: text.slice(text.lastIndexOf('"') + 1) });
		expect(replayed).toEqual(call.arguments);
	});

	// #10897
	it("marks malformed final arguments instead of keeping the parsed prefix", async () => {
		const model: Model<"openai-responses"> = {
			id: "gpt-5-mini",
			name: "GPT-5 Mini",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 400000,
			maxTokens: 128000,
		};
		const output = createOutput(model);
		const stream = new AssistantMessageEventStream();
		const argumentsJson = '{"path":"README.md","content":"updated","mode":.5}';

		await processResponsesStream(createFunctionCallEvents(argumentsJson), output, stream, model);

		const toolCall = output.content[0];
		if (!toolCall || toolCall.type !== "toolCall") throw new Error("Expected toolCall block");
		expect(toolCall.arguments).toEqual({});
		expect(toolCall.argumentsError?.endsWith(`Received arguments:\n${argumentsJson}`)).toBe(true);
	});
});
