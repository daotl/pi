import { createAssistantMessageEventStream, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { runAgentLoop } from "../src/agent-loop.ts";
import type { AgentTool } from "../src/types.ts";

const model: Model<"faux"> = {
	id: "natural-continuation",
	name: "Natural continuation",
	api: "faux",
	provider: "local",
	baseUrl: "http://localhost:0",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 8192,
	maxTokens: 1024,
};
const scenarios = [
	{ label: "all terminate", terminate: [true, true], override: undefined, canContinue: false },
	{ label: "mixed", terminate: [true, false], override: undefined, canContinue: true },
	{ label: "hook terminates", terminate: [false, false], override: true, canContinue: false },
	{ label: "hook resumes", terminate: [true, true], override: false, canContinue: true },
];
it.each(
	(["sequential", "parallel"] as const).flatMap((toolExecution) =>
		scenarios.map((scenario) => ({ ...scenario, toolExecution })),
	),
)(
	"schedules from finalized natural continuation ($toolExecution, $label)",
	async ({ toolExecution, terminate, override, canContinue }) => {
		const schema = Type.Object({ index: Type.Number() });
		const tool: AgentTool<typeof schema> = {
			name: "handoff",
			label: "Handoff",
			description: "Finish or continue work",
			parameters: schema,
			execute: async (_id, { index }) => ({
				content: [{ type: "text", text: `result ${index}` }],
				details: {},
				terminate: terminate[index],
			}),
		};
		const observed: boolean[] = [];
		let requests = 0;
		const messages = await runAgentLoop(
			[{ role: "user", content: "work", timestamp: 1 }],
			{ messages: [], tools: [tool] },
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
				toolExecution,
				afterToolCall: async () => (override === undefined ? undefined : { terminate: override }),
				finishTurn: (turn) => {
					const natural = turn.canContinue;
					observed.push(natural);
					if (!natural) return { action: "end" };
				},
			},
			() => {},
			undefined,
			() => {
				requests++;
				const message =
					requests === 1
						? {
								...fauxAssistantMessage(""),
								stopReason: "toolUse" as const,
								content: [
									{ type: "toolCall" as const, id: "first", name: "handoff", arguments: { index: 0 } },
									{ type: "toolCall" as const, id: "second", name: "handoff", arguments: { index: 1 } },
								],
							}
						: fauxAssistantMessage("completed");
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
				return stream;
			},
		);
		expect(observed).toEqual(canContinue ? [true, false] : [false]);
		expect(requests).toBe(canContinue ? 2 : 1);
		expect(messages.filter((message) => message.role === "toolResult").map((message) => message.content)).toEqual([
			[{ type: "text", text: "result 0" }],
			[{ type: "text", text: "result 1" }],
		]);
	},
);
it.each(["error", "aborted"] as const)("never grants natural continuation for %s", async (stopReason) => {
	const observed: boolean[] = [];
	let requests = 0;
	await runAgentLoop(
		[{ role: "user", content: "work", timestamp: 1 }],
		{ messages: [] },
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
			finishTurn: (turn) => {
				observed.push(turn.canContinue);
				return { action: "continue" };
			},
		},
		() => {},
		undefined,
		() => {
			requests++;
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "error", reason: stopReason, error: fauxAssistantMessage("", { stopReason }) });
			return stream;
		},
	);
	expect(observed).toEqual([false]);
	expect(requests).toBe(1);
});
