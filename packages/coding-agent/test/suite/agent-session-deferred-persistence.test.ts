import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import * as fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, appendFileSync: vi.fn(actual.appendFileSync) };
});

describe("deferred output persistence settlement", () => {
	const harnesses: Harness[] = [];
	const directories: string[] = [];
	beforeEach(async () => {
		const actual = await vi.importActual<typeof fs>("fs");
		vi.mocked(fs.appendFileSync).mockReset().mockImplementation(actual.appendFileSync);
	});
	afterEach(() => {
		while (harnesses.length) harnesses.pop()?.cleanup();
		for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it.each((["prompt", "continue"] as const).flatMap((run) => ["bash", "custom"].map((record) => ({ run, record }))))(
		"releases $run ownership after deferred $record write failure without losing or duplicating records",
		async ({ run, record }) => {
			const cwd = fs.mkdtempSync(join(tmpdir(), "pi-deferred-persistence-"));
			directories.push(cwd);
			const manager = SessionManager.create(cwd, join(cwd, "sessions"));
			const harness = await createHarness({
				cwd,
				sessionManager: manager,
				settings: {
					compaction: { enabled: false },
					retry: { enabled: false },
				},
			});
			harnesses.push(harness);
			harness.setResponses([fauxAssistantMessage("initial answer")]);
			await harness.session.prompt("initial request");
			if (run === "continue") {
				manager.appendMessage({ role: "user", content: "pending continuation", timestamp: Date.now() });
				harness.session.refreshContext();
			}
			let queued = false;
			const unsubscribe = harness.session.subscribe((event) => {
				if (event.type !== "agent_end" || queued) return;
				queued = true;
				for (const content of ["deferred first", "deferred second", "deferred third"]) {
					if (record === "bash")
						harness.session.recordBashResult(content, {
							output: content,
							exitCode: 0,
							cancelled: false,
							truncated: false,
						});
					else
						void harness.session.sendCustomMessage(
							{ customType: "deferred", content, display: false },
							{ triggerTurn: false },
						);
				}
			});
			const started = Promise.withResolvers<void>();
			const stream = createAssistantMessageEventStream();
			harness.session.agent.streamFunction = () => {
				started.resolve();
				return stream;
			};
			const actual = await vi.importActual<typeof fs>("fs");
			const failure = new Error("controlled deferred write failure");
			let failed = false;
			vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
				if (!failed && typeof args[1] === "string" && args[1].includes("deferred second")) {
					failed = true;
					throw failure;
				}
				return actual.appendFileSync(...args);
			});
			const running = run === "prompt" ? harness.session.prompt("second request") : harness.session.continue();
			const outcome = running.then(
				() => undefined,
				(error) => error,
			);
			try {
				await started.promise;
				let idleResolved = false;
				const idle = harness.session.waitForIdle().then(() => {
					idleResolved = true;
				});
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("completed answer") });
				expect(await outcome).toBe(failure);
				expect(harness.session.isIdle).toBe(true);
				await idle;
				expect(idleResolved).toBe(true);
				expect(harness.session.getLastAssistantText()).toBe("completed answer");
				harness.session.agent.streamFunction = streamSimple;
				harness.setResponses([fauxAssistantMessage("later prompt works")]);
				await harness.session.prompt("retry deferred output");
				expect(harness.session.getLastAssistantText()).toBe("later prompt works");
				const reopened = SessionManager.open(manager.getSessionFile()!);
				const records = reopened
					.getBranch()
					.flatMap((entry) =>
						record === "bash"
							? entry.type === "message" && entry.message.role === "bashExecution"
								? [entry.message.command]
								: []
							: entry.type === "custom_message" && entry.customType === "deferred"
								? [getMessageText(entry)]
								: [],
					);
				expect(records).toEqual(["deferred first", "deferred second", "deferred third"]);
			} finally {
				unsubscribe();
				stream.end(fauxAssistantMessage("completed answer"));
				await outcome;
			}
		},
	);

	it("does not republish a committed custom record after its subscriber throws", async () => {
		const cwd = fs.mkdtempSync(join(tmpdir(), "pi-custom-notification-"));
		directories.push(cwd);
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
		});
		harnesses.push(harness);
		const failure = new Error("custom subscriber rejected after append");
		let queued = false;
		let failed = false;
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "agent_end" && !queued) {
				queued = true;
				void harness.session.sendCustomMessage(
					{ customType: "one-publication", content: "accepted once", display: false },
					{ triggerTurn: false },
				);
			}
			if (event.type === "message_start" && event.message.role === "custom" && !failed) {
				failed = true;
				throw failure;
			}
		});
		try {
			harness.setResponses([fauxAssistantMessage("first answer")]);
			await expect(harness.session.prompt("first request")).rejects.toBe(failure);
			harness.setResponses([fauxAssistantMessage("next answer")]);
			await harness.session.prompt("next request");
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				expect(
					current
						.getEntries()
						.filter((entry) => entry.type === "custom_message" && entry.customType === "one-publication")
						.map(getMessageText),
				).toEqual(["accepted once"]);
			}
		} finally {
			unsubscribe();
		}
	});
});
