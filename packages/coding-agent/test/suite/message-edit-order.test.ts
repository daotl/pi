import type { AssistantMessage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	formatMessageForEdit,
	formatMessageForSwipe,
	parseMessageEditsAndSwipes,
} from "../../src/core/message-edit.ts";
import { createHarness } from "./harness.ts";

const call = { type: "toolCall" as const, id: "call", name: "read", arguments: { note: "a </pi_tool_call> inside" } };
const first = { type: "thinking" as const, thinking: "first signed body", thinkingSignature: "first" };
const second = { type: "thinking" as const, thinking: "second signed body", thinkingSignature: "second" };
const cases: { name: string; content: AssistantMessage["content"] }[] = [
	{ name: "text/tool/text", content: [{ type: "text", text: "before" }, call, { type: "text", text: "after" }] },
	{ name: "tool/reasoning/text", content: [call, first, { type: "text", text: "answer" }] },
	{ name: "text/reasoning/text", content: [{ type: "text", text: "before" }, first, { type: "text", text: "after" }] },
	{ name: "consecutive signed reasoning", content: [first, second, { type: "text", text: "answer" }] },
	{
		name: "multiple tool sections",
		content: [
			call,
			{ type: "toolCall", id: "two", name: "read", arguments: {} },
			{ type: "text", text: "after tools" },
		],
	},
];

for (const format of ["edit", "swipe"] as const) {
	describe(`${format} ordered sections`, () => {
		it.each(cases)("round-trips $name without refusing representable content", async ({ content }) => {
			const harness = await createHarness();
			try {
				harness.sessionManager.appendMessage({ role: "user", content: "question", timestamp: 1 });
				const message = fauxAssistantMessage(content);
				const id = harness.sessionManager.appendMessage(message);
				harness.session.refreshContext();
				const entry = harness.sessionManager.getEntry(id);
				if (!entry) throw new Error("Missing source assistant");
				const xml =
					format === "edit" ? formatMessageForEdit(0, message) : formatMessageForSwipe(entry.timestamp, message);
				if (xml === null) throw new Error("Representable content was refused");
				const parsed = parseMessageEditsAndSwipes(xml);
				expect([...parsed.edits, ...parsed.swipes][0].content).toEqual(content);
				harness.session.applyMessageEdits(xml);
				expect(harness.session.messages.findLast((item) => item.role === "assistant")?.content).toEqual(content);
				expect(message.content).toEqual(content);
			} finally {
				harness.cleanup();
			}
		});
	});
}
