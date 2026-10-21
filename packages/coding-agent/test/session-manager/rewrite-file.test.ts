import * as fs from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return {
		...actual,
		appendFileSync: vi.fn(actual.appendFileSync),
		openSync: vi.fn(actual.openSync),
		writeFileSync: vi.fn(actual.writeFileSync),
		fsyncSync: vi.fn(actual.fsyncSync),
		closeSync: vi.fn(actual.closeSync),
		renameSync: vi.fn(actual.renameSync),
	};
});

describe("atomic session file rewrite", () => {
	let dir: string;

	beforeEach(async () => {
		const actual = await vi.importActual<typeof fs>("fs");
		vi.mocked(fs.openSync).mockReset().mockImplementation(actual.openSync);
		vi.mocked(fs.appendFileSync).mockReset().mockImplementation(actual.appendFileSync);
		vi.mocked(fs.writeFileSync).mockReset().mockImplementation(actual.writeFileSync);
		vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
		vi.mocked(fs.closeSync).mockReset().mockImplementation(actual.closeSync);
		vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync);
		dir = fs.mkdtempSync(join(tmpdir(), "session-rewrite-"));
	});

	afterEach(() => {
		vi.clearAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	function createSession() {
		const session = SessionManager.create(dir, dir);
		const user = session.appendMessage(userMsg("keep the previous conversation"));
		session.appendMessage(assistantMsg("previous answer"));
		const file = session.getSessionFile()!;
		return { session, user, file };
	}

	it.each(["initial", "flushed"] as const)("does not publish a failed %s append", (mode) => {
		const session = SessionManager.create(dir, dir);
		session.appendSystemPrompt("original");
		if (mode === "flushed") session.appendMessage(userMsg("existing"));
		const file = session.getSessionFile()!;
		const entries = structuredClone(session.getEntries());
		const projection = structuredClone(session.buildSessionProjection());
		const leaf = session.getLeafId();
		const bytes = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
		const failure = new Error("append publication failure");
		if (mode === "initial")
			vi.mocked(fs.openSync).mockImplementationOnce(() => {
				throw failure;
			});
		else
			vi.mocked(fs.appendFileSync).mockImplementationOnce(() => {
				throw failure;
			});
		const append = () =>
			mode === "initial" ? session.appendMessage(userMsg("accepted")) : session.appendSystemPrompt("accepted");
		expect(append).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(session.getLeafId()).toBe(leaf);
		expect(session.getSavedSystemPrompt()?.systemPrompt).toBe("original");
		if (bytes) expect(fs.readFileSync(file)).toEqual(bytes);
		else expect(fs.existsSync(file)).toBe(false);
		const id = append();
		expect(session.getLeafId()).toBe(id);
		expect(SessionManager.open(file, dir, dir).getEntries()).toEqual(session.getEntries());
	});

	it("restores removed descendants, labels and a non-tail selected leaf after failed tail removal", () => {
		const { session, user, file } = createSession();
		const firstAnswer = session.getLeafId()!;
		session.appendLabelChange(firstAnswer, "first branch");
		session.branch(user);
		const selected = session.appendMessage(assistantMsg("selected answer"));
		session.appendLabelChange(selected, "selected branch");
		session.branch(selected);
		const heldSelected = session.getEntry(selected);
		const entries = structuredClone(session.getEntries());
		const tree = structuredClone(session.getTree());
		const projection = structuredClone(session.buildSessionProjection());
		const bytes = fs.readFileSync(file);
		const failure = new Error("tail removal rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => session.removeLastMessages(2)).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.getTree()).toEqual(tree);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(session.getLeafId()).toBe(selected);
		expect(session.getEntry(selected)).toBe(heldSelected);
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(SessionManager.open(file, dir, dir).getEntries()).toEqual(entries);
		expect(session.removeLastMessages(2)).toBe(2);
		expect(session.getEntries()).toEqual([]);
		expect(SessionManager.open(file, dir, dir).getEntries()).toEqual([]);
	});

	it("restores a selected subtree and labels after failed descendant removal", () => {
		const { session, user, file } = createSession();
		const removed = session.getLeafId()!;
		session.appendLabelChange(removed, "removed subtree");
		session.branch(user);
		const sibling = session.appendMessage(assistantMsg("sibling"));
		session.branch(removed);
		const held = session.getEntry(removed);
		const entries = structuredClone(session.getEntries());
		const tree = structuredClone(session.getTree());
		const projection = structuredClone(session.buildSessionProjection());
		const bytes = fs.readFileSync(file);
		const failure = new Error("subtree rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => session.removeEntriesWithDescendants([removed])).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.getTree()).toEqual(tree);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(session.getLeafId()).toBe(removed);
		expect(session.getEntry(removed)).toBe(held);
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(session.removeEntriesWithDescendants([removed])).toBe(2);
		expect(session.getLeafId()).toBe(user);
		expect(session.getEntry(removed)).toBeUndefined();
		expect(session.getEntry(sibling)).toBeDefined();
		expect(SessionManager.open(file, dir, dir).getEntries()).toEqual(session.getEntries());
	});

	it("restores cloned aliases and retained metadata after failed selected removal", () => {
		const { session, user, file } = createSession();
		const held = session.getLeafEntry()!;
		session.appendCompaction("summary", held.id, 100);
		session.appendLabelChange(held.id, "bookmark");
		const entries = structuredClone(session.getEntries());
		const projection = structuredClone(session.buildSessionProjection());
		const tree = structuredClone(session.getTree());
		const leaf = session.getLeafId();
		const bytes = fs.readFileSync(file);
		const failure = new Error("selected removal rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => session.removeEntries([user])).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(session.getTree()).toEqual(tree);
		expect(session.getLeafId()).toBe(leaf);
		expect(session.getEntry(held.id)).toBe(held);
		expect(held.supersededBy).toBeUndefined();
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(session.removeEntries([user])).toBe(1);
		expect(session.getBranch().some((entry) => entry.id === user)).toBe(false);
		expect(SessionManager.open(file, dir, dir).getEntries()).toEqual(session.getEntries());
	});

	it.each(["replace", "remove"] as const)("keeps old branch references while remapping the %s clone", (operation) => {
		const { session, user, file } = createSession();
		const assistant = session.getLeafId()!;
		const compaction = session.appendCompaction("old summary", assistant, 100);
		const edit = session.appendContextEdit(assistant, { content: "projected answer" });
		const label = session.appendLabelChange(assistant, "original label");
		session.branch(assistant);
		const sibling = session.appendCompaction("sibling summary", assistant, 100);
		session.branch(label);
		const oldProjection = structuredClone(session.buildSessionProjection().messages);
		if (operation === "replace") session.replaceMessages([{ entryId: user, message: userMsg("edited user") }]);
		else expect(session.removeEntries([user])).toBe(1);
		const branch = session.getBranch();
		const clone = branch.find((entry) => entry.type === "message" && entry.message.role === "assistant")!;
		expect(clone.id).not.toBe(assistant);
		expect(branch.find((entry) => entry.type === "compaction")).toMatchObject({ firstKeptEntryId: clone.id });
		expect(branch.find((entry) => entry.type === "context_edit")).toMatchObject({ targetId: clone.id });
		expect(branch.find((entry) => entry.type === "label")).toMatchObject({ targetId: clone.id });
		expect(session.buildSessionProjection().messages).toContainEqual(
			expect.objectContaining({
				role: "assistant",
				content: [{ type: "text", text: "projected answer" }],
			}),
		);
		expect(session.getEntry(compaction)).toMatchObject({ firstKeptEntryId: assistant });
		expect(session.getEntry(sibling)).toMatchObject({ firstKeptEntryId: assistant });
		expect(session.getEntry(edit)).toMatchObject({ targetId: assistant });
		expect(session.getEntry(label)).toMatchObject({ targetId: assistant });
		const reopened = SessionManager.open(file, dir, dir);
		reopened.branch(label);
		expect(reopened.buildSessionProjection().messages).toEqual(oldProjection);
	});

	it("preserves held tool content and deletion map when partial shred fails", () => {
		const { session, file } = createSession();
		const held = session.getLeafEntry();
		if (!held || held.type !== "message" || held.message.role !== "assistant") throw new Error("Missing assistant");
		held.message = {
			...held.message,
			content: [
				{ type: "text", text: "keep" },
				{ type: "toolCall", id: "one", name: "read", arguments: {} },
				{ type: "toolCall", id: "two", name: "read", arguments: {} },
			],
		};
		session.softDeleteUnits([{ entryId: held.id, toolCallId: "one" }]);
		const message = held.message;
		const content = message.content;
		const deletionMap = held.deletedToolCalls;
		const entries = structuredClone(session.getEntries());
		const projection = structuredClone(session.buildSessionProjection());
		const bytes = fs.readFileSync(file);
		const remove = () => session.removeEntries([], new Map([[held.id, new Set(["one"])]]));
		const failure = new Error("partial shred rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		expect(remove).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(session.getLeafId()).toBe(held.id);
		expect(session.getEntry(held.id)).toBe(held);
		expect(held.message).toBe(message);
		expect(held.message.content).toBe(content);
		expect(held.deletedToolCalls).toBe(deletionMap);
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(remove()).toBe(1);
		const selected = session.getLeafEntry();
		expect(selected).toMatchObject({
			type: "message",
			message: {
				content: [
					{ type: "text", text: "keep" },
					{ type: "toolCall", id: "two", name: "read", arguments: {} },
				],
			},
		});
		if (!selected || selected.type !== "message") throw new Error("Missing selected assistant");
		expect(selected.deletedToolCalls).toBeUndefined();
		expect(SessionManager.open(file, dir, dir).getEntries()).toEqual(session.getEntries());
	});

	it("restores live soft-deletion flags and held tool maps when persistence fails", () => {
		const { session, user, file } = createSession();
		const assistant = session.getLeafEntry();
		if (!assistant || assistant.type !== "message" || assistant.message.role !== "assistant")
			throw new Error("Missing assistant");
		assistant.message = {
			...assistant.message,
			content: [
				{ type: "toolCall", id: "one", name: "read", arguments: {} },
				{ type: "toolCall", id: "two", name: "read", arguments: {} },
			],
		};
		session.softDeleteUnits([{ entryId: assistant.id, toolCallId: "one" }]);
		const heldMap = assistant.deletedToolCalls;
		const previousMap = { ...heldMap };
		const entries = structuredClone(session.getEntries());
		const projection = structuredClone(session.buildSessionProjection());
		const bytes = fs.readFileSync(file);
		const failure = new Error("soft-delete rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => session.softDeleteUnits([{ entryId: assistant.id, toolCallId: "two" }, { entryId: user }])).toThrow(
			failure,
		);
		expect(session.getEntries()).toEqual(entries);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(assistant.deletedToolCalls).toBe(heldMap);
		expect(heldMap).toEqual(previousMap);
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(SessionManager.open(file, dir, dir).buildSessionProjection()).toEqual(projection);
		expect(session.softDeleteUnits([{ entryId: assistant.id, toolCallId: "two" }, { entryId: user }])).toBe(2);
	});

	it.each(["latest", "selected"] as const)("keeps deletion state after failed %s restore", (mode) => {
		const { session, user, file } = createSession();
		const assistant = session.getLeafEntry();
		if (!assistant || assistant.type !== "message" || assistant.message.role !== "assistant")
			throw new Error("Missing assistant");
		assistant.message = {
			...assistant.message,
			content: [{ type: "toolCall", id: "one", name: "read", arguments: {} }],
		};
		session.softDeleteUnits([{ entryId: assistant.id, toolCallId: "one" }, { entryId: user }]);
		const heldMap = assistant.deletedToolCalls;
		const entries = structuredClone(session.getEntries());
		const projection = structuredClone(session.buildSessionProjection());
		const bytes = fs.readFileSync(file);
		const failure = new Error("restore rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		const restore = () =>
			mode === "latest" ? session.restoreDeletedUnits(2) : session.restoreDeletedEntryIds([user]);
		expect(restore).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(assistant.deletedToolCalls).toBe(heldMap);
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(SessionManager.open(file, dir, dir).buildSessionProjection()).toEqual(projection);
		restore();
		expect(session.getEntry(user)?.deletedAt).toBeUndefined();
	});

	it("keeps selected tail, source aliases and references unchanged after failed replacement", () => {
		const { session, user, file } = createSession();
		const assistant = session.getLeafEntry();
		if (!assistant) throw new Error("Missing assistant");
		session.appendCompaction("summary", assistant.id, 100);
		session.appendLabelChange(assistant.id, "bookmark");
		const entries = structuredClone(session.getEntries());
		const projection = structuredClone(session.buildSessionProjection());
		const tree = structuredClone(session.getTree());
		const leaf = session.getLeafId();
		const bytes = fs.readFileSync(file);
		const failure = new Error("replacement rename failure");
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw failure;
		});
		expect(() => session.replaceMessages([{ entryId: user, message: userMsg("edited") }])).toThrow(failure);
		expect(session.getEntries()).toEqual(entries);
		expect(session.buildSessionProjection()).toEqual(projection);
		expect(session.getTree()).toEqual(tree);
		expect(session.getLeafId()).toBe(leaf);
		expect(assistant.supersededBy).toBeUndefined();
		expect(fs.readFileSync(file)).toEqual(bytes);
		session.replaceMessages([{ entryId: user, message: userMsg("edited") }]);
		expect(
			session.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user"),
		).toMatchObject({ message: { content: "edited" } });
	});

	it.each(["write", "fsync", "close", "rename"] as const)(
		"preserves previous disk bytes and reopen behavior when %s fails",
		async (stage) => {
			const { session, user, file } = createSession();
			const previous = fs.readFileSync(file);
			const previousContext = SessionManager.open(file, dir, dir).buildSessionContext();
			const files = fs.readdirSync(dir).sort();
			const failure = new Error(`rewrite ${stage} failure`);
			const actual = await vi.importActual<typeof fs>("fs");
			if (stage === "write") {
				vi.mocked(fs.writeFileSync).mockImplementationOnce((...args) => {
					actual.writeFileSync(...args);
					throw failure;
				});
			} else if (stage === "fsync") {
				vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
					throw failure;
				});
			} else if (stage === "close") {
				vi.mocked(fs.closeSync).mockImplementationOnce(() => {
					throw failure;
				});
			} else {
				vi.mocked(fs.renameSync).mockImplementationOnce(() => {
					throw failure;
				});
			}

			expect(() => session.softDeleteUnits([{ entryId: user }])).toThrow(failure);
			expect(fs.readFileSync(file)).toEqual(previous);
			expect(fs.readdirSync(dir).sort()).toEqual(files);
			const reopened = SessionManager.open(file, dir, dir);
			expect(reopened.buildSessionContext()).toEqual(previousContext);
			expect(reopened.getEntry(user)?.deletedAt).toBeUndefined();
		},
	);

	it("publishes a complete rewrite and preserves the existing file mode", () => {
		const { session, user, file } = createSession();
		fs.chmodSync(file, 0o640);
		const previous = fs.readFileSync(file);
		expect(session.softDeleteUnits([{ entryId: user }])).toBe(1);
		expect(fs.readFileSync(file)).not.toEqual(previous);
		expect(fs.statSync(file).mode & 0o7777).toBe(0o640);
		const reopened = SessionManager.open(file, dir, dir);
		expect(reopened.getEntry(user)?.deletedAt).toBeDefined();
		expect(reopened.buildSessionContext().messages).toEqual(
			session.buildSessionContext().messages.filter((message) => message.role === "assistant"),
		);
		expect(fs.readdirSync(dir)).toEqual([file.slice(dir.length + 1)]);
	});

	it("rewrites a symbolic link target without splitting the session file", () => {
		const { user, file } = createSession();
		const alias = join(dir, "session-link.jsonl");
		fs.symlinkSync(file, alias);
		const session = SessionManager.open(alias, dir, dir);
		session.softDeleteUnits([{ entryId: user }]);
		expect(fs.lstatSync(alias).isSymbolicLink()).toBe(true);
		expect(SessionManager.open(file, dir, dir).getEntry(user)?.deletedAt).toBeDefined();
		const next = session.appendMessage(userMsg("continued through alias"));
		expect(SessionManager.open(file, dir, dir).getLeafId()).toBe(next);
		expect(fs.readFileSync(alias)).toEqual(fs.readFileSync(file));
	});

	it("does not overwrite or clean up a foreign file when exclusive temporary open fails", async () => {
		const { session, user, file } = createSession();
		const previous = fs.readFileSync(file);
		const actual = await vi.importActual<typeof fs>("fs");
		let foreignFile: string | undefined;
		vi.mocked(fs.openSync).mockImplementationOnce((path, flags, mode) => {
			if (flags === "wx") {
				foreignFile = String(path);
				actual.writeFileSync(path, "foreign temporary data");
				return actual.openSync(path, flags, mode);
			}
			return actual.openSync(path, flags, mode);
		});
		expect(() => session.softDeleteUnits([{ entryId: user }])).toThrow();
		expect(foreignFile).toBeDefined();
		expect(fs.readFileSync(foreignFile!, "utf8")).toBe("foreign temporary data");
		expect(fs.readFileSync(file)).toEqual(previous);
		expect(SessionManager.open(file, dir, dir).getEntry(user)?.deletedAt).toBeUndefined();
	});
});
