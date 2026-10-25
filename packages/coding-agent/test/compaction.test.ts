import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai/compat";
import { getModel } from "@earendil-works/pi-ai/compat";
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type CompactionSettings,
	calculateContextTokens,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	findCutPoint,
	getLastAssistantUsage,
	prepareCompaction,
	shouldCompact,
	type TokenCounter,
} from "../src/core/compaction/index.ts";
import {
	buildSessionContext,
	type CompactionEntry,
	type CustomMessageEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionEntry,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "../src/core/session-manager.ts";

// ============================================================================
// Test fixtures
// ============================================================================

function loadLargeSessionEntries(): SessionEntry[] {
	const sessionPath = join(__dirname, "fixtures/large-session.jsonl");
	const content = readFileSync(sessionPath, "utf-8");
	const entries = parseSessionEntries(content);
	migrateSessionEntries(entries); // Add id/parentId for v1 fixtures
	return entries.filter((e): e is SessionEntry => e.type !== "session");
}

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createUserMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function createAssistantMessage(text: string, usage?: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		usage: usage || createMockUsage(100, 50),
		stopReason: "stop",
		timestamp: Date.now(),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	};
}

let entryCounter = 0;
let lastId: string | null = null;

function resetEntryCounter() {
	entryCounter = 0;
	lastId = null;
}

// Reset counter before each test to get predictable IDs
beforeEach(() => {
	resetEntryCounter();
});

function createMessageEntry(message: AgentMessage): SessionMessageEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: SessionMessageEntry = {
		type: "message",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		message,
	};
	lastId = id;
	return entry;
}

function createCompactionEntry(summary: string, firstKeptEntryId: string): CompactionEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: CompactionEntry = {
		type: "compaction",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		summary,
		firstKeptEntryId,
		tokensBefore: 10000,
	};
	lastId = id;
	return entry;
}

function createModelChangeEntry(provider: string, modelId: string): ModelChangeEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: ModelChangeEntry = {
		type: "model_change",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		provider,
		modelId,
	};
	lastId = id;
	return entry;
}

function createThinkingLevelEntry(thinkingLevel: string): ThinkingLevelChangeEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: ThinkingLevelChangeEntry = {
		type: "thinking_level_change",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		thinkingLevel,
	};
	lastId = id;
	return entry;
}

function createCustomMessageEntry(content: string): CustomMessageEntry {
	const id = `test-id-${entryCounter++}`;
	const entry: CustomMessageEntry = {
		type: "custom_message",
		id,
		parentId: lastId,
		timestamp: new Date().toISOString(),
		customType: "test",
		content,
		display: true,
	};
	lastId = id;
	return entry;
}

function extractText(messages: AgentMessage[]): string {
	return messages
		.map((message) => {
			switch (message.role) {
				case "user":
					return typeof message.content === "string"
						? message.content
						: message.content
								.filter((block): block is { type: "text"; text: string } => block.type === "text")
								.map((block) => block.text)
								.join(" ");
				case "assistant":
					return message.content
						.filter((block): block is { type: "text"; text: string } => block.type === "text")
						.map((block) => block.text)
						.join(" ");
				case "branchSummary":
				case "compactionSummary":
					return message.summary;
				case "custom":
				case "toolResult":
					return typeof message.content === "string"
						? message.content
						: message.content
								.filter((block): block is { type: "text"; text: string } => block.type === "text")
								.map((block) => block.text)
								.join(" ");
				case "bashExecution":
					return `${message.command}\n${message.output}`;
				default:
					return "";
			}
		})
		.join("\n");
}

// ============================================================================
// Unit tests
// ============================================================================

describe("Token calculation", () => {
	it("should calculate total context tokens from usage", () => {
		const usage = createMockUsage(1000, 500, 200, 100);
		expect(calculateContextTokens(usage)).toBe(1800);
	});

	it("should handle zero values", () => {
		const usage = createMockUsage(0, 0, 0, 0);
		expect(calculateContextTokens(usage)).toBe(0);
	});
});

describe("getLastAssistantUsage", () => {
	it("should find the last non-aborted assistant message usage", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Hello")),
			createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
			createMessageEntry(createUserMessage("How are you?")),
			createMessageEntry(createAssistantMessage("Good", createMockUsage(200, 100))),
		];

		const usage = getLastAssistantUsage(entries);
		expect(usage).not.toBeNull();
		expect(usage!.input).toBe(200);
	});

	it("should skip aborted messages", () => {
		const abortedMsg: AssistantMessage = {
			...createAssistantMessage("Aborted", createMockUsage(300, 150)),
			stopReason: "aborted",
		};

		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Hello")),
			createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
			createMessageEntry(createUserMessage("How are you?")),
			createMessageEntry(abortedMsg),
		];

		const usage = getLastAssistantUsage(entries);
		expect(usage).not.toBeNull();
		expect(usage!.input).toBe(100);
	});

	it("should skip all-zero assistant usage", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Hello")),
			createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
			createMessageEntry(createUserMessage("continue")),
			createMessageEntry(createAssistantMessage("Partial", createMockUsage(0, 0))),
		];

		const usage = getLastAssistantUsage(entries);
		expect(usage).not.toBeNull();
		expect(usage!.input).toBe(100);
	});

	it("should return undefined if no assistant messages", () => {
		const entries: SessionEntry[] = [createMessageEntry(createUserMessage("Hello"))];
		expect(getLastAssistantUsage(entries)).toBeUndefined();
	});
});

