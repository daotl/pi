import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageCostBreakdown } from "../../src/core/usage-totals.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

it("persists the rejected terminal charge while restoring the original prefill in effective context", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-terminal-receipt-"));
	let harness: Harness | undefined;
	try {
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		harness.setResponses([fauxAssistantMessage("original partial", { stopReason: "aborted" })]);
		await harness.session.prompt("initial request");
		const before = harness.session.getSessionStats();
		const usage = {
			input: 11,
			output: 7,
			cacheRead: 3,
			cacheWrite: 2,
			totalTokens: 23,
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
		};
		const terminal = {
			...fauxAssistantMessage("different terminal"),
			api: "openai-completions" as const,
			provider: "physical-provider",
			model: "physical-model",
			responseId: "physical-response",
			usage,
		};
		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: terminal }));
			return stream;
		};
		await harness.session.continue();
		expect(harness.session.getLastAssistantText()).toBe("original partial");
		expect(harness.session.isIdle).toBe(true);
		const stats = harness.session.getSessionStats();
		expect(stats.tokens).toEqual({
			input: before.tokens.input + usage.input,
			output: before.tokens.output + usage.output,
			cacheRead: before.tokens.cacheRead + usage.cacheRead,
			cacheWrite: before.tokens.cacheWrite + usage.cacheWrite,
			total: before.tokens.total + usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
		});
		expect(stats.cost).toBe(before.cost + usage.cost.total);
		const reopened = SessionManager.open(manager.getSessionFile()!);
		const receipts = reopened
			.getEntries()
			.flatMap((entry) =>
				entry.type === "message" &&
				entry.message.role === "assistant" &&
				entry.message.responseId === terminal.responseId
					? [entry.message]
					: [],
			);
		expect(receipts).toEqual([
			expect.objectContaining({
				api: terminal.api,
				provider: terminal.provider,
				model: terminal.model,
				responseId: terminal.responseId,
				usage,
				stopReason: "error",
				content: [{ type: "text", text: "" }],
			}),
		]);
		expect(
			getUsageCostBreakdown(reopened.getEntries()).find((entry) => entry.key === "physical-provider/physical-model"),
		).toEqual({ key: "physical-provider/physical-model", cost: usage.cost.total, tokens: 23 });
		expect(getMessageText(reopened.buildSessionContext().messages.at(-1))).toBe("original partial");
		expect(
			reopened
				.getEntries()
				.some((entry) => entry.type === "message" && getMessageText(entry.message) === "different terminal"),
		).toBe(false);
	} finally {
		harness?.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});
