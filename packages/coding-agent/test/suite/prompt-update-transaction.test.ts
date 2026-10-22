import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, appendFileSync: vi.fn(actual.appendFileSync) };
});
beforeEach(async () => {
	const actual = await vi.importActual<typeof fs>("fs");
	vi.mocked(fs.appendFileSync).mockReset().mockImplementation(actual.appendFileSync);
});
afterEach(() => vi.useRealTimers());

it.each(["set", "clear", "system", "skills", "all"] as const)(
	"retains committed prompt construction after failed %s snapshot and a real next request",
	async (operation) => {
		const root = fs.mkdtempSync(join(tmpdir(), "pi-prompt-transaction-"));
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		const skillDir = join(agentDir, "skills", "alpha");
		fs.mkdirSync(cwd, { recursive: true });
		fs.mkdirSync(skillDir, { recursive: true });
		const system = join(agentDir, "SYSTEM.md");
		const skill = join(skillDir, "SKILL.md");
		fs.writeFileSync(system, "ORIGINAL PREAMBLE");
		fs.writeFileSync(skill, "---\nname: alpha\ndescription: ORIGINAL SKILL\n---\nbody");
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			additionalSkillPaths: [join(agentDir, "skills")],
			noThemes: true,
			noPromptTemplates: true,
			noContextFiles: true,
		});
		await loader.reload();
		const manager = SessionManager.create(cwd, join(root, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			resourceLoader: loader,
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			if (operation === "clear") harness.session.setCustomSystemPrompt("ORIGINAL CUSTOM");
			harness.setResponses([fauxAssistantMessage("seed")]);
			await harness.session.prompt("seed question");
			const before = harness.session.systemPrompt;
			const snapshot = manager.getSavedSystemPrompt();
			const entries = structuredClone(manager.getEntries());
			const bytes = fs.readFileSync(manager.getSessionFile()!);
			fs.writeFileSync(system, "UNCOMMITTED PREAMBLE");
			fs.writeFileSync(skill, "---\nname: alpha\ndescription: UNCOMMITTED SKILL\n---\nbody");
			const update = () => {
				if (operation === "set") harness.session.setCustomSystemPrompt("UNCOMMITTED CUSTOM");
				else if (operation === "clear") harness.session.setCustomSystemPrompt("");
				else if (operation === "system") harness.session.reloadSystemPromptFromFiles();
				else if (operation === "skills") harness.session.reloadSkillsFromFiles();
				else harness.session.reloadAllFromFiles();
			};
			vi.mocked(fs.appendFileSync).mockImplementationOnce(() => {
				throw new Error("injected prompt snapshot failure");
			});
			expect(update).toThrow();
			expect(harness.session.systemPrompt).toBe(before);
			expect(manager.getSavedSystemPrompt()).toEqual(snapshot);
			expect(manager.getEntries()).toEqual(entries);
			expect(fs.readFileSync(manager.getSessionFile()!)).toEqual(bytes);
			let request = "";
			harness.setResponses([
				(context) => {
					request = getCurrentSystemPrompt(context.messages);
					return fauxAssistantMessage("after failed update");
				},
			]);
			await harness.session.prompt("next question");
			expect(request).toBe(before);
			expect(request).not.toContain("UNCOMMITTED");
			update();
			expect(manager.getSavedSystemPrompt()?.systemPrompt).toBe(harness.session.systemPrompt);
			expect(SessionManager.open(manager.getSessionFile()!).getSavedSystemPrompt()).toEqual(
				manager.getSavedSystemPrompt(),
			);
		} finally {
			await harness.session.abort();
			harness.cleanup();
			fs.rmSync(root, { recursive: true, force: true });
		}
	},
);

it("rejects all explicit prompt updates during a held real stream without changing committed state", async () => {
	const harness = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
	const stream = createAssistantMessageEventStream();
	const started = Promise.withResolvers<void>();
	let running: Promise<void> | undefined;
	try {
		harness.session.agent.streamFunction = () => {
			started.resolve();
			return stream;
		};
		running = harness.session.prompt("held request");
		await Promise.race([
			started.promise,
			running.then(() => {
				throw new Error("Provider gate absent");
			}),
		]);
		const before = harness.session.systemPrompt;
		const saved = harness.sessionManager.getSavedSystemPrompt();
		const entries = structuredClone(harness.sessionManager.getEntries());
		for (const update of [
			() => harness.session.setCustomSystemPrompt("unaccepted"),
			() => harness.session.reloadSystemPromptFromFiles(),
			() => harness.session.reloadSkillsFromFiles(),
			() => harness.session.reloadAllFromFiles(),
		])
			expect(update).toThrow();
		expect(harness.session.systemPrompt).toBe(before);
		expect(harness.sessionManager.getSavedSystemPrompt()).toEqual(saved);
		expect(harness.sessionManager.getEntries()).toEqual(entries);
		stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("held completed") });
		await running;
		expect(harness.session.getLastAssistantText()).toBe("held completed");
		expect(harness.session.isIdle).toBe(true);
	} finally {
		stream.end(fauxAssistantMessage("", { stopReason: "aborted" }));
		await harness.session.abort();
		await running?.catch(() => {});
		harness.cleanup();
	}
});

