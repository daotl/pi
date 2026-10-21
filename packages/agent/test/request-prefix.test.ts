import { createAssistantMessageEventStream, fauxAssistantMessage, type Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/index.ts";

describe("Agent live request prefix", () => {
	it.each([undefined, "", "[initial] "])(
		"keeps raw converters composable across prefix changes %j",
		async (initialPrefix) => {
			const user = { role: "user" as const, content: "history", timestamp: 1 };
			const requests: Message[][] = [];
			const agent = new Agent({
				initialState: { messages: [user] },
				incomingMessagePrefix: initialPrefix,
				streamFn: (_model, context) => {
					requests.push(structuredClone(context.messages));
					const stream = createAssistantMessageEventStream();
					queueMicrotask(() =>
						stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("done") }),
					);
					return stream;
				},
			});
			const raw = agent.convertToLlm;
			agent.convertToLlm = async (messages) => raw(messages);
			await agent.continue();
			expect(requests[0]).toEqual([{ ...user, content: `${initialPrefix ?? ""}history` }]);
			agent.incomingMessagePrefix = "[live] ";
			const next = {
				role: "user" as const,
				content: [
					{ type: "text" as const, text: "next", textSignature: "metadata" },
					{ type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" },
				],
				timestamp: 2,
			};
			await agent.prompt(next);
			expect(requests[1].filter((message) => message.role === "user")).toEqual([
				{ ...user, content: "[live] history" },
				{ ...next, content: [{ ...next.content[0], text: "[live] next" }, next.content[1]] },
			]);
			agent.convertToLlm = raw;
			agent.incomingMessagePrefix = "[restored] ";
			await agent.prompt("string input");
			const users = requests[2].filter((message) => message.role === "user");
			expect(users[0]).toMatchObject({ content: "[restored] history" });
			expect(users[2]).toMatchObject({ content: [{ type: "text", text: "[restored] string input" }] });
			expect(agent.state.messages.filter((message) => message.role === "user").slice(0, 2)).toEqual([user, next]);
			expect(await raw([user])).toEqual([user]);
		},
	);
});
