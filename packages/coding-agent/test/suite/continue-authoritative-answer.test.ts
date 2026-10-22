import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getMessageText } from "./harness.ts";

it.each([false, true])(
	"rejects continuation of a completed answer without deleting it (policy tail %s)",
	async (patches) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-authoritative-answer-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			harness.setResponses([fauxAssistantMessage("completed answer")]);
			await harness.session.prompt("original question");
			if (patches) manager.appendMessage({ role: "system", content: "trailing policy", timestamp: 2 });
			harness.session.refreshContext();
			const entries = structuredClone(manager.getEntries());
			const leaf = manager.getLeafId();
			const before = harness.faux.state.callCount;
			harness.setResponses([fauxAssistantMessage("unwanted regeneration")]);
			await expect(harness.session.continue()).rejects.toBeInstanceOf(Error);
			expect(harness.faux.state.callCount).toBe(before);
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				expect(current.getEntries()).toEqual(entries);
				expect(current.getLeafId()).toBe(leaf);
				expect(
					current
						.buildSessionContext()
						.messages.filter((message) => message.role === "assistant")
						.map(getMessageText),
				).toEqual(["completed answer"]);
			}
			expect(harness.session.isIdle).toBe(true);
		} finally {
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it.each(["error", "aborted"] as const)(
	"retries an interrupted unsupported response through omission, not deletion (%s)",
	async (stopReason) => {
		const harness = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
		try {
			harness.setResponses([fauxAssistantMessage("interrupted answer", { stopReason })]);
			await harness.session.prompt("retry question");
			const original = harness.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (!original) throw new Error("Expected original assistant");
			let request: string[] = [];
			harness.setResponses([
				(context) => {
					request = context.messages.filter((message) => message.role !== "system").map(getMessageText);
					return fauxAssistantMessage("retried answer");
				},
			]);
			await harness.session.continue();
			expect(request).toEqual(["retry question"]);
			expect(harness.sessionManager.getEntry(original.id)).toEqual(original);
			expect(harness.sessionManager.getBranch()).toContainEqual(
				expect.objectContaining({ type: "context_edit", targetId: original.id, replacement: null }),
			);
			expect(harness.session.getLastAssistantText()).toBe("retried answer");
		} finally {
			await harness.session.abort();
			harness.cleanup();
		}
	},
);
