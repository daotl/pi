import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import type { ScheduledMessage } from "../../src/modes/interactive/interactive-mode.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness } from "./harness.ts";

const apply = Reflect.get(InteractiveMode.prototype, "handleApplyMessageEdits") as (
	this: object,
	text: string,
	options: { clearEditor: boolean },
) => Promise<boolean>;
const scheduled = Reflect.get(InteractiveMode.prototype, "runScheduledAction") as (
	this: object,
	entry: ScheduledMessage,
) => void;

describe("scheduled edit application", () => {
	it.each(["valid", "empty", "invalid"] as const)(
		"preserves the draft and only continues an accepted %s edit",
		async (kind) => {
			const harness = await createHarness();
			try {
				harness.sessionManager.appendMessage({ role: "user", content: "original", timestamp: 1 });
				harness.sessionManager.appendMessage(fauxAssistantMessage("answer"));
				harness.session.refreshContext();
				let draft = "unsent user draft";
				const history = structuredClone(harness.sessionManager.getEntries());
				const continueRun = vi.fn(async () => {});
				const status = vi.fn();
				const error = vi.fn();
				const context = {
					session: harness.session,
					editor: {
						setText: (text: string) => {
							draft = text;
						},
					},
					chatContainer: { clear: vi.fn() },
					renderInitialMessages: vi.fn(),
					showStatus: status,
					showError: error,
					handleContinueCommand: continueRun,
					handleApplyMessageEdits(text: string, options: { clearEditor: boolean }) {
						return apply.call(this, text, options);
					},
				};
				const text =
					kind === "valid"
						? '<pi_edit id="1" role="user">edited</pi_edit>'
						: kind === "invalid"
							? '<pi_edit id="999" role="user">bad</pi_edit>'
							: "not an edit";
				scheduled.call(context, { id: 1, text, when: { type: "settled" }, isContinue: false, isEdit: true });
				await vi.waitFor(() => expect(status.mock.calls.length + error.mock.calls.length).toBe(1));
				await new Promise<void>((resolve) => setImmediate(resolve));
				expect(draft).toBe("unsent user draft");
				expect(continueRun).toHaveBeenCalledTimes(kind === "valid" ? 1 : 0);
				if (kind === "valid")
					expect(harness.session.messages.find((message) => message.role === "user")?.content).toEqual([
						{ type: "text", text: "edited" },
					]);
				else expect(harness.sessionManager.getEntries()).toEqual(history);
			} finally {
				harness.cleanup();
			}
		},
	);

	it("clears an accepted editor-origin edit but keeps rejected editor text", async () => {
		const harness = await createHarness();
		try {
			harness.sessionManager.appendMessage({ role: "user", content: "original", timestamp: 1 });
			harness.session.refreshContext();
			let draft = "editor edit";
			const context = {
				session: harness.session,
				editor: {
					setText: (text: string) => {
						draft = text;
					},
				},
				chatContainer: { clear: vi.fn() },
				renderInitialMessages: vi.fn(),
				showStatus: vi.fn(),
				showError: vi.fn(),
			};
			expect(
				await apply.call(context, '<pi_edit id="999" role="user">invalid</pi_edit>', { clearEditor: true }),
			).toBe(false);
			expect(draft).toBe("editor edit");
			expect(await apply.call(context, '<pi_edit id="0" role="user">edited</pi_edit>', { clearEditor: true })).toBe(
				true,
			);
			expect(draft).toBe("");
		} finally {
			harness.cleanup();
		}
	});
});
