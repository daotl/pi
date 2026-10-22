import * as fs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serializeSessionBranch } from "../../src/core/session-export.ts";
import { loadEntriesFromFile, parseSessionEntries, SessionManager } from "../../src/core/session-manager.ts";

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

let dir: string;
beforeEach(async () => {
	const actual = await vi.importActual<typeof fs>("fs");
	vi.mocked(fs.writeFileSync).mockReset().mockImplementation(actual.writeFileSync);
	vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
	vi.mocked(fs.closeSync).mockReset().mockImplementation(actual.closeSync);
	vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync);
	dir = mkdtempSync(join(tmpdir(), "pi-selected-leaf-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const user = (content: string) => ({ role: "user" as const, content, timestamp: 1 });

it.each(["remove", "subtree", "last"] as const)(
	"reopens an empty selected root after %s while retaining abandoned roots",
	(operation) => {
		const session = SessionManager.create(dir, dir);
		const original = session.appendMessage(user("original root"));
		session.replaceMessages([{ entryId: original, message: user("edited root") }]);
		const selected = session.getLeafId()!;
		if (operation === "remove") expect(session.removeMessage(selected)).toBe(true);
		else if (operation === "subtree") expect(session.removeEntriesWithDescendants([selected])).toBe(1);
		else expect(session.removeLastMessages(1)).toBe(1);
		expect(session.getLeafId()).toBeNull();
		expect(session.getEntry(original)).toBeDefined();
		const reopened = SessionManager.open(session.getSessionFile()!, dir, dir);
		expect(reopened.getLeafId()).toBeNull();
		expect(reopened.buildSessionContext().messages).toEqual([]);
		const next = reopened.appendMessage(user("new root"));
		expect(reopened.getEntry(next)?.parentId).toBeNull();
		expect(SessionManager.open(reopened.getSessionFile()!, dir, dir).buildSessionContext().messages).toEqual([
			user("new root"),
		]);
	},
);

it.each(["subtree", "last"] as const)(
	"reopens the selected ancestor after %s without selecting a retained later sibling",
	(operation) => {
		const session = SessionManager.create(dir, dir);
		const root = session.appendMessage(user("selected root"));
		const removed = session.appendMessage(user("removed tail"));
		session.branch(root);
		const sibling = session.appendMessage(user("retained sibling"));
		session.branch(removed);
		if (operation === "subtree") expect(session.removeEntriesWithDescendants([removed])).toBe(1);
		else expect(session.removeLastMessages(1)).toBe(1);
		expect(session.buildSessionContext().messages).toEqual([user("selected root")]);
		const reopened = SessionManager.open(session.getSessionFile()!, dir, dir);
		expect(reopened.buildSessionContext().messages).toEqual([user("selected root")]);
		expect(reopened.getEntry(sibling)).toBeDefined();
	},
);

it.each(["empty", "ancestor"] as const)(
	"keeps %s selection bookkeeping private while raw fork/import preserve it",
	(selection) => {
		const session = SessionManager.create(dir, dir);
		const root = session.appendMessage(user("root"));
		const removed = session.appendMessage(user("removed"));
		session.branch(root);
		const sibling = session.appendMessage(user("sibling"));
		session.branch(removed);
		session.removeEntriesWithDescendants(selection === "empty" ? [root] : [removed]);
		if (selection === "empty") {
			// Create a retained independent root without changing the selected empty result.
			const next = session.appendMessage(user("independent root"));
			session.replaceMessages([{ entryId: next, message: user("selected root") }]);
			session.removeMessage(session.getLeafId()!);
		}
		const expected = session.buildSessionContext();
		const file = session.getSessionFile()!;
		const raw = readFileSync(file, "utf8");
		expect(loadEntriesFromFile(file)).toEqual([session.getHeader(), ...session.getEntries()]);
		expect(parseSessionEntries(raw)).toEqual([session.getHeader(), ...session.getEntries()]);
		expect(session.getEntryCount()).toBe(session.getEntries().length);
		expect(session.getTree().flatMap((node) => [node.entry])).not.toContainEqual(
			expect.objectContaining({ type: "leaf" }),
		);
		const exported = serializeSessionBranch(session);
		expect(exported).not.toContain('"type":"leaf"');
		const imported = join(dir, "imported.jsonl");
		writeFileSync(imported, raw);
		expect(SessionManager.open(imported, dir, dir).buildSessionContext()).toEqual(expected);
		const fork = SessionManager.forkFrom(file, dir, join(dir, "fork"));
		expect(fork.buildSessionContext()).toEqual(expected);
		if (selection === "ancestor") {
			expect(fork.getLeafId()).toBe(root);
			expect(fork.getEntry(sibling)).toEqual(session.getEntry(sibling));
			session.softDeleteUnits([{ entryId: sibling }]);
			expect(SessionManager.open(file, dir, dir).getLeafId()).toBe(root);
			session.restoreDeletedEntryIds([sibling]);
			expect(SessionManager.open(file, dir, dir).getLeafId()).toBe(root);
		}
	},
);

it.each(
	(["empty", "ancestor"] as const).flatMap((selection) =>
		(["write", "fsync", "close", "rename"] as const).map((stage) => ({ selection, stage })),
	),
)("publishes no changed selection or history while $selection checkpoint fails at $stage", ({ selection, stage }) => {
	const session = SessionManager.create(dir, dir);
	const root = session.appendMessage(user("root"));
	const removed = session.appendMessage(user("selected tail"));
	session.appendLabelChange(removed, "bookmark");
	session.branch(root);
	session.appendMessage(user("retained sibling"));
	session.branch(removed);
	const file = session.getSessionFile()!;
	const bytes = readFileSync(file);
	const held = session.getEntries();
	const snapshot = structuredClone(held);
	const selected = session.getLeafId();
	const tree = structuredClone(session.getTree());
	const projection = structuredClone(session.buildSessionProjection());
	const failure = new Error(`injected ${stage}`);
	const unchanged = () => {
		expect(session.getLeafId()).toBe(selected);
		expect(session.getEntries()).toEqual(snapshot);
		expect(session.getTree()).toEqual(tree);
		expect(session.buildSessionProjection()).toEqual(projection);
		for (const entry of held) expect(session.getEntry(entry.id)).toBe(entry);
	};
	const fail = () => {
		unchanged();
		throw failure;
	};
	if (stage === "write") vi.mocked(fs.writeFileSync).mockImplementationOnce(fail);
	else if (stage === "fsync") vi.mocked(fs.fsyncSync).mockImplementationOnce(fail);
	else if (stage === "close") vi.mocked(fs.closeSync).mockImplementationOnce(fail);
	else vi.mocked(fs.renameSync).mockImplementationOnce(fail);
	const remove = () =>
		selection === "empty" ? session.removeLastMessages(2) : session.removeEntriesWithDescendants([removed]);
	expect(remove).toThrow(failure);
	unchanged();
	expect(readFileSync(file)).toEqual(bytes);
	remove();
	const reopened = SessionManager.open(file, dir, dir);
	expect(reopened.getLeafId()).toBe(session.getLeafId());
	expect(reopened.buildSessionContext()).toEqual(session.buildSessionContext());
});

it.each([undefined, 7, {}, "missing-entry"])(
	"ignores malformed or stale selection marker %j instead of hiding retained history",
	(leafId) => {
		const session = SessionManager.create(dir, dir);
		const selected = session.appendMessage(user("retained history"));
		const file = session.getSessionFile()!;
		fs.appendFileSync(file, `${JSON.stringify({ type: "leaf", leafId })}\n`);
		const reopened = SessionManager.open(file, dir, dir);
		expect(reopened.getLeafId()).toBe(selected);
		expect(reopened.buildSessionContext().messages).toEqual([user("retained history")]);
	},
);