describe("estimateContextTokens", () => {
	it("uses the last non-zero assistant usage as the context anchor", () => {
		const messages: AgentMessage[] = [
			createUserMessage("Hello"),
			createAssistantMessage("Hi", createMockUsage(100, 50)),
			createUserMessage("continue"),
			createAssistantMessage("Partial thinking", createMockUsage(0, 0)),
		];

		const estimate = estimateContextTokens(messages);

		expect(estimate.usageTokens).toBe(150);
		expect(estimate.lastUsageIndex).toBe(1);
		expect(estimate.trailingTokens).toBeGreaterThan(0);
		expect(estimate.tokens).toBe(150 + estimate.trailingTokens);
	});
});

describe("shouldCompact", () => {
	it("should return true when context exceeds threshold", () => {
		const settings: CompactionSettings = {
			enabled: true,
			reserveTokens: 10000,
			keepRecentTokens: 20000,
			summaryBlockMaxTokens: 10000,
		};

		expect(shouldCompact(95000, 100000, settings)).toBe(true);
		expect(shouldCompact(89000, 100000, settings)).toBe(false);
	});

	it("should return false when disabled", () => {
		const settings: CompactionSettings = {
			enabled: false,
			reserveTokens: 10000,
			keepRecentTokens: 20000,
			summaryBlockMaxTokens: 10000,
		};

		expect(shouldCompact(95000, 100000, settings)).toBe(false);
	});
});

