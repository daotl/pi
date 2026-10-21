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
