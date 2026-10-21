import type { ResponseReasoningItem, ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { convertResponsesMessages, processResponsesStream } from "../src/api/openai-responses-shared.ts";
import type { AssistantMessage, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

function createModel(): Model<"azure-openai-responses"> {
	return {
		id: "gpt-5-mini",
		name: "GPT-5 Mini",
		api: "azure-openai-responses",
		provider: "azure-openai-responses",
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 400000,
		maxTokens: 128000,
	};
}

function createOutput(model: Model<"azure-openai-responses">): AssistantMessage {
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

async function* createEvents(
	doneItem: ResponseReasoningItem,
	completedItem: ResponseReasoningItem,
): AsyncIterable<ResponseStreamEvent> {
	yield {
		type: "response.output_item.added",
		output_index: 0,
		sequence_number: 0,
		item: { type: "reasoning", id: doneItem.id, summary: [] },
	} as ResponseStreamEvent;
	yield {
		type: "response.output_item.done",
		output_index: 0,
		sequence_number: 1,
		item: doneItem,
	} as ResponseStreamEvent;
	yield {
		type: "response.completed",
		sequence_number: 2,
		response: {
			id: "resp_test",
			status: "completed",
			output: [completedItem],
		},
	} as ResponseStreamEvent;
}

function getReplayedReasoning(model: Model<"azure-openai-responses">, assistant: AssistantMessage) {
	const context = normalizeContext({
		messages: [
			{ role: "user", content: "first", timestamp: Date.now() - 1 },
			assistant,
			{ role: "user", content: "follow-up", timestamp: Date.now() },
		],
	});
	const input = convertResponsesMessages(model, context, new Set(["azure-openai-responses"]));
	return input.find((item) => item.type === "reasoning");
}

describe("Azure OpenAI Responses reasoning replay", () => {
	it.each<[string, Partial<Pick<AssistantMessage, "api" | "provider" | "model">>, string]>([
		["Completions API", { api: "openai-completions" }, "reasoning_content"],
		["Anthropic API", { api: "anthropic-messages" }, "anthropic-opaque-signature"],
		[
			"provider",
			{ provider: "other-provider" },
			JSON.stringify({ type: "reasoning", id: "rs_foreign", summary: [], encrypted_content: "foreign" }),
		],
		[
			"model",
			{ model: "other-model" },
			JSON.stringify({ type: "reasoning", id: "rs_foreign", summary: [], encrypted_content: "foreign" }),
		],
	])(
		"replays foreign visible reasoning as text without opaque data from a different %s",
		(_field, source, signature) => {
			const model = createModel();
			const assistant: AssistantMessage = {
				...createOutput(model),
				...source,
				content: [
					{ type: "thinking", thinking: "Visible reasoning", thinkingSignature: signature },
					{ type: "thinking", thinking: "Unsigned reasoning" },
					{ type: "thinking", thinking: "[Reasoning redacted]", thinkingSignature: "opaque", redacted: true },
					{ type: "thinking", thinking: "", thinkingSignature: "encrypted-only" },
					{ type: "text", text: "Answer" },
				],
			};
			const stored = structuredClone(assistant);
			const input = convertResponsesMessages(
				model,
				normalizeContext({ messages: [assistant] }),
				new Set([model.provider]),
			);

			expect(input).toMatchObject([
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Visible reasoning" }] },
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Unsigned reasoning" }] },
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Answer" }] },
			]);
			expect(assistant).toEqual(stored);
		},
	);

	it.each(["Visible native summary", ""])("replays native reasoning JSON with visible text %j", (thinking) => {
		const model = createModel();
		const reasoning: ResponseReasoningItem = {
			type: "reasoning",
			id: "rs_native",
			summary: thinking ? [{ type: "summary_text", text: thinking }] : [],
			encrypted_content: "native-encrypted-content",
		};
		const assistant = createOutput(model);
		assistant.content = [
			{ type: "thinking", thinking, thinkingSignature: JSON.stringify(reasoning) },
			{ type: "text", text: "Answer", textSignature: "msg_native" },
		];
		const stored = structuredClone(assistant);
		const input = convertResponsesMessages(
			model,
			normalizeContext({ messages: [assistant] }),
			new Set([model.provider]),
		);

		expect(input).toEqual([
			reasoning,
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Answer", annotations: [] }],
				status: "completed",
				id: "msg_native",
				phase: undefined,
			},
		]);
		expect(assistant).toEqual(stored);
	});

	it("preserves existing encrypted_content from output_item.done", async () => {
		const model = createModel();
		const output = createOutput(model);
		const doneItem: ResponseReasoningItem = {
			type: "reasoning",
			id: "rs_done",
			summary: [],
			encrypted_content: "from-output-item-done",
		};
		const completedItem: ResponseReasoningItem = {
			...doneItem,
			encrypted_content: "from-response-completed",
		};

		await processResponsesStream(
			createEvents(doneItem, completedItem),
			output,
			new AssistantMessageEventStream(),
			model,
		);

		expect(getReplayedReasoning(model, output)).toMatchObject({
			type: "reasoning",
			id: "rs_done",
			encrypted_content: "from-output-item-done",
		});
	});

	it("fills encrypted_content when output_item.done omitted it", async () => {
		const model = createModel();
		const output = createOutput(model);
		const doneItem: ResponseReasoningItem = {
			type: "reasoning",
			id: "rs_missing",
			summary: [],
		};
		const completedItem: ResponseReasoningItem = {
			...doneItem,
			encrypted_content: "from-response-completed",
		};

		await processResponsesStream(
			createEvents(doneItem, completedItem),
			output,
			new AssistantMessageEventStream(),
			model,
		);

		expect(getReplayedReasoning(model, output)).toMatchObject({
			type: "reasoning",
			id: "rs_missing",
			encrypted_content: "from-response-completed",
		});
	});
});