describe("findCutPoint", () => {
	it.each(["raw", "projected"] as const)("consumes bounded %s counts in newest-first order", async (mode) => {
		const entries = Array.from({ length: 12 }, (_, index) => createMessageEntry(createUserMessage(String(index))));
		const pending = new Map<string, (tokens: number) => void>();
		const issued: string[] = [];
		let released = false;
		const counter: TokenCounter = (messages) => {
			const message = messages[0];
			if (message.role !== "user" || typeof message.content !== "string") throw new Error("Expected user entry");
			issued.push(message.content);
			if (released) return Promise.resolve(1);
			const deferred = Promise.withResolvers<number>();
			pending.set(message.content, deferred.resolve);
			return deferred.promise;
		};
		const running =
			mode === "raw"
				? findCutPoint(entries, 0, entries.length, 5, 6, counter).then((cut) => entries[cut.firstKeptEntryIndex].id)
				: prepareCompaction(
						entries,
						DEFAULT_COMPACTION_SETTINGS,
						{ keepRecentTokens: 5, keepRecentMessages: 6 },
						counter,
					).then((preparation) => preparation?.firstKeptEntryId);
		try {
			for (let tick = 0; tick < 8; tick++) await Promise.resolve();
			expect(issued).toEqual(["11", "10", "9", "8"]);
			pending.get("8")?.(1);
			pending.get("9")?.(8);
			pending.get("10")?.(3);
			pending.get("11")?.(2);
			expect(await running).toBe(entries[10].id);
			expect(issued).toEqual(["11", "10", "9", "8"]);
		} finally {
			released = true;
			for (const resolve of pending.values()) resolve(1);
			await running;
		}
	});

	it("cancels only speculative batch work after a known cutoff", async () => {
		const entries = Array.from({ length: 8 }, (_, index) => createMessageEntry(createUserMessage(String(index))));
		const parent = new AbortController();
		const signals: AbortSignal[] = [];
		const pending = new Map<string, (tokens: number) => void>();
		let released = false;
		const counter: TokenCounter = (messages, signal) => {
			const message = messages[0];
			if (message.role !== "user" || typeof message.content !== "string") throw new Error("Expected user entry");
			if (signal) signals.push(signal);
			if (released) return Promise.resolve(1);
			const deferred = Promise.withResolvers<number>();
			pending.set(message.content, deferred.resolve);
			signal?.addEventListener("abort", () => deferred.reject(new Error("Speculation cancelled")), { once: true });
			return deferred.promise;
		};
		const running = findCutPoint(entries, 0, entries.length, 1, undefined, counter);
		try {
			for (let tick = 0; tick < 8; tick++) await Promise.resolve();
			expect([...pending.keys()]).toEqual(["7", "6", "5", "4"]);
			pending.get("7")?.(2);
			expect(await running).toEqual({ firstKeptEntryIndex: 7, turnStartIndex: -1, isSplitTurn: false });
			expect(signals).toHaveLength(4);
			expect(signals.every((signal) => signal.aborted)).toBe(true);
			expect(parent.signal.aborted).toBe(false);
		} finally {
			released = true;
			for (const resolve of pending.values()) resolve(1);
			await running;
		}
	});

	it("starts another bounded batch only when the newest batch fits", async () => {
		const entries = Array.from({ length: 10 }, (_, index) => createMessageEntry(createUserMessage(String(index))));
		const issued: string[] = [];
		const cut = await findCutPoint(entries, 0, entries.length, 6, undefined, async (messages) => {
			const message = messages[0];
			if (message.role !== "user" || typeof message.content !== "string") throw new Error("Expected user entry");
			issued.push(message.content);
			return 1;
		});
		expect(cut.firstKeptEntryIndex).toBe(4);
		expect(issued).toEqual(["9", "8", "7", "6", "5", "4", "3", "2"]);
	});

	it.each(["before-cutoff", "after-cutoff"] as const)(
		"handles speculative rejection %s in transcript order",
		async (failure) => {
			const entries = Array.from({ length: 8 }, (_, index) => createMessageEntry(createUserMessage(String(index))));
			const newest = Promise.withResolvers<number>();
			const failureError = new Error("count failure");
			const signals: AbortSignal[] = [];
			const counter: TokenCounter = (messages, signal) => {
				const message = messages[0];
				if (message.role !== "user" || typeof message.content !== "string") throw new Error("Expected user entry");
				if (signal) signals.push(signal);
				return message.content === "7" ? newest.promise : Promise.reject(failureError);
			};
			const running = findCutPoint(entries, 0, entries.length, 1, undefined, counter);
			const outcome = running.then(
				(cut) => ({ cut }),
				(error: unknown) => ({ error }),
			);
			for (let tick = 0; tick < 8; tick++) await Promise.resolve();
			newest.resolve(failure === "after-cutoff" ? 2 : 0);
			if (failure === "before-cutoff") expect(await outcome).toEqual({ error: failureError });
			else expect(await outcome).toMatchObject({ cut: { firstKeptEntryIndex: 7 } });
			expect(signals).toHaveLength(4);
			expect(signals.every((signal) => signal.aborted)).toBe(true);
		},
	);

	it("should find cut point based on actual token differences", async () => {
		// Create entries with cumulative token counts
		const entries: SessionEntry[] = [];
		for (let i = 0; i < 10; i++) {
			entries.push(createMessageEntry(createUserMessage(`User ${i}`)));
			entries.push(
				createMessageEntry(createAssistantMessage(`Assistant ${i}`, createMockUsage(0, 100, (i + 1) * 1000, 0))),
			);
		}

		// 20 entries, last assistant has 10000 tokens
		// keepRecentTokens = 2500: keep entries where diff < 2500
		const result = await findCutPoint(entries, 0, entries.length, 2500);

		// Should cut at a valid cut point (user or assistant message)
		expect(entries[result.firstKeptEntryIndex].type).toBe("message");
		const role = (entries[result.firstKeptEntryIndex] as SessionMessageEntry).message.role;
		expect(role === "user" || role === "assistant").toBe(true);
	});

	it("should return startIndex if no valid cut points in range", async () => {
		const entries: SessionEntry[] = [createMessageEntry(createAssistantMessage("a"))];
		const result = await findCutPoint(entries, 0, entries.length, 1000);
		expect(result.firstKeptEntryIndex).toBe(0);
	});

	it("should keep everything if all messages fit within budget", async () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a", createMockUsage(0, 50, 500, 0))),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b", createMockUsage(0, 50, 1000, 0))),
		];

		const result = await findCutPoint(entries, 0, entries.length, 50000);
		expect(result.firstKeptEntryIndex).toBe(0);
	});

	it("should indicate split turn when cutting at assistant message", async () => {
		// Create a scenario where we cut at an assistant message mid-turn
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Turn 1")),
			createMessageEntry(createAssistantMessage("A1", createMockUsage(0, 100, 1000, 0))),
			createMessageEntry(createUserMessage("Turn 2")), // index 2
			createMessageEntry(createAssistantMessage("A2-1", createMockUsage(0, 100, 5000, 0))), // index 3
			createMessageEntry(createAssistantMessage("A2-2", createMockUsage(0, 100, 8000, 0))), // index 4
			createMessageEntry(createAssistantMessage("A2-3", createMockUsage(0, 100, 10000, 0))), // index 5
		];

		// With keepRecentTokens = 3000, should cut somewhere in Turn 2
		const result = await findCutPoint(entries, 0, entries.length, 3000);

		// If cut at assistant message (not user), should indicate split turn
		const cutEntry = entries[result.firstKeptEntryIndex] as SessionMessageEntry;
		if (cutEntry.message.role === "assistant") {
			expect(result.isSplitTurn).toBe(true);
			expect(result.turnStartIndex).toBe(2); // Turn 2 starts at index 2
		}
	});

	it("should budget context-visible custom message entries", async () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("hi")),
			createMessageEntry(createAssistantMessage("hello")),
			createCustomMessageEntry("x".repeat(4000)),
			createMessageEntry(createAssistantMessage("ok")),
		];

		const tinyBudget = await findCutPoint(entries, 0, entries.length, 1);
		expect(tinyBudget.firstKeptEntryIndex).toBe(3);
		expect(tinyBudget.isSplitTurn).toBe(true);
		expect(tinyBudget.turnStartIndex).toBe(2);

		const customFitsBudget = await findCutPoint(entries, 0, entries.length, 2);
		expect(customFitsBudget.firstKeptEntryIndex).toBe(3);
		expect(customFitsBudget.isSplitTurn).toBe(true);
		expect(customFitsBudget.turnStartIndex).toBe(2);
	});

	it("should keep the last N messages when keepRecentMessages is set", async () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a")),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b")),
			createMessageEntry(createUserMessage("3")),
			createMessageEntry(createAssistantMessage("c")),
		];

		const result = await findCutPoint(entries, 0, entries.length, 20000, 3);
		expect(result.firstKeptEntryIndex).toBe(3);
	});

	it("keeps the smaller window when both message count and token limit are given (shortest wins)", async () => {
		// 6 tiny messages (~1 estimated token each).
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a", createMockUsage(0, 0, 100, 0))),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b", createMockUsage(0, 0, 100, 0))),
			createMessageEntry(createUserMessage("3")),
			createMessageEntry(createAssistantMessage("c", createMockUsage(0, 0, 100, 0))),
		];

		// keepRecentMessages=4 -> keep last 4 (cut at index 2)
		expect((await findCutPoint(entries, 0, entries.length, undefined, 4)).firstKeptEntryIndex).toBe(2);
		// keepRecentTokens=2 -> keep ~last 2 (cut at index 4)
		expect((await findCutPoint(entries, 0, entries.length, 2, undefined)).firstKeptEntryIndex).toBe(4);
		// both: the token limit keeps fewer messages, so it wins (larger index)
		expect((await findCutPoint(entries, 0, entries.length, 2, 4)).firstKeptEntryIndex).toBe(4);
	});

	it.each([
		{ mode: "raw", tokens: 0, messages: undefined },
		{ mode: "projected", tokens: 0, messages: undefined },
		{ mode: "raw", tokens: 0, messages: 3 },
		{ mode: "projected", tokens: 0, messages: 3 },
		{ mode: "raw", tokens: 0, messages: 0 },
		{ mode: "projected", tokens: 0, messages: 0 },
		{ mode: "raw", tokens: undefined, messages: 0 },
		{ mode: "projected", tokens: undefined, messages: 0 },
	])("keeps newest atomic group without counting: $mode/$tokens/$messages", async ({ mode, tokens, messages }) => {
		const old = createMessageEntry(createUserMessage("old"));
		const user = createMessageEntry(createUserMessage("current"));
		const call = createMessageEntry({
			...createAssistantMessage(""),
			content: [{ type: "toolCall", id: "zero-call", name: "read", arguments: { path: "file" } }],
			stopReason: "toolUse",
		});
		const result = createMessageEntry({
			role: "toolResult",
			toolCallId: "zero-call",
			toolName: "read",
			content: [{ type: "text", text: "result" }],
			isError: false,
			timestamp: 1,
		});
		const entries = [old, user, call, result];
		const counter: TokenCounter = async () => {
			throw new Error("Zero retention must not count preparation tokens");
		};
		if (mode === "raw") {
			expect(await findCutPoint(entries, 0, entries.length, tokens, messages, counter)).toEqual({
				firstKeptEntryIndex: 2,
				turnStartIndex: 1,
				isSplitTurn: true,
			});
		} else {
			const preparation = await prepareCompaction(
				entries,
				DEFAULT_COMPACTION_SETTINGS,
				{ keepRecentTokens: tokens, keepRecentMessages: messages },
				counter,
			);
			expect(preparation?.firstKeptEntryId).toBe(call.id);
			expect(preparation?.messagesToSummarize).toEqual([old.message]);
			expect(preparation?.turnPrefixMessages).toEqual([user.message]);
		}
	});

	it("counts empty conversation contributions, not prompt deltas, in message budgets", async () => {
		const entries = [
			createMessageEntry(createUserMessage("old")),
			createMessageEntry(createUserMessage("")),
			createMessageEntry({ role: "system", content: "large prompt".repeat(100), timestamp: 1 }),
			createMessageEntry(createAssistantMessage("")),
		];
		expect((await findCutPoint(entries, 0, entries.length, undefined, 2)).firstKeptEntryIndex).toBe(1);
		const preparation = await prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS, { keepRecentMessages: 2 });
		expect(preparation?.firstKeptEntryId).toBe(entries[1].id);
		expect(preparation?.messagesToSummarize).toEqual([entries[0].message]);
	});

	it("stops token counting at the message cutoff and uses a stricter token cutoff", async () => {
		const entries = ["older", "boundary", "newer", "newest"].map((text) =>
			createMessageEntry(createUserMessage(text)),
		);
		for (const tokens of [100, 1]) {
			const counted: AgentMessage[][] = [];
			const counter = async (messages: AgentMessage[]) => {
				counted.push(messages);
				if (messages[0] === entries[0].message) throw new Error("history outside message budget counted");
				return 1;
			};
			const expected = tokens === 1 ? 3 : 2;
			expect((await findCutPoint(entries, 0, entries.length, tokens, 2, counter)).firstKeptEntryIndex).toBe(
				expected,
			);
			expect(counted).toEqual([[entries[3].message], [entries[2].message]]);
			counted.length = 0;
			const preparation = await prepareCompaction(
				entries,
				DEFAULT_COMPACTION_SETTINGS,
				{ keepRecentTokens: tokens, keepRecentMessages: 2 },
				counter,
			);
			expect(preparation?.firstKeptEntryId).toBe(entries[expected].id);
			expect(counted).toEqual([[entries[3].message], [entries[2].message]]);
		}
	});

	// Regression test for #9740.
	it("should fall back to the latest valid cut point before oversized trailing tool results", async () => {
		const oldUser = createMessageEntry(createUserMessage("old history"));
		const oldAssistant = createMessageEntry(createAssistantMessage("old answer"));
		const currentUser = createMessageEntry(createUserMessage("read the large file"));
		const toolCall = createMessageEntry({
			...createAssistantMessage(""),
			content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "big.txt" } }],
			stopReason: "toolUse",
		});
		const toolResult = createMessageEntry({
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "read",
			content: [{ type: "text", text: "x".repeat(8000) }],
			isError: false,
			timestamp: Date.now(),
		});
		const entries = [oldUser, oldAssistant, currentUser, toolCall, toolResult];

		const result = await findCutPoint(entries, 0, entries.length, 1000);
		expect(result).toEqual({
			firstKeptEntryIndex: 3,
			turnStartIndex: 2,
			isSplitTurn: true,
		});

		const preparation = await prepareCompaction(entries, {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1000,
		});
		expect(preparation?.firstKeptEntryId).toBe(toolCall.id);
		expect(preparation?.messagesToSummarize).toEqual([oldUser.message, oldAssistant.message]);
		expect(preparation?.turnPrefixMessages).toEqual([currentUser.message]);
	});
});

