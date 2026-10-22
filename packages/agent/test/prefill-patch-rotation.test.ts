import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
	type SystemMessage,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { convertMessages } from "../../ai/src/api/openai-completions.ts";
import {
	type AgentContext,
	type AgentLoopConfig,
	type AgentMessage,
	type AgentTool,
	agentLoopContinue,
	runAgentLoopContinue,
} from "../src/index.ts";

const compat: Parameters<typeof convertMessages>[2] = {
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
};
const model: Model<"openai-completions"> = {
	id: "prefill",
	name: "Prefill",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://localhost:0/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
};
const matrix = (["stream", "run"] as const).flatMap((consumer) =>
	(["none", "patches", "patches-steering", "prepare-patches"] as const).flatMap((suffix) =>
		(["start-update", "terminal-only", "end-only"] as const).map((delivery) => ({ consumer, suffix, delivery })),
	),
);
it.each(matrix)("replaces one prefix across $suffix/$delivery ($consumer)", async ({ consumer, suffix, delivery }) => {
	const schema = Type.Object({ value: Type.String() });
	const executed: string[] = [];
	const tool: AgentTool<typeof schema> = {
		name: "echo",
		label: "Echo",
		description: "Echo",
		parameters: schema,
		execute: async (_id, args) => {
			executed.push(args.value);
			return { content: [{ type: "text", text: `genuine:${args.value}` }], details: {} };
		},
	};
	const extra = ["first_extra", "second_extra"].map((name) => ({ ...tool, name }));
	const declaration: SystemMessage = {
		role: "system",
		content: "initial policy",
		toolsAdded: [{ name: tool.name, description: tool.description, parameters: schema }],
		timestamp: 1,
	};
	const old = { ...fauxAssistantMessage("older answer"), api: model.api, provider: model.provider, model: model.id };
	const history: AgentMessage[] = [
		declaration,
		{ role: "user", content: "older request", timestamp: 1 },
		old,
		{ role: "system", content: "older policy stays here", timestamp: 2 },
		{ role: "user", content: "go", timestamp: 3 },
	];
	const prefix: AssistantMessage = {
		...old,
		stopReason: "toolUse",
		content: [{ type: "toolCall", id: "call_once", name: "echo", arguments: { value: "once" }, raw: "<raw>" }],
	};
	const patches: SystemMessage[] =
		suffix === "none"
			? []
			: extra.map((value, index) => ({
					role: "system",
					content: `trailing policy ${index + 1}`,
					toolsAdded: [{ name: value.name, description: value.description, parameters: schema }],
					timestamp: index + 4,
				}));
	const steering: AgentMessage = { role: "user", content: "accepted steering", timestamp: 6 };
	const pending = suffix === "patches-steering" ? [steering] : [];
	const expected = [...history, ...patches, ...(suffix === "patches-steering" ? [steering] : [])];
	const context: AgentContext = {
		messages: [...history, prefix, ...(suffix === "prepare-patches" ? [] : patches)],
		tools: suffix === "none" ? [tool] : [tool, ...extra],
	};
	const requests: TranscriptContext[] = [];
	const flags: Array<boolean | undefined> = [];
	const echoed: AssistantMessage = {
		...prefix,
		content: [...prefix.content, { type: "text", text: "echo completed" }],
	};
	const final: AssistantMessage = { ...old, content: [{ type: "text", text: "done" }] };
	let preparation = 0;
	const preparedPrefills: Array<boolean | undefined> = [];
	const config: AgentLoopConfig = {
		model,
		returnPrefill: true,
		convertToLlm: (messages) =>
			messages.filter(
				(message) =>
					message.role === "system" ||
					message.role === "user" ||
					message.role === "assistant" ||
					message.role === "toolResult",
			),
		getSteeringMessages: async () => pending.splice(0),
		prepareRequest: (request) => {
			preparedPrefills.push(request.returnPrefill);
			if (suffix === "prepare-patches" && ++preparation === 1) {
				return { context: { ...request.context, messages: [...history, prefix, ...patches] } };
			}
			return undefined;
		},
	};
	const streamFn = (_model: Model<string>, request: TranscriptContext, options?: { returnPrefill?: boolean }) => {
		requests.push({ ...request, messages: request.messages.slice() });
		flags.push(options?.returnPrefill);
		const first = requests.length === 1;
		const stream = createAssistantMessageEventStream();
		if (first && delivery === "start-update") {
			const start = { ...prefix, content: [{ type: "text" as const, text: "resuming" }] };
			stream.push({ type: "start", partial: start });
			stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "once", partial: prefix });
		}
		if (delivery === "end-only") stream.end(first ? echoed : final);
		else stream.push({ type: "done", reason: first ? "toolUse" : "stop", message: first ? echoed : final });
		return stream;
	};
	const messages =
		consumer === "stream"
			? await agentLoopContinue(context, config, undefined, streamFn).result()
			: await runAgentLoopContinue(context, config, () => {}, undefined, streamFn);
	expect(executed).toEqual(["once"]);
	expect(flags).toEqual([true, false]);
	expect(preparedPrefills).toEqual([true, false]);
	expect(requests[0].messages).toEqual([...expected, prefix]);
	const wire = requests.map((request, index) => convertMessages(model, request, compat, { prefill: flags[index] }));
	expect(
		wire[1].flatMap((message) =>
			message.role === "assistant" ? (message.tool_calls ?? []).map((call) => call.id) : [],
		),
	).toEqual(["call_once"]);
	expect(wire[1].filter((message) => message.role === "tool")).toEqual([
		{ role: "tool", tool_call_id: "call_once", content: "genuine:once" },
	]);
	const result = messages.find((message) => message.role === "toolResult");
	expect(requests[1].messages).toEqual([...expected, echoed, result]);
	if (suffix !== "prepare-patches") expect(context.messages).toEqual([...expected, echoed, result, final]);
});

