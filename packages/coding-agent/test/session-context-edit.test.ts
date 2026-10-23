import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_COMPACTION_SETTINGS,
	estimateProjectedContextTokens,
	estimateTokens,
	prepareCompaction,
} from "../src/core/compaction/index.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { getUsageTotals } from "../src/core/usage-totals.ts";

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "faux",
		provider: "faux",
		model: "faux",
		usage: {
			input: 10,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 11,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function text(message: { content: string | Array<{ type: string; text?: string }> }): string {
	return typeof message.content === "string"
		? message.content
		: message.content.flatMap((part) => (part.type === "text" ? [part.text ?? ""] : [])).join("");
}

describe("session context edits", () => {
	it("omits a target only from model projection", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "request", timestamp: Date.now() });
		const assistantId = session.appendMessage(assistant("partial"));
		const result: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "raw output" }],
			details: { path: "large.txt" },
			isError: true,
			timestamp: Date.now(),
		};
		const resultId = session.appendMessage(result);
		session.appendContextEdit(assistantId, null);
		session.appendContextEdit(resultId, null);

		expect(session.getBranch().filter((entry) => entry.type === "message")).toHaveLength(3);
		expect(session.buildSessionProjection().messages.map((message) => message.role)).toEqual(["user"]);
		expect((session.getEntry(resultId) as { message: ToolResultMessage }).message).toBe(result);
	});

	it("replaces only content and lets the latest edit win", () => {
		const session = SessionManager.inMemory();
		const targetId = session.appendMessage(assistant("original"));
		session.appendContextEdit(targetId, { content: [{ type: "text", text: "first" }] });
		session.appendContextEdit(targetId, null);
		session.appendContextEdit(targetId, { content: [{ type: "text", text: "restored" }] });

		const projected = session.buildSessionProjection().messages[0];
		expect(projected.role).toBe("assistant");
		if (projected.role !== "assistant") throw new Error("expected assistant");
		expect(text(projected)).toBe("restored");
		expect(projected.usage.totalTokens).toBe(11);
		expect(text((session.getEntry(targetId) as { message: AssistantMessage }).message)).toBe("original");
	});

	it("normalizes string replacements for array-only assistant and tool-result roles", () => {
		const session = SessionManager.inMemory();
		const assistantId = session.appendMessage(assistant("original"));
		const resultId = session.appendMessage({
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "original result" }],
			isError: false,
			timestamp: Date.now(),
		});
		const assistantEditId = session.appendContextEdit(assistantId, { content: "assistant replacement" });
		const resultEditId = session.appendContextEdit(resultId, { content: "result replacement" });

		expect(session.getEntry(assistantEditId)).toMatchObject({
			replacement: { content: [{ type: "text", text: "assistant replacement" }] },
		});
		expect(session.getEntry(resultEditId)).toMatchObject({
			replacement: { content: [{ type: "text", text: "result replacement" }] },
		});
		const projected = session.buildSessionProjection().messages;
		expect(projected[0]).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "assistant replacement" }],
		});
		expect(projected[1]).toMatchObject({
			role: "toolResult",
			content: [{ type: "text", text: "result replacement" }],
		});
	});

	it("normalizes imported string replacements while projecting array-only roles", () => {
		const session = SessionManager.inMemory();
		const assistantId = session.appendMessage(assistant("original"));
		const editId = session.appendContextEdit(assistantId, null);
		const edit = session.getEntry(editId);
		if (edit?.type !== "context_edit") throw new Error("expected context edit");
		edit.replacement = { content: "imported replacement" };

		expect(session.buildSessionProjection().messages[0]).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "imported replacement" }],
		});
	});

	it("keeps edits branch-relative", () => {
		const session = SessionManager.inMemory();
		const targetId = session.appendMessage({ role: "user", content: "original", timestamp: Date.now() });
		session.appendContextEdit(targetId, { content: "edited" });
		expect(text(session.buildSessionProjection().messages[0] as { content: string })).toBe("edited");

		session.branch(targetId);
		expect(text(session.buildSessionProjection().messages[0] as { content: string })).toBe("original");
	});

	it("uses a self-referencing compaction to retain no preceding entries", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "discarded", timestamp: Date.now() });
		const compactionId = session.appendCompaction("exact handoff", null, 100);
		session.appendMessage({ role: "user", content: "after", timestamp: Date.now() });

		const compaction = session.getEntry(compactionId);
		expect(compaction).toMatchObject({ type: "compaction", firstKeptEntryId: compactionId });
		expect(session.buildSessionProjection().messages.map((message) => message.role)).toEqual([
			"compactionSummary",
			"user",
		]);
		expect(
			session
				.buildSessionProjection()
				.messages.map((message) => ("summary" in message ? message.summary : text(message as { content: string }))),
		).toEqual(["exact handoff", "after"]);
	});

	it("applies post-compaction edits to retained pre-compaction entries", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "summarized", timestamp: Date.now() });
		const retainedId = session.appendMessage({ role: "user", content: "original retained", timestamp: Date.now() });
		session.appendCompaction("summary", retainedId, 100);
		session.appendContextEdit(retainedId, { content: "edited retained" });

		expect(
			session
				.buildSessionProjection()
				.messages.map((message) => ("summary" in message ? message.summary : text(message as { content: string }))),
		).toEqual(["summary", "edited retained"]);
	});

	it("uses only the newest summary when a repeated compaction retains entries before the older compaction", async () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "summarized first", timestamp: Date.now() });
		const retainedId = session.appendMessage({ role: "user", content: "retained", timestamp: Date.now() });
		session.appendCompaction("first summary", retainedId, 100);
		session.appendMessage(assistant("after first compaction"));
		session.appendCompaction("second summary", retainedId, 80);
		session.appendMessage({ role: "user", content: "new tail ".repeat(100), timestamp: Date.now() });

		// Crystal keeps all visible summaries by default; a test wanting only the
		// newest must set summaryBlockMaxTokens to 0.
		const summaries = session
			.buildSessionProjection({ summaryBlockMaxTokens: 0 })
			.messages.flatMap((message) => ("summary" in message ? [message.summary] : []));
		expect(summaries).toEqual(["second summary"]);
		const preparation = await prepareCompaction(session.getBranch(), {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});
		expect(preparation?.previousSummary).toBe("second summary");
	});

	it("supports repeated retain-none compactions", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "discarded", timestamp: Date.now() });
		session.appendCompaction("first handoff", null, 100);
		session.appendMessage({ role: "user", content: "also discarded", timestamp: Date.now() });
		const secondId = session.appendCompaction("second handoff", null, 50);

		expect(session.getEntry(secondId)).toMatchObject({ firstKeptEntryId: secondId });
		// Crystal keeps all visible summaries by default; a test wanting only the
		// newest must set summaryBlockMaxTokens to 0.
		expect(
			session
				.buildSessionProjection({ summaryBlockMaxTokens: 0 })
				.messages.map((message) => ("summary" in message ? message.summary : "")),
		).toEqual(["second handoff"]);
	});

	it("does not trust pre-edit assistant usage for projected context estimates", () => {
		const session = SessionManager.inMemory();
		const largeUserId = session.appendMessage({
			role: "user",
			content: "discarded input ".repeat(2_000),
			timestamp: Date.now(),
		});
		const response = assistant("small answer");
		response.usage = { ...response.usage, input: 10_000, totalTokens: 10_001 };
		const assistantId = session.appendMessage(response);
		session.appendContextEdit(largeUserId, null);

		const editedEstimate = estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch());
		expect(editedEstimate.usageTokens).toBe(0);
		expect(editedEstimate.tokens).toBeLessThan(100);

		session.appendContextEdit(assistantId, null);
		expect(estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch()).tokens).toBe(0);
	});

	it("uses assistant usage captured after the latest context edit", () => {
		const session = SessionManager.inMemory();
		const userId = session.appendMessage({ role: "user", content: "original", timestamp: Date.now() });
		session.appendContextEdit(userId, { content: "edited" });
		const response = assistant("answer");
		response.usage = { ...response.usage, input: 4_000, output: 100, totalTokens: 4_100 };
		session.appendMessage(response);
		session.appendMessage({ role: "user", content: "next", timestamp: Date.now() });

		const estimate = estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch());
		expect(estimate.usageTokens).toBe(4_100);
		expect(estimate.trailingTokens).toBe(1);
		expect(estimate.tokens).toBe(4_101);
	});

	it("does not reuse post-edit assistant usage after a later compaction", () => {
		const session = SessionManager.inMemory();
		const userId = session.appendMessage({ role: "user", content: "small input", timestamp: Date.now() });
		session.appendContextEdit(userId, { content: "edited input" });
		const response = assistant("answer");
		response.usage = { ...response.usage, input: 50_000, output: 1, totalTokens: 50_001 };
		session.appendMessage(response);
		session.appendCompaction("small summary", userId, 50_001);

		const estimate = estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch());
		expect(estimate.usageTokens).toBe(0);
		expect(estimate.tokens).toBeLessThan(100);
	});

	it.each(["replace", "remove"] as const)(
		"does not treat %s tail-clone usage as a fresh context measurement",
		(operation) => {
			const session = SessionManager.inMemory();
			const userId = session.appendMessage({ role: "user", content: "large input ".repeat(2_000), timestamp: 1 });
			const response = assistant("small answer");
			response.usage = { ...response.usage, input: 50_000, output: 1, totalTokens: 50_001 };
			const originalId = session.appendMessage(response);
			const charges = getUsageTotals(session.getEntries());
			if (operation === "replace") {
				session.replaceMessages([
					{ entryId: userId, message: { role: "user", content: "small input", timestamp: 1 } },
				]);
			} else {
				session.removeMessage(userId);
			}
			const projected = session.buildSessionProjection();
			const clone = projected.entries.find(
				(entry) => entry.sourceEntry.type === "message" && entry.sourceEntry.message.role === "assistant",
			);
			expect(clone?.sourceEntry.id).not.toBe(originalId);
			expect(clone?.sourceEntry.usageSourceId).toBe(originalId);
			const localTokens = projected.messages.reduce((total, message) => total + estimateTokens(message), 0);
			expect(estimateProjectedContextTokens(projected, session.getBranch())).toEqual({
				tokens: localTokens,
				usageTokens: 0,
				trailingTokens: localTokens,
				lastUsageIndex: null,
			});
			expect(getUsageTotals(session.getEntries())).toEqual(charges);
			expect(response.usage.totalTokens).toBe(50_001);
		},
	);

	it("trusts independently generated alternatives and fresh responses after cloned history", () => {
		const session = SessionManager.inMemory();
		const userId = session.appendMessage({ role: "user", content: "question", timestamp: 1 });
		const originalId = session.appendMessage(assistant("original answer"));
		session.branch(userId);
		const alternative = assistant("independent alternative");
		alternative.usage = { ...alternative.usage, input: 4_000, output: 100, totalTokens: 4_100 };
		const alternativeId = session.appendMessage(alternative);
		expect(alternativeId).not.toBe(originalId);
		expect(session.getEntry(alternativeId)?.usageSourceId).toBeUndefined();
		expect(estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch()).usageTokens).toBe(
			4_100,
		);
		session.replaceMessages([
			{ entryId: userId, message: { role: "user", content: "edited question", timestamp: 1 } },
		]);
		session.appendMessage({ role: "user", content: "follow-up after edit", timestamp: 2 });
		const fresh = assistant("fresh response");
		fresh.usage = { ...fresh.usage, input: 2_000, output: 50, totalTokens: 2_050 };
		const freshId = session.appendMessage(fresh);
		expect(session.getEntry(freshId)?.usageSourceId).toBeUndefined();
		expect(estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch()).usageTokens).toBe(
			2_050,
		);
	});

	it("includes effective system and tool context in edited estimates", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({
			role: "system",
			content: "system prompt ".repeat(3_000),
			toolsAdded: [
				{
					name: "example",
					description: "tool declaration ".repeat(100),
					parameters: { type: "object", properties: {} },
				},
			],
			timestamp: Date.now(),
		});
		const userId = session.appendMessage({ role: "user", content: "ask", timestamp: Date.now() });
		session.appendMessage(assistant("done"));
		session.appendContextEdit(userId, { content: "ask" });

		expect(
			estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch()).tokens,
		).toBeGreaterThan(10_000);
	});

	it("does not advance past a boundary replacement of the candidate input", async () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "old request", timestamp: Date.now() });
		session.appendMessage(assistant("old answer"));
		const replacedUserId = session.appendMessage({
			role: "user",
			content: "original input",
			timestamp: Date.now(),
		});
		const assistantId = session.appendMessage(assistant("answered original input"));
		session.appendContextEdit(replacedUserId, { content: "NEW-INSTRUCTION ".repeat(100) });
		session.appendContextEdit(assistantId, null);
		session.appendCustomEntry("bookkeeping", { source: "test" });

		const preparation = await prepareCompaction(session.getBranch(), {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});
		expect(preparation?.firstKeptEntryId).toBe(replacedUserId);
		expect(JSON.stringify(preparation?.messagesToSummarize)).not.toContain("NEW-INSTRUCTION");
		expect(JSON.stringify(preparation?.turnPrefixMessages)).not.toContain("NEW-INSTRUCTION");
	});

	it("does not let metadata move the cut past unsent boundary input", async () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "old request", timestamp: Date.now() });
		session.appendMessage(assistant("old answer"));
		const instructionId = session.appendCustomMessageEntry("next-work", "UNSENT-INSTRUCTION ".repeat(100), false);
		session.appendCustomEntry("bookkeeping", { source: "test" });

		const preparation = await prepareCompaction(session.getBranch(), {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});
		expect(preparation?.firstKeptEntryId).toBe(instructionId);
		expect(JSON.stringify(preparation?.messagesToSummarize)).not.toContain("UNSENT-INSTRUCTION");
		expect(JSON.stringify(preparation?.turnPrefixMessages)).not.toContain("UNSENT-INSTRUCTION");
	});

	it("does not treat an omitted custom message as a recovery attempt", async () => {
		const session = SessionManager.inMemory();
		session.appendMessage({
			role: "user",
			content: "unanswered input ".repeat(100),
			timestamp: Date.now(),
		});
		const customId = session.appendCustomMessageEntry("temporary", "temporary context", false);
		session.appendContextEdit(customId, null);

		const preparation = await prepareCompaction(session.getBranch(), {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});
		expect(preparation).toBeUndefined();
	});

	it("advances past input for an omitted assistant recovery suffix with metadata", async () => {
		const session = SessionManager.inMemory();
		const userId = session.appendMessage({
			role: "user",
			content: "recovery input ".repeat(100),
			timestamp: Date.now(),
		});
		const attemptId = session.appendMessage(assistant("failed attempt"));
		session.appendContextEdit(attemptId, null);
		session.appendCustomEntry("bookkeeping", { source: "test" });

		const preparation = await prepareCompaction(session.getBranch(), {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});
		expect(preparation?.firstKeptEntryId).toBe(attemptId);
		expect(preparation?.turnPrefixMessages).toEqual([
			expect.objectContaining({ role: "user", content: expect.stringContaining("recovery input") }),
		]);
		expect(preparation?.messagesToSummarize).not.toContainEqual(
			expect.objectContaining({ role: "user", content: expect.stringContaining("recovery input") }),
		);
		expect(userId).not.toBe(attemptId);
	});

	it("prepares compaction from edited model content", async () => {
		const session = SessionManager.inMemory();
		const omittedId = session.appendMessage({ role: "user", content: "OMIT-ME ".repeat(100), timestamp: Date.now() });
		session.appendMessage(assistant("old answer ".repeat(100)));
		session.appendContextEdit(omittedId, null);
		session.appendMessage({ role: "user", content: "keep", timestamp: Date.now() });
		session.appendMessage(assistant("suffix"));

		const preparation = await prepareCompaction(session.getBranch(), {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});
		expect(preparation).toBeDefined();
		expect(JSON.stringify(preparation?.messagesToSummarize)).not.toContain("OMIT-ME");
		expect(JSON.stringify(preparation?.turnPrefixMessages)).not.toContain("OMIT-ME");
	});

	it.each(["arguments", "name", "removed"] as const)(
		"drops only current-turn results invalidated by changed call %s",
		(change) => {
			const session = SessionManager.inMemory();
			session.appendMessage({ role: "user", content: "question", timestamp: 1 });
			const original = {
				...assistant(""),
				content: [{ type: "toolCall" as const, id: "reused", name: "read", arguments: { path: "old" } }],
			};
			const source = session.appendMessage(original);
			session.appendMessage({ role: "system", content: "transparent delta", timestamp: 2 });
			const stale = session.appendMessage({
				role: "toolResult",
				toolCallId: "reused",
				toolName: "read",
				content: [{ type: "text", text: "STALE" }],
				isError: false,
				timestamp: 3,
			});
			session.appendContextEdit(stale, { content: "STALE EDIT" });
			session.appendMessage({
				...assistant(""),
				content: [{ type: "toolCall", id: "reused", name: "read", arguments: { path: "later" } }],
			});
			session.appendMessage({
				role: "toolResult",
				toolCallId: "reused",
				toolName: "read",
				content: [{ type: "text", text: "later result" }],
				isError: false,
				timestamp: 4,
			});
			const replacement = {
				...original,
				content:
					change === "removed"
						? []
						: [
								{
									...original.content[0],
									...(change === "arguments" ? { arguments: { path: "new" } } : { name: "write" }),
								},
							],
			};
			session.replaceMessages([{ entryId: source, message: replacement }]);
			expect(
				session
					.buildSessionProjection()
					.messages.filter((message) => message.role === "toolResult")
					.map(text),
			).toEqual(["later result"]);
			expect(session.getEntry(stale)).toBeDefined();
			expect(session.getBranch().some((entry) => entry.type === "context_edit")).toBe(false);
		},
	);

	it("keeps results for structurally unchanged calls after an explicit replacement", () => {
		const session = SessionManager.inMemory();
		const original = {
			...assistant(""),
			content: [
				{
					type: "toolCall" as const,
					id: "call",
					name: "read",
					arguments: { path: "old", options: { a: 1, b: 2 } },
				},
			],
		};
		const source = session.appendMessage(original);
		session.appendMessage({
			role: "toolResult",
			toolCallId: "call",
			toolName: "read",
			content: [{ type: "text", text: "valid" }],
			isError: false,
			timestamp: 2,
		});
		session.appendContextEdit(source, { content: "obsolete projected edit" });
		session.replaceMessages([
			{
				entryId: source,
				message: {
					...original,
					content: [{ ...original.content[0], arguments: { options: { b: 2, a: 1 }, path: "old" } }],
				},
			},
		]);
		expect(
			session
				.buildSessionProjection()
				.messages.filter((message) => message.role === "toolResult")
				.map(text),
		).toEqual(["valid"]);
		expect(session.buildSessionProjection().messages[0]).toMatchObject({
			role: "assistant",
			content: [expect.objectContaining({ type: "toolCall", id: "call" })],
		});
	});

	it.each([null, undefined])("replaces legacy assistant content %s without inventing calls", (content) => {
		const session = SessionManager.inMemory();
		const source = session.appendMessage({ ...assistant(""), content } as unknown as AssistantMessage);
		const replacement = assistant("repaired");
		session.replaceMessages([{ entryId: source, message: replacement }]);
		expect(session.buildSessionProjection().messages).toEqual([replacement]);
	});

	it("moves invalidated boundaries past soft-deleted followers without reviving summarized history", () => {
		const session = SessionManager.inMemory();
		session.appendMessage({ role: "user", content: "summarized user", timestamp: 1 });
		const original = {
			...assistant(""),
			content: [{ type: "toolCall" as const, id: "call", name: "read", arguments: {} }],
		};
		const source = session.appendMessage(original);
		const stale = session.appendMessage({
			role: "toolResult",
			toolCallId: "call",
			toolName: "read",
			content: [{ type: "text", text: "stale" }],
			isError: false,
			timestamp: 2,
		});
		const hidden = session.appendMessage({ role: "user", content: "hidden", timestamp: 3 });
		session.appendMessage({ role: "user", content: "visible follower", timestamp: 4 });
		session.softDeleteUnits([{ entryId: hidden }]);
		session.appendCompaction("summary", stale, 100);
		session.replaceMessages([{ entryId: source, message: { ...original, content: [] } }]);
		expect(session.buildSessionProjection().messages).toEqual([
			expect.objectContaining({ role: "compactionSummary", summary: "summary" }),
			expect.objectContaining({ role: "user", content: "visible follower" }),
		]);
		const branch = session.getBranch();
		expect(branch.find((entry) => entry.type === "compaction")).toMatchObject({
			firstKeptEntryId: branch.find(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "user" &&
					entry.message.content === "visible follower",
			)?.id,
		});
	});
});