describe("buildSessionContext", () => {
	it("should load all messages when no compaction", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a")),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b")),
		];

		const loaded = buildSessionContext(entries);
		expect(loaded.messages.length).toBe(4);
		expect(loaded.thinkingLevel).toBe("off");
		expect(loaded.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
	});

	it("should handle single compaction", () => {
		// IDs: u1=test-id-0, a1=test-id-1, u2=test-id-2, a2=test-id-3, compaction=test-id-4, u3=test-id-5, a3=test-id-6
		const u1 = createMessageEntry(createUserMessage("1"));
		const a1 = createMessageEntry(createAssistantMessage("a"));
		const u2 = createMessageEntry(createUserMessage("2"));
		const a2 = createMessageEntry(createAssistantMessage("b"));
		const compaction = createCompactionEntry("Summary of 1,a,2,b", u2.id); // keep from u2 onwards
		const u3 = createMessageEntry(createUserMessage("3"));
		const a3 = createMessageEntry(createAssistantMessage("c"));

		const entries: SessionEntry[] = [u1, a1, u2, a2, compaction, u3, a3];

		const loaded = buildSessionContext(entries);
		// summary + kept (u2, a2) + after (u3, a3) = 5
		expect(loaded.messages.length).toBe(5);
		expect(loaded.messages[0].role).toBe("compactionSummary");
		expect((loaded.messages[0] as any).summary).toContain("Summary of 1,a,2,b");
	});

	it("should keep all summaries oldest-first across multiple compactions", () => {
		// First batch
		const u1 = createMessageEntry(createUserMessage("1"));
		const a1 = createMessageEntry(createAssistantMessage("a"));
		const compact1 = createCompactionEntry("First summary", u1.id);
		// Second batch
		const u2 = createMessageEntry(createUserMessage("2"));
		const b = createMessageEntry(createAssistantMessage("b"));
		const u3 = createMessageEntry(createUserMessage("3"));
		const c = createMessageEntry(createAssistantMessage("c"));
		const compact2 = createCompactionEntry("Second summary", u3.id); // keep from u3 onwards
		// After second compaction
		const u4 = createMessageEntry(createUserMessage("4"));
		const d = createMessageEntry(createAssistantMessage("d"));

		const entries: SessionEntry[] = [u1, a1, compact1, u2, b, u3, c, compact2, u4, d];

		const loaded = buildSessionContext(entries);
		// Both summaries, then the kept tail from u3 (u3, c, u4, d) = 6
		expect(loaded.messages.length).toBe(6);
		expect((loaded.messages[0] as any).summary).toContain("First summary");
		expect((loaded.messages[1] as any).summary).toContain("Second summary");
		expect((loaded.messages[2] as any).content).toBe("3");
	});

	it("should keep all messages when firstKeptEntryId is first entry", () => {
		const u1 = createMessageEntry(createUserMessage("1"));
		const a1 = createMessageEntry(createAssistantMessage("a"));
		const compact1 = createCompactionEntry("First summary", u1.id); // keep from first entry
		const u2 = createMessageEntry(createUserMessage("2"));
		const b = createMessageEntry(createAssistantMessage("b"));

		const entries: SessionEntry[] = [u1, a1, compact1, u2, b];

		const loaded = buildSessionContext(entries);
		// summary + all messages (u1, a1, u2, b) = 5
		expect(loaded.messages.length).toBe(5);
	});

	it("should track model and thinking level changes", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createModelChangeEntry("openai", "gpt-4"),
			createMessageEntry(createAssistantMessage("a")),
			createThinkingLevelEntry("high"),
		];

		const loaded = buildSessionContext(entries);
		// model_change is later overwritten by assistant message's model info
		expect(loaded.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-4-5" });
		expect(loaded.thinkingLevel).toBe("high");
	});
});

