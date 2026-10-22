import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../../src/core/extensions/loader.ts";
import { DefaultResourceLoader, type ResourceLoader } from "../../src/core/resource-loader.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "../model-runtime-test-utils.ts";
import { createHarness, type Harness } from "./harness.ts";

// The effective system prompt must be persisted with the session and restored
// verbatim on resume so the model's prefill cache survives APPEND_SYSTEM.md /
// Pi's internal prompt changes. Only an explicit update (slash command or CLI
// flag) should rebuild it from current files.

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-system-prompt-restore-"));
	tempDirs.push(dir);
	return dir;
}

function createResourceLoader(append: string): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getSystemPromptSource: () => undefined,
		getAppendSystemPrompt: () => [append],
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
		reloadSystemPrompt: () => {},
		reloadSkills: () => {},
	};
}

async function createSession(
	cwd: string,
	sessionManager: SessionManager,
	resourceLoader: ResourceLoader,
	restoreSystemPrompt?: boolean,
): Promise<AgentSession> {
	const model = getModel("anthropic", "claude-sonnet-4-5")!;
	const authStorage = AuthStorage.inMemory();
	await authStorage.modify(model.provider, async () => ({ type: "api_key", key: "faux-key" }));
	const modelRegistry = await createInMemoryModelRegistry(authStorage);
	const agent = new Agent({
		getApiKey: () => "faux-key",
		initialState: {
			model,
			systemPrompt: "",
			tools: [],
		},
		streamFn: streamSimple,
	});
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager: SettingsManager.inMemory(),
		cwd,
		modelRuntime: getModelRuntime(modelRegistry),
		resourceLoader,
		restoreSystemPrompt,
	});
	session.subscribe(() => {});
	return session;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe("system prompt persistence and restore", () => {
	test("persists the built system prompt and restores it verbatim on resume", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		// First run: APPEND_SYSTEM.md content "v1".
		const first = await createSession(cwd, sessionManager, createResourceLoader("append-v1"));
		expect(sessionManager.getSavedSystemPrompt()?.systemPrompt).toContain("append-v1");
		const savedOnFirstRun = sessionManager.getSavedSystemPrompt()?.systemPrompt;
		expect(savedOnFirstRun).toBeTruthy();
		first.dispose();

		// Resume with APPEND_SYSTEM.md changed to "v2". The saved prompt must win.
		const resumed = await createSession(cwd, sessionManager, createResourceLoader("append-v2"));
		expect(resumed.systemPrompt).toBe(savedOnFirstRun);
		expect(resumed.systemPrompt).toContain("append-v1");
		expect(resumed.systemPrompt).not.toContain("append-v2");
		resumed.dispose();
	});

	test("does not persist an identical prompt again on resume", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		const first = await createSession(cwd, sessionManager, createResourceLoader("append-v1"));
		const entriesAfterFirst = sessionManager.getEntries().filter((e) => e.type === "system_prompt").length;
		first.dispose();

		const resumed = await createSession(cwd, sessionManager, createResourceLoader("append-v1"));
		const entriesAfterResume = sessionManager.getEntries().filter((e) => e.type === "system_prompt").length;
		resumed.dispose();

		expect(entriesAfterFirst).toBe(1);
		expect(entriesAfterResume).toBe(1);
	});

	test("restoreSystemPrompt=false rebuilds from current files and persists", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		const first = await createSession(cwd, sessionManager, createResourceLoader("append-v1"));
		first.dispose();

		// Force an update: the current APPEND_SYSTEM.md is loaded and saved.
		const forced = await createSession(cwd, sessionManager, createResourceLoader("append-v2"), false);
		expect(forced.systemPrompt).toContain("append-v2");
		expect(sessionManager.getSavedSystemPrompt()?.systemPrompt).toContain("append-v2");
		forced.dispose();
	});

	test("reloadSystemPromptFromFiles rebuilds from current files during a live session", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		const session = await createSession(cwd, sessionManager, createResourceLoader("append-v1"));
		expect(session.systemPrompt).toContain("append-v1");

		// Swap the loader to a different append and force an update.
		const updatedLoader = createResourceLoader("append-v2");
		Object.assign(session, { _resourceLoader: updatedLoader });
		session.reloadSystemPromptFromFiles();

		expect(session.systemPrompt).toContain("append-v2");
		expect(sessionManager.getSavedSystemPrompt()?.systemPrompt).toContain("append-v2");
		session.dispose();
	});

	test("setCustomSystemPrompt persists a custom prompt and clear reverts to files", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);
		const session = await createSession(cwd, sessionManager, createResourceLoader("append-v1"));

		session.setCustomSystemPrompt("CUSTOM BASE PROMPT");
		expect(session.hasCustomSystemPrompt).toBe(true);
		expect(session.systemPrompt).toContain("CUSTOM BASE PROMPT");
		expect(sessionManager.getSavedSystemPrompt()?.customPrompt).toBe("CUSTOM BASE PROMPT");

		// Clear reverts to the file-based prompt.
		session.reloadSystemPromptFromFiles();
		expect(session.hasCustomSystemPrompt).toBe(false);
		expect(session.systemPrompt).toContain("append-v1");
		expect(sessionManager.getSavedSystemPrompt()?.customPrompt).toBeUndefined();
		session.dispose();
	});
});

