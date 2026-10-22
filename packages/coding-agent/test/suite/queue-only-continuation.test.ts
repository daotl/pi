import { type FauxResponseFactory, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("queue-only continuation after bounded retry", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length) harnesses.pop()?.cleanup();
	});

	it.each([
		{ queue: "steering", maxRetries: 0 },
		{ queue: "followUp", maxRetries: 0 },
		{ queue: "steering", maxRetries: 1 },
		{ queue: "followUp", maxRetries: 1 },
	] as const)("drains $queue after $maxRetries approved prefix retries", async ({ queue, maxRetries }) => {
		const harness = await createHarness({
			fauxApi: "openai-completions",
			settings: {
				retry: { enabled: maxRetries > 0, maxRetries, baseDelayMs: 0 },
				compaction: { enabled: false },
			},
		});
		harnesses.push(harness);
		const requests: Array<{ texts: string[]; prefill: boolean }> = [];
		harness.setResponses(
			Array.from(
				{ length: 5 },
				(_, attempt): FauxResponseFactory =>
					async (context, options) => {
						const texts = context.messages.map(getMessageText);
						requests.push({ texts, prefill: options?.returnPrefill === true });
						if (attempt === 0) {
							if (queue === "steering") await harness.session.steer("QUEUED INPUT");
							else await harness.session.followUp("QUEUED INPUT");
						}
						if (texts.includes("QUEUED INPUT")) return fauxAssistantMessage("queued answer");
						// Bound broken recapture without waiting for an unlimited provider retry.
						if (attempt === 4) harness.session.clearQueue();
						return fauxAssistantMessage(attempt === 0 ? "original partial prefix" : "orig", {
							stopReason: "error",
							errorMessage: "Connection error.",
						});
					},
			),
		);
		await harness.session.prompt("original request");
		expect(requests.map((request) => request.prefill)).toEqual(
			maxRetries === 0 ? [false, false] : [false, true, false],
		);
		expect(requests.at(-1)?.texts).toContain("QUEUED INPUT");
		expect(harness.session.getLastAssistantText()).toBe("queued answer");
		expect(harness.session.agent.hasQueuedMessages()).toBe(false);
		expect(harness.session.isIdle).toBe(true);
	});
});
