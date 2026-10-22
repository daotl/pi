import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageTotals } from "../../src/core/usage-totals.ts";
import { createHarness, getMessageText } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return {
		...actual,
		writeFileSync: vi.fn(actual.writeFileSync),
		fsyncSync: vi.fn(actual.fsyncSync),
		closeSync: vi.fn(actual.closeSync),
		renameSync: vi.fn(actual.renameSync),
		appendFileSync: vi.fn(actual.appendFileSync),
	};
});
beforeEach(async () => {
	const actual = await vi.importActual<typeof fs>("fs");
	vi.mocked(fs.writeFileSync).mockReset().mockImplementation(actual.writeFileSync);
	vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
	vi.mocked(fs.closeSync).mockReset().mockImplementation(actual.closeSync);
	vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync);
	vi.mocked(fs.appendFileSync).mockReset().mockImplementation(actual.appendFileSync);
});
afterEach(() => vi.useRealTimers());

it.each(
	(["replacement-add", "version-add"] as const).flatMap((batch) =>
		(["write", "fsync", "close", "rename"] as const).map((stage) => ({ batch, stage })),
	),
)("publishes no partial $batch batch while the atomic $stage fails", async ({ batch, stage }) => {
	const cwd = fs.mkdtempSync(join(tmpdir(), "pi-mixed-edit-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		harness.setResponses([fauxAssistantMessage("original answer")]);
		await harness.session.prompt("original question");
		const held = manager.getEntries();
		const entries = structuredClone(held);
		const leaf = manager.getLeafId();
		const messages = structuredClone(harness.session.messages);
		const tree = structuredClone(manager.getTree());
		const file = manager.getSessionFile()!;
		const bytes = fs.readFileSync(file);
		const unchanged = () => {
			expect(manager.getEntries()).toEqual(entries);
			expect(manager.getLeafId()).toBe(leaf);
			expect(manager.getTree()).toEqual(tree);
			expect(harness.session.messages).toEqual(messages);
			for (const entry of held) expect(manager.getEntry(entry.id)).toBe(entry);
		};
		const failure = new Error(`injected atomic ${stage} failure`);
		const fail = () => {
			unchanged();
			throw failure;
		};
		if (stage === "write") vi.mocked(fs.writeFileSync).mockImplementationOnce(fail);
		else if (stage === "fsync") vi.mocked(fs.fsyncSync).mockImplementationOnce(fail);
		else if (stage === "close") vi.mocked(fs.closeSync).mockImplementationOnce(fail);
		else vi.mocked(fs.renameSync).mockImplementationOnce(fail);
		const firstEdit =
			batch === "replacement-add"
				? '<pi_edit id="1" role="user">changed question</pi_edit>'
				: '<pi_edit id="0" role="assistant"><pi_content>new version</pi_content></pi_edit>';
		const edit = `${firstEdit}<pi_edit id="-1" role="user">added input</pi_edit>`;
		expect(() => harness.session.applyMessageEdits(edit)).toThrow(failure);
		unchanged();
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(SessionManager.open(file).getEntries()).toEqual(entries);
		const result = harness.session.applyMessageEdits(edit);
		expect(result).toEqual({
			edited: batch === "replacement-add" ? 1 : 0,
			added: 1,
			versioned: batch === "version-add" ? 1 : 0,
			swiped: 0,
		});
		expect(harness.session.messages.filter((message) => message.role !== "system").map(getMessageText)).toEqual(
			batch === "replacement-add"
				? ["changed question", "original answer", "added input"]
				: ["original question", "new version", "added input"],
		);
		expect(SessionManager.open(file).buildSessionContext().messages).toEqual(harness.session.messages);
	} finally {
		await harness.session.abort();
		harness.cleanup();
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

it("keeps all earlier edit/version/add operations unpublished when a later swipe timestamp is stale", async () => {
	const cwd = fs.mkdtempSync(join(tmpdir(), "pi-stale-mixed-edit-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({ cwd, sessionManager: manager });
	try {
		harness.setResponses([fauxAssistantMessage("original answer")]);
		await harness.session.prompt("original question");
		const entries = structuredClone(manager.getEntries());
		const leaf = manager.getLeafId();
		const messages = structuredClone(harness.session.messages);
		const file = manager.getSessionFile()!;
		const bytes = fs.readFileSync(file);
		const input =
			'<pi_edit id="1" role="user">changed question</pi_edit><pi_edit id="0" role="assistant"><pi_content>new version</pi_content></pi_edit><pi_edit id="-1" role="user">added input</pi_edit><pi_swipe timestamp="1999-01-01T00:00:00.000Z" role="assistant"><pi_content>stale</pi_content></pi_swipe>';
		expect(() => harness.session.applyMessageEdits(input)).toThrow();
		expect(manager.getEntries()).toEqual(entries);
		expect(manager.getLeafId()).toBe(leaf);
		expect(harness.session.messages).toEqual(messages);
		expect(fs.readFileSync(file)).toEqual(bytes);
		expect(SessionManager.open(file).getEntries()).toEqual(entries);
	} finally {
		await harness.session.abort();
		harness.cleanup();
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

it("commits all swipe edits together while retaining version positions and historical charge identities", async () => {
	const cwd = fs.mkdtempSync(join(tmpdir(), "pi-swipe-batch-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-22T12:00:00Z") });
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
		await harness.session.prompt("question");
		vi.setSystemTime(new Date("2026-10-22T12:00:01Z"));
		await harness.session.regenerateSwipe(harness.session.getSwipeGroup()!);
		const versions = harness.session.getSwipeGroup()!.versions;
		const before = getUsageTotals(manager.getEntries());
		const firstId = versions[0].id;
		const secondId = versions[1].id;
		const firstStamp = versions[0].timestamp;
		const secondStamp = versions[1].timestamp;
		const xml = `<pi_swipe timestamp="${firstStamp}" role="assistant"><pi_content>edited first</pi_content></pi_swipe><pi_swipe timestamp="${secondStamp}" role="assistant"><pi_content>edited second</pi_content></pi_swipe>`;
		expect(harness.session.applyMessageEdits(xml)).toEqual({ edited: 0, added: 0, versioned: 0, swiped: 2 });
		const current = harness.session.getSwipeGroup()!;
		expect(current.versions.map((entry) => getMessageText(entry.message))).toEqual(["edited first", "edited second"]);
		expect(current.versions.map((entry) => entry.timestamp)).toEqual([firstStamp, secondStamp]);
		expect(current.currentIndex).toBe(1);
		expect(getUsageTotals(manager.getEntries())).toEqual(before);
		expect(manager.getEntry(firstId)).toMatchObject({
			message: expect.objectContaining({ content: [{ type: "text", text: "first" }] }),
		});
		expect(manager.getEntry(secondId)).toMatchObject({
			message: expect.objectContaining({ content: [{ type: "text", text: "second" }] }),
		});
		expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
			harness.session.messages,
		);
	} finally {
		await harness.session.abort();
		harness.cleanup();
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});

it("restores the committed non-current swipe branch's tools, not the abandoned runtime loadout", async () => {
	const cwd = fs.mkdtempSync(join(tmpdir(), "pi-edit-branch-loadout-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-22T13:00:00Z") });
		harness.session.setActiveToolsByName(["read"]);
		harness.setResponses([fauxAssistantMessage("read branch"), fauxAssistantMessage("bash followup")]);
		await harness.session.prompt("question");
		const originalGroup = harness.session.getSwipeGroup()!;
		const first = originalGroup.versions[0];
		vi.setSystemTime(new Date("2026-10-22T13:00:01Z"));
		harness.session.setActiveToolsByName(["bash"]);
		await harness.session.prompt("follow-up");
		vi.setSystemTime(new Date("2026-10-22T13:00:02Z"));
		// Construct the retained sibling directly so the edit selects the original version's subtree.
		manager.branch(originalGroup.anchorEntryId);
		manager.appendMessage(fauxAssistantMessage("read alternative"));
		harness.session.refreshContext();
		harness.session.setActiveToolsByName(["read"]);
		expect(harness.session.getActiveToolNames()).toEqual(["read"]);
		vi.mocked(fs.appendFileSync).mockImplementation(() => {
			throw new Error("Unexpected append after atomic edit publication");
		});
		harness.session.applyMessageEdits(
			`<pi_swipe timestamp="${first.timestamp}" role="assistant"><pi_content>edited read branch</pi_content></pi_swipe>`,
		);
		expect(harness.session.getActiveToolNames()).toEqual(["bash"]);
		expect(harness.session.messages.filter((message) => message.role !== "system").map(getMessageText)).toEqual([
			"question",
			"edited read branch",
			"follow-up",
			"bash followup",
		]);
		expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
			harness.session.messages,
		);
	} finally {
		const actual = await vi.importActual<typeof fs>("fs");
		vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
		await harness.session.abort();
		harness.cleanup();
		fs.rmSync(cwd, { recursive: true, force: true });
	}
});
