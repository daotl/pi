import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../../../src/core/agent-session.ts";
import { type JsonAgentSessionEvent, toJsonEvent } from "../../../src/modes/json-event.ts";
import { createHarness, type Harness } from "../harness.ts";

describe("regression #7911: JSON message updates retain usage", () => {
	let harness: Harness | undefined;

	afterEach(() => {
		harness?.cleanup();
	});

	it("includes cumulative usage without cumulative message snapshots", async () => {
		harness = await createHarness();
		harness.setResponses([fauxAssistantMessage("hello")]);

		await harness.session.prompt("respond");

		// #7290's delta-only wire projection dropped this fixed-size metadata with the snapshots.
		const update = harness
			.eventsOfType("message_update")
			.find((event) => event.message.role === "assistant" && event.message.usage.totalTokens > 0);
		if (!update || update.message.role !== "assistant") {
			throw new Error("Expected an assistant update with populated usage");
		}

		const wireUpdate = toJsonEvent(update);
		expect(wireUpdate.usage).toEqual(update.message.usage);
		expect(wireUpdate).not.toHaveProperty("message");
		expect(wireUpdate.assistantMessageEvent).not.toHaveProperty("partial");
	});
});

describe("JSON retry limit projection", () => {
	it.each(["auto_retry_start", "summarization_retry_scheduled"] as const)(
		"represents unlimited and finite limits explicitly for %s without mutating session events",
		(type) => {
			for (const maxAttempts of [Number.POSITIVE_INFINITY, 3]) {
				const event = {
					type,
					attempt: 1,
					maxAttempts,
					delayMs: 250,
					errorMessage: "overloaded_error",
				} satisfies AgentSessionEvent;
				const expected = {
					...event,
					maxAttempts: maxAttempts === Number.POSITIVE_INFINITY ? null : maxAttempts,
				} satisfies JsonAgentSessionEvent;
				const wire: JsonAgentSessionEvent = toJsonEvent(event);
				expect(wire).toEqual(expected);
				expect(JSON.parse(JSON.stringify(wire))).toEqual(expected);
				expect(event.maxAttempts).toBe(maxAttempts);
			}
		},
	);
});
