import { type AssistantMessage, createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { Agent, type AgentMessage, isHarnessMessage, stripTrailingHarnessMessages } from "../src/index.ts";

const cases: Array<{ label: string; content: AssistantMessage["content"] }> = [
	{ label: "text replay signature", content: [{ type: "text", text: "", textSignature: "opaque-text-signature" }] },
	{
		label: "Responses metadata",
		content: [{ type: "text", text: "", textSignature: '{"v":1,"id":"msg_signed","phase":"final_answer"}' }],
	},
	{
		label: "reasoning signature",
		content: [{ type: "thinking", thinking: "", thinkingSignature: "opaque-reasoning-signature" }],
	},
];
it.each(cases)("retains $label as a real assistant turn instead of regenerating user input", async ({ content }) => {
	const user: AgentMessage = { role: "user", content: "original request", timestamp: 1 };
	const signed: AssistantMessage = { ...fauxAssistantMessage(""), content };
	const policy: AgentMessage = { role: "system", content: "latest policy", timestamp: 2 };
	const history = [user, signed, policy];
	expect(stripTrailingHarnessMessages(history)).toBe(history);
	let dispatches = 0;
	const agent = new Agent({
		initialState: { messages: history },
		streamFn: () => {
			dispatches++;
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("regenerated answer") });
			return stream;
		},
	});
	await expect(agent.continue()).rejects.toBeInstanceOf(Error);
	expect(dispatches).toBe(0);
	expect(agent.state.messages).toEqual([user, signed, policy]);
	expect(isHarnessMessage(signed)).toBe(false);
});
it("still dismisses unsigned empty notifications and retries the user", async () => {
	const user: AgentMessage = { role: "user", content: "retry request", timestamp: 1 };
	const notification = fauxAssistantMessage("", { stopReason: "aborted" });
	let dispatches = 0;
	const answer = fauxAssistantMessage("retried answer");
	const agent = new Agent({
		initialState: { messages: [user, notification] },
		streamFn: () => {
			dispatches++;
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: answer });
			return stream;
		},
	});
	expect(isHarnessMessage(notification)).toBe(true);
	await agent.continue();
	expect(dispatches).toBe(1);
	expect(agent.state.messages).toEqual([user, answer]);
});
