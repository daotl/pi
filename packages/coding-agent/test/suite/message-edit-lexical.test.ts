import { fauxAssistantMessage, normalizeContext } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { describe, expect, it } from "vitest";
import { formatMessageForEdit, formatMessageForSwipe } from "../../src/core/message-edit.ts";
import { createHarness, getMessageText } from "./harness.ts";

for (const format of ["edit", "swipe"] as const) {
	describe(`${format} lexical roundtrip`, () => {
		it("decodes formatted reasoning attributes exactly once and preserves provider replay", async () => {
			const harness = await createHarness();
			try {
				const signature = JSON.stringify({ type: "reasoning", id: "rs_1", encrypted_content: "opaque<&quot;>" });
				const message = {
					...fauxAssistantMessage([
						{ type: "thinking", thinking: "reasoning", thinkingSignature: signature },
						{ type: "text", text: "answer" },
					]),
					api: "openai-responses",
					provider: "openai",
					model: "fixture",
				};
				const entryId = harness.sessionManager.appendMessage(message);
				harness.sessionManager.appendMessage({ role: "user", content: "later", timestamp: 2 });
				harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
				const entry = harness.sessionManager.getEntry(entryId);
				if (!entry) throw new Error("Missing assistant entry");
				const xml =
					format === "edit" ? formatMessageForEdit(1, message) : formatMessageForSwipe(entry.timestamp, message);
				if (xml === null) throw new Error("Unexpected formatting refusal");
				harness.session.applyMessageEdits(xml);
				const stored = harness.session.messages.find((message) => message.role === "assistant");
				expect(stored?.role === "assistant" ? stored.content[0] : undefined).toMatchObject({
					thinkingSignature: signature,
				});
				const wire = convertResponsesMessages(
					{ ...harness.getModel(), api: "openai-responses", provider: "openai", id: "fixture" },
					normalizeContext({
						messages: harness.session.messages.filter((message) => message.role === "assistant"),
					}),
					new Set(["openai"]),
				);
				expect(wire).toContainEqual(JSON.parse(signature));
			} finally {
				harness.cleanup();
			}
		});
		it("retains an unbalanced literal less-than in the message body", async () => {
			const harness = await createHarness();
			try {
				const original = { role: "user" as const, content: "if x < y &lt; stays literal", timestamp: 1 };
				const id = harness.sessionManager.appendMessage(original);
				harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
				const entry = harness.sessionManager.getEntry(id);
				if (!entry) throw new Error("Missing user entry");
				const xml =
					format === "edit" ? formatMessageForEdit(0, original) : formatMessageForSwipe(entry.timestamp, original);
				if (xml === null) throw new Error("Unexpected formatting refusal");
				harness.session.applyMessageEdits(xml);
				expect(harness.session.messages.filter((message) => message.role === "user").map(getMessageText)).toEqual([
					original.content,
				]);
			} finally {
				harness.cleanup();
			}
		});
	});
}
