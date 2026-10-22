import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { createHarness } from "./harness.ts";

it.each(["memory", "file"] as const)(
	"restores selected branch prompt and executable loadout before real requests in %s sessions",
	async (storage) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-selected-policy-"));
		const manager =
			storage === "file" ? SessionManager.create(cwd, join(cwd, "sessions")) : SessionManager.inMemory(cwd);
		const agentDir = join(cwd, "agent");
		const skillDir = join(agentDir, "skills", "branch-skill");
		mkdirSync(skillDir, { recursive: true });
		const skillPath = join(skillDir, "SKILL.md");
		const contextPath = join(cwd, "AGENTS.md");
		writeFileSync(skillPath, "---\nname: branch-skill\ndescription: BRANCH A SKILL\n---\nbody A");
		writeFileSync(contextPath, "BRANCH A CONTEXT");
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			additionalSkillPaths: [join(agentDir, "skills")],
			noThemes: true,
			noPromptTemplates: true,
		});
		await loader.reload();
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			resourceLoader: loader,
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			harness.session.setCustomSystemPrompt("BRANCH A POLICY");
			harness.session.setActiveToolsByName(["read"]);
			harness.setResponses([fauxAssistantMessage("answer A")]);
			await harness.session.prompt("question A");
			const a = manager.getLeafId()!;
			writeFileSync(skillPath, "---\nname: branch-skill\ndescription: BRANCH B SKILL\n---\nbody B");
			writeFileSync(contextPath, "BRANCH B CONTEXT");
			await loader.reload();
			harness.session.reloadAllFromFiles();
			harness.session.setCustomSystemPrompt("BRANCH B POLICY");
			harness.session.setActiveToolsByName(["bash"]);
			harness.setResponses([fauxAssistantMessage("answer B")]);
			await harness.session.prompt("question B");
			const b = manager.getLeafId()!;
			for (const [id, policy, tool] of [
				[a, "BRANCH A POLICY", "read"],
				[b, "BRANCH B POLICY", "bash"],
			]) {
				await harness.session.navigateTree(id);
				expect(harness.session.systemPrompt).toContain(policy);
				expect(harness.session.getActiveToolNames()).toEqual([tool]);
				expect(harness.session.systemPrompt).toContain(
					policy === "BRANCH A POLICY" ? "BRANCH A SKILL" : "BRANCH B SKILL",
				);
				expect(harness.session.systemPrompt).toContain(
					policy === "BRANCH A POLICY" ? "BRANCH A CONTEXT" : "BRANCH B CONTEXT",
				);
				let sent = "";
				harness.setResponses([
					(context) => {
						sent = getCurrentSystemPrompt(context.messages);
						return fauxAssistantMessage("selected reply");
					},
				]);
				await harness.session.prompt("selected request");
				expect(sent).toContain(policy);
				expect(manager.getSavedSystemPrompt()?.customPrompt).toBe(policy);
			}
		} finally {
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it("restores the durable policy when physical tail removal discards an idle update", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-delete-policy-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		harness.session.setCustomSystemPrompt("RETAINED POLICY");
		harness.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("second")]);
		await harness.session.prompt("first input");
		await harness.session.prompt("second input");
		harness.session.setCustomSystemPrompt("REMOVED IDLE POLICY");
		expect(harness.session.deleteLastMessages(1)).toBe(1);
		expect(harness.session.systemPrompt).toContain("RETAINED POLICY");
		expect(harness.session.systemPrompt).not.toContain("REMOVED IDLE POLICY");
		let sent = "";
		harness.setResponses([
			(context) => {
				sent = getCurrentSystemPrompt(context.messages);
				return fauxAssistantMessage("after deletion");
			},
		]);
		await harness.session.prompt("new input");
		expect(sent).toContain("RETAINED POLICY");
		expect(SessionManager.open(manager.getSessionFile()!).getSavedSystemPrompt()?.customPrompt).toBe(
			"RETAINED POLICY",
		);
	} finally {
		harness.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});

