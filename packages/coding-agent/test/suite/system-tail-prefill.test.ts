import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	getCurrentSystemMessage,
} from "@earendil-works/pi-ai";
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

it("preserves accepted dynamic discovery sections on continuation while refreshing base policy", async () => {
	let injected = false;
	const harness = await createHarness({
		fauxApi: "openai-completions",
		settings: { compaction: { enabled: false }, retry: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", (event) => {
					if (injected) return;
					injected = true;
					event.systemPromptOptions.sections.mcp_servers = "indirect server namespace: docs";
				});
			},
		],
	});
	try {
		harness.setResponses([fauxAssistantMessage("partial", { stopReason: "aborted" })]);
		await harness.session.prompt("start discovery");
		expect(getCurrentSystemMessage(harness.session.messages)?.sections?.mcp_servers).toContain("docs");
		harness.session.setCustomSystemPrompt("new accepted preamble");
		let sections: Record<string, string | null> | undefined;
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("partial continued", { stopReason: "aborted" });
			},
		]);
		await harness.session.continue();
		expect(sections?.mcp_servers).toBe("<mcp_servers>\nindirect server namespace: docs\n</mcp_servers>");
		expect(sections?.preamble).toBe("new accepted preamble");
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("partial continued twice", { stopReason: "aborted" });
			},
		]);
		await harness.session.continue();
		expect(sections?.mcp_servers).toContain("indirect server namespace: docs");
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("fresh prefix", { stopReason: "aborted" });
			},
		]);
		await harness.session.prompt("new start without discovery injection");
		expect(sections?.mcp_servers).toBeUndefined();
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("fresh prefix completed");
			},
		]);
		await harness.session.continue();
		expect(sections?.mcp_servers).toBeUndefined();
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});

it.each(["regenerate", "reopen"] as const)(
	"preserves selected discovery through %s continuation",
	async (operation) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-discovery-resume-"));
		let injected = false;
		let harness = await createHarness({
			cwd,
			sessionManager: SessionManager.create(cwd, join(cwd, "sessions")),
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						if (injected) return;
						injected = true;
						event.systemPromptOptions.sections.mcp_servers = "selected namespace docs";
					});
				},
			],
		});
		try {
			harness.setResponses([fauxAssistantMessage("selected prefix", { stopReason: "aborted" })]);
			await harness.session.prompt("selected request");
			if (operation === "reopen") {
				const file = harness.sessionManager.getSessionFile()!;
				harness.cleanup();
				harness = await createHarness({
					cwd,
					sessionManager: SessionManager.open(file),
					fauxApi: "openai-completions",
					settings: { compaction: { enabled: false }, retry: { enabled: false } },
				});
			}
			let discovery: string | null | undefined;
			harness.setResponses([
				(context) => {
					discovery = getCurrentSystemMessage(context.messages)?.sections?.mcp_servers;
					return fauxAssistantMessage(
						operation === "reopen" ? "selected prefix completed" : "regenerated prefix",
						operation === "regenerate" ? { stopReason: "aborted" } : {},
					);
				},
			]);
			if (operation === "regenerate") await harness.session.regenerateSwipe(harness.session.getSwipeGroup()!);
			else await harness.session.continue();
			expect(discovery).toBe("<mcp_servers>\nselected namespace docs\n</mcp_servers>");
			if (operation === "regenerate") {
				harness.setResponses([
					(context) => {
						discovery = getCurrentSystemMessage(context.messages)?.sections?.mcp_servers;
						return fauxAssistantMessage("regenerated prefix completed");
					},
				]);
				await harness.session.continue();
				expect(discovery).toBe("<mcp_servers>\nselected namespace docs\n</mcp_servers>");
			}
		} finally {
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);