test.each([
	"unchanged",
	"context-edit",
	"forced",
	"failed-update",
	"remove-addendum",
	"clear-preamble",
	"full-reload",
	"legacy-context",
	"legacy-context-edit",
] as const)(
	"uses the same saved effective prompt in getters, chained hooks and provider requests: %s",
	async (mode) => {
		const root = createTempDir();
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		const systemPath = join(agentDir, "SYSTEM.md");
		const appendPath = join(agentDir, "APPEND_SYSTEM.md");
		const contextPath = join(cwd, "AGENTS.md");
		writeFileSync(systemPath, "SAVED PREAMBLE");
		writeFileSync(appendPath, "SAVED ADDENDUM");
		writeFileSync(contextPath, "SAVED RAW PROJECT CONTEXT");
		const seen: string[] = [];
		let inspect = false;
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			noThemes: true,
			noPromptTemplates: true,
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event, ctx) => {
						if (!inspect) return;
						seen.push(event.systemPrompt, ctx.getSystemPrompt());
						if (mode === "context-edit")
							event.systemPromptOptions.contextFiles[0].content = "EDITED RAW PROJECT CONTEXT";
						if (mode === "legacy-context-edit")
							event.systemPromptOptions.contextFiles[0].content += "\nEDITED OPAQUE CONTEXT";
						if (mode === "forced") return { systemPrompt: "EXACT FORCED REQUEST POLICY" };
						if (mode === "remove-addendum") event.systemPromptOptions.sections.addendum = "";
					});
					pi.on("before_agent_start", (event, ctx) => {
						if (inspect) seen.push(event.systemPrompt, ctx.getSystemPrompt());
					});
				},
			],
		});
		let harness: Harness | undefined;
		try {
			await loader.reload();
			const manager = SessionManager.create(cwd, join(root, "sessions"));
			harness = await createHarness({
				cwd,
				sessionManager: manager,
				resourceLoader: loader,
				initialActiveToolNames: ["read"],
				settings: { retry: { enabled: false }, compaction: { enabled: false } },
			});
			harness.setResponses([fauxAssistantMessage("seed answer")]);
			await harness.session.prompt("seed question");
			const saved = harness.session.systemPrompt;
			expect(harness.session.getEffectiveContextSources()).toEqual([
				{ path: systemPath },
				{ path: appendPath },
				{ path: contextPath },
			]);
			const file = manager.getSessionFile()!;
			if (mode === "legacy-context" || mode === "legacy-context-edit") {
				const snapshot = manager.getSavedSystemPrompt()!;
				manager.appendSystemPrompt(
					snapshot.systemPrompt,
					snapshot.customPrompt,
					snapshot.skills,
					snapshot.sections,
				);
			}
			harness.cleanup();
			harness = undefined;
			writeFileSync(systemPath, "CHANGED DISK PREAMBLE");
			writeFileSync(appendPath, "CHANGED DISK ADDENDUM");
			writeFileSync(contextPath, "CHANGED DISK PROJECT CONTEXT");
			await loader.reload();
			inspect = true;
			const reopened = SessionManager.open(file);
			harness = await createHarness({
				cwd,
				sessionManager: reopened,
				resourceLoader: loader,
				initialActiveToolNames: ["read"],
				settings: { retry: { enabled: false }, compaction: { enabled: false } },
			});
			const expectedSources = [
				{ label: expect.stringMatching(/saved system prompt.*source unavailable/i) },
				{ label: expect.stringMatching(/saved.*addendum.*source unavailable/i) },
				mode === "legacy-context" || mode === "legacy-context-edit"
					? { label: expect.stringMatching(/saved.*context.*source unavailable/i) }
					: { path: contextPath },
			];
			expect(harness.session.getEffectiveContextSources()).toEqual(expectedSources);
			const consumerSources = harness.session.getEffectiveContextSources();
			for (const source of consumerSources) {
				if ("path" in source) source.path = "/consumer/replaced-context.md";
				else source.label = "consumer replaced label";
			}
			consumerSources.pop();
			expect(harness.session.getEffectiveContextSources()).toEqual(expectedSources);
			if (mode === "failed-update") {
				Object.assign(loader, {
					reloadSkills: () => {
						throw new Error("skill update failed after prompt reload");
					},
				});
				expect(() => harness!.session.reloadAllFromFiles()).toThrow("skill update failed after prompt reload");
				expect(harness.session.getEffectiveContextSources()).toEqual(expectedSources);
			}
			if (mode === "clear-preamble") {
				harness.session.setCustomSystemPrompt("TEMPORARY CUSTOM PREAMBLE");
				harness.session.setCustomSystemPrompt("");
			}
			if (mode === "full-reload") await harness.session.reload();
			if (mode === "clear-preamble") {
				expect(harness.session.getEffectiveContextSources()).toEqual([
					{ path: systemPath },
					expectedSources[1],
					{ path: contextPath },
				]);
			}
			const effective =
				mode === "clear-preamble"
					? saved.replace("SAVED PREAMBLE", "CHANGED DISK PREAMBLE")
					: mode === "full-reload"
						? saved.replace("SAVED RAW PROJECT CONTEXT", "CHANGED DISK PROJECT CONTEXT")
						: saved;
			expect(harness.session.systemPrompt).toBe(effective);
			let request = "";
			harness.setResponses([
				(context) => {
					request = getCurrentSystemPrompt(context.messages);
					return fauxAssistantMessage("restored answer");
				},
			]);
			if (mode === "full-reload")
				harness.session.agent.streamFunction = (_model, context) => {
					request = getCurrentSystemPrompt(context.messages);
					const stream = createAssistantMessageEventStream();
					stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("restored answer") });
					return stream;
				};
			await harness.session.prompt("request after reopen");
			expect(seen.slice(0, 2)).toEqual([effective, effective]);
			const expected =
				mode === "forced"
					? "EXACT FORCED REQUEST POLICY"
					: mode === "legacy-context-edit"
						? saved.replace("\n</project_context>", "\nEDITED OPAQUE CONTEXT\n</project_context>")
						: mode === "context-edit"
							? saved.replace("SAVED RAW PROJECT CONTEXT", "EDITED RAW PROJECT CONTEXT")
							: mode === "remove-addendum"
								? saved.replace("\n\n<addendum>\nSAVED ADDENDUM\n</addendum>", "")
								: effective;
			expect(seen.slice(2)).toEqual([expected, expected]);
			expect(request).toBe(expected);
			expect(reopened.getSavedSystemPrompt()?.systemPrompt).toBe(effective);
		} finally {
			harness?.cleanup();
		}
	},
);

