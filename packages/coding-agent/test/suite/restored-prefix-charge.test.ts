import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { createHarness } from "./harness.ts";

it("does not charge a repeatedly restored cloned partial again but retains each completed rejection charge", async () => {
	const harness = await createHarness({
		fauxApi: "openai-completions",
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		harness.setResponses([fauxAssistantMessage("older answer")]);
		await harness.session.prompt("older request");
		harness.setResponses([fauxAssistantMessage("partial", { stopReason: "aborted" })]);
		await harness.session.prompt("current request");
		const older = harness.sessionManager
			.getBranch()
			.find(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "assistant" &&
					entry.message.content.some((part) => part.type === "text" && part.text === "older answer"),
			);
		if (!older) throw new Error("Expected earlier assistant");
		harness.session.deleteMessage(older.id);
		const before = harness.session.getSessionStats();
		const usage = {
			input: 11,
			output: 7,
			cacheRead: 3,
			cacheWrite: 2,
			totalTokens: 23,
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
		};
		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: { ...fauxAssistantMessage("mismatch"), usage } });
			return stream;
		};
		await harness.session.continue();
		await harness.session.continue();
		const stats = harness.session.getSessionStats();
		expect(stats.tokens).toEqual({
			input: before.tokens.input + 22,
			output: before.tokens.output + 14,
			cacheRead: before.tokens.cacheRead + 6,
			cacheWrite: before.tokens.cacheWrite + 4,
			total: before.tokens.total + 46,
		});
		expect(stats.cost).toBe(before.cost + 20);
		expect(harness.session.getLastAssistantText()).toBe("partial");
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});