it("restores the selected swipe subtree policy while keeping version identity", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-swipe-policy-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		harness.setResponses([fauxAssistantMessage("version one"), fauxAssistantMessage("version two")]);
		await harness.session.prompt("shared question");
		const first = harness.session.getSwipeGroup()!;
		harness.session.setCustomSystemPrompt("VERSION ONE POLICY");
		const firstLeaf = manager.getLeafId()!;
		harness.session.prepareSwipeRegeneration(first);
		await harness.session.continue();
		const group = harness.session.getSwipeGroup()!;
		harness.session.setCustomSystemPrompt("VERSION TWO POLICY");
		expect(harness.session.goToSwipeVersion(group, 0)).toBe(true);
		expect(harness.session.systemPrompt).toContain("VERSION ONE POLICY");
		expect(manager.getBranch().some((entry) => entry.id === firstLeaf)).toBe(true);
		expect(harness.session.getSwipeGroup()!.versions.map((entry) => entry.id)).toEqual(
			group.versions.map((entry) => entry.id),
		);
		let request = "";
		harness.setResponses([
			(context) => {
				request = getCurrentSystemPrompt(context.messages);
				return fauxAssistantMessage("selected version response");
			},
		]);
		await harness.session.prompt("request under first version");
		expect(request).toContain("VERSION ONE POLICY");
	} finally {
		harness.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});

it("keeps prior versions selectable when regeneration sanitizes the selected branch policy", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-untrusted-regenerate-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	manager.appendSystemPrompt("HISTORICAL PROJECT POLICY", undefined, [], { preamble: "HISTORICAL PROJECT POLICY" });
	const owner = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	let resumed: Awaited<ReturnType<typeof createAgentSession>> | undefined;
	try {
		owner.setResponses([fauxAssistantMessage("original version")]);
		await owner.session.prompt("shared question");
		await owner.session.dispose();
		const settings = SettingsManager.inMemory(
			{ retry: { enabled: false }, compaction: { enabled: false } },
			{ projectTrusted: false },
		);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: join(cwd, "agent"),
			settingsManager: settings,
			noExtensions: true,
			noSkills: true,
			noThemes: true,
			noPromptTemplates: true,
			noContextFiles: true,
		});
		await loader.reload();
		resumed = await createAgentSession({
			cwd,
			agentDir: join(cwd, "agent"),
			sessionManager: SessionManager.open(manager.getSessionFile()!),
			settingsManager: settings,
			resourceLoader: loader,
			modelRuntime: owner.session.modelRuntime,
			model: owner.getModel(),
		});
		const session = resumed.session;
		const selected = session.sessionManager;
		const original = session.getSwipeGroup()!;
		session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("safe regenerated version") });
			return stream;
		};
		session.prepareSwipeRegeneration(original);
		expect(selected.getLeafId()).toBe(original.anchorEntryId);
		await session.continue();
		const current = session.getSwipeGroup()!;
		expect(
			current.versions.map((entry) => (entry.message.role === "assistant" ? entry.message.content : undefined)),
		).toEqual([[{ type: "text", text: "original version" }], [{ type: "text", text: "safe regenerated version" }]]);
		expect(current.anchorEntryId).toBe(original.anchorEntryId);
		expect(session.systemPrompt).not.toContain("HISTORICAL PROJECT POLICY");
		expect(
			session
				.softDeleteLastMessages(1)
				.map((unit) => unit.entry.id)
				.sort(),
		).toEqual(current.versions.map((entry) => entry.id).sort());
		expect(
			session
				.getDeletedSwipeVersions()
				.map((entry) => entry.id)
				.sort(),
		).toEqual(current.versions.map((entry) => entry.id).sort());
		session.restoreSwipeVersions([1, 2]);
		expect(session.getSwipeGroup()!.versions.map((entry) => entry.id)).toEqual(
			current.versions.map((entry) => entry.id),
		);
		session.shredLastMessages(1);
		expect(current.versions.every((entry) => selected.getEntry(entry.id) === undefined)).toBe(true);
	} finally {
		await resumed?.session.dispose();
		owner.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});

it("restores the policy inherited by a new id0 version instead of a later idle snapshot", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-version-policy-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		harness.session.setCustomSystemPrompt("ORIGINAL VERSION POLICY");
		harness.setResponses([fauxAssistantMessage("original version")]);
		await harness.session.prompt("question");
		harness.session.setCustomSystemPrompt("LATER IDLE POLICY");
		harness.session.applyMessageEdits(
			'<pi_edit id="0" role="assistant"><pi_content>edited version</pi_content></pi_edit>',
		);
		expect(manager.getSavedSystemPrompt()?.customPrompt).toBe("ORIGINAL VERSION POLICY");
		expect(harness.session.systemPrompt).toContain("ORIGINAL VERSION POLICY");
		expect(harness.session.systemPrompt).not.toContain("LATER IDLE POLICY");
	} finally {
		harness.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});