test("direct continuation publishes a saved prompt changed after the last response", async () => {
	const cwd = createTempDir();
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	let harness: Harness | undefined;
	try {
		harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		harness.session.setCustomSystemPrompt("OLD RESPONSE POLICY");
		harness.setResponses([fauxAssistantMessage("answer prefix")]);
		await harness.session.prompt("original question");
		harness.session.setCustomSystemPrompt("NEW SAVED POLICY");
		manager.appendMessage({ role: "user", content: "pending question after policy update", timestamp: Date.now() });
		const file = manager.getSessionFile()!;
		harness.cleanup();
		harness = undefined;
		harness = await createHarness({
			cwd,
			sessionManager: SessionManager.open(file),
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", () => ({ systemPrompt: "UNEXPECTED PROMPT HOOK" }));
				},
			],
		});
		harness.session.refreshContext();
		let request = "";
		harness.setResponses([
			(context) => {
				request = getCurrentSystemPrompt(context.messages);
				return fauxAssistantMessage("answer under saved policy");
			},
		]);
		await harness.session.continue();
		expect(request).toContain("NEW SAVED POLICY");
		expect(request).not.toContain("OLD RESPONSE POLICY");
		expect(request).not.toContain("UNEXPECTED PROMPT HOOK");
		expect(getCurrentSystemPrompt(harness.sessionManager.buildSessionProjection().messages)).toBe(request);
	} finally {
		harness?.cleanup();
	}
});