describe("prepareCompaction", () => {
	it("does not treat system messages as conversation history", async () => {
		const system = createMessageEntry({
			role: "system",
			content: "",
			sections: { preamble: "current prompt" },
			timestamp: Date.now(),
		});
		const user = createMessageEntry(createUserMessage("one long turn"));
		const assistant = createMessageEntry(createAssistantMessage("assistant suffix"));
		const preparation = await prepareCompaction([system, user, assistant], {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1,
		});

		expect(preparation).toBeDefined();
		expect(preparation?.firstKeptEntryId).toBe(assistant.id);
		expect(preparation?.isSplitTurn).toBe(true);
		expect(preparation?.messagesToSummarize).toEqual([system.message]);
		expect(preparation?.turnPrefixMessages).toEqual([user.message]);
	});
	it("excludes prompt deltas from token retention counts", async () => {
		const old = createMessageEntry(createUserMessage("old"));
		const patch = createMessageEntry({ role: "system", content: "large prompt".repeat(100), timestamp: 1 });
		const recent = createMessageEntry(createUserMessage("recent"));
		const entries = [old, patch, recent];
		const counted: AgentMessage[][] = [];
		const counter = async (messages: AgentMessage[]) => {
			counted.push(messages);
			return messages.some((message) => message.role === "system") ? 1000 : 1;
		};
		expect(
			await prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS, { keepRecentTokens: 2 }, counter),
		).toBeUndefined();
		expect(counted).toEqual([[recent.message], [old.message]]);
	});
});

