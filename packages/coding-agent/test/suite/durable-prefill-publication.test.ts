import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { estimateProjectedContextTokens } from "../../src/core/compaction/compaction.ts";
import { FooterDataProvider } from "../../src/core/footer-data-provider.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageTotals } from "../../src/core/usage-totals.ts";
import { FooterComponent } from "../../src/modes/interactive/components/footer.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, getMessageText } from "./harness.ts";

it.each(["success", "mismatch"] as const)(
	"keeps the original prefix and suffix durable while a continuation is held (%s)",
	async (outcome) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-durable-prefill-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		const started = Promise.withResolvers<void>();
		const stream = createAssistantMessageEventStream();
		let running: Promise<void> | undefined;
		try {
			harness.setResponses([fauxAssistantMessage("raw partial", { stopReason: "aborted" })]);
			await harness.session.prompt("original request");
			const prefix = manager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (!prefix) throw new Error("Expected prefix");
			manager.appendContextEdit(prefix.id, { content: [{ type: "text", text: "edited partial" }] });
			const hidden = manager.appendCustomMessageEntry("suffix", "hidden suffix", false);
			manager.appendContextEdit(hidden, null);
			manager.appendMessage({ role: "system", content: "trailing policy", timestamp: 2 });
			manager.appendCompaction("checkpoint", prefix.id, 100);
			manager.appendUsage("suffix", "faux", "faux-1", {
				input: 7,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 10,
				cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
			});
			harness.session.refreshContext();
			const original = structuredClone(manager.getEntries());
			const selected = manager.getLeafId();
			const bytes = readFileSync(manager.getSessionFile()!);
			const beforeUsage = getUsageTotals(manager.getEntries());
			const terminalUsage = {
				input: 11,
				output: 7,
				cacheRead: 3,
				cacheWrite: 2,
				totalTokens: 23,
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
			};
			let request: string[] = [];
			harness.session.agent.streamFunction = (_model, context) => {
				request = context.messages.map(getMessageText);
				started.resolve();
				return stream;
			};
			running = harness.session.continue();
			await Promise.race([
				started.promise,
				running.then(() => {
					throw new Error("Continuation ended before provider startup");
				}),
			]);
			expect(readFileSync(manager.getSessionFile()!)).toEqual(bytes);
			const held = SessionManager.open(manager.getSessionFile()!);
			expect(held.getEntries()).toEqual(original);
			expect(held.getLeafId()).toBe(selected);
			expect(request.filter((text) => text === "edited partial")).toEqual(["edited partial"]);
			expect(request.at(-1)).toBe("edited partial");
			expect(request).not.toContain("hidden suffix");
			stream.push({
				type: "done",
				reason: "stop",
				message: {
					...fauxAssistantMessage(outcome === "success" ? "edited partial completed" : "mismatched terminal"),
					usage: terminalUsage,
				},
			});
			await running;
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				const projection = current.buildSessionContext().messages;
				expect(projection.filter((message) => message.role === "assistant").map(getMessageText)).toEqual([
					outcome === "success" ? "edited partial completed" : "edited partial",
				]);
				expect(projection.map(getMessageText)).not.toContain("hidden suffix");
				expect(projection.map(getMessageText)).toContain("trailing policy");
				const activeCheckpoint = current.getBranch().find((entry) => entry.type === "compaction");
				const activeAssistant = current
					.getBranch()
					.find(
						(entry) =>
							entry.type === "message" && entry.message.role === "assistant" && !entry.message.errorMessage,
					);
				expect(activeCheckpoint?.type === "compaction" ? activeCheckpoint.firstKeptEntryId : undefined).toBe(
					activeAssistant?.id,
				);
				expect(getUsageTotals(current.getEntries())).toEqual({
					input: beforeUsage.input + 11,
					output: beforeUsage.output + 7,
					cacheRead: beforeUsage.cacheRead + 3,
					cacheWrite: beforeUsage.cacheWrite + 2,
					cost: beforeUsage.cost + 10,
				});
			}
		} finally {
			stream.end(fauxAssistantMessage("", { stopReason: "aborted" }));
			await harness.session.abort();
			await running?.catch(() => {});
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it.each(["copy", "edit", "checkpoint"] as const)(
	"invalidates continued usage after a later %s across reopen",
	async (invalidation) => {
		initTheme(undefined, false);
		const cwd = mkdtempSync(join(tmpdir(), "pi-continued-usage-"));
		let harness = await createHarness({
			cwd,
			sessionManager: SessionManager.create(cwd, join(cwd, "sessions")),
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
		});
		const footerData = new FooterDataProvider(cwd);
		try {
			harness.setResponses([fauxAssistantMessage("partial", { stopReason: "aborted" })]);
			await harness.session.prompt("question");
			const partial = harness.sessionManager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant")!;
			harness.sessionManager.appendCompaction("checkpoint", partial.id, 9999);
			harness.session.refreshContext();
			expect(harness.session.getContextUsage()?.tokens).toBeNull();
			harness.setResponses([fauxAssistantMessage("partial completed")]);
			await harness.session.continue();
			const completed = harness.session.messages.find(
				(message) => message.role === "assistant" && getMessageText(message) === "partial completed",
			);
			if (completed?.role !== "assistant") throw new Error("Expected completed response");
			const billedTokens = completed.usage.totalTokens;
			expect(billedTokens).toBeGreaterThan(0);
			const file = harness.sessionManager.getSessionFile()!;
			for (const reopened of [false, true]) {
				if (reopened) {
					harness.cleanup();
					harness = await createHarness({
						cwd,
						sessionManager: SessionManager.open(file),
						fauxApi: "openai-completions",
						settings: { compaction: { enabled: false }, retry: { enabled: false } },
					});
				}
				const manager = harness.sessionManager;
				expect(
					estimateProjectedContextTokens(manager.buildSessionProjection(), manager.getBranch()).usageTokens,
				).toBe(billedTokens);
				expect(harness.session.getSessionStats().contextUsage?.tokens).toBeGreaterThanOrEqual(billedTokens);
				expect(new FooterComponent(harness.session, footerData).render(160).join("\n")).not.toContain("?/");
			}
			const manager = harness.sessionManager;
			const user = manager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user")!;
			if (invalidation === "copy") {
				manager.replaceMessages([
					{ entryId: user.id, message: { role: "user", content: "changed question", timestamp: 1 } },
				]);
			} else if (invalidation === "edit") {
				manager.appendContextEdit(user.id, { content: "changed retained request" });
			} else {
				manager.appendCompaction("later checkpoint", user.id, 9999);
			}
			harness.session.refreshContext();
			for (const current of [manager, SessionManager.open(file)]) {
				expect(
					estimateProjectedContextTokens(current.buildSessionProjection(), current.getBranch()).usageTokens,
				).toBe(0);
			}
			expect(harness.session.getContextUsage()?.tokens).toBeNull();
			harness.cleanup();
			harness = await createHarness({
				cwd,
				sessionManager: SessionManager.open(file),
				fauxApi: "openai-completions",
				settings: { compaction: { enabled: false }, retry: { enabled: false } },
			});
			expect(harness.session.getSessionStats().contextUsage?.tokens).toBeNull();
			expect(new FooterComponent(harness.session, footerData).render(160).join("\n")).toContain("?/");
		} finally {
			footerData.dispose();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it("executes and replays a continued call reusing a deleted prefix call ID without changing historical tombstones", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-continued-call-"));
	let executions = 0;
	const harness = await createHarness({
		cwd,
		sessionManager: SessionManager.create(cwd, join(cwd, "sessions")),
		fauxApi: "openai-completions",
		settings: { compaction: { enabled: false }, retry: { enabled: false } },
		tools: [
			{
				name: "probe",
				label: "Probe",
				description: "Probe",
				parameters: Type.Object({}),
				execute: async () => {
					executions++;
					return { content: [{ type: "text", text: "executed current call" }], details: {} };
				},
			},
		],
	});
	try {
		harness.setResponses([
			fauxAssistantMessage([fauxText("partial"), fauxToolCall("probe", {}, { id: "call_1" })], {
				stopReason: "aborted",
			}),
		]);
		await harness.session.prompt("start");
		const original = harness.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "assistant")!;
		harness.session.softDeleteLastMessages(1);
		const historical = structuredClone(harness.sessionManager.getEntry(original.id));
		let nextRequest = "";
		harness.setResponses([
			fauxAssistantMessage([fauxText("partial completed"), fauxToolCall("probe", {}, { id: "call_1" })], {
				stopReason: "toolUse",
			}),
			(context) => {
				nextRequest = JSON.stringify(context.messages);
				return fauxAssistantMessage("finished");
			},
		]);
		await harness.session.continue();
		expect(executions).toBe(1);
		const request = JSON.parse(nextRequest) as Array<{
			role: string;
			content: Array<{ type: string; id?: string }>;
			toolCallId?: string;
		}>;
		expect(
			request.some(
				(message) =>
					message.role === "assistant" &&
					message.content.some((block) => block.type === "toolCall" && block.id === "call_1"),
			),
		).toBe(true);
		expect(request.some((message) => message.role === "toolResult" && message.toolCallId === "call_1")).toBe(true);
		for (const current of [harness.sessionManager, SessionManager.open(harness.sessionManager.getSessionFile()!)]) {
			expect(current.getEntry(original.id)).toMatchObject({ ...historical, supersededBy: expect.any(String) });
			const active = current
				.getBranch()
				.find(
					(entry) =>
						entry.type === "message" &&
						entry.message.role === "assistant" &&
						getMessageText(entry.message) === "partial completed",
				);
			expect(active?.type === "message" ? active.deletedToolCalls : undefined).toBeUndefined();
		}
	} finally {
		harness.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});
