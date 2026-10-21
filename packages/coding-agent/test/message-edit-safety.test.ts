import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
	formatMessageContent,
	formatMessageForEdit,
	formatMessageForSwipe,
	parseMessageEditsAndSwipes,
} from "../src/core/message-edit.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

const lossyMessages: AgentMessage[] = [
	{ role: "user", content: '<pi_image mimeType="image/png">not an image</pi_image>', timestamp: 1 },
	fauxAssistantMessage([{ type: "text", text: "signed text", textSignature: "replay-id" }]),
	fauxAssistantMessage([{ type: "toolCall", id: "call", name: "read", arguments: {}, raw: "<raw>" }]),
	fauxAssistantMessage([{ type: "toolCall", id: "call", name: "read", arguments: {}, namespace: "dynamic" }]),
	fauxAssistantMessage([{ type: "thinking", thinking: "signed", thinkingSignature: "" }]),
	fauxAssistantMessage([{ type: "text", text: " \t\n" }]),
];

describe("lossless edit formatting", () => {
	it.each(lossyMessages.map((message, index) => ({ message, index })))(
		"refuses lossy content/replay metadata $index for edit and swipe",
		({ message }) => {
			expect(formatMessageForEdit(0, message)).toBeNull();
			expect(formatMessageForSwipe("2026-01-01T00:00:00Z", message)).toBeNull();
		},
	);

	it("does not throw while probing ordinary text with nonobject tool XML", () => {
		const message = fauxAssistantMessage([
			{ type: "text", text: 'example</pi_content><pi_tool_call id="call" name="read">[]</pi_tool_call>' },
		]);
		expect(formatMessageForEdit(0, message)).toBeNull();
		expect(formatMessageForSwipe("fixture", message)).toBeNull();
	});

	it("retains representable native signed reasoning and literal body text", () => {
		const message = fauxAssistantMessage([
			{ type: "thinking", thinking: "reasoning", thinkingSignature: "opaque<&>" },
			{ type: "text", text: "literal <value> &amp;" },
		]);
		const xml = formatMessageForEdit(0, message);
		if (xml === null) throw new Error("Unexpected refusal");
		expect(parseMessageEditsAndSwipes(xml).edits[0].content).toEqual(message.content);
	});
});

const editCommand = Reflect.get(InteractiveMode.prototype, "handleEditCommand") as (
	this: object,
	arg: string,
) => Promise<void>;
const copyMatch = Reflect.get(InteractiveMode.prototype, "formatCopyMatch") as (
	this: object,
	match: { message: AgentMessage; editableIndex: number },
	multiple: boolean,
) => string | undefined;

describe("edit/copy selection safety", () => {
	it.each(["substring", "swipe"] as const)(
		"keeps the draft when any %s match cannot round-trip",
		async (selection) => {
			let draft = "keep unsent draft";
			const safe: AgentMessage = { role: "user", content: "safe match", timestamp: 1 };
			const unsafe = lossyMessages[0];
			const setText = vi.fn((text: string) => {
				draft = text;
			});
			const context = {
				session: {
					isStreaming: false,
					getEditableMessagesContaining: () => [
						{ index: 1, message: safe },
						{ index: 0, message: unsafe },
					],
					getSwipeGroup: () => ({
						currentIndex: 0,
						versions: [
							{ timestamp: "one", message: safe },
							{ timestamp: "two", message: unsafe },
						],
					}),
				},
				editor: { setText },
				showStatus: vi.fn(),
			};
			await editCommand.call(context, selection === "swipe" ? "swipe 1,2" : "match");
			expect(draft).toBe("keep unsent draft");
			expect(setText).not.toHaveBeenCalled();
		},
	);

	it("retains unsafe matches as plain content in a multiple-message copy", () => {
		const message = lossyMessages[0];
		expect(copyMatch.call({}, { message, editableIndex: 0 }, true)).toBe(formatMessageContent(message));
	});
});