describe("prepareCompaction with previous compaction", () => {
	it("should skip repeated compactions when kept messages still fit", async () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)"));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1"));
		const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1"));
		const a2 = createMessageEntry(createAssistantMessage("assistant msg 2"));
		const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1"));
		const a3 = createMessageEntry(createAssistantMessage("assistant msg 3", createMockUsage(5000, 1000)));
		const compaction1 = createCompactionEntry("First summary", u2.id);
		const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction1)"));
		const a4 = createMessageEntry(createAssistantMessage("assistant msg 4", createMockUsage(8000, 2000)));

		const pathEntries = [u1, a1, u2, a2, u3, a3, compaction1, u4, a4];
		const preparation = await prepareCompaction(pathEntries, DEFAULT_COMPACTION_SETTINGS);

		expect(preparation).toBeUndefined();
	});

	it("should re-summarize previously kept messages when the recent window moves past them", async () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)".repeat(4)));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1".repeat(4)));
		const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1 ".repeat(12)));
		const a2 = createMessageEntry(createAssistantMessage("assistant msg 2 ".repeat(12)));
		const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1 ".repeat(12)));
		const a3 = createMessageEntry(createAssistantMessage("assistant msg 3 ".repeat(12), createMockUsage(5000, 1000)));
		const compaction1 = createCompactionEntry("First summary", u2.id);
		const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction1) ".repeat(12)));
		const a4 = createMessageEntry(createAssistantMessage("assistant msg 4 ".repeat(12), createMockUsage(8000, 2000)));

		const settings: CompactionSettings = {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 100,
		};
		const preparation = await prepareCompaction([u1, a1, u2, a2, u3, a3, compaction1, u4, a4], settings);

		expect(preparation).toBeDefined();
		// The summarization request must carry exactly what the chat contains before
		// compaction: the previous summary message in its natural position at the head,
		// followed by the raw messages being cut. Anything less diverges from the
		// cached prefix right after the system prompt and wastes the provider cache.
		expect(preparation!.messagesToSummarize[0]).toMatchObject({
			role: "compactionSummary",
			summary: "First summary",
		});
		const summarizedText = extractText(preparation!.messagesToSummarize);
		expect(summarizedText).toContain("user msg 2 - kept by compaction1");
		expect(summarizedText).toContain("user msg 3 - kept by compaction1");
		expect(preparation!.previousSummary).toBe("First summary");
	});

	it("prepends the previous compaction summary to messagesToSummarize for cache fidelity", async () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)".repeat(4)));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1".repeat(4)));
		const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1 ".repeat(12)));
		const a2 = createMessageEntry(createAssistantMessage("assistant msg 2 ".repeat(12)));
		const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1 ".repeat(12)));
		const a3 = createMessageEntry(createAssistantMessage("assistant msg 3 ".repeat(12), createMockUsage(5000, 1000)));
		const compaction1 = createCompactionEntry("First summary", u2.id);
		const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction1) ".repeat(12)));
		const a4 = createMessageEntry(createAssistantMessage("assistant msg 4 ".repeat(12), createMockUsage(8000, 2000)));

		const settings: CompactionSettings = {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 100,
		};
		const preparation = await prepareCompaction([u1, a1, u2, a2, u3, a3, compaction1, u4, a4], settings);

		expect(preparation).toBeDefined();
		// The previous summary message leads messagesToSummarize exactly as it leads
		// the chat context before compaction, so the summarization request stays
		// byte-identical to the normal chat prefix (provider cache reuse).
		expect(preparation!.messagesToSummarize[0]).toMatchObject({
			role: "compactionSummary",
			summary: "First summary",
		});
		expect(extractText(preparation!.messagesToSummarize.slice(1))).toContain("user msg 2 - kept by compaction1");
		// previousSummary is available for iterative update.
		expect(preparation!.previousSummary).toBe("First summary");
	});

	it("prepends ALL visible previous summaries to messagesToSummarize (no folding)", async () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)"));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1"));
		const compact1 = createCompactionEntry("First summary", u1.id);
		const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1 ".repeat(12)));
		const b = createMessageEntry(createAssistantMessage("assistant msg 2 ".repeat(12)));
		const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1 ".repeat(12)));
		const c = createMessageEntry(createAssistantMessage("assistant msg 3 ".repeat(12), createMockUsage(5000, 1000)));
		const compact2 = createCompactionEntry("Second summary", u3.id);
		const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction2) ".repeat(12)));
		const a4 = createMessageEntry(createAssistantMessage("assistant msg 4 ".repeat(12), createMockUsage(8000, 2000)));

		const settings: CompactionSettings = {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 100,
		};
		const preparation = await prepareCompaction([u1, a1, compact1, u2, b, u3, c, compact2, u4, a4], settings);

		expect(preparation).toBeDefined();
		// Both summaries lead messagesToSummarize, oldest first, then the cut messages.
		expect(preparation!.messagesToSummarize[0]).toMatchObject({
			role: "compactionSummary",
			summary: "First summary",
		});
		expect(preparation!.messagesToSummarize[1]).toMatchObject({
			role: "compactionSummary",
			summary: "Second summary",
		});
		expect(extractText(preparation!.messagesToSummarize.slice(2))).toContain("user msg 3 - kept by compaction1");
		// previousSummary exposes the most recent summary for extension consumers.
		expect(preparation!.previousSummary).toBe("Second summary");
	});

	it("summary block limit of 0 keeps only the most recent summary in messagesToSummarize", async () => {
		const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)"));
		const a1 = createMessageEntry(createAssistantMessage("assistant msg 1"));
		const compact1 = createCompactionEntry("First summary", u1.id);
		const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1 ".repeat(12)));
		const b = createMessageEntry(createAssistantMessage("assistant msg 2 ".repeat(12)));
		const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1 ".repeat(12)));
		const c = createMessageEntry(createAssistantMessage("assistant msg 3 ".repeat(12), createMockUsage(5000, 1000)));
		const compact2 = createCompactionEntry("Second summary", u3.id);
		const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction2) ".repeat(12)));
		const a4 = createMessageEntry(createAssistantMessage("assistant msg 4 ".repeat(12), createMockUsage(8000, 2000)));

		const settings: CompactionSettings = {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 100,
			summaryBlockMaxTokens: 0,
		};
		const preparation = await prepareCompaction([u1, a1, compact1, u2, b, u3, c, compact2, u4, a4], settings);

		expect(preparation).toBeDefined();
		// Only the most recent summary survives in the request prefix.
		const summaries = preparation!.messagesToSummarize.filter((m) => m.role === "compactionSummary");
		expect(summaries).toHaveLength(1);
		expect((summaries[0] as any).summary).toBe("Second summary");
	});

	it("builds the next summary from the visible checkpoint and cumulative summaries", async () => {
		const old = createMessageEntry(createUserMessage("old"));
		const first = createCompactionEntry("first", old.id);
		first.systemMessage = { role: "system", content: "stale checkpoint", timestamp: 1 };
		const kept = createMessageEntry(createUserMessage("kept"));
		const hidden = createCompactionEntry("deleted private summary", kept.id);
		hidden.deletedAt = "2025-01-02T00:00:00Z";
		const latest = createCompactionEntry("latest", kept.id);
		latest.systemMessage = { role: "system", content: "current checkpoint", timestamp: 2 };
		const patch = createMessageEntry({ role: "system", content: "later tools delta", timestamp: 3 });
		const next = createMessageEntry(createUserMessage("next"));
		const newest = createMessageEntry(createUserMessage("newest"));
		const entries = [old, first, kept, hidden, latest, patch, next, newest];
		for (const limit of [undefined, 0]) {
			const preparation = await prepareCompaction(
				entries,
				{ ...DEFAULT_COMPACTION_SETTINGS, summaryBlockMaxTokens: limit },
				{ keepRecentMessages: 1 },
			);
			expect(preparation?.firstKeptEntryId).toBe(newest.id);
			expect(preparation?.previousSummary).toBe("latest");
			expect(preparation?.messagesToSummarize).toEqual([
				latest.systemMessage,
				...(limit === undefined ? [expect.objectContaining({ role: "compactionSummary", summary: "first" })] : []),
				expect.objectContaining({ role: "compactionSummary", summary: "latest" }),
				kept.message,
				patch.message,
				next.message,
			]);
		}
	});
});