test.each([true, false])("SDK reopen uses runtime cwd and trust-gated current policy: trusted=%s", async (trusted) => {
	const root = createTempDir();
	const oldCwd = join(root, "old");
	const cwd = join(root, "current");
	const agentDir = join(root, "agent");
	mkdirSync(oldCwd);
	mkdirSync(cwd);
	mkdirSync(agentDir);
	const manager = SessionManager.create(oldCwd, join(root, "sessions"));
	const sections = { preamble: "HISTORICAL PROJECT POLICY", cwd: `<cwd>\n${oldCwd}\n</cwd>` };
	manager.appendSystemPrompt(`HISTORICAL PROJECT POLICY\n\n${sections.cwd}`, undefined, [], sections);
	manager.appendMessage({ role: "system", content: "", sections, timestamp: 0 });
	manager.appendMessage({ role: "user", content: "old question", timestamp: 1 });
	const settings = SettingsManager.inMemory(
		{ retry: { enabled: false }, compaction: { enabled: false } },
		{ projectTrusted: trusted },
	);
	const observations: string[] = [];
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: settings,
		systemPrompt: "CURRENT USER POLICY",
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noPromptTemplates: true,
		noContextFiles: true,
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", (event, ctx) => {
					observations.push(event.systemPrompt, ctx.getSystemPrompt());
				});
				pi.on("context_with_system", (event) => {
					observations.push(getCurrentSystemPrompt(event.messages));
				});
			},
		],
	});
	await loader.reload();
	const owner = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
	const reopened = SessionManager.open(manager.getSessionFile()!, undefined, cwd);
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		sessionManager: reopened,
		settingsManager: settings,
		resourceLoader: loader,
		modelRuntime: owner.session.modelRuntime,
		model: owner.getModel(),
		tools: ["read"],
	});
	try {
		let request = "";
		session.agent.streamFunction = (_model, context) => {
			request = getCurrentSystemPrompt(context.messages);
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("resumed") });
			return stream;
		};
		await session.prompt("new question");
		for (const prompt of [session.systemPrompt, ...observations, request]) {
			expect(prompt).toContain(`<cwd>\n${cwd}\n</cwd>`);
			expect(prompt).not.toContain(`<cwd>\n${oldCwd}\n</cwd>`);
			expect(prompt).toContain(trusted ? "HISTORICAL PROJECT POLICY" : "CURRENT USER POLICY");
			if (!trusted) expect(prompt).not.toContain("HISTORICAL PROJECT POLICY");
		}
	} finally {
		await session.dispose();
		owner.cleanup();
	}
});

