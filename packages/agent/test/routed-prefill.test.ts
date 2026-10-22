import { createAssistantMessageEventStream, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { Agent, type AgentEvent, type AgentLoopConfig, agentLoop, agentLoopContinue } from "../src/index.ts";

const physical: Model<"openai-completions"> = {
	id: "physical",
	name: "Physical",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://localhost:0/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
};
const virtual = { ...physical, api: "pi-virtual", provider: "router", id: "auto" };
const incompatible = { ...physical, api: "anthropic-messages" as const };
const prefill = {
	...fauxAssistantMessage("prefix"),
	api: physical.api,
	provider: physical.provider,
	model: physical.id,
};

it("resolves a virtual selection before accepting a supported physical prefill", async () => {
	const dispatched: string[] = [];
	const response = { ...prefill, content: [{ type: "text" as const, text: "prefix completed" }] };
	const agent = new Agent({
		initialState: { model: virtual, messages: [{ role: "user", content: "start", timestamp: 1 }] },
		prepareRequest: async () => ({ model: physical }),
		streamFn: (model, context, options) => {
			dispatched.push(model.api);
			expect(context.messages.at(-1)).toEqual(prefill);
			expect(options?.returnPrefill).toBe(true);
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: response });
			return stream;
		},
	});
	await agent.continue(prefill);
	expect(dispatched).toEqual(["openai-completions"]);
	expect(agent.state.messages.at(-1)).toEqual(response);
	expect(agent.state.model).toEqual(virtual);
});

it("rejects a prefill routed from a supported selection to an incompatible physical API before dispatch", async () => {
	let dispatches = 0;
	const agent = new Agent({
		initialState: { model: physical, messages: [{ role: "user", content: "start", timestamp: 1 }] },
		prepareRequest: async () => ({ model: incompatible }),
		streamFn: () => {
			dispatches++;
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: { ...prefill, api: incompatible.api } });
			return stream;
		},
	});
	await agent.continue(prefill);
	expect(dispatches).toBe(0);
	expect(agent.state.messages.at(-1)).toMatchObject({
		role: "assistant",
		stopReason: "error",
		usage: { totalTokens: 0 },
	});
	expect(agent.state.isStreaming).toBe(false);
});

it.each(["start", "continue"] as const)(
	"settles low-level %s consumers after incompatible prefill routing",
	async (mode) => {
		let dispatches = 0;
		const config: AgentLoopConfig = {
			model: virtual,
			returnPrefill: true,
			convertToLlm: (messages) =>
				messages.filter(
					(message) =>
						message.role === "system" ||
						message.role === "user" ||
						message.role === "assistant" ||
						message.role === "toolResult",
				),
			prepareRequest: async () => ({ model: incompatible }),
		};
		const context = { messages: mode === "continue" ? [prefill] : [] };
		const streamFn = () => {
			dispatches++;
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: { ...prefill, api: incompatible.api } });
			return stream;
		};
		const stream =
			mode === "start"
				? agentLoop([prefill], context, config, undefined, streamFn)
				: agentLoopContinue(context, config, undefined, streamFn);
		const events: AgentEvent[] = [];
		const iteration = (async () => {
			for await (const event of stream) events.push(event);
		})();
		const [, messages] = await Promise.all([iteration, stream.result()]);
		expect(dispatches).toBe(0);
		expect(messages.at(-1)).toMatchObject({
			role: "assistant",
			api: incompatible.api,
			provider: incompatible.provider,
			model: incompatible.id,
			stopReason: "error",
			usage: { totalTokens: 0 },
		});
		expect(events.filter((event) => event.type === "agent_end")).toEqual([{ type: "agent_end", messages }]);
		expect(events.filter((event) => event.type === "message_start")).toHaveLength(mode === "start" ? 2 : 1);
		expect(events.filter((event) => event.type === "message_end")).toHaveLength(mode === "start" ? 2 : 1);
	},
);

it("does not restrict an ordinary request routed to a non-prefill API", async () => {
	let dispatched = "";
	const response = { ...fauxAssistantMessage("ordinary answer"), api: incompatible.api };
	const agent = new Agent({
		initialState: { model: virtual },
		prepareRequest: async () => ({ model: incompatible }),
		streamFn: (model) => {
			dispatched = model.api;
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: response });
			return stream;
		},
	});
	await agent.prompt("ordinary request");
	expect(dispatched).toBe(incompatible.api);
	expect(agent.state.messages.at(-1)).toEqual(response);
});
