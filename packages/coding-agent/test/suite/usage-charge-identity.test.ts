import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { exportSessionToHtml } from "../../src/core/export-html/index.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageCostBreakdown } from "../../src/core/usage-totals.ts";
import { FooterComponent } from "../../src/modes/interactive/components/footer.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness } from "./harness.ts";

const usage = {
	input: 11,
	output: 7,
	cacheRead: 3,
	cacheWrite: 2,
	totalTokens: 23,
	cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
};
it.each(["replace", "remove"] as const)(
	"counts distinct equal-valued calls once each across repeated %s tail clones",
	async (mutation) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-charge-identity-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			initTheme(undefined, false);
			const first = manager.appendMessage({ role: "user", content: "first question", timestamp: 1 });
			const model = harness.getModel();
			const response = {
				...fauxAssistantMessage("first answer"),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage,
			};
			manager.appendMessage(response);
			manager.appendMessage({ role: "user", content: "second question", timestamp: 2 });
			manager.appendMessage({ ...response, content: [{ type: "text", text: "second answer" }] });
			if (mutation === "replace") {
				manager.replaceMessages([
					{ entryId: first, message: { role: "user", content: "edited first", timestamp: 1 } },
				]);
				const again = manager
					.getBranch()
					.find((entry) => entry.type === "message" && entry.message.role === "user");
				if (!again) throw new Error("Expected cloned user");
				manager.replaceMessages([
					{ entryId: again.id, message: { role: "user", content: "edited twice", timestamp: 1 } },
				]);
			} else {
				manager.removeMessage(first);
				const clonedSecond = manager
					.getBranch()
					.find((entry) => entry.type === "message" && entry.message.role === "user");
				if (!clonedSecond) throw new Error("Expected surviving user");
				manager.removeMessage(clonedSecond.id);
			}
			harness.session.refreshContext();
			const stats = harness.session.getSessionStats();
			expect(stats.tokens).toEqual({ input: 22, output: 14, cacheRead: 6, cacheWrite: 4, total: 46 });
			expect(stats.cost).toBe(20);
			expect(stats.assistantMessages).toBe(2);
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				expect(getUsageCostBreakdown(current.getEntries())).toEqual([
					{ key: `${model.provider}/${model.id}`, cost: 20, tokens: 46 },
				]);
			}
			const footer = new FooterComponent(harness.session, {
				getGitBranch: () => null,
				getExtensionStatuses: () => new Map(),
				getAvailableProviderCount: () => 1,
				onBranchChange: () => () => {},
			});
			expect(stripAnsi(footer.render(240)[1])).toContain("↑22 ↓14 R6 W4");
			expect(stripAnsi(footer.render(240)[1])).toContain("$20.000");
			const output = await exportSessionToHtml(manager, undefined, { outputPath: join(cwd, "session.html") });
			const html = readFileSync(output, "utf8");
			const encoded = html.match(/<script[^>]*id="session-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
			if (!encoded) throw new Error("Expected exported session data");
			const data = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
			expect(data.usageTotals).toEqual({ input: 22, output: 14, cacheRead: 6, cacheWrite: 4, cost: 20 });
		} finally {
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it("keeps tool, summary and independent model charges through clone and replay chains", async () => {
	const manager = SessionManager.inMemory();
	const harness = await createHarness({
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		const user = manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
		const model = harness.getModel();
		manager.appendMessage({ ...fauxAssistantMessage("answer"), provider: model.provider, model: model.id, usage });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "call",
			toolName: "tool",
			content: [{ type: "text", text: "result" }],
			isError: false,
			usage,
			timestamp: 2,
		});
		manager.appendCompaction("summary", user, 100, undefined, false, usage);
		manager.branchWithSummary(manager.getLeafId(), "branch summary", undefined, false, usage);
		manager.appendUsage("cache_warm", model.provider, model.id, usage);
		manager.replaceMessages([{ entryId: user, message: { role: "user", content: "edited question", timestamp: 1 } }]);
		const replay = manager
			.getBranch()
			.filter((entry) => entry.type === "compaction" || entry.type === "branch_summary" || entry.type === "usage");
		manager.appendTrailingEntries(replay);
		const replayAgain = manager.getBranch().slice(-replay.length);
		manager.appendTrailingEntries(replayAgain);
		harness.session.refreshContext();
		expect(harness.session.getSessionStats().tokens).toEqual({
			input: 55,
			output: 35,
			cacheRead: 15,
			cacheWrite: 10,
			total: 115,
		});
		expect(harness.session.getSessionStats().cost).toBe(50);
		expect(getUsageCostBreakdown(manager.getEntries())).toEqual([
			{ key: "Tools/summaries", cost: 30, tokens: 69 },
			{ key: `${model.provider}/${model.id}`, cost: 20, tokens: 46 },
		]);
	} finally {
		harness.cleanup();
	}
});

it("keeps equal-valued real alternatives distinct while soft deletion changes only context", async () => {
	const manager = SessionManager.inMemory();
	const harness = await createHarness({ sessionManager: manager });
	try {
		const user = manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
		const response = { ...fauxAssistantMessage("alternative"), usage };
		const first = manager.appendMessage(response);
		manager.branch(user);
		const second = manager.appendMessage({ ...response });
		manager.softDeleteUnits([{ entryId: first }]);
		manager.softDeleteUnits([{ entryId: second }]);
		harness.session.refreshContext();
		expect(harness.session.getSessionStats().cost).toBe(20);
		expect(harness.session.getSessionStats().tokens.total).toBe(46);
		manager.restoreDeletedUnits(2);
		harness.session.refreshContext();
		expect(harness.session.getSessionStats().cost).toBe(20);
		expect(getUsageCostBreakdown(manager.getEntries())).toEqual([
			{ key: `${response.provider}/${response.model}`, cost: 20, tokens: 46 },
		]);
	} finally {
		harness.cleanup();
	}
});
