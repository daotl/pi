import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, test } from "vitest";
import { AgentSession } from "../../src/core/agent-session.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { createExtensionRuntime } from "../../src/core/extensions/loader.ts";
import { DefaultResourceLoader, type ResourceLoader } from "../../src/core/resource-loader.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import type { Skill } from "../../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "../model-runtime-test-utils.ts";
import { createHarness, getMessageText } from "./harness.ts";

// The effective skill set must be persisted with the session and restored on
// resume so the runtime skill list stays consistent with the restored system
// prompt, keeping the model's prefill cache stable across skill file edits.
// Only an explicit update (/update skills, /update all) should reload skills
// from disk.

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-skills-restore-"));
	tempDirs.push(dir);
	return dir;
}

function makeSkill(name: string, description = `desc-${name}`): Skill {
	return {
		name,
		description,
		filePath: `/fake/${name}/SKILL.md`,
		baseDir: `/fake/${name}`,
		sourceInfo: createSyntheticSourceInfo(`/fake/${name}/SKILL.md`, { source: "user" }),
		disableModelInvocation: false,
	};
}

/** Skills the mock loader reports; mutating it simulates a change on disk. */
interface SkillHolder {
	skills: Skill[];
}

function createResourceLoader(append: string, holder?: SkillHolder): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: holder ? holder.skills : [], diagnostics: [] }),
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

describe("skill persistence and restore", () => {
	test("persists the effective skills with the system prompt and restores them on resume", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		// First run: disk has skill "alpha".
		const first = await createSession(
			cwd,
			sessionManager,
			createResourceLoader("append-v1", { skills: [makeSkill("alpha")] }),
		);
		expect(first.systemPrompt).toContain("alpha");
		expect(sessionManager.getSavedSystemPrompt()?.skills?.map((s) => s.name)).toEqual(["alpha"]);
		expect(first.getEffectiveSkills().map((s) => s.name)).toEqual(["alpha"]);
		first.dispose();

		// Resume with disk now reporting skill "beta". The saved skill set must win.
		const resumed = await createSession(
			cwd,
			sessionManager,
			createResourceLoader("append-v1", { skills: [makeSkill("beta")] }),
		);
		expect(resumed.systemPrompt).toContain("alpha");
		expect(resumed.systemPrompt).not.toContain("beta");
		expect(resumed.getEffectiveSkills().map((s) => s.name)).toEqual(["alpha"]);
		expect(sessionManager.getSavedSystemPrompt()?.skills?.map((s) => s.name)).toEqual(["alpha"]);
		resumed.dispose();
	});

	test("does not persist an identical skill snapshot again on resume", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		const first = await createSession(
			cwd,
			sessionManager,
			createResourceLoader("append-v1", { skills: [makeSkill("alpha")] }),
		);
		const entriesAfterFirst = sessionManager.getEntries().filter((e) => e.type === "system_prompt").length;
		first.dispose();

		const resumed = await createSession(
			cwd,
			sessionManager,
			createResourceLoader("append-v1", { skills: [makeSkill("alpha")] }),
		);
		const entriesAfterResume = sessionManager.getEntries().filter((e) => e.type === "system_prompt").length;
		resumed.dispose();

		expect(entriesAfterFirst).toBe(1);
		expect(entriesAfterResume).toBe(1);
	});

	test("restoreSystemPrompt=false rebuilds skills from the current loader", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		const first = await createSession(
			cwd,
			sessionManager,
			createResourceLoader("append-v1", { skills: [makeSkill("alpha")] }),
		);
		first.dispose();

		// Forced rebuild: the current disk skill set is loaded and saved.
		const forced = await createSession(
			cwd,
			sessionManager,
			createResourceLoader("append-v1", { skills: [makeSkill("beta")] }),
			false,
		);
		expect(forced.systemPrompt).toContain("beta");
		expect(forced.getEffectiveSkills().map((s) => s.name)).toEqual(["beta"]);
		expect(sessionManager.getSavedSystemPrompt()?.skills?.map((s) => s.name)).toEqual(["beta"]);
		forced.dispose();
	});

	test("reloadSkillsFromFiles picks up skill changes during a live session", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);
		const holder: SkillHolder = { skills: [makeSkill("alpha")] };

		const session = await createSession(cwd, sessionManager, createResourceLoader("append-v1", holder));
		expect(session.systemPrompt).toContain("alpha");

		// Simulate a skill edit on disk, then update skills only.
		holder.skills = [makeSkill("beta")];
		session.reloadSkillsFromFiles();

		expect(session.systemPrompt).toContain("beta");
		expect(session.systemPrompt).not.toContain("alpha");
		expect(session.getEffectiveSkills().map((s) => s.name)).toEqual(["beta"]);
		expect(sessionManager.getSavedSystemPrompt()?.skills?.map((s) => s.name)).toEqual(["beta"]);
		session.dispose();
	});

	test("reloadAllFromFiles reloads both system prompt and skills", async () => {
		const cwd = createTempDir();
		const sessionManager = SessionManager.create(cwd);

		// First run with append v1 and skill alpha.
		const first = await createSession(
			cwd,
			sessionManager,
			createResourceLoader("append-v1", { skills: [makeSkill("alpha")] }),
		);
		first.dispose();

		// Live session resumed with append v2 and skill beta on disk.
		const holder: SkillHolder = { skills: [makeSkill("alpha")] };
		const session = await createSession(cwd, sessionManager, createResourceLoader("append-v1", holder));

		// Change append content and skill set, then update everything.
		const updatedLoader = createResourceLoader("append-v2", holder);
		Object.assign(session, { _resourceLoader: updatedLoader });
		holder.skills = [makeSkill("beta")];
		session.reloadAllFromFiles();

		expect(session.systemPrompt).toContain("append-v2");
		expect(session.systemPrompt).toContain("beta");
		expect(session.getEffectiveSkills().map((s) => s.name)).toEqual(["beta"]);
		expect(sessionManager.getSavedSystemPrompt()?.systemPrompt).toContain("append-v2");
		expect(sessionManager.getSavedSystemPrompt()?.skills?.map((s) => s.name)).toEqual(["beta"]);
		session.dispose();
	});
});

