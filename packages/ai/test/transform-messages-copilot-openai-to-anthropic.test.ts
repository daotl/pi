import type { MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import { describe, expect, it } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { transformMessages } from "../src/api/transform-messages.ts";
import type { AssistantMessage, Message, Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

// Normalize function matching what anthropic.ts uses
function anthropicNormalizeToolCallId(
	id: string,
	_model: Model<"anthropic-messages">,
	_source: AssistantMessage,
): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function makeCopilotClaudeModel(): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-4.6",
		name: "Claude Sonnet 4.6",
		api: "anthropic-messages",
		provider: "github-copilot",
		baseUrl: "https://api.individual.githubcopilot.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16000,
	};
}

function makeAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "github-copilot",
		model: "gpt-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

async function captureAnthropicPayload(
	model: Model<"anthropic-messages">,
	assistant: AssistantMessage,
): Promise<MessageCreateParamsStreaming> {
	let payload: MessageCreateParamsStreaming | undefined;
	await streamAnthropic(model, normalizeContext({ messages: [assistant] }), {
		apiKey: "isolated-test-key",
		onPayload(value) {
			payload = value as MessageCreateParamsStreaming;
			throw new Error("Captured before network dispatch");
		},
	}).result();
	if (!payload) throw new Error("Anthropic payload was not captured");
	return payload;
}

describe("OpenAI to Anthropic session migration for Copilot Claude", () => {
	it.each([false, true])("isolates opaque tool signatures for native replay=%s", (native) => {
		const model = makeCopilotClaudeModel();
		const signature = JSON.stringify({ type: "reasoning.encrypted", data: "opaque" });
		const assistant = makeAssistantMessage([
			{ type: "toolCall", id: "call|item", name: "bash", arguments: {}, thoughtSignature: signature },
		]);
		if (native) Object.assign(assistant, { api: model.api, provider: model.provider, model: model.id });
		const stored = structuredClone(assistant);
		const result = transformMessages([assistant], model, anthropicNormalizeToolCallId);
		const replayed = result.find((message) => message.role === "assistant");
		expect(replayed?.content).toEqual([
			{
				type: "toolCall",
				id: "call_item",
				name: "bash",
				arguments: {},
				...(native ? { thoughtSignature: signature } : {}),
			},
		]);
		expect(assistant).toEqual(stored);
	});

	// Replay metadata is native only to an exact provider/API/model origin. Foreign
	// visible reasoning remains ordinary text; redacted and opaque blocks are omitted.
	it.each<Partial<Pick<AssistantMessage, "api" | "provider" | "model">>>([
		{ api: "openai-completions", provider: "github-copilot", model: "claude-sonnet-4.6" },
		{ api: "openai-responses", provider: "github-copilot", model: "gpt-5" },
		{ api: "anthropic-messages", provider: "other-provider", model: "claude-sonnet-4.6" },
		{ api: "anthropic-messages", provider: "github-copilot", model: "other-model" },
	])("sends foreign visible reasoning as text without opaque replay data: %o", async (source) => {
		const assistant: AssistantMessage = {
			...makeAssistantMessage([
				{ type: "thinking", thinking: "Visible reasoning", thinkingSignature: "reasoning_content" },
				{ type: "thinking", thinking: "Unsigned reasoning" },
				{ type: "thinking", thinking: "[Reasoning redacted]", thinkingSignature: "opaque", redacted: true },
				{ type: "thinking", thinking: "", thinkingSignature: "encrypted-only" },
				{ type: "text", text: "Answer" },
			]),
			...source,
		};
		const stored = structuredClone(assistant);
		const payload = await captureAnthropicPayload(makeCopilotClaudeModel(), assistant);

		expect(payload.messages).toEqual([
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Visible reasoning" },
					{ type: "text", text: "Unsigned reasoning" },
					{ type: "text", text: "Answer" },
				],
			},
		]);
		expect(assistant).toEqual(stored);
	});

	it("replays native signed and redacted reasoning unchanged", async () => {
		const model = makeCopilotClaudeModel();
		const assistant: AssistantMessage = {
			...makeAssistantMessage([
				{ type: "thinking", thinking: "Native reasoning", thinkingSignature: "native-signature" },
				{ type: "thinking", thinking: "", thinkingSignature: "empty-visible-signature" },
				{ type: "thinking", thinking: "[Reasoning redacted]", thinkingSignature: "opaque", redacted: true },
			]),
			api: model.api,
			provider: model.provider,
			model: model.id,
		};
		const stored = structuredClone(assistant);
		const payload = await captureAnthropicPayload(model, assistant);

		expect(payload.messages).toEqual([
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Native reasoning", signature: "native-signature" },
					{ type: "thinking", thinking: "", signature: "empty-visible-signature" },
					{ type: "redacted_thinking", data: "opaque" },
				],
			},
		]);
		expect(assistant).toEqual(stored);
	});

	it("adds synthetic tool results for trailing orphaned tool calls", () => {
		const model = makeCopilotClaudeModel();
		const messages: Message[] = [
			{ role: "user", content: "read the file", timestamp: Date.now() },
			makeAssistantMessage([
				{
					type: "toolCall",
					id: "call_123|fc_123",
					name: "read",
					arguments: { path: "README.md" },
				},
			]),
		];

		const result = transformMessages(messages, model, anthropicNormalizeToolCallId);
		const lastMessage = result[result.length - 1];

		expect(lastMessage).toMatchObject({
			role: "toolResult",
			toolCallId: "call_123_fc_123",
			toolName: "read",
			isError: true,
			content: [{ type: "text", text: "No result provided" }],
		});
	});

	it("adds synthetic results only for trailing tool calls that are still missing results", () => {
		const model = makeCopilotClaudeModel();
		const messages: Message[] = [
			{ role: "user", content: "run commands", timestamp: Date.now() },
			makeAssistantMessage([
				{ type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "README.md" } },
				{ type: "toolCall", id: "call_2|fc_2", name: "bash", arguments: { command: "pwd" } },
			]),
			{
				role: "toolResult",
				toolCallId: "call_1|fc_1",
				toolName: "read",
				content: [{ type: "text", text: "done" }],
				isError: false,
				timestamp: Date.now(),
			},
		];

		const result = transformMessages(messages, model, anthropicNormalizeToolCallId);
		const syntheticResults = result.filter((message) => message.role === "toolResult" && message.isError);

		expect(syntheticResults).toHaveLength(1);
		expect(syntheticResults[0]).toMatchObject({
			role: "toolResult",
			toolCallId: "call_2_fc_2",
			toolName: "bash",
			content: [{ type: "text", text: "No result provided" }],
		});
	});
});
