import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { createHarness, type Harness } from "./harness.ts";

it("granular reload rereads changed and deleted resources through the same loader and persists them", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-granular-reload-"));
	let harness: Harness | undefined;
	try {
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		const skillDir = join(agentDir, "skills");
		const keptDir = join(skillDir, "kept-skill");
		const removedDir = join(skillDir, "removed-skill");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(keptDir, { recursive: true });
		mkdirSync(removedDir, { recursive: true });
		const systemPath = join(agentDir, "SYSTEM.md");
		const appendPath = join(agentDir, "APPEND_SYSTEM.md");
		const keptPath = join(keptDir, "SKILL.md");
		const removedPath = join(removedDir, "SKILL.md");
		writeFileSync(systemPath, "OLD PREAMBLE");
		writeFileSync(appendPath, "REMOVED ADDENDUM");
		writeFileSync(keptPath, "---\nname: kept-skill\ndescription: OLD SKILL DESCRIPTION\n---\nKept body");
		writeFileSync(removedPath, "---\nname: removed-skill\ndescription: REMOVED SKILL\n---\nRemoved body");
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir,
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			additionalSkillPaths: [skillDir],
			noThemes: true,
			noPromptTemplates: true,
			noContextFiles: true,
		});
		await loader.reload();
		const manager = SessionManager.create(cwd, join(root, "sessions"));
		harness = await createHarness({
			cwd,
			sessionManager: manager,
			resourceLoader: loader,
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
		});
		const requestPrompt = async () => {
			let request = "";
			harness!.setResponses([
				(context) => {
					request = getCurrentSystemPrompt(context.messages);
					return fauxAssistantMessage("inspected instructions");
				},
			]);
			await harness!.session.prompt("Inspect effective instructions");
			return request;
		};
		const initial = await requestPrompt();
		for (const marker of ["OLD PREAMBLE", "REMOVED ADDENDUM", "OLD SKILL DESCRIPTION", "REMOVED SKILL"]) {
			expect(initial).toContain(marker);
		}
		writeFileSync(systemPath, "UPDATED PREAMBLE");
		unlinkSync(appendPath);
		writeFileSync(keptPath, "---\nname: kept-skill\ndescription: UPDATED SKILL\n---\nKept body");
		unlinkSync(removedPath);
		const addedDir = join(skillDir, "added-skill");
		mkdirSync(addedDir);
		writeFileSync(join(addedDir, "SKILL.md"), "---\nname: added-skill\ndescription: ADDED SKILL\n---\nAdded body");
		harness.session.reloadSystemPromptFromFiles();
		const promptUpdated = await requestPrompt();
		expect(promptUpdated).toContain("UPDATED PREAMBLE");
		expect(promptUpdated).not.toContain("OLD PREAMBLE");
		expect(promptUpdated).not.toContain("REMOVED ADDENDUM");
		expect(promptUpdated).toContain("OLD SKILL DESCRIPTION");
		expect(promptUpdated).toContain("REMOVED SKILL");
		expect(promptUpdated).not.toContain("ADDED SKILL");
		harness.session.reloadSkillsFromFiles();
		const skillsUpdated = await requestPrompt();
		for (const marker of ["UPDATED PREAMBLE", "UPDATED SKILL", "ADDED SKILL"])
			expect(skillsUpdated).toContain(marker);
		for (const marker of [
			"OLD PREAMBLE",
			"REMOVED ADDENDUM",
			"OLD SKILL DESCRIPTION",
			"REMOVED SKILL",
			removedPath,
		]) {
			expect(skillsUpdated).not.toContain(marker);
		}
		const reopened = SessionManager.open(manager.getSessionFile()!);
		expect(reopened.getSavedSystemPrompt()?.systemPrompt).toBe(skillsUpdated);
		expect(
			reopened
				.getSavedSystemPrompt()
				?.skills?.map(({ name, description }) => ({ name, description }))
				.sort((a, b) => a.name.localeCompare(b.name)),
		).toEqual([
			{ name: "added-skill", description: "ADDED SKILL" },
			{ name: "kept-skill", description: "UPDATED SKILL" },
		]);
	} finally {
		harness?.cleanup();
		rmSync(root, { recursive: true, force: true });
	}
});