function writeSkill(directory: string, name: string, description: string, body: string, disabled = false): string {
	mkdirSync(directory, { recursive: true });
	const file = join(directory, "SKILL.md");
	writeFileSync(
		file,
		`---\nname: ${name}\ndescription: ${description}\ndisable-model-invocation: ${disabled}\n---\n${body}\n`,
	);
	return file;
}

test("untrusted SDK resume uses canonical saved ordering but current skill authority and bodies", async () => {
	const root = createTempDir();
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	mkdirSync(cwd);
	mkdirSync(agentDir);
	const alphaDir = join(agentDir, "skills", "alpha");
	const alpha = writeSkill(alphaDir, "alpha", "CURRENT ALPHA DESCRIPTION", "old alpha body");
	const beta = writeSkill(join(agentDir, "skills", "beta"), "beta", "CURRENT HIDDEN DESCRIPTION", "beta body", true);
	const gamma = writeSkill(join(agentDir, "skills", "gamma"), "gamma", "CURRENT GAMMA DESCRIPTION", "gamma body");
	const project = writeSkill(
		join(cwd, ".pi", "skills", "project-only"),
		"project-only",
		"PROJECT DESCRIPTION",
		"project body",
	);
	const stale = writeSkill(join(root, "unavailable"), "stale", "STALE DESCRIPTION", "stale body");
	const aliasDir = join(root, "alpha-alias");
	symlinkSync(alphaDir, aliasDir, "dir");
	const savedSkill = (name: string, filePath: string): Skill => ({
		...makeSkill(name, "FORGED SAVED DESCRIPTION"),
		filePath,
		baseDir: join(root, "forged-references"),
		disableModelInvocation: name !== "old-beta",
		sourceInfo: createSyntheticSourceInfo(filePath, { source: "forged", scope: "user", origin: "package" }),
	});
	const manager = SessionManager.create(cwd, join(root, "sessions"));
	manager.appendSystemPrompt("FORGED SAVED PROMPT", undefined, [
		savedSkill("old-beta", beta),
		savedSkill("forged-alpha", join(aliasDir, "SKILL.md")),
		savedSkill("duplicate-alpha", "../agent/skills/alpha/../alpha/SKILL.md"),
		savedSkill("stale", stale),
		savedSkill("forged-project", project),
	]);
	manager.appendMessage({ role: "user", content: "historical question", timestamp: 1 });
	const file = manager.getSessionFile()!;
	const owner = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
	let active: AgentSession | undefined;
	const reopen = async () => {
		const settings = SettingsManager.inMemory(
			{ retry: { enabled: false }, compaction: { enabled: false } },
			{ projectTrusted: false },
		);
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
			additionalSkillPaths: [alpha, beta, gamma, project],
		});
		await loader.reload();
		const reopened = SessionManager.open(file, undefined, cwd);
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
		active = session;
		return { session, manager: reopened, loader };
	};
	try {
		const first = await reopen();
		const current = first.loader.getSkills().skills;
		const expected = [beta, alpha, gamma].map((path) => {
			const skill = current.find((skill) => skill.filePath === path)!;
			return { ...skill, sourceInfo: { ...skill.sourceInfo } };
		});
		expect(first.session.getEffectiveSkills()).toEqual(expected);
		const consumerSkills = first.session.getEffectiveSkills();
		consumerSkills[0].disableModelInvocation = false;
		consumerSkills[1].name = "consumer-renamed-alpha";
		consumerSkills[1].description = "CONSUMER DESCRIPTION";
		consumerSkills[1].filePath = stale;
		consumerSkills[1].baseDir = join(root, "consumer-references");
		consumerSkills[1].sourceInfo.path = stale;
		consumerSkills[1].sourceInfo.scope = "project";
		consumerSkills[1].sourceInfo.source = "consumer";
		consumerSkills.pop();
		expect(first.session.getEffectiveSkills()).toEqual(expected);
		expect(first.session.systemPrompt).toContain("CURRENT ALPHA DESCRIPTION");
		expect(first.session.systemPrompt).toContain("CURRENT GAMMA DESCRIPTION");
		for (const rejected of ["FORGED", "CURRENT HIDDEN DESCRIPTION", "PROJECT DESCRIPTION", "STALE DESCRIPTION"]) {
			expect(first.session.systemPrompt).not.toContain(rejected);
		}
		expect(first.manager.getSavedSystemPrompt()?.skills).toEqual(expected);

		writeSkill(alphaDir, "alpha", "CURRENT ALPHA DESCRIPTION", "CURRENT ALPHA BODY");
		const requests: string[] = [];
		first.session.agent.streamFunction = (_model, context) => {
			requests.push(getMessageText(context.messages.filter((message) => message.role === "user").at(-1)));
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("done") });
			return stream;
		};
		await first.session.prompt("/skill:alpha task arguments");
		await first.session.prompt("/skill:forged-alpha unchanged arguments");
		expect(requests).toEqual([
			`<skill name="alpha" location="${alpha}">\nReferences are relative to ${alphaDir}.\n\nCURRENT ALPHA BODY\n</skill>\n\ntask arguments`,
			"/skill:forged-alpha unchanged arguments",
		]);
		const safeSnapshot = first.manager.getSavedSystemPrompt();
		const safeEntries = first.manager.getEntries().filter((entry) => entry.type === "system_prompt");
		await first.session.dispose();
		active = undefined;

		const second = await reopen();
		expect(second.session.getEffectiveSkills()).toEqual(expected);
		expect(second.manager.getSavedSystemPrompt()).toEqual(safeSnapshot);
		expect(second.manager.getEntries().filter((entry) => entry.type === "system_prompt")).toEqual(safeEntries);
		rmSync(alphaDir, { recursive: true });
		second.session.reloadSkillsFromFiles();
		const remaining = expected.filter((skill) => skill.filePath !== alpha);
		expect(second.session.getEffectiveSkills()).toEqual(remaining);
		expect(second.session.systemPrompt).not.toContain("CURRENT ALPHA DESCRIPTION");
		expect(second.manager.getSavedSystemPrompt()?.skills).toEqual(remaining);
		const removedSnapshot = second.manager.getSavedSystemPrompt();
		const removedEntries = second.manager.getEntries().filter((entry) => entry.type === "system_prompt");
		expect(removedEntries.slice(0, -1)).toEqual(safeEntries);
		await second.session.dispose();
		active = undefined;

		const third = await reopen();
		expect(third.session.getEffectiveSkills()).toEqual(remaining);
		expect(third.manager.getSavedSystemPrompt()).toEqual(removedSnapshot);
		expect(third.manager.getEntries().filter((entry) => entry.type === "system_prompt")).toEqual(removedEntries);
	} finally {
		await active?.dispose();
		owner.cleanup();
	}
});

