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
