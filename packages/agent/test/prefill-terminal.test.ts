import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { Agent, type AgentEvent, type AgentTool, prefillEchoComplete } from "../src/index.ts";

const model: Model<"openai-completions"> = {
	id: "selected",
	name: "Selected",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://localhost:0/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
};

function response(text: string): AssistantMessage {
	return { ...fauxAssistantMessage(text), api: model.api, provider: model.provider, model: model.id };
}

describe("terminal prefill publication barrier", () => {
	it.each(["terminal-only", "matching-partial", "no-start"] as const)(
		"rejects an incomplete terminal before a terminating tool executes (%s)",
		async (delivery) => {
			const prefill = response("original complete prefix");
			const terminal: AssistantMessage = {
				...response("orig"),
				provider: "physical-provider",
				model: "physical-model",
				responseId: "response-real",
				stopReason: "toolUse",
				content: [
					{ type: "text", text: "orig" },
					{ type: "toolCall", id: "echo", name: "record", arguments: {} },
				],
				usage: {
					input: 11,
					output: 7,
					cacheRead: 3,
					cacheWrite: 2,
					totalTokens: 23,
					cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
				},
			};
			const executed: string[] = [];
			const tool: AgentTool = {
				name: "record",
				label: "Record",
				description: "Record a side effect",
				parameters: Type.Object({}),
				execute: async () => {
					executed.push("executed");
					return { content: [], details: {}, terminate: true };
				},
			};
			let signal: AbortSignal | undefined;
			const events: AgentEvent[] = [];
			const agent = new Agent({
				initialState: { model, tools: [tool], messages: [{ role: "user", content: "start", timestamp: 1 }] },
				streamFn: (_model, _context, options) => {
					signal = options?.signal;
					const stream = createAssistantMessageEventStream();
					queueMicrotask(() => {
						if (delivery !== "no-start") stream.push({ type: "start", partial: prefill });
						if (delivery === "matching-partial")
							stream.push({ type: "text_delta", contentIndex: 0, delta: "", partial: prefill });
						stream.push({ type: "done", reason: "toolUse", message: terminal });
					});
					return stream;
				},
			});
			agent.subscribe((event) => {
				events.push(event);
			});
			const outcome = await agent.continue(prefill).then(
				() => undefined,
				(error) => error,
			);
			expect(executed).toEqual([]);
			expect(outcome).toBeUndefined();
			expect(agent.state.messages).not.toContain(terminal);
			expect(agent.state.messages.at(-1)).toMatchObject({
				role: "assistant",
				stopReason: "error",
				provider: terminal.provider,
				model: terminal.model,
				api: terminal.api,
				responseId: terminal.responseId,
				usage: terminal.usage,
				content: [{ type: "text", text: "" }],
			});
			expect(signal?.aborted).toBe(true);
			const assistantStarts = events.filter(
				(event) => event.type === "message_start" && event.message.role === "assistant",
			);
			const assistantEnds = events.filter(
				(event) => event.type === "message_end" && event.message.role === "assistant",
			);
			expect(assistantStarts).toHaveLength(1);
			expect(assistantEnds).toHaveLength(1);
			expect(events.some((event) => event.type === "tool_execution_start")).toBe(false);
		},
	);

	it("accepts a complete terminal echo and executes the tool once", async () => {
		const prefill = response("original complete prefix");
		const executed: string[] = [];
		const tool: AgentTool = {
			name: "record",
			label: "Record",
			description: "Record a side effect",
			parameters: Type.Object({}),
			execute: async () => {
				executed.push("executed");
				return { content: [], details: {}, terminate: true };
			},
		};
		const terminal: AssistantMessage = {
			...response("original complete prefix continued"),
			stopReason: "toolUse",
			content: [
				{ type: "text", text: "original complete prefix continued" },
				{ type: "toolCall", id: "echo", name: "record", arguments: {} },
			],
		};
		const agent = new Agent({
			initialState: { model, tools: [tool], messages: [{ role: "user", content: "start", timestamp: 1 }] },
			streamFn: () => {
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => stream.push({ type: "done", reason: "toolUse", message: terminal }));
				return stream;
			},
		});
		await agent.continue(prefill);
		expect(executed).toEqual(["executed"]);
		expect(agent.state.messages).toContain(terminal);
		expect(agent.state.messages.at(-1)?.role).toBe("toolResult");
	});

	it("aborts a streaming mismatch without inventing completed usage or a duplicate message start", async () => {
		const prefill = response("prefix");
		const events: AgentEvent[] = [];
		let signal: AbortSignal | undefined;
		const agent = new Agent({
			initialState: { model, messages: [{ role: "user", content: "start", timestamp: 1 }] },
			streamFn: (_model, _context, options) => {
				signal = options?.signal;
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => {
					const partial = response("wrong!");
					stream.push({ type: "start", partial });
					stream.push({ type: "text_delta", contentIndex: 0, delta: "wrong!", partial });
					stream.end(partial);
				});
				return stream;
			},
		});
		agent.subscribe((event) => {
			events.push(event);
		});
		await agent.continue(prefill);
		expect(signal?.aborted).toBe(true);
		expect(agent.state.messages.at(-1)).toMatchObject({
			stopReason: "error",
			content: [{ type: "text", text: "" }],
			usage: { totalTokens: 0 },
		});
		expect(
			events.filter((event) => event.type === "message_start" && event.message.role === "assistant"),
		).toHaveLength(1);
		expect(events.filter((event) => event.type === "message_end" && event.message.role === "assistant")).toHaveLength(
			1,
		);
	});

	it.each<{
		label: string;
		args: Extract<AssistantMessage["content"][number], { type: "toolCall" }>["arguments"];
		matches: boolean;
	}>([
		{ label: "scalar", args: { command: "delete", options: { enabled: true, paths: ["a", "b"] } }, matches: false },
		{ label: "nested", args: { command: "read", options: { enabled: false, paths: ["a", "b"] } }, matches: false },
		{
			label: "array order",
			args: { command: "read", options: { enabled: true, paths: ["b", "a"] } },
			matches: false,
		},
		{ label: "missing key", args: { command: "read", options: { paths: ["a", "b"] } }, matches: false },
		{ label: "null", args: { command: "read", options: null }, matches: false },
		{
			label: "object order",
			args: { options: { paths: ["a", "b"], enabled: true }, command: "read" },
			matches: true,
		},
	])("checks rawless arguments before execution ($label)", async ({ args, matches }) => {
		const prefill: AssistantMessage = {
			...response(""),
			content: [
				{
					type: "toolCall",
					id: "original",
					name: "record",
					arguments: { command: "read", options: { enabled: true, paths: ["a", "b"] } },
				},
			],
		};
		const terminal: AssistantMessage = {
			...response(""),
			stopReason: "toolUse",
			content: [{ type: "toolCall", id: "echo", name: "record", arguments: args }],
		};
		const executed: unknown[] = [];
		const tool: AgentTool = {
			name: "record",
			label: "Record",
			description: "Record arguments",
			parameters: Type.Object({
				command: Type.String(),
				options: Type.Unknown(),
			}),
			execute: async (_id, params) => {
				executed.push(params);
				return { content: [], details: {}, terminate: true };
			},
		};
		const agent = new Agent({
			initialState: { model, tools: [tool], messages: [{ role: "user", content: "start", timestamp: 1 }] },
			streamFn: () => {
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial: prefill });
					stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "", partial: prefill });
					stream.push({ type: "done", reason: "toolUse", message: terminal });
				});
				return stream;
			},
		});
		await agent.continue(prefill);
		expect(executed).toEqual(matches ? [args] : []);
		expect(prefillEchoComplete({ ...terminal, stopReason: "aborted" }, prefill)).toBe(matches);
		if (matches) expect(agent.state.messages).toContain(terminal);
		else {
			expect(agent.state.messages).not.toContain(terminal);
			expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: "error" });
		}
	});

	it.each(["thinking", "raw"] as const)(
		"rechecks complete terminal %s after a matching streamed partial",
		async (field) => {
			const prefill: AssistantMessage = {
				...response("prefix"),
				content: [
					{ type: "thinking", thinking: "complete reasoning" },
					{ type: "text", text: "prefix" },
					{ type: "toolCall", id: "original", name: "record", arguments: {}, raw: "complete raw" },
				],
			};
			const terminal: AssistantMessage = {
				...prefill,
				stopReason: "toolUse",
				content: prefill.content.map((block) => {
					if (field === "thinking" && block.type === "thinking") return { ...block, thinking: "short" };
					if (field === "raw" && block.type === "toolCall") return { ...block, raw: "short" };
					return block;
				}),
			};
			const executed: string[] = [];
			const tool: AgentTool = {
				name: "record",
				label: "Record",
				description: "Record",
				parameters: Type.Object({}),
				execute: async () => {
					executed.push("executed");
					return { content: [], details: {}, terminate: true };
				},
			};
			const agent = new Agent({
				initialState: { model, tools: [tool], messages: [{ role: "user", content: "start", timestamp: 1 }] },
				streamFn: () => {
					const stream = createAssistantMessageEventStream();
					queueMicrotask(() => {
						stream.push({ type: "start", partial: prefill });
						stream.push({ type: "text_delta", contentIndex: 1, delta: "", partial: prefill });
						stream.push({ type: "done", reason: "toolUse", message: terminal });
					});
					return stream;
				},
			});
			await agent.continue(prefill);
			expect(executed).toEqual([]);
			expect(agent.state.messages).not.toContain(terminal);
			expect(agent.state.messages.at(-1)).toMatchObject({ stopReason: "error" });
		},
	);

	it("does not reject provisional rawless arguments that complete correctly at terminal", async () => {
		const prefill: AssistantMessage = {
			...response(""),
			content: [{ type: "toolCall", id: "original", name: "record", arguments: { command: "read" } }],
		};
		const partial: AssistantMessage = {
			...prefill,
			content: [{ type: "toolCall", id: "echo", name: "record", arguments: { command: "r" } }],
		};
		const terminal: AssistantMessage = { ...prefill, stopReason: "toolUse" };
		const executed: unknown[] = [];
		const tool: AgentTool = {
			name: "record",
			label: "Record",
			description: "Record",
			parameters: Type.Object({ command: Type.String() }),
			execute: async (_id, args) => {
				executed.push(args);
				return { content: [], details: {}, terminate: true };
			},
		};
		const agent = new Agent({
			initialState: { model, tools: [tool], messages: [{ role: "user", content: "start", timestamp: 1 }] },
			streamFn: () => {
				const stream = createAssistantMessageEventStream();
				queueMicrotask(() => {
					stream.push({ type: "start", partial });
					stream.push({ type: "toolcall_delta", contentIndex: 0, delta: "r", partial });
					stream.push({ type: "done", reason: "toolUse", message: terminal });
				});
				return stream;
			},
		});
		await agent.continue(prefill);
		expect(executed).toEqual([{ command: "read" }]);
		expect(agent.state.messages).toContain(terminal);
	});
});