test.each(["binding", "request"] as const)(
	"untrusted SDK finalizes its safe skill snapshot through %s",
	async (finalization) => {
		const root = createTempDir();
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		const discovered = writeSkill(
			join(root, "discovered"),
			"discovered",
			"CURRENT DISCOVERED DESCRIPTION",
			"discovered body",
		);
		const manager = SessionManager.create(cwd, join(root, "sessions"));
		const saved = { ...makeSkill("old-discovered", "OLD DISCOVERED DESCRIPTION"), filePath: discovered };
		manager.appendSystemPrompt("OLD DISCOVERED POLICY", undefined, [saved]);
		manager.appendMessage({ role: "user", content: "historical question", timestamp: 1 });
		const file = manager.getSessionFile()!;
		const owner = await createHarness({ settings: { retry: { enabled: false }, compaction: { enabled: false } } });
		let active: AgentSession | undefined;
		let previousEntries = manager.getEntries().filter((entry) => entry.type === "system_prompt");
		let finalSnapshot = manager.getSavedSystemPrompt();
		try {
			for (const reopening of [0, 1]) {
				const settings = SettingsManager.inMemory({}, { projectTrusted: false });
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
							pi.on("resources_discover", () => ({ skillPaths: [discovered] }));
						},
					],
				});
				await loader.reload();
				const reopened = SessionManager.open(file, undefined, cwd);
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
				active = session;
				expect(reopened.getEntries().filter((entry) => entry.type === "system_prompt")).toEqual(previousEntries);
				if (finalization === "binding") await session.bindExtensions({});
				else {
					session.agent.streamFunction = () => {
						const stream = createAssistantMessageEventStream();
						stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("accepted safe request") });
						return stream;
					};
					await session.prompt("accepted request without binding discovery");
				}
				const expected = finalization === "binding" ? loader.getSkills().skills : [];
				expect(session.getEffectiveSkills()).toEqual(expected);
				expect(session.getEffectiveSkills().map((skill) => skill.name)).toEqual(
					finalization === "binding" ? ["discovered"] : [],
				);
				if (finalization === "binding") expect(session.systemPrompt).toContain("CURRENT DISCOVERED DESCRIPTION");
				else expect(session.systemPrompt).not.toContain("CURRENT DISCOVERED DESCRIPTION");
				expect(session.systemPrompt).not.toContain("OLD DISCOVERED");
				expect(reopened.getSavedSystemPrompt()?.skills).toEqual(expected);
				const entries = reopened.getEntries().filter((entry) => entry.type === "system_prompt");
				if (reopening === 0) {
					expect(entries.slice(0, -1)).toEqual(previousEntries);
					finalSnapshot = reopened.getSavedSystemPrompt();
				} else {
					expect(entries).toEqual(previousEntries);
					expect(reopened.getSavedSystemPrompt()).toEqual(finalSnapshot);
				}
				previousEntries = entries;
				await session.dispose();
				active = undefined;
			}
		} finally {
			await active?.dispose();
			owner.cleanup();
		}
	},
);
