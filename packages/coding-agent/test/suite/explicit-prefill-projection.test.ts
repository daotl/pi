import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { expect, it } from "vitest";
import type { BoundaryResult } from "../../src/core/extensions/types.ts";
import { createHarness, getMessageText } from "./harness.ts";

it("does not append a context-edited ordinary assistant again during a boundary continuation", async () => {
	let handled = false;
	const harness = await createHarness({
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("turn_end", (event): BoundaryResult | undefined => {
					if (handled) return;
					handled = true;
					return {
						entries: [
							{
								type: "context_edit",
								targetId: event.messageEntryId,
								replacement: { content: [{ type: "text", text: "canonical edited answer" }] },
							},
							{
								type: "custom_message",
								customType: "next-work",
								content: "new boundary instruction",
								display: false,
							},
						],
						continue: true,
					};
				});
			},
		],
	});
	try {
		let request: string[] = [];
		harness.setResponses([
			fauxAssistantMessage("original answer"),
			(context) => {
				request = context.messages.filter((message) => message.role !== "system").map(getMessageText);
				return fauxAssistantMessage("answered boundary instruction");
			},
		]);
		await harness.session.prompt("question");
		expect(request).toEqual(["question", "canonical edited answer", "new boundary instruction"]);
		expect(harness.session.getLastAssistantText()).toBe("answered boundary instruction");
	} finally {
		harness.cleanup();
	}
});

it("preserves an explicit direct-Agent prefix even when it equals earlier transcript text", async () => {
	const harness = await createHarness({
		fauxApi: "openai-completions",
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		harness.setResponses([fauxAssistantMessage("same prefix")]);
		await harness.session.prompt("older question");
		const nextUser = { role: "user" as const, content: "current question", timestamp: 2 };
		harness.sessionManager.appendMessage(nextUser);
		harness.session.refreshContext();
		let request: string[] = [];
		let prefill: boolean | undefined;
		harness.setResponses([
			(context, options) => {
				request = context.messages.filter((message) => message.role !== "system").map(getMessageText);
				prefill = options?.returnPrefill;
				return fauxAssistantMessage("same prefix completed");
			},
		]);
		await harness.session.agent.continue(fauxAssistantMessage("same prefix"));
		expect(prefill).toBe(true);
		expect(request).toEqual(["older question", "same prefix", "current question", "same prefix"]);
		expect(harness.session.getLastAssistantText()).toBe("same prefix completed");
	} finally {
		harness.cleanup();
	}
});

it("sends a post-tool assistant replacement once without guessing that its copy is a prefix", async () => {
	const harness = await createHarness({
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
		tools: [
			{
				name: "noop",
				label: "Noop",
				description: "Noop",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
			},
		],
		extensionFactories: [
			(pi) => {
				pi.on("turn_end", (event): BoundaryResult | undefined => {
					if (event.toolResultEntryIds.length === 0) return;
					return {
						entries: [
							{
								type: "context_edit",
								targetId: event.messageEntryId,
								replacement: { content: [{ type: "text", text: "replacement assistant" }] },
							},
							...event.toolResultEntryIds.map((targetId) => ({
								type: "context_edit" as const,
								targetId,
								replacement: null,
							})),
						],
					};
				});
			},
		],
	});
	try {
		let request: string[] = [];
		let prefill: boolean | undefined;
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("noop", {}), { stopReason: "toolUse" }),
			(context, options) => {
				request = context.messages.filter((message) => message.role !== "system").map(getMessageText);
				prefill = options?.returnPrefill;
				return fauxAssistantMessage("normal next answer");
			},
		]);
		await harness.session.prompt("ordinary tool request");
		expect(request).toEqual(["ordinary tool request", "replacement assistant"]);
		expect(prefill).not.toBe(true);
		expect(harness.session.getLastAssistantText()).toBe("normal next answer");
	} finally {
		harness.cleanup();
	}
});
