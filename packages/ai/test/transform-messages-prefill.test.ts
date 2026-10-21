import { describe, expect, it } from "vitest";
import { transformMessages } from "../src/api/transform-messages.ts";
import type { AssistantMessage, Message, Model, ToolCall, ToolResultMessage, Usage } from "../src/types.ts";

const emptyUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeModel(): Model<"openai-completions"> {
	return {
		id: "llama-server",
		name: "llama-server",
		api: "openai-completions",
		provider: "llama-server",
		baseUrl: "http://127.0.0.1:8080/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 8192,
		maxTokens: 2048,
	};
}

function makeAssistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "llama-server",
		model: "llama-server",
		usage: emptyUsage,
		stopReason: "toolUse",
		timestamp: 2,
	};
}

describe("transformMessages skipTrailingToolResultSynthesis", () => {
	it("synthesizes tool results for trailing unresolved tool calls by default", () => {
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-1",
			name: "read_file",
			arguments: { path: "/tmp/a" },
		};
		const messages: Message[] = [{ role: "user", content: "read", timestamp: 1 }, makeAssistant([toolCall])];

		const result = transformMessages(messages, makeModel());

		// The trailing assistant's unresolved tool call gets a synthetic tool result.
		expect(result[result.length - 1].role).toBe("toolResult");
		expect((result[result.length - 1] as ToolResultMessage).toolCallId).toBe("call-1");
	});

	it("skips synthesizing tool results for trailing tool calls in prefill mode", () => {
		const toolCall: ToolCall = {
			type: "toolCall",
			id: "call-1",
			name: "read_file",
			arguments: { path: "/tmp/a" },
			raw: "<raw>",
		};
		const messages: Message[] = [{ role: "user", content: "read", timestamp: 1 }, makeAssistant([toolCall])];

		const result = transformMessages(messages, makeModel(), undefined, {
			skipTrailingToolResultSynthesis: true,
		});

		// The trailing assistant is preserved as the last message (no synthetic result).
		expect(result[result.length - 1].role).toBe("assistant");
		expect(result.length).toBe(2);
	});

	it("still synthesizes mid-conversation orphaned tool calls in prefill mode", () => {
		const orphanedCall: ToolCall = {
			type: "toolCall",
			id: "call-orphan",
			name: "read_file",
			arguments: { path: "/tmp/a" },
		};
		const trailingCall: ToolCall = {
			type: "toolCall",
			id: "call-trail",
			name: "read_file",
			arguments: { path: "/tmp/b" },
			raw: "<raw>",
		};
		const messages: Message[] = [
			{ role: "user", content: "read", timestamp: 1 },
			// Orphaned tool call (no following tool result, interrupted by a user message).
			makeAssistant([orphanedCall]),
			{ role: "user", content: "continue", timestamp: 2 },
			// Trailing prefill tool call.
			makeAssistant([trailingCall]),
		];

		const result = transformMessages(messages, makeModel(), undefined, {
			skipTrailingToolResultSynthesis: true,
		});

		// The orphaned call (interrupted by a user message) gets a synthetic result.
		const synthetic = result.find(
			(m) => m.role === "toolResult" && (m as ToolResultMessage).toolCallId === "call-orphan",
		);
		expect(synthetic).toBeDefined();
		// The trailing prefill tool call is preserved as the last message.
		expect(result[result.length - 1].role).toBe("assistant");
		const lastAssistant = result[result.length - 1] as AssistantMessage;
		expect(lastAssistant.content[0]).toMatchObject({ type: "toolCall", id: "call-trail" });
	});

	it.each(["text", "tool"] as const)("keeps trailing system patches before the %s prefill", (kind) => {
		const assistant = makeAssistant(
			kind === "text"
				? [{ type: "text", text: "partial" }]
				: [{ type: "toolCall", id: "call", name: "read", arguments: {} }],
		);
		const patch: Message = { role: "system", content: "later instruction", timestamp: 3 };
		const messages: Message[] = [{ role: "user", content: "question", timestamp: 1 }, assistant, patch];
		const stored = structuredClone(messages);
		const result = transformMessages(messages, makeModel(), undefined, { skipTrailingToolResultSynthesis: true });
		expect(result).toEqual([messages[0], patch, assistant]);
		expect(messages).toEqual(stored);
	});

	it.each(["error", "aborted"] as const)("omits %s replay and only its own tool results", (stopReason) => {
		const call: ToolCall = { type: "toolCall", id: "reused", name: "read", arguments: {} };
		const failed = { ...makeAssistant([call]), stopReason };
		const retry = makeAssistant([call]);
		const toolResult = (text: string): ToolResultMessage => ({
			role: "toolResult",
			toolCallId: "reused",
			toolName: "read",
			content: [{ type: "text", text }],
			isError: false,
			timestamp: 3,
		});
		const rejected = toolResult("failed result");
		const accepted = toolResult("later valid result");
		const patch: Message = { role: "system", content: "keep patch", timestamp: 4 };
		const input: Message[] = [failed, patch, rejected, retry, accepted];
		const stored = structuredClone(input);
		expect(transformMessages(input, makeModel())).toEqual([patch, retry, accepted]);
		expect(input).toEqual(stored);
	});

	it.each(["error", "aborted"] as const)("keeps a trailing %s assistant only for explicit prefill", (stopReason) => {
		const assistant = { ...makeAssistant([{ type: "text", text: "partial" }]), stopReason };
		const patch: Message = { role: "system", content: "later instruction", timestamp: 3 };
		expect(transformMessages([assistant, patch], makeModel())).toEqual([patch]);
		expect(
			transformMessages([assistant, patch], makeModel(), undefined, { skipTrailingToolResultSynthesis: true }),
		).toEqual([patch, assistant]);
	});
});
