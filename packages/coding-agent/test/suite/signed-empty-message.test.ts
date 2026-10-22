import { type AssistantMessage, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { createHarness } from "./harness.ts";

it.each(["text", "thinking"] as const)(
	"keeps signed empty %s addressable for soft-delete and restore",
	async (kind) => {
		const harness = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
		try {
			const user = { role: "user" as const, content: "retained question", timestamp: 1 };
			harness.sessionManager.appendMessage(user);
			const signed: AssistantMessage = {
				...fauxAssistantMessage(""),
				content:
					kind === "text"
						? [{ type: "text", text: "", textSignature: "opaque-text" }]
						: [{ type: "thinking", thinking: "", thinkingSignature: "opaque-reasoning" }],
			};
			const id = harness.sessionManager.appendMessage(signed);
			harness.session.refreshContext();
			expect(harness.session.getEditableMessage(0)?.entryId).toBe(id);
			const removed = harness.session.softDeleteLastMessages(1);
			expect(removed.map((unit) => unit.entry.id)).toEqual([id]);
			expect(harness.session.messages).toEqual([user]);
			expect(harness.session.restoreDeletedMessages(1).map((unit) => unit.entry.id)).toEqual([id]);
			expect(harness.session.messages).toEqual([user, signed]);
		} finally {
			harness.cleanup();
		}
	},
);