it("does not rotate ordinary history or trailing patches without prefill", async () => {
	const history: AgentMessage[] = [
		{ role: "user", content: "older", timestamp: 1 },
		fauxAssistantMessage("older answer"),
		{ role: "system", content: "older policy", timestamp: 2 },
		{ role: "user", content: "new request", timestamp: 3 },
		{ role: "system", content: "trailing policy", timestamp: 4 },
	];
	const context: AgentContext = { messages: history.slice() };
	let request: AgentMessage[] = [];
	const final = fauxAssistantMessage("ordinary answer");
	await runAgentLoopContinue(
		context,
		{
			model,
			convertToLlm: (messages) =>
				messages.filter(
					(message) =>
						message.role === "system" ||
						message.role === "user" ||
						message.role === "assistant" ||
						message.role === "toolResult",
				),
		},
		() => {},
		undefined,
		(_model, providerContext) => {
			request = providerContext.messages.slice();
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: final });
			return stream;
		},
	);
	expect(request).toEqual(history);
	expect(context.messages).toEqual([...history, final]);
});

it.each(["error", "aborted"] as const)("replaces the prefix once for a terminal-only %s", async (stopReason) => {
	const user: AgentMessage = { role: "user", content: "request", timestamp: 1 };
	const prefix = fauxAssistantMessage("prefix");
	const patch: SystemMessage = { role: "system", content: "policy", timestamp: 2 };
	const context: AgentContext = { messages: [user, prefix, patch] };
	const failure = fauxAssistantMessage("prefix partial", { stopReason });
	let starts = 0;
	let ends = 0;
	const result = await runAgentLoopContinue(
		context,
		{
			model,
			returnPrefill: true,
			convertToLlm: (messages) =>
				messages.filter(
					(message) =>
						message.role === "system" ||
						message.role === "user" ||
						message.role === "assistant" ||
						message.role === "toolResult",
				),
		},
		(event) => {
			if (event.type === "message_start") starts++;
			if (event.type === "message_end") ends++;
		},
		undefined,
		() => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "error", reason: stopReason, error: failure });
			return stream;
		},
	);
	expect(context.messages).toEqual([user, patch, failure]);
	expect(result).toEqual([failure]);
	expect(starts).toBe(1);
	expect(ends).toBe(1);
});
