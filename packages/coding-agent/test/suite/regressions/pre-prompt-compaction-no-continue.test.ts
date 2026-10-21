import { type AssistantMessage, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, getAssistantTexts, getMessageText, getUserTexts, type Harness } from "../harness.ts";

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

describe("pre-prompt compaction regression", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.restoreAllMocks();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("compacts length-stop overflow before a new prompt without continuing from an assistant message", async () => {
		const harness = await createHarness({
			models: [{ id: "faux-1", contextWindow: 10_000, maxTokens: 100 }],
			settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
		});
		harnesses.push(harness);

		const now = Date.now();
		const model = harness.getModel();
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "previous prompt" }],
			timestamp: now - 1000,
		});
		const lengthStopAssistant: AssistantMessage = {
			...fauxAssistantMessage("length-stop assistant response", { stopReason: "length", timestamp: now - 500 }),
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: createUsage(10_000),
		};
		harness.sessionManager.appendMessage(lengthStopAssistant);
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		const requests: Array<Array<{ role: string; text: string }>> = [];
		harness.setResponses(
			["pre-prompt summary", "answer to next prompt"].map((answer) => (context) => {
				requests.push(context.messages.map((message) => ({ role: message.role, text: getMessageText(message) })));
				return fauxAssistantMessage(answer);
			}),
		);
		const continueSpy = vi.spyOn(harness.session.agent, "continue");

		await harness.session.prompt("next prompt");

		expect(requests).toHaveLength(2);
		expect(requests[0]?.map((message) => message.text).join("\n")).toContain("previous prompt");
		expect(requests[0]?.map((message) => message.text)).not.toContain("next prompt");
		expect(requests[1]?.filter((message) => message.role === "user").map((message) => message.text)).toContain(
			"next prompt",
		);
		expect(getUserTexts(harness)).toContain("next prompt");
		expect(getAssistantTexts(harness).at(-1)).toBe("answer to next prompt");
		expect(continueSpy).not.toHaveBeenCalled();
		expect(harness.eventsOfType("compaction_end")).toHaveLength(1);
		expect(harness.eventsOfType("compaction_end")[0]).toMatchObject({
			reason: "overflow",
			aborted: false,
			willRetry: true,
			result: { summary: "pre-prompt summary" },
		});
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toMatchObject([
			{ summary: "pre-prompt summary" },
		]);
	});
});
