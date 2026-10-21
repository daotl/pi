import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/api/openai-completions.ts";
import type { AssistantMessage, Model, OpenAICompletionsCompat, TranscriptContext, Usage } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const emptyUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const compat = {
	supportsStore: true,
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	supportsFinishReason: true,
	maxTokensField: "max_completion_tokens",
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: false,
	requiresReasoningContentOnAssistantMessages: false,
	thinkingFormat: "openai",
	openRouterRouting: {},
	vercelGatewayRouting: {},
	chatTemplateKwargs: {},
	chatTemplateArgs: {},
	zaiToolStream: false,
	supportsStrictMode: true,
	supportsOpenAIGrammarTools: true,
	cacheControlFormat: undefined,
	sendSessionAffinityHeaders: false,
	sessionAffinityFormat: "openai",
	supportsMidConvoSystemMessages: true,
	supportsMidConvoToolAdditions: true,
	vllmPriority: 0,
	supportsLongCacheRetention: true,
} satisfies Required<
	Omit<OpenAICompletionsCompat, "cacheControlFormat" | "supportsThinkingTokenBudget" | "thinkingTokenBudgetField">
> & {
	cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
	supportsThinkingTokenBudget?: OpenAICompletionsCompat["supportsThinkingTokenBudget"];
	thinkingTokenBudgetField?: OpenAICompletionsCompat["thinkingTokenBudgetField"];
};

function buildModel(): Model<"openai-completions"> {
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
		compat,
	};
}