it.each(["compact", "tree"] as const)(
	"rejects explicit updates while a real %s hook owns summarization",
	async (mode) => {
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const harness = await createHarness({
			settings: {
				retry: { enabled: false },
				compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 512 },
			},
			extensionFactories: [
				(pi) => {
					if (mode === "compact")
						pi.on("session_before_compact", async () => {
							started.resolve();
							await release.promise;
							return { cancel: true };
						});
					else
						pi.on("session_before_tree", async () => {
							started.resolve();
							await release.promise;
							return { cancel: true };
						});
				},
			],
		});
		let compactCancellation: { aborted: boolean; errorMessage?: string } | undefined;
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "compaction_end") compactCancellation = event;
		});
		let running: Promise<unknown> | undefined;
		try {
			harness.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);
			await harness.session.prompt("first question");
			const target = harness.sessionManager.getLeafId()!;
			await harness.session.prompt("second question");
			running =
				mode === "compact"
					? harness.session.compact({ keepRecentMessages: 1 })
					: harness.session.navigateTree(target, { summarize: true });
			const outcome = running.then(
				(result) => ({ result }),
				(error: unknown) => ({ error }),
			);
			await Promise.race([
				started.promise,
				outcome.then(() => {
					throw new Error("Summary ownership gate absent");
				}),
			]);
			const before = harness.session.systemPrompt;
			const entries = structuredClone(harness.sessionManager.getEntries());
			for (const update of [
				() => harness.session.setCustomSystemPrompt("unaccepted"),
				() => harness.session.reloadSystemPromptFromFiles(),
				() => harness.session.reloadSkillsFromFiles(),
				() => harness.session.reloadAllFromFiles(),
			])
				expect(update).toThrow();
			expect(harness.session.systemPrompt).toBe(before);
			expect(harness.sessionManager.getEntries()).toEqual(entries);
			release.resolve();
			const settled = await outcome;
			if (mode === "compact") {
				expect(settled).toHaveProperty("error", expect.any(Error));
				expect(compactCancellation).toMatchObject({ aborted: true, errorMessage: undefined });
			} else {
				expect(settled).toEqual({ result: { cancelled: true } });
			}
			expect(harness.session.isIdle).toBe(true);
			expect(harness.sessionManager.getEntries()).toEqual(entries);
		} finally {
			release.resolve();
			unsubscribe();
			await running?.catch(() => {});
			await harness.session.abort();
			harness.cleanup();
		}
	},
);

it.each(["/update", "/update system-prompt", "/update skills", "/system-prompt set rejected", "/system-prompt clear"])(
	"reports a busy session through the actual %s submission boundary",
	async (command) => {
		const harness = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
		const stream = createAssistantMessageEventStream();
		const started = Promise.withResolvers<void>();
		const errors: string[] = [];
		const statuses: string[] = [];
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			runtimeHost: { session: harness.session },
			defaultEditor: {} as { onSubmit?: (text: string) => Promise<void> },
			editor: { setText: (_text: string) => {} },
			showError: (message: string) => errors.push(message),
			showStatus: (message: string) => statuses.push(message),
		}) as { setupEditorSubmitHandler(): void; defaultEditor: { onSubmit?: (text: string) => Promise<void> } };
		let running: Promise<void> | undefined;
		try {
			harness.session.agent.streamFunction = () => {
				started.resolve();
				return stream;
			};
			running = harness.session.prompt("held request");
			await Promise.race([
				started.promise,
				running.then(() => {
					throw new Error("Provider gate absent");
				}),
			]);
			const before = harness.session.systemPrompt;
			context.setupEditorSubmitHandler();
			await context.defaultEditor.onSubmit!(command);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toContain("Cannot update the system prompt while the agent is running.");
			expect(statuses).toEqual([]);
			expect(harness.session.systemPrompt).toBe(before);
			stream.push({
				type: "done",
				reason: "stop",
				message: fauxAssistantMessage("completed after rejected command"),
			});
			await running;
			expect(harness.session.getLastAssistantText()).toBe("completed after rejected command");
			errors.length = 0;
			await context.defaultEditor.onSubmit!(command);
			expect(errors).toEqual([]);
			expect(statuses).toEqual([expect.any(String)]);
		} finally {
			stream.end(fauxAssistantMessage("", { stopReason: "aborted" }));
			await harness.session.abort();
			await running?.catch(() => {});
			harness.cleanup();
		}
	},
);