// ============================================================================
// Integration tests with real session data
// ============================================================================

describe("Large session fixture", () => {
	it("should parse the large session", () => {
		const entries = loadLargeSessionEntries();
		expect(entries.length).toBeGreaterThan(100);

		const messageCount = entries.filter((e) => e.type === "message").length;
		expect(messageCount).toBeGreaterThan(100);
	});

	it("should find cut point in large session", async () => {
		const entries = loadLargeSessionEntries();
		const result = await findCutPoint(entries, 0, entries.length, DEFAULT_COMPACTION_SETTINGS.keepRecentTokens);

		// Cut point should be at a message entry (user or assistant)
		expect(entries[result.firstKeptEntryIndex].type).toBe("message");
		const role = (entries[result.firstKeptEntryIndex] as SessionMessageEntry).message.role;
		expect(role === "user" || role === "assistant").toBe(true);
	});

	it("should load session correctly", () => {
		const entries = loadLargeSessionEntries();
		const loaded = buildSessionContext(entries);

		expect(loaded.messages.length).toBeGreaterThan(100);
		expect(loaded.model).not.toBeNull();
	});
});

// ============================================================================
// LLM integration tests (skipped without API key)
// ============================================================================

describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("LLM summarization", () => {
	it("should generate a compaction result for the large session", async () => {
		const entries = loadLargeSessionEntries();
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const preparation = await prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);
		expect(preparation).toBeDefined();

		const compactionResult = await compact(preparation!, model, process.env.ANTHROPIC_OAUTH_TOKEN!);

		expect(compactionResult.summary.length).toBeGreaterThan(100);
		expect(compactionResult.firstKeptEntryId).toBeTruthy();
		expect(compactionResult.tokensBefore).toBeGreaterThan(0);

		console.log("Summary length:", compactionResult.summary.length);
		console.log("First kept entry ID:", compactionResult.firstKeptEntryId);
		console.log("Tokens before:", compactionResult.tokensBefore);
		console.log("\n--- SUMMARY ---\n");
		console.log(compactionResult.summary);
	}, 60000);

	it("should produce valid session after compaction", async () => {
		const entries = loadLargeSessionEntries();
		const loaded = buildSessionContext(entries);
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const preparation = await prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);
		expect(preparation).toBeDefined();

		const compactionResult = await compact(preparation!, model, process.env.ANTHROPIC_OAUTH_TOKEN!);

		// Simulate appending compaction to entries by creating a proper entry
		const lastEntry = entries[entries.length - 1];
		const parentId = lastEntry.id;
		const compactionEntry: CompactionEntry = {
			type: "compaction",
			id: "compaction-test-id",
			parentId,
			timestamp: new Date().toISOString(),
			...compactionResult,
		};
		const newEntries = [...entries, compactionEntry];
		const reloaded = buildSessionContext(newEntries);

		// Should have summary + kept messages. When the first user message is
		// pinned it appears ahead of the summary; either way the summary is
		// present and the context shrank.
		expect(reloaded.messages.length).toBeLessThan(loaded.messages.length);
		const summaryMsg = reloaded.messages.find((m) => m.role === "compactionSummary");
		expect(summaryMsg).toBeDefined();
		expect((summaryMsg as any).summary).toContain(compactionResult.summary);

		console.log("Original messages:", loaded.messages.length);
		console.log("After compaction:", reloaded.messages.length);
	}, 60000);
});
