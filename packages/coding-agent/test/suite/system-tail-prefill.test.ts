import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getMessageText } from "./harness.ts";

it.each((["success", "mismatch"] as const).flatMap((outcome) => [false, true].map((clone) => ({ outcome, clone }))))(
	"captures the assistant before trailing patches ($outcome, cloned tail $clone)",
	async ({ outcome, clone }) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-system-tail-prefill-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
		});
		try {
			if (clone) {
				harness.setResponses([fauxAssistantMessage("older retained answer")]);
				await harness.session.prompt("older retained request");
			}
			harness.setResponses([fauxAssistantMessage("original partial", { stopReason: "aborted" })]);
			await harness.session.prompt("start");
			const patch = { role: "system" as const, content: "preserved trailing policy", timestamp: 2 };
			harness.sessionManager.appendMessage(patch);
			const laterPatch = { role: "system" as const, content: "second trailing policy", timestamp: 3 };
			harness.sessionManager.appendMessage(laterPatch);
			const hiddenPolicy = "soft-deleted policy must stay hidden";
			const hiddenId = manager.appendMessage({ role: "system", content: hiddenPolicy, timestamp: 4 });
			manager.softDeleteUnits([{ entryId: hiddenId }]);
			harness.session.refreshContext();
			if (clone) {
				const earlier = manager
					.getBranch()
					.find(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "assistant" &&
							getMessageText(entry.message) === "older retained answer",
					);
				if (!earlier) throw new Error("Expected earlier assistant");
				harness.session.deleteMessage(earlier.id);
			}
			let prefill: boolean | undefined;
			let request: string[] = [];
			harness.session.agent.streamFunction = (_model, context, options) => {
				prefill = options?.returnPrefill;
				request = context.messages.map(getMessageText);
				const stream = createAssistantMessageEventStream();
				stream.push({
					type: "done",
					reason: "stop",
					message: fauxAssistantMessage(
						outcome === "success" ? "original partial completed" : "different terminal",
					),
				});
				return stream;
			};
			await harness.session.continue();
			expect(prefill).toBe(true);
			expect(request.slice(-3)).toEqual([patch.content, laterPatch.content, "original partial"]);
			expect(request).not.toContain(hiddenPolicy);
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				const context = current.buildSessionContext().messages;
				expect(context.map(getMessageText)).not.toContain(hiddenPolicy);
				const hidden = current
					.getBranch()
					.filter(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "system" &&
							getMessageText(entry.message) === hiddenPolicy,
					);
				expect(hidden).toEqual([expect.objectContaining({ deletedAt: expect.any(String) })]);
				if (clone)
					expect(context.filter((message) => message.role === "user").map(getMessageText)).toEqual([
						"older retained request",
						"start",
					]);
				expect(
					context
						.filter(
							(message) =>
								message.role === "system" &&
								[patch.content, laterPatch.content].includes(getMessageText(message)),
						)
						.map(getMessageText),
				).toEqual([patch.content, laterPatch.content]);
				expect(context.filter((message) => message.role === "assistant").map(getMessageText)).toEqual([
					outcome === "success" ? "original partial completed" : "original partial",
				]);
			}
			expect(harness.session.isIdle).toBe(true);
		} finally {
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);