test.each(["aborted", "completed"] as const)(
	"standalone policy patch survives automatic prefill %s publication",
	async (terminal) => {
		const cwd = createTempDir();
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			harness.session.setCustomSystemPrompt("OLD PREFILL POLICY");
			const model = harness.getModel();
			const prefix = {
				...fauxAssistantMessage("original prefix", { stopReason: "aborted" }),
				api: model.api,
				provider: model.provider,
				model: model.id,
			};
			harness.session.agent.streamFunction = () => {
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "error", reason: "aborted", error: prefix });
				return stream;
			};
			await harness.session.prompt("original question");
			harness.session.setCustomSystemPrompt("NEW PREFILL POLICY");
			let request = "";
			harness.session.agent.streamFunction = (_model, context) => {
				request = getCurrentSystemPrompt(context.messages);
				const stream = createAssistantMessageEventStream();
				if (terminal === "aborted")
					stream.push({
						type: "error",
						reason: "aborted",
						error: { ...prefix, content: [{ type: "text", text: "orig" }] },
					});
				else
					stream.push({
						type: "done",
						reason: "stop",
						message: {
							...prefix,
							stopReason: "stop",
							content: [{ type: "text", text: "original prefix completed" }],
						},
					});
				return stream;
			};
			await harness.session.continue();
			expect(request).toContain("NEW PREFILL POLICY");
			expect(request).not.toContain("OLD PREFILL POLICY");
			const reopened = SessionManager.open(manager.getSessionFile()!);
			expect(getCurrentSystemPrompt(reopened.buildSessionProjection().messages)).toContain("NEW PREFILL POLICY");
			expect(
				reopened
					.buildSessionProjection()
					.messages.filter((message) => message.role === "assistant")
					.map((message) => message.content),
			).toEqual([
				[{ type: "text", text: terminal === "aborted" ? "original prefix" : "original prefix completed" }],
			]);
		} finally {
			harness.cleanup();
		}
	},
);

test.each([false, true])(
	"untrusted reopen keeps explicit user override and context lifecycle: structured=%s",
	async (structured) => {
		const root = createTempDir();
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		const contextPath = join(cwd, "AGENTS.md");
		writeFileSync(contextPath, "CURRENT ALLOWED CONTEXT");
		const manager = SessionManager.create(cwd, join(root, "sessions"));
		const sections = structured
			? { preamble: "saved", project_context: "<project_context>\nSAVED ALLOWED CONTEXT\n</project_context>" }
			: undefined;
		manager.appendSystemPrompt("saved", "EXPLICIT USER OVERRIDE", [], sections, [
			{ path: contextPath, content: "SAVED ALLOWED CONTEXT" },
		]);
		manager.appendMessage({ role: "user", content: "historical question", timestamp: 1 });
		const settings = SettingsManager.inMemory({}, { projectTrusted: false });
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: settings,
			noExtensions: true,
			noSkills: true,
			noThemes: true,
			noPromptTemplates: true,
		});
		await loader.reload();
		const owner = await createHarness();
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			settingsManager: settings,
			resourceLoader: loader,
			sessionManager: manager,
			modelRuntime: owner.session.modelRuntime,
			model: owner.getModel(),
			tools: ["read"],
		});
		try {
			expect(session.systemPrompt).toContain("EXPLICIT USER OVERRIDE");
			// Structured AGENTS context is retained; an opaque legacy prompt must use current loader files.
			expect(session.systemPrompt).toContain(structured ? "SAVED ALLOWED CONTEXT" : "CURRENT ALLOWED CONTEXT");
			await session.reload();
			expect(session.systemPrompt).toContain("EXPLICIT USER OVERRIDE");
			expect(session.systemPrompt).toContain("CURRENT ALLOWED CONTEXT");
			expect(session.systemPrompt).not.toContain("SAVED ALLOWED CONTEXT");
		} finally {
			await session.dispose();
			owner.cleanup();
		}
	},
);
