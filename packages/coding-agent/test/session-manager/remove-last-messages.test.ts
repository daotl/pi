import {
	BACKGROUND_CONTEXT,
	DEFAULT_COMPACTION_SETTINGS,
	type JsonlSessionMetadata,
	JsonlSessionRepo,
	prepareCompaction,
	type Session,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { type AssistantMessage, getCurrentSystemMessage, type SystemMessage } from "@earendil-works/pi-ai";
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSessionContext } from "../../../agent/src/harness/session/context.ts";
import { SessionManager } from "../../src/core/session-manager.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const tempDirs: string[] = [];
beforeEach(async () => {
	const actual = await vi.importActual<typeof fs>("fs");
	vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync);
});
afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function userMessage(text: string, timestamp: number) {
	return { role: "user" as const, content: text, timestamp };
}

function assistantMessage(
	content: AssistantMessage["content"],
	timestamp: number,
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "llama-server",
		model: "test",
		usage: createUsage(),
		stopReason,
		timestamp,
	};
}

describe("SessionManager.removeLastMessages", () => {
	it("removes the last message", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("hello", 1));
		session.appendMessage(assistantMessage([{ type: "text", text: "hi" }], 2));

		expect(session.buildSessionContext().messages).toHaveLength(2);

		const removed = session.removeLastMessages(1);

		expect(removed).toBe(1);
		const messages = session.buildSessionContext().messages;
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
	});

	it("removes the last N messages", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("a", 1));
		session.appendMessage(assistantMessage([{ type: "text", text: "b" }], 2));
		session.appendMessage(userMessage("c", 3));
		session.appendMessage(assistantMessage([{ type: "text", text: "d" }], 4));

		const removed = session.removeLastMessages(2);

		expect(removed).toBe(2);
		const messages = session.buildSessionContext().messages;
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");
	});

	it("skips harness messages when counting and removes trailing harness messages", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("hello", 1));
		// Harness message: aborted assistant with no content
		session.appendMessage(assistantMessage([], 2, "aborted"));

		// Only the user message is non-harness; /delete 1 removes it and the trailing harness
		const removed = session.removeLastMessages(1);

		expect(removed).toBe(1);
		expect(session.buildSessionContext().messages).toHaveLength(0);
		expect(session.getBranch()).toHaveLength(0);
	});

	it("removes a real assistant message and trailing harness message after it", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("hello", 1));
		session.appendMessage(assistantMessage([{ type: "text", text: "real response" }], 2));
		// Trailing harness message after the real assistant message
		session.appendMessage(assistantMessage([], 3, "aborted"));

		const removed = session.removeLastMessages(1);

		expect(removed).toBe(1);
		const messages = session.buildSessionContext().messages;
		expect(messages).toHaveLength(1);
		expect(messages[0].role).toBe("user");
	});

	it("keeps harness messages before the deletion point", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("hello", 1));
		// Harness message before the real assistant message
		session.appendMessage(assistantMessage([], 2, "aborted"));
		session.appendMessage(assistantMessage([{ type: "text", text: "real response" }], 3));

		// /delete 1 removes the real assistant message; the harness before it stays
		const removed = session.removeLastMessages(1);

		expect(removed).toBe(1);
		const messages = session.buildSessionContext().messages;
		// user + the kept harness assistant message (content []) remain
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("user");
		expect(messages[1].role).toBe("assistant");
	});

	it("removes more than available deletes all non-harness messages", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("a", 1));
		session.appendMessage(assistantMessage([{ type: "text", text: "b" }], 2));

		const removed = session.removeLastMessages(10);

		expect(removed).toBe(2);
		expect(session.buildSessionContext().messages).toHaveLength(0);
	});

	it("returns 0 when there are no non-harness messages", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(assistantMessage([], 1, "aborted"));

		const removed = session.removeLastMessages(1);

		expect(removed).toBe(0);
		// The harness entry is unchanged
		expect(session.getBranch()).toHaveLength(1);
	});

	it("returns 0 for count < 1", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("a", 1));

		expect(session.removeLastMessages(0)).toBe(0);
		expect(session.removeLastMessages(-1)).toBe(0);
		expect(session.buildSessionContext().messages).toHaveLength(1);
	});

	it("removes non-message entries trailing the deletion point", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("hello", 1));
		session.appendMessage(assistantMessage([{ type: "text", text: "response" }], 2));
		// Trailing non-message entry after the assistant message
		session.appendThinkingLevelChange("high");

		const removed = session.removeLastMessages(1);

		expect(removed).toBe(1);
		// The assistant message AND the trailing thinking_level_change are removed
		expect(session.getEntries()).toHaveLength(1);
		expect(session.getEntries()[0].type).toBe("message");
	});

	it("keeps non-message entries before the deletion point", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("hello", 1));
		session.appendThinkingLevelChange("high");
		session.appendMessage(assistantMessage([{ type: "text", text: "response" }], 3));

		const removed = session.removeLastMessages(1);

		expect(removed).toBe(1);
		// user + thinking_level_change remain; assistant removed
		expect(session.getEntries()).toHaveLength(2);
		expect(session.getEntries().some((e) => e.type === "thinking_level_change")).toBe(true);
	});

	it("removes branched descendants of deleted entries", () => {
		const session = SessionManager.inMemory();
		const userId = session.appendMessage(userMessage("hello", 1));
		const assistantId = session.appendMessage(assistantMessage([{ type: "text", text: "first branch" }], 2));
		// Branch from the user message, creating a sibling branch
		session.branch(userId);
		const assistant2Id = session.appendMessage(assistantMessage([{ type: "text", text: "second branch" }], 3));

		// Leaf path is [user, assistant2]; the first assistant is a branched descendant of user.
		expect(session.getBranch()).toHaveLength(2);

		// /delete 2 removes both leaf-path messages (user, assistant2) and the
		// branched descendant (first assistant) whose parent (user) was removed.
		const removed = session.removeLastMessages(2);

		expect(removed).toBe(2);
		expect(session.getBranch()).toHaveLength(0);
		expect(session.getEntries().some((e) => e.id === assistantId)).toBe(false);
		expect(session.getEntries().some((e) => e.id === assistant2Id)).toBe(false);
	});

	it("counts the visible projected message instead of an omitted raw tail", () => {
		const session = SessionManager.inMemory();
		const visible = session.appendMessage(userMessage("visible", 1));
		const hidden = session.appendMessage(userMessage("hidden", 2));
		session.appendContextEdit(hidden, null);
		expect(session.removeLastMessages(1)).toBe(1);
		expect(session.buildSessionContext().messages).toEqual([]);
		expect(session.getEntry(visible)).toBeUndefined();
	});

	it.each(["raw-harness", "projected-harness"] as const)(
		"uses %s projected assistant content for counting",
		(mode) => {
			const session = SessionManager.inMemory();
			const input = session.appendMessage(userMessage("question", 1));
			const response = session.appendMessage(
				assistantMessage(mode === "raw-harness" ? [] : [{ type: "text", text: "raw answer" }], 2, "aborted"),
			);
			session.appendContextEdit(response, {
				content: mode === "raw-harness" ? [{ type: "text", text: "projected answer" }] : [],
			});
			expect(session.removeLastMessages(1)).toBe(1);
			expect(session.buildSessionContext().messages).toEqual(
				mode === "raw-harness" ? [userMessage("question", 1)] : [],
			);
			expect(session.getEntry(input) !== undefined).toBe(mode === "raw-harness");
		},
	);

	it("does not count a trailing system policy as a deletable message", () => {
		const session = SessionManager.inMemory();
		session.appendMessage(userMessage("question", 1));
		session.appendMessage(assistantMessage([{ type: "text", text: "answer" }], 2));
		session.appendMessage({ role: "system", content: "policy", timestamp: 3 });
		expect(session.removeLastMessages(1)).toBe(1);
		expect(session.buildSessionContext().messages).toEqual([userMessage("question", 1)]);
	});

	it.each([1, 2, 99])("preserves compacted state and sibling history when removing %s projected messages", (count) => {
		const dir = fs.mkdtempSync(join(tmpdir(), "pi-projected-delete-"));
		tempDirs.push(dir);
		const session = SessionManager.create(dir, dir);
		session.appendMessage({ role: "system", content: "saved policy", timestamp: 0 });
		const old = session.appendMessage(userMessage("summarized question", 1));
		session.appendMessage(assistantMessage([{ type: "text", text: "summarized answer" }], 2));
		const retained = session.appendMessage(userMessage("retained question", 3));
		session.branch(old);
		const sibling = session.appendMessage(assistantMessage([{ type: "text", text: "sibling answer" }], 4));
		session.branch(retained);
		const answer = session.appendMessage(assistantMessage([{ type: "text", text: "retained answer" }], 5));
		const checkpoint = session.appendCompaction("saved summary", retained, 100, { source: "compaction" });
		session.appendLabelChange(checkpoint, "checkpoint bookmark");
		session.appendThinkingLevelChange("high");
		session.appendCustomEntry("retained-state", { value: 42 });
		session.appendMessage({ role: "system", content: "current policy", timestamp: 6 });
		const policy = session.buildSessionContext().messages.filter((message) => message.role === "system");
		const siblingBefore = structuredClone(session.getEntry(sibling));
		const metadata = session
			.getBranch()
			.filter((entry) => entry.type === "custom" || entry.type === "thinking_level_change");
		expect(session.removeLastMessages(count)).toBe(Math.min(count, 2));
		for (const actual of [session, SessionManager.open(session.getSessionFile()!, dir)]) {
			const messages = actual.buildSessionContext().messages;
			expect(messages.filter((message) => message.role === "system")).toEqual(policy);
			expect(messages.filter((message) => message.role !== "system")).toEqual([
				expect.objectContaining({ role: "compactionSummary", summary: "saved summary" }),
				...(count === 1 ? [userMessage("retained question", 3)] : []),
			]);
			expect(actual.getEntry(answer)).toBeUndefined();
			expect(actual.getEntry(sibling)).toEqual(siblingBefore);
			expect(actual.getLabel(checkpoint)).toBe("checkpoint bookmark");
			expect(
				actual.getBranch().filter((entry) => entry.type === "custom" || entry.type === "thinking_level_change"),
			).toEqual(metadata);
			expect(actual.getEntry(checkpoint)).toMatchObject({
				firstKeptEntryId: count === 1 ? retained : checkpoint,
				details: { source: "compaction" },
			});
		}
	});

	it("imports producer-written retain-none checkpoints through closed fork, first commit, and reopen", async () => {
		const dir = fs.mkdtempSync(join(tmpdir(), "pi-retain-none-import-"));
		tempDirs.push(dir);
		const producer = SessionManager.create(dir, dir);
		const policy: SystemMessage = {
			role: "system",
			content: [{ type: "text", text: "Preserve this policy after compaction." }],
			sections: {
				safety: "<safety>Never reveal secrets.</safety>",
				workspace: "<workspace>Use this repo.</workspace>",
			},
			toolsAdded: [
				{
					name: "read",
					description: "Read a file",
					parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
				},
			],
			timestamp: 0,
		};
		producer.appendMessage(policy);
		producer.appendMessage(userMessage("summarized question", 1));
		producer.appendMessage(assistantMessage([{ type: "text", text: "summarized answer" }], 2));
		const retained = producer.appendMessage(userMessage("deleted retained question", 3));
		producer.appendMessage(assistantMessage([{ type: "text", text: "deleted retained answer" }], 4));
		const checkpoint = producer.appendCompaction("saved summary", retained, 100, { source: "deletion" });
		expect(producer.removeLastMessages(2)).toBe(2);
		expect(producer.getEntry(checkpoint)).toMatchObject({ firstKeptEntryId: checkpoint });
		const producerCheckpoint = producer.getEntry(checkpoint);
		if (producerCheckpoint?.type !== "compaction" || !producerCheckpoint.systemMessage) {
			throw new Error("Missing producer system checkpoint");
		}
		const systemMessage = structuredClone(producerCheckpoint.systemMessage);
		expect(systemMessage).toEqual({
			...policy,
			content: "Preserve this policy after compaction.",
			timestamp: expect.any(Number),
		});
		expect(producer.buildSessionContext().messages).toEqual([
			systemMessage,
			expect.objectContaining({ role: "compactionSummary", summary: "saved summary" }),
		]);
		const path = producer.getSessionFile()!;
		const bytes = fs.readFileSync(path);
		const header = producer.getHeader()!;
		const metadata: JsonlSessionMetadata = {
			id: header.id,
			cwd: header.cwd,
			path,
			createdAt: Date.parse(header.timestamp),
			modifiedAt: Date.parse(header.timestamp),
			storageVersion: 3,
		};
		const fileSystem = new NodeExecutionEnv({ cwd: dir });
		const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: dir });
		const assertCheckpoint = async (session: Session) => {
			const branch = await session.branch("main", BACKGROUND_CONTEXT);
			if (!branch) throw new Error("Missing imported main branch");
			const entries = await branch.findEntries({ order: "oldestFirst" }, BACKGROUND_CONTEXT);
			expect(entries.at(-1)).toMatchObject({
				type: "compaction",
				summary: "saved summary",
				retainedTail: [],
				systemMessage,
				details: { source: "deletion" },
			});
			expect(await buildSessionContext(entries, undefined, BACKGROUND_CONTEXT)).toEqual([
				systemMessage,
				expect.objectContaining({ role: "compactionSummary", summary: "saved summary" }),
			]);
			expect(
				(await session.findEntries({ type: "message", order: "asc" }, BACKGROUND_CONTEXT)).map((entry) =>
					entry.type === "message" ? entry.message : undefined,
				),
			).toEqual([
				policy,
				userMessage("summarized question", 1),
				assistantMessage([{ type: "text", text: "summarized answer" }], 2),
			]);
		};
		try {
			const fork = await repo.fork(metadata, { scope: "tree", id: "retain-none-fork" }, BACKGROUND_CONTEXT);
			await assertCheckpoint(fork);
			await fork.close(BACKGROUND_CONTEXT);
			const reopenedFork = await repo.open(fork.metadata, BACKGROUND_CONTEXT);
			await assertCheckpoint(reopenedFork);
			await reopenedFork.close(BACKGROUND_CONTEXT);
			expect(fs.readFileSync(path)).toEqual(bytes);
			const session = await repo.open(metadata, BACKGROUND_CONTEXT);
			await assertCheckpoint(session);
			expect(fs.readFileSync(path)).toEqual(bytes);
			await session.setName("upgraded retain-none checkpoint", BACKGROUND_CONTEXT);
			await assertCheckpoint(session);
			await session.close(BACKGROUND_CONTEXT);
			expect(JSON.parse(fs.readFileSync(path, "utf8").split("\n")[0])).toMatchObject({ v: 4 });
			const reopened = await repo.open(metadata, BACKGROUND_CONTEXT);
			await assertCheckpoint(reopened);
			const upgradedFork = await repo.fork(
				metadata,
				{ scope: "tree", id: "upgraded-retain-none-fork" },
				BACKGROUND_CONTEXT,
			);
			await assertCheckpoint(upgradedFork);
			await upgradedFork.close(BACKGROUND_CONTEXT);
			await reopened.close(BACKGROUND_CONTEXT);
		} finally {
			await repo.close(BACKGROUND_CONTEXT);
			await fileSystem.cleanup(BACKGROUND_CONTEXT);
		}
	});

	it("imports nonempty retained checkpoints without replaying folded system deltas", async () => {
		const dir = fs.mkdtempSync(join(tmpdir(), "pi-retained-policy-import-"));
		tempDirs.push(dir);
		const producer = SessionManager.create(dir, dir);
		const policy: SystemMessage = {
			role: "system",
			content: "Base policy.",
			sections: { safety: "Never reveal secrets.", workspace: "Old workspace." },
			toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object", properties: {} } }],
			timestamp: 0,
		};
		const delta: SystemMessage = {
			role: "system",
			content: "Retained policy delta.",
			sections: { safety: null, workspace: "Current workspace." },
			toolsRemoved: [{ name: "read" }],
			toolsAdded: [{ name: "write", description: "Write a file", parameters: { type: "object", properties: {} } }],
			timestamp: 4,
		};
		producer.appendMessage(policy);
		producer.appendMessage(userMessage("summarized question", 1));
		producer.appendMessage(assistantMessage([{ type: "text", text: "summarized answer" }], 2));
		const retained = producer.appendMessage(userMessage("retained question", 3));
		producer.appendMessage(delta);
		producer.appendMessage(assistantMessage([{ type: "text", text: "deleted retained answer" }], 5));
		const checkpoint = producer.appendCompaction("saved summary", retained, 100);
		expect(producer.removeLastMessages(1)).toBe(1);
		expect(producer.getEntry(checkpoint)).toMatchObject({ firstKeptEntryId: retained });
		producer.appendMessage(userMessage("follow-up question", 6));
		const systemMessage = getCurrentSystemMessage(producer.buildSessionContext().messages);
		expect(systemMessage).toEqual({
			role: "system",
			content: "Base policy.\n\nRetained policy delta.",
			sections: { workspace: "Current workspace." },
			toolsAdded: delta.toolsAdded,
			timestamp: expect.any(Number),
		});
		expect(producer.getEntry(checkpoint)).toMatchObject({ systemMessage });
		const path = producer.getSessionFile()!;
		const bytes = fs.readFileSync(path);
		const header = producer.getHeader()!;
		const metadata: JsonlSessionMetadata = {
			id: header.id,
			cwd: header.cwd,
			path,
			createdAt: Date.parse(header.timestamp),
			modifiedAt: Date.parse(header.timestamp),
			storageVersion: 3,
		};
		const fileSystem = new NodeExecutionEnv({ cwd: dir });
		const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: dir });
		const assertPolicy = async (session: Session) => {
			const branch = await session.branch("main", BACKGROUND_CONTEXT);
			if (!branch) throw new Error("Missing imported main branch");
			const entries = await branch.findEntries({ order: "oldestFirst" }, BACKGROUND_CONTEXT);
			expect(entries.find((entry) => entry.type === "compaction")).toMatchObject({
				retainedTail: [userMessage("retained question", 3)],
				systemMessage,
			});
			const messages = await buildSessionContext(entries, undefined, BACKGROUND_CONTEXT);
			expect(messages).toEqual([
				systemMessage,
				expect.objectContaining({ role: "compactionSummary", summary: "saved summary" }),
				userMessage("retained question", 3),
				userMessage("follow-up question", 6),
			]);
			expect(getCurrentSystemMessage(messages)).toEqual(systemMessage);
			const preparation = prepareCompaction(entries, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 1 });
			if (!preparation.ok) throw preparation.error;
			expect(preparation.value).toMatchObject({
				systemMessage,
				messagesToSummarize: [userMessage("retained question", 3)],
				retainedTail: [userMessage("follow-up question", 6)],
			});
		};
		try {
			const session = await repo.open(metadata, BACKGROUND_CONTEXT);
			await assertPolicy(session);
			expect(fs.readFileSync(path)).toEqual(bytes);
			await session.setName("upgraded retained policy checkpoint", BACKGROUND_CONTEXT);
			await assertPolicy(session);
			await session.close(BACKGROUND_CONTEXT);
			expect(JSON.parse(fs.readFileSync(path, "utf8").split("\n")[0])).toMatchObject({ v: 4 });
			const reopened = await repo.open(metadata, BACKGROUND_CONTEXT);
			await assertPolicy(reopened);
			await reopened.close(BACKGROUND_CONTEXT);
		} finally {
			await repo.close(BACKGROUND_CONTEXT);
			await fileSystem.cleanup(BACKGROUND_CONTEXT);
		}
	});

	it("rebases surviving sibling checkpoints on their own paths", () => {
		const dir = fs.mkdtempSync(join(tmpdir(), "pi-sibling-delete-"));
		tempDirs.push(dir);
		const session = SessionManager.create(dir, dir);
		session.appendMessage(userMessage("old raw question", 1));
		const retained = session.appendMessage(userMessage("retained question", 2));
		session.appendMessage(assistantMessage([{ type: "text", text: "retained answer" }], 3));
		const checkpoint = session.appendCompaction("first summary", retained, 100);
		session.appendMessage(userMessage("sibling question", 4));
		const siblingAnswer = assistantMessage([{ type: "text", text: "sibling answer" }], 5);
		session.appendMessage(siblingAnswer);
		const siblingCheckpoint = session.appendCompaction("sibling summary", retained, 150);
		session.appendLabelChange(siblingCheckpoint, "sibling bookmark");
		session.branch(checkpoint);
		expect(session.removeLastMessages(2)).toBe(2);
		for (const actual of [session, SessionManager.open(session.getSessionFile()!, dir)]) {
			actual.branch(siblingCheckpoint);
			expect(actual.buildSessionContext().messages).toEqual([
				expect.objectContaining({ role: "compactionSummary", summary: "first summary" }),
				expect.objectContaining({ role: "compactionSummary", summary: "sibling summary" }),
				userMessage("sibling question", 4),
				siblingAnswer,
			]);
			expect(actual.getEntry(siblingCheckpoint)).toMatchObject({ firstKeptEntryId: checkpoint });
			expect(actual.getLabel(siblingCheckpoint)).toBe("sibling bookmark");
		}
	});

	it("publishes no rebased checkpoint on rename failure and retries without resurrecting raw history", () => {
		const dir = fs.mkdtempSync(join(tmpdir(), "pi-checkpoint-delete-failure-"));
		tempDirs.push(dir);
		const session = SessionManager.create(dir, dir);
		session.appendMessage(userMessage("old raw question", 1));
		const retained = session.appendMessage(userMessage("retained question", 2));
		session.appendMessage(assistantMessage([{ type: "text", text: "retained answer" }], 3));
		const checkpoint = session.appendCompaction("saved summary", retained, 100);
		const held = session.getEntries();
		const entries = structuredClone(held);
		const projection = structuredClone(session.buildSessionProjection());
		const leaf = session.getLeafId();
		const file = session.getSessionFile()!;
		const bytes = fs.readFileSync(file);
		const failure = new Error("checkpoint deletion rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => session.removeLastMessages(99)).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(session.getLeafId()).toBe(leaf);
		for (const entry of held) expect(session.getEntry(entry.id)).toBe(entry);
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(SessionManager.open(file, dir).buildSessionProjection()).toEqual(projection);
		expect(session.removeLastMessages(99)).toBe(2);
		expect(SessionManager.open(file, dir).buildSessionContext().messages).toEqual([
			expect.objectContaining({ role: "compactionSummary", summary: "saved summary" }),
		]);
		expect(session.getEntry(checkpoint)).toMatchObject({ firstKeptEntryId: checkpoint });
	});

	it("does not rebase a visible checkpoint onto a soft-deleted boundary", () => {
		const dir = fs.mkdtempSync(join(tmpdir(), "pi-hidden-checkpoint-boundary-"));
		tempDirs.push(dir);
		const session = SessionManager.create(dir, dir);
		session.appendMessage(userMessage("summarized raw question", 1));
		const retained = session.appendMessage(userMessage("retained question", 2));
		const hidden = session.appendCompaction("hidden summary", retained, 100);
		session.softDeleteUnits([{ entryId: hidden }]);
		const visible = session.appendCompaction("visible summary", retained, 100);
		expect(session.buildSessionContext().messages).toEqual([
			expect.objectContaining({ role: "compactionSummary", summary: "visible summary" }),
			userMessage("retained question", 2),
		]);
		expect(session.removeLastMessages(1)).toBe(1);
		for (const actual of [session, SessionManager.open(session.getSessionFile()!, dir)]) {
			expect(actual.buildSessionContext().messages).toEqual([
				expect.objectContaining({ role: "compactionSummary", summary: "visible summary" }),
			]);
			expect(actual.getEntry(visible)).toMatchObject({ firstKeptEntryId: visible });
			expect(actual.getEntry(hidden)?.deletedAt).toBeDefined();
		}
	});
});
