import type { AssistantMessage } from "@earendil-works/pi-ai";
import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SessionEntry, SessionManager } from "../../src/core/session-manager.ts";
import { getUsageTotals } from "../../src/core/usage-totals.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return {
		...actual,
		writeFileSync: vi.fn(actual.writeFileSync),
		fsyncSync: vi.fn(actual.fsyncSync),
		closeSync: vi.fn(actual.closeSync),
		renameSync: vi.fn(actual.renameSync),
	};
});

function response(text: string, output: number): AssistantMessage {
	const message = assistantMsg(text);
	return {
		...message,
		timestamp: output,
		usage: { ...message.usage, output, totalTokens: output + 1 },
	};
}

function messageEntry(session: SessionManager, id: string) {
	const entry = session.getEntry(id);
	if (entry?.type !== "message") throw new Error(`Missing message ${id}`);
	return entry;
}

describe("assistant continuation storage transactions", () => {
	let dir: string;

	beforeEach(async () => {
		const actual = await vi.importActual<typeof fs>("fs");
		vi.mocked(fs.writeFileSync).mockReset().mockImplementation(actual.writeFileSync);
		vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
		vi.mocked(fs.closeSync).mockReset().mockImplementation(actual.closeSync);
		vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync);
		dir = fs.mkdtempSync(join(tmpdir(), "continuation-transaction-"));
	});

	afterEach(() => {
		vi.clearAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function fixture() {
		const session = SessionManager.create(dir, dir);
		const user = session.appendMessage({ ...userMsg("question"), timestamp: 1 });
		const charged = session.appendMessage(response("original partial", 3));
		session.branch(user);
		const prefill = session.appendMessage(response("projected partial", 3), charged);
		const edit = session.appendContextEdit(prefill, { content: "effective partial" });
		const system = session.appendMessage({ role: "system", content: "system patch", timestamp: 4 });
		const custom = session.appendCustomMessageEntry("notice", "custom context", false, { retained: true });
		const customEdit = session.appendContextEdit(custom, { content: "edited custom context" });
		const compaction = session.appendCompaction("summary", prefill, 100, { files: [] }, false, response("", 5).usage);
		const label = session.appendLabelChange(prefill, "prefill bookmark");
		const summary = session.branchWithSummary(
			label,
			"branch summary",
			{ retained: true },
			true,
			response("", 7).usage,
		);
		const usage = session.appendUsage("cache_warm", "anthropic", "test", response("", 11).usage, "warm receipt");
		const state = session.appendCustomEntry("state", { retained: true });
		session.appendSystemPrompt("saved prompt");
		session.appendThinkingLevelChange("high");
		session.appendModelChange("anthropic", "test");
		const tail = session.getBranch().slice(session.getBranch().findIndex((entry) => entry.id === prefill) + 1);
		return {
			session,
			user,
			charged,
			prefill,
			edit,
			system,
			custom,
			customEdit,
			compaction,
			label,
			summary,
			usage,
			state,
			tail,
		};
	}

	it("replaces the canonical position, remaps only cloned references, and charges the new response once", () => {
		const f = fixture();
		const held = f.session.getEntries();
		const values = structuredClone(held);
		const oldTotals = getUsageTotals(held);
		const before = f.session.getBranch();
		const replacement = response("continued answer", 13);
		const id = f.session.replaceAssistantContinuation(f.prefill, replacement);
		const branch = f.session.getBranch();
		const offset = before.findIndex((entry) => entry.id === f.prefill);
		expect(branch.slice(0, offset)).toEqual(before.slice(0, offset));
		expect(branch[offset]).toMatchObject({ id, parentId: f.user, type: "message", message: replacement });
		expect(branch[offset].usageSourceId).toBeUndefined();
		expect(branch.slice(offset).map((entry) => entry.type)).toEqual(
			before
				.slice(offset)
				.filter((entry) => entry.id !== f.edit)
				.map((entry) => entry.type),
		);
		const clones = new Map(branch.slice(offset).map((entry) => [entry.usageSourceId, entry]));
		expect(clones.get(f.compaction)).toMatchObject({ firstKeptEntryId: id });
		expect(clones.get(f.label)).toMatchObject({ targetId: id });
		expect(clones.get(f.summary)).toMatchObject({ fromId: clones.get(f.label)?.id });
		expect(clones.get(f.customEdit)).toMatchObject({ targetId: clones.get(f.custom)?.id });
		expect(f.session.getLabel(id)).toBe("prefill bookmark");
		expect(f.session.getEntry(f.compaction)).toMatchObject({ firstKeptEntryId: f.prefill });
		expect(f.session.getEntry(f.edit)).toMatchObject({ targetId: f.prefill });
		expect(held).toEqual(values);
		for (const source of before.slice(offset).filter((entry) => entry.id !== f.edit)) {
			const clone = source.id === f.prefill ? branch[offset] : clones.get(source.usageSourceId ?? source.id);
			expect(f.session.getEntry(source.id)?.supersededBy).toBe(clone?.id);
			expect(clone?.supersededBy).toBeUndefined();
		}
		expect(getUsageTotals(f.session.getEntries())).toEqual({
			...oldTotals,
			input: oldTotals.input + replacement.usage.input,
			output: oldTotals.output + replacement.usage.output,
		});
		const reopened = SessionManager.open(f.session.getSessionFile()!, dir, dir);
		expect(reopened.getBranch()).toEqual(branch);
		expect(reopened.buildSessionProjection()).toEqual(f.session.buildSessionProjection());
		expect(getUsageTotals(reopened.getEntries())).toEqual(getUsageTotals(f.session.getEntries()));
	});

	it("retains deletion state and supersession chains without adding swipe alternatives", () => {
		const session = SessionManager.create(dir, dir);
		session.appendMessage({ ...userMsg("question"), timestamp: 1 });
		const source = session.appendMessage({
			...response("partial", 3),
			content: [
				{ type: "text", text: "partial" },
				{ type: "toolCall", id: "deleted-call", name: "read", arguments: {} },
			],
		});
		session.softDeleteUnits([{ entryId: source, toolCallId: "deleted-call" }]);
		const first = session.replaceAssistantContinuation(source, response("first continuation", 5));
		session.softDeleteUnits([{ entryId: first }]);
		const held = messageEntry(session, first);
		const snapshot = structuredClone(held);
		const second = session.replaceAssistantContinuation(first, response("second continuation", 7));
		expect(messageEntry(session, second)).toMatchObject({
			deletedAt: snapshot.deletedAt,
			deletedToolCalls: snapshot.deletedToolCalls,
		});
		expect(held).toEqual(snapshot);
		expect(session.getEntry(source)?.supersededBy).toBe(first);
		expect(session.getEntry(first)?.supersededBy).toBe(second);
		expect(
			session
				.getChildren(held.parentId!)
				.filter((entry) => entry.supersededBy === undefined)
				.map((entry) => entry.id),
		).toEqual([second]);
		expect(SessionManager.open(session.getSessionFile()!, dir, dir).getEntry(second)).toEqual(
			session.getEntry(second),
		);
		const restored = session.restoreAssistantPrefill(held.parentId, response("restored partial", 7), second, []);
		expect(messageEntry(session, restored)).toMatchObject({
			deletedAt: snapshot.deletedAt,
			deletedToolCalls: snapshot.deletedToolCalls,
		});
		expect(messageEntry(session, restored).deletedToolCalls).not.toBe(messageEntry(session, second).deletedToolCalls);
		expect(session.getEntry(second)?.supersededBy).toBe(restored);
	});

	it("restores ordered replayable entries with transitive charge identities and retains raw source history", () => {
		const f = fixture();
		const skipped = f.session.appendMessage({ ...userMsg("not replayed"), timestamp: 20 });
		const skippedEdit = f.session.appendContextEdit(skipped, { content: "also not replayed" });
		const boundary = f.session.appendCompaction("fallback boundary", skipped, 200);
		const trailing = f.session
			.getBranch()
			.slice(f.session.getBranch().findIndex((entry) => entry.id === f.prefill) + 1);
		const totals = getUsageTotals(f.session.getEntries());
		const held = f.session.getEntries();
		const snapshots = structuredClone(held);
		const id = f.session.restoreAssistantPrefill(f.user, response("effective partial", 3), f.prefill, trailing);
		const branch = f.session.getBranch();
		const restored = messageEntry(f.session, id);
		expect(restored).toMatchObject({ parentId: f.user, usageSourceId: f.charged });
		const clones = new Map(branch.map((entry) => [entry.usageSourceId, entry]));
		expect(branch.slice(2).map((entry) => entry.type)).toEqual(
			trailing.filter((entry) => entry.id !== skipped && entry.id !== skippedEdit).map((entry) => entry.type),
		);
		expect(clones.get(f.edit)).toMatchObject({ targetId: id });
		expect(clones.get(f.customEdit)).toMatchObject({ targetId: clones.get(f.custom)?.id });
		expect(clones.get(f.compaction)).toMatchObject({ firstKeptEntryId: id });
		expect(clones.get(f.summary)).toMatchObject({ fromId: clones.get(f.label)?.id });
		expect(clones.get(f.compaction)).toMatchObject({
			systemMessage: { role: "system", content: "system patch", timestamp: expect.any(Number) },
		});
		expect(clones.get(boundary)).toMatchObject({ firstKeptEntryId: id });
		expect(clones.get(f.usage.id)).toMatchObject({ note: "warm receipt", usage: f.usage.usage });
		expect(branch.some((entry) => entry.id === f.prefill || entry.id === skipped || entry.id === skippedEdit)).toBe(
			false,
		);
		expect(f.session.getEntry(f.prefill)).toMatchObject({ message: response("projected partial", 3) });
		expect(held).toEqual(snapshots);
		expect(getUsageTotals(f.session.getEntries())).toEqual(totals);
		const second = f.session.restoreAssistantPrefill(
			f.user,
			restored.message as AssistantMessage,
			id,
			branch.slice(2),
		);
		expect(messageEntry(f.session, second).usageSourceId).toBe(f.charged);
		expect(getUsageTotals(f.session.getEntries())).toEqual(totals);
		const reopened = SessionManager.open(f.session.getSessionFile()!, dir, dir);
		expect(reopened.getBranch()).toEqual(f.session.getBranch());
		expect(reopened.buildSessionProjection()).toEqual(f.session.buildSessionProjection());
		expect(getUsageTotals(reopened.getEntries())).toEqual(totals);
	});

	it("gives an unpersisted direct prefill its own identity and leaves subsequent appends durable", () => {
		const session = SessionManager.create(dir, dir);
		const id = session.restoreAssistantPrefill(null, response("direct partial", 3), undefined, []);
		expect(messageEntry(session, id).usageSourceId).toBeUndefined();
		expect(messageEntry(session, id).supersededBy).toBeUndefined();
		const user = session.appendMessage({ ...userMsg("next question"), timestamp: 4 });
		expect(messageEntry(session, user).parentId).toBe(id);
		expect(SessionManager.open(session.getSessionFile()!, dir, dir).getBranch()).toEqual(session.getBranch());
		expect(getUsageTotals(session.getEntries())).toMatchObject({ input: 1, output: 3 });
	});

	it.each(["replace", "restore"] as const)(
		"remaps forward suffix references during %s without rewriting sources",
		(operation) => {
			const session = SessionManager.inMemory(dir);
			const prefill = session.appendMessage(response("partial", 3));
			const timestamp = "2026-01-01T00:00:00.000Z";
			const trailing: SessionEntry[] = [
				{
					type: "compaction",
					id: "compact",
					parentId: prefill,
					timestamp,
					summary: "summary",
					firstKeptEntryId: "custom",
					tokensBefore: 10,
				},
				{
					type: "branch_summary",
					id: "summary",
					parentId: "compact",
					timestamp,
					summary: "branch",
					fromId: "custom",
				},
				{
					type: "label",
					id: "label",
					parentId: "summary",
					timestamp,
					targetId: "custom",
					label: "forward bookmark",
				},
				{
					type: "context_edit",
					id: "edit",
					parentId: "label",
					timestamp,
					targetId: "custom",
					replacement: { content: "projected" },
				},
				{
					type: "custom_message",
					id: "custom",
					parentId: "edit",
					timestamp,
					customType: "notice",
					content: "raw",
					display: false,
				},
			];
			const manager = SessionManager.inMemory(dir, undefined, [
				session.getHeader()!,
				...session.getEntries(),
				...trailing,
			]);
			const originals = structuredClone(manager.getEntries());
			if (operation === "replace") manager.replaceAssistantContinuation(prefill, response("continued", 5));
			else manager.restoreAssistantPrefill(null, response("partial", 3), prefill, trailing);
			const branch = manager.getBranch();
			const target = branch.find((entry) => entry.usageSourceId === "custom")!;
			expect(branch.find((entry) => entry.type === "compaction")).toMatchObject({ firstKeptEntryId: target.id });
			expect(branch.find((entry) => entry.type === "branch_summary")).toMatchObject({ fromId: target.id });
			expect(branch.find((entry) => entry.type === "label")).toMatchObject({ targetId: target.id });
			expect(branch.find((entry) => entry.type === "context_edit")).toMatchObject({ targetId: target.id });
			expect(manager.getLabel(target.id)).toBe("forward bookmark");
			for (const source of originals) {
				const retained = manager.getEntry(source.id)!;
				expect({ ...retained, supersededBy: undefined }).toEqual({ ...source, supersededBy: undefined });
			}
		},
	);

	it("retains conversational and tool-result suffix entries at their original relative positions", () => {
		const session = SessionManager.create(dir, dir);
		const user = session.appendMessage({ ...userMsg("question"), timestamp: 1 });
		const source = session.appendMessage(response("partial", 3));
		const result = session.appendMessage({
			role: "toolResult",
			toolCallId: "earlier-call",
			toolName: "read",
			content: [{ type: "text", text: "retained result" }],
			isError: false,
			timestamp: 4,
			usage: response("", 5).usage,
		});
		const followup = session.appendMessage({ ...userMsg("followup"), timestamp: 6 });
		const answer = session.appendMessage(response("later answer", 7));
		const original = session.getBranch();
		const totals = getUsageTotals(session.getEntries());
		const replacement = session.replaceAssistantContinuation(source, response("continued", 11));
		const branch = session.getBranch();
		expect(branch[0].id).toBe(user);
		expect(branch[1]).toMatchObject({ id: replacement, parentId: user });
		expect(branch.slice(2).map((entry) => entry.usageSourceId)).toEqual([result, followup, answer]);
		expect(branch.slice(2).map((entry) => (entry.type === "message" ? entry.message : undefined))).toEqual(
			original.slice(2).map((entry) => (entry.type === "message" ? entry.message : undefined)),
		);
		expect(getUsageTotals(session.getEntries()).output).toBe(totals.output + 11);
		expect(SessionManager.open(session.getSessionFile()!, dir, dir).getBranch()).toEqual(branch);
	});

	it("rejects a noncanonical assistant without changing the selected conversation or file", () => {
		const f = fixture();
		const file = f.session.getSessionFile()!;
		const bytes = fs.readFileSync(file);
		const leaf = f.session.getLeafId();
		const branch = f.session.getBranch();
		expect(() => f.session.replaceAssistantContinuation(f.charged, response("wrong branch", 13))).toThrow(
			`Assistant prefill ${f.charged} is not on the active branch`,
		);
		expect(f.session.getLeafId()).toBe(leaf);
		expect(f.session.getBranch()).toEqual(branch);
		expect(fs.readFileSync(file)).toEqual(bytes);
	});

	for (const operation of ["replace", "restore"] as const) {
		it.each(["write", "fsync", "close", "rename"] as const)(
			`does not publish ${operation} entries or mutate held references when %s fails`,
			(stage) => {
				const f = fixture();
				const file = f.session.getSessionFile()!;
				const bytes = fs.readFileSync(file);
				const held = f.session.getEntries();
				const snapshots = structuredClone(held);
				const leaf = f.session.getLeafId();
				const tree = structuredClone(f.session.getTree());
				const projection = structuredClone(f.session.buildSessionProjection());
				const totals = getUsageTotals(held);
				const failure = new Error(`${operation} ${stage} failure`);
				const assertUnpublished = () => {
					expect(f.session.getLeafId()).toBe(leaf);
					expect(f.session.getEntries()).toEqual(snapshots);
					expect(f.session.getTree()).toEqual(tree);
					expect(f.session.buildSessionProjection()).toEqual(projection);
					expect(f.session.getLabel(f.prefill)).toBe("prefill bookmark");
					expect(held).toEqual(snapshots);
					for (const entry of held) expect(f.session.getEntry(entry.id)).toBe(entry);
				};
				const fail = () => {
					assertUnpublished();
					throw failure;
				};
				if (stage === "write") vi.mocked(fs.writeFileSync).mockImplementationOnce(fail);
				else if (stage === "fsync") vi.mocked(fs.fsyncSync).mockImplementationOnce(fail);
				else if (stage === "close") vi.mocked(fs.closeSync).mockImplementationOnce(fail);
				else vi.mocked(fs.renameSync).mockImplementationOnce(fail);
				const apply = () =>
					operation === "replace"
						? f.session.replaceAssistantContinuation(f.prefill, response("continued", 13))
						: f.session.restoreAssistantPrefill(f.user, response("effective partial", 3), f.prefill, f.tail);
				expect(apply).toThrow(failure);
				assertUnpublished();
				expect(fs.readFileSync(file)).toEqual(bytes);
				expect(fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
				expect(SessionManager.open(file, dir, dir).getEntries()).toEqual(snapshots);
				expect(getUsageTotals(f.session.getEntries())).toEqual(totals);
				const id = apply();
				expect(f.session.getBranch().some((entry) => entry.id === id)).toBe(true);
				const selectedLeaf = f.session.getLeafId();
				const next = f.session.appendMessage(response("next provider response", 17));
				expect(messageEntry(f.session, next)).toMatchObject({ parentId: selectedLeaf });
				expect(messageEntry(f.session, next).usageSourceId).toBeUndefined();
				const reopened = SessionManager.open(file, dir, dir);
				expect(reopened.getEntries()).toEqual(f.session.getEntries());
				expect(reopened.getLeafId()).toBe(next);
				expect(getUsageTotals(reopened.getEntries()).output).toBe(
					totals.output + 17 + (operation === "replace" ? 13 : 0),
				);
			},
		);
	}
});