function buildAssistant(content: AssistantMessage["content"]): AssistantMessage {
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

function buildContext(...messages: AssistantMessage[]): TranscriptContext {
	return normalizeContext({
		messages: [{ role: "user", content: "Read the file", timestamp: 1 }, ...messages],
	});
}

type AssistantParams = {
	role: string;
	tool_calls_raw?: string;
	tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
	reasoning_content?: string;
	content?: string | null | unknown[];
};

function asAssistant(msg: unknown): AssistantParams {
	return msg as AssistantParams;
}

describe("openai-completions convertMessages tool-call prefill", () => {
	it("sends tool_calls_raw for the trailing assistant when prefill is set and all calls have raw", () => {
		const assistant = buildAssistant([
			{
				type: "toolCall",
				id: "call-1",
				name: "read_file",
				arguments: { path: "/tmp/a.txt" },
				raw: "<raw-call-1>",
			},
			{
				type: "toolCall",
				id: "call-2",
				name: "read_file",
				arguments: { path: "/tmp/b.txt" },
				raw: "<raw-call-2>",
			},
		]);
		const messages = convertMessages(buildModel(), buildContext(assistant), compat, {
			prefill: true,
		});

		const last = asAssistant(messages[messages.length - 1]);
		expect(last.role).toBe("assistant");
		expect(last.tool_calls_raw).toBe("<raw-call-1><raw-call-2>");
		expect(last.tool_calls).toBeUndefined();
		// No synthetic tool results appended after the trailing assistant.
		expect(messages.some((m) => m.role === "tool")).toBe(false);
	});

	it.each(["text", "tool"] as const)("serializes trailing system patches before a %s prefill", (kind) => {
		const assistant = buildAssistant(
			kind === "text"
				? [{ type: "text", text: "partial" }]
				: [{ type: "toolCall", id: "call-1", name: "read_file", arguments: {}, raw: "<raw>" }],
		);
		const wire = convertMessages(
			buildModel(),
			normalizeContext({
				messages: [
					{ role: "user", content: "question", timestamp: 1 },
					assistant,
					{ role: "system", content: "later instruction", timestamp: 3 },
				],
			}),
			compat,
			{ prefill: true },
		);
		expect(wire.at(-1)?.role).toBe("assistant");
		expect(wire.slice(0, -1)).toContainEqual(expect.objectContaining({ content: "later instruction" }));
		if (kind === "tool") expect(asAssistant(wire.at(-1)).tool_calls_raw).toBe("<raw>");
		else expect(asAssistant(wire.at(-1)).content).toBe("partial");
	});

	it("drops aborted partial replay unless explicitly continuing its prefill", () => {
		const failed = {
			...buildAssistant([{ type: "text" as const, text: "failed partial" }]),
			stopReason: "aborted" as const,
		};
		const context = buildContext(failed);
		const ordinary = convertMessages(buildModel(), context, compat);
		expect(ordinary).toEqual([{ role: "user", content: "Read the file" }]);
		const continued = convertMessages(buildModel(), context, compat, { prefill: true });
		expect(asAssistant(continued.at(-1))).toMatchObject({ role: "assistant", content: "failed partial" });
	});

	it("sends reasoning_content alongside tool_calls_raw for the prefill", () => {
		const assistant = buildAssistant([
			{ type: "thinking", thinking: "I should read the file.", thinkingSignature: "reasoning_content" },
			{
				type: "toolCall",
				id: "call-1",
				name: "read_file",
				arguments: { path: "/tmp/a.txt" },
				raw: "<raw-call-1>",
			},
		]);
		const messages = convertMessages(buildModel(), buildContext(assistant), compat, {
			prefill: true,
		});

		const last = asAssistant(messages[messages.length - 1]);
		expect(last.role).toBe("assistant");
		expect(last.reasoning_content).toBe("I should read the file.");
		expect(last.tool_calls_raw).toBe("<raw-call-1>");
		expect(last.tool_calls).toBeUndefined();
	});

	it("falls back to structured tool_calls when raw is unavailable", () => {
		const assistant = buildAssistant([
			{
				type: "toolCall",
				id: "call-1",
				name: "read_file",
				arguments: { path: "/tmp/a.txt" },
			},
		]);
		const messages = convertMessages(buildModel(), buildContext(assistant), compat, {
			prefill: true,
		});

		const last = asAssistant(messages[messages.length - 1]);
		expect(last.role).toBe("assistant");
		expect(last.tool_calls_raw).toBeUndefined();
		expect(Array.isArray(last.tool_calls)).toBe(true);
		expect(last.tool_calls?.[0].function.name).toBe("read_file");
	});

	it("sends structured tool_calls for non-trailing assistant messages even in prefill mode", () => {
		const first = buildAssistant([
			{
				type: "toolCall",
				id: "call-1",
				name: "read_file",
				arguments: { path: "/tmp/a.txt" },
				raw: "<raw-call-1>",
			},
		]);
		const trailing = buildAssistant([{ type: "text", text: "continuing" }]);
		const messages = convertMessages(
			buildModel(),
			normalizeContext({
				messages: [
					{ role: "user", content: "Read the file", timestamp: 1 },
					first,
					{
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "read_file",
						content: [{ type: "text", text: "file contents" }],
						isError: false,
						timestamp: 2,
					},
					trailing,
				],
			}),
			compat,
			{ prefill: true },
		);

		// The first assistant (non-trailing) sends structured tool_calls.
		const firstAssistant = asAssistant(
			messages.find((m) => m.role === "assistant" && "tool_calls" in (m as AssistantParams)),
		);
		expect(firstAssistant).toBeDefined();
		expect(firstAssistant.tool_calls_raw).toBeUndefined();
		expect(Array.isArray(firstAssistant.tool_calls)).toBe(true);
		// The trailing assistant (text only) is the last message.
		const last = asAssistant(messages[messages.length - 1]);
		expect(last.role).toBe("assistant");
		expect(last.content).toBe("continuing");
	});

	it("sends structured tool_calls and synthesizes tool results when prefill is not set", () => {
		const assistant = buildAssistant([
			{
				type: "toolCall",
				id: "call-1",
				name: "read_file",
				arguments: { path: "/tmp/a.txt" },
				raw: "<raw-call-1>",
			},
		]);
		const messages = convertMessages(buildModel(), buildContext(assistant), compat);

		// Trailing unresolved tool calls get synthetic tool results appended.
		expect(messages[messages.length - 1].role).toBe("tool");
		// The assistant sends structured tool_calls (not tool_calls_raw).
		const assistantMsg = asAssistant(messages.find((m) => m.role === "assistant"));
		expect(assistantMsg.tool_calls_raw).toBeUndefined();
		expect(Array.isArray(assistantMsg.tool_calls)).toBe(true);
	});

	it("does not skip a tool-call-only prefill assistant (sends tool_calls_raw)", () => {
		const assistant = buildAssistant([
			{
				type: "toolCall",
				id: "call-1",
				name: "read_file",
				arguments: { path: "/tmp/a.txt" },
				raw: "<raw-call-1>",
			},
		]);
		const messages = convertMessages(buildModel(), buildContext(assistant), compat, {
			prefill: true,
		});

		// The assistant must not be skipped (it has tool_calls_raw).
		const assistants = messages.filter((m) => m.role === "assistant");
		expect(assistants.length).toBe(1);
		const last = asAssistant(assistants[0]);
		expect(last.tool_calls_raw).toBe("<raw-call-1>");
	});

	it.each(["text", "thinking", "mixed"] as const)(
		"preserves exact %s whitespace only for trailing prefill",
		(kind) => {
			const assistant = buildAssistant([
				...(kind !== "thinking" ? [{ type: "text" as const, text: "\n\n" }] : []),
				...(kind !== "text"
					? [{ type: "thinking" as const, thinking: " \t\n", thinkingSignature: "reasoning_content" }]
					: []),
				...(kind === "mixed"
					? [
							{ type: "text" as const, text: "prefix" },
							{ type: "thinking" as const, thinking: "reasoning", thinkingSignature: "reasoning_content" },
							{ type: "text" as const, text: "\t " },
						]
					: []),
				{ type: "toolCall", id: "call-1", name: "read_file", arguments: {}, raw: "<raw>" },
			]);
			const stored = structuredClone(assistant);
			const wire = convertMessages(buildModel(), buildContext(assistant), compat, { prefill: true });
			const sent = asAssistant(wire.at(-1));
			expect(sent.content).toBe(kind === "thinking" ? null : kind === "mixed" ? "\n\nprefix\t " : "\n\n");
			expect(sent.reasoning_content).toBe(
				kind === "text" ? undefined : kind === "mixed" ? " \t\nreasoning" : " \t\n",
			);
			expect(sent.tool_calls_raw).toBe("<raw>");
			const ordinary = asAssistant(
				convertMessages(buildModel(), buildContext(assistant), compat).find(
					(message) => message.role === "assistant",
				),
			);
			expect(ordinary.content).toBe(kind === "mixed" ? "prefix" : null);
			expect(ordinary.reasoning_content).toBe(kind === "mixed" ? "reasoning" : undefined);
			expect(assistant).toEqual(stored);
		},
	);

	it.each(["text", "thinking"] as const)("retains a whitespace-only %s prefill without tools", (kind) => {
		const assistant = buildAssistant(
			kind === "text"
				? [{ type: "text", text: " \t\n" }]
				: [{ type: "thinking", thinking: " \t\n", thinkingSignature: "reasoning_content" }],
		);
		const wire = convertMessages(buildModel(), buildContext(assistant), compat, { prefill: true });
		expect(wire.at(-1)?.role).toBe("assistant");
		const sent = asAssistant(wire.at(-1));
		expect(kind === "text" ? sent.content : sent.reasoning_content).toBe(" \t\n");
		expect(convertMessages(buildModel(), buildContext(assistant), compat)).toEqual([
			{ role: "user", content: "Read the file" },
		]);
	});
});
