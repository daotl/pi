import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import type { Skill } from "../../src/core/skills.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { normalizeBuildSystemPromptOptions } from "../../src/core/system-prompt.ts";

describe("saved prompt snapshot ownership", () => {
	it("isolates original inputs and returned nested metadata", () => {
		const session = SessionManager.inMemory();
		const skill: Skill = {
			name: "alpha",
			description: "original",
			filePath: "/alpha/SKILL.md",
			baseDir: "/alpha",
			sourceInfo: createSyntheticSourceInfo("/alpha/SKILL.md", { source: "test" }),
			disableModelInvocation: false,
		};
		const expected = structuredClone(skill);
		const sections = { preamble: "original" };
		session.appendSystemPrompt("original", undefined, [skill], sections);
		skill.sourceInfo.path = "/mutated";
		sections.preamble = "mutated";
		expect(session.getSavedSystemPrompt()).toMatchObject({ skills: [expected], sections: { preamble: "original" } });
		const saved = session.getSavedSystemPrompt();
		if (!saved?.skills || !saved.sections) throw new Error("Missing snapshot");
		saved.skills[0].sourceInfo.path = "/consumer";
		saved.sections.preamble = "consumer";
		expect(session.getSavedSystemPrompt()).toMatchObject({ skills: [expected], sections: { preamble: "original" } });
	});

	it("does not expose stored sections through saved prompt reads", () => {
		const session = SessionManager.inMemory();
		session.appendSystemPrompt("original", undefined, undefined, { preamble: "original" });
		const saved = session.getSavedSystemPrompt();
		if (!saved?.sections) throw new Error("Missing snapshot");
		saved.sections.preamble = "consumer";
		expect(session.getSavedSystemPrompt()?.sections).toEqual({ preamble: "original" });
	});

	it("isolates context file records and arrays from original inputs and saved prompt readers", () => {
		const session = SessionManager.inMemory();
		const contextFiles = [
			{ path: "/project/AGENTS.md", content: "Original instructions." },
			{ path: "", content: "Legacy context body.", renderedProjectContext: true },
		];
		const expected = structuredClone(contextFiles);
		session.appendSystemPrompt("original", undefined, undefined, undefined, contextFiles);
		contextFiles[0].path = "/mutated/AGENTS.md";
		contextFiles[0].content = "Mutated instructions.";
		contextFiles[1].renderedProjectContext = false;
		contextFiles.push({ path: "/extra/AGENTS.md", content: "Extra instructions." });
		expect(session.getSavedSystemPrompt()?.contextFiles).toEqual(expected);

		const saved = session.getSavedSystemPrompt();
		if (!saved?.contextFiles) throw new Error("Missing snapshot");
		saved.contextFiles[0].path = "/consumer/AGENTS.md";
		saved.contextFiles[0].content = "Consumer instructions.";
		saved.contextFiles[1].renderedProjectContext = false;
		saved.contextFiles.pop();
		expect(session.getSavedSystemPrompt()?.contextFiles).toEqual(expected);
	});

	it("retains raw and opaque context snapshots when a session is reopened from disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "prompt-snapshot-"));
		try {
			const session = SessionManager.create(dir, dir);
			const contextFiles = [
				{ path: "/project/AGENTS.md", content: "Saved instructions." },
				{ path: "", content: "Saved legacy context.", renderedProjectContext: true },
			];
			const expected = structuredClone(contextFiles);
			session.appendSystemPrompt("saved", undefined, undefined, undefined, contextFiles);
			contextFiles[0].content = "Changed before the first message.";
			contextFiles[1].renderedProjectContext = false;
			session.appendMessage({ role: "user", content: "Resume this project.", timestamp: 1 });

			const reopened = SessionManager.open(session.getSessionFile()!, dir, dir);
			expect(reopened.getSavedSystemPrompt()?.contextFiles).toEqual(expected);
			const saved = reopened.getSavedSystemPrompt();
			if (!saved?.contextFiles) throw new Error("Missing snapshot");
			saved.contextFiles[0].content = "Changed by a reader after reopening.";
			saved.contextFiles[1].renderedProjectContext = false;
			expect(reopened.getSavedSystemPrompt()?.contextFiles).toEqual(expected);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not share nested skill metadata with mutable extension options", () => {
		const skill: Skill = {
			name: "alpha",
			description: "original",
			filePath: "/alpha/SKILL.md",
			baseDir: "/alpha",
			sourceInfo: createSyntheticSourceInfo("/alpha/SKILL.md", { source: "test" }),
			disableModelInvocation: false,
		};
		const normalized = normalizeBuildSystemPromptOptions({ cwd: "/project", skills: [skill] });
		normalized.skills[0].sourceInfo.path = "/extension";
		expect(skill.sourceInfo.path).toBe("/alpha/SKILL.md");
	});
});
