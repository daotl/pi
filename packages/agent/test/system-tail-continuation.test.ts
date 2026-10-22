import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import {
	Agent,
	type AgentLoopConfig,
	type AgentMessage,
	agentLoopContinue,
	runAgentLoopContinue,
} from "../src/index.ts";

const model: Model<"openai-completions"> = {
	id: "system-tail",
	name: "System tail",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://localhost:0/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
};
const firstPatch: AgentMessage = { role: "system", content: "first policy", timestamp: 1 };
const lastPatch: AgentMessage = { role: "system", content: "last policy", timestamp: 2 };
const config: AgentLoopConfig = {
	model,
	convertToLlm: (messages) =>
		messages.filter(
			(message) =>
				message.role === "system" ||
				message.role === "user" ||
				message.role === "assistant" ||
				message.role === "toolResult",
		),
};

it.each(
	(["stream", "run"] as const).flatMap((consumer) =>
		["system-only", "completed-assistant"].map((tail) => ({ consumer, tail })),
	),
)("rejects $tail behind policy patches before dispatch ($consumer)", async ({ consumer, tail }) => {
	let dispatches = 0;
	const completed = fauxAssistantMessage("completed answer");
	const messages = tail === "system-only" ? [firstPatch, lastPatch] : [completed, firstPatch, lastPatch];
	const original = messages.slice();
	const streamFn = () => {
		dispatches++;
		const stream = createAssistantMessageEventStream();
		stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("must not regenerate") });
		return stream;
	};
	if (consumer === "stream") expect(() => agentLoopContinue({ messages }, config, undefined, streamFn)).toThrow();
	else
		await expect(runAgentLoopContinue({ messages }, config, () => {}, undefined, streamFn)).rejects.toBeInstanceOf(
			Error,
		);
	expect(dispatches).toBe(0);
	expect(messages).toEqual(original);
});

it.each(["stream", "run"] as const)(
	"dismisses only empty notifications across ordered system patches (%s)",
	async (consumer) => {
		const user: AgentMessage = { role: "user", content: "retry request", timestamp: 3 };
		const empty = fauxAssistantMessage("", { stopReason: "aborted" });
		const context = { messages: [user, empty, firstPatch, { ...empty }, lastPatch] };
		let request: TranscriptContext | undefined;
		const streamFn = (_model: Model<string>, providerContext: TranscriptContext) => {
			request = { ...providerContext, messages: providerContext.messages.slice() };
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("retried answer") });
			return stream;
		};
		if (consumer === "stream") await agentLoopContinue(context, config, undefined, streamFn).result();
		else await runAgentLoopContinue(context, config, () => {}, undefined, streamFn);
		expect(request?.messages).toEqual([user, firstPatch, lastPatch]);
	},
);

it.each(["steering", "followUp"] as const)(
	"uses queued %s input rather than regenerating the assistant behind a system patch",
	async (queue) => {
		const user: AgentMessage = { role: "user", content: "old request", timestamp: 1 };
		const completed = fauxAssistantMessage("completed answer");
		const queued: AgentMessage = { role: "user", content: "new request", timestamp: 3 };
		const requests: TranscriptContext[] = [];
		const answer = fauxAssistantMessage("new answer");
		const agent = new Agent({
			initialState: { model, messages: [user, completed, firstPatch, lastPatch] },
			streamFn: (_model, context) => {
				requests.push({ ...context, messages: context.messages.slice() });
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: "stop", message: answer });
				return stream;
			},
		});
		if (queue === "steering") agent.steer(queued);
		else agent.followUp(queued);
		await agent.continue();
		expect(requests.map((request) => request.messages)).toEqual([[user, completed, firstPatch, lastPatch, queued]]);
		expect(agent.peekQueuedMessages()).toEqual([]);
		expect(agent.state.messages).toEqual([user, completed, firstPatch, lastPatch, queued, answer]);
	},
);
