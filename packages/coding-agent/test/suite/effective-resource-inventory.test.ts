import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { type AutocompleteProvider, Container } from "@earendil-works/pi-tui";
import { expect, it } from "vitest";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness, type Harness } from "./harness.ts";

it("keeps restored skill completion aligned with effective dispatch until explicit reload", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-effective-inventory-"));
	const cwd = join(root, "project"),
		agentDir = join(root, "agent"),
		skillDir = join(agentDir, "skills", "alpha");
	mkdirSync(cwd);
	mkdirSync(skillDir, { recursive: true });
	const path = join(skillDir, "SKILL.md");
	writeFileSync(path, "---\nname: alpha\ndescription: SAVED SKILL DESCRIPTION\n---\nbody");
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
	let harness: Harness | undefined;
	try {
		await loader.reload();
		const manager = SessionManager.create(cwd, join(root, "sessions"));
		harness = await createHarness({ cwd, sessionManager: manager, resourceLoader: loader });
		harness.setResponses([fauxAssistantMessage("seed")]);
		await harness.session.prompt("seed");
		const file = manager.getSessionFile()!;
		harness.cleanup();
		harness = undefined;
		writeFileSync(path, "---\nname: alpha\ndescription: CHANGED DISK DESCRIPTION\n---\nbody");
		await loader.reload();
		harness = await createHarness({ cwd, sessionManager: SessionManager.open(file), resourceLoader: loader });
		let installed: AutocompleteProvider | undefined;
		const mode = Object.assign(Object.create(InteractiveMode.prototype), {
			runtimeHost: { session: harness.session },
			skillCommands: new Map<string, string>(),
			fdPath: null,
			defaultEditor: {
				setAutocompleteProvider: (provider: AutocompleteProvider) => {
					installed = provider;
				},
			},
			editor: {},
			autocompleteProviderWrappers: [],
			loadedResourcesContainer: new Container(),
			options: { verbose: false },
			getBuiltInCommandConflictDiagnostics: () => [],
			showStatus: () => {},
		}) as {
			setupAutocompleteProvider(): void;
			handleUpdateCommand(arg: string): void;
			refreshEffectiveResources(): void;
		};
		mode.setupAutocompleteProvider();
		const suggestions = await installed!.getSuggestions(["/skill:al"], 0, 9, {
			signal: new AbortController().signal,
		});
		expect(suggestions?.items.find((item) => item.value === "skill:alpha")?.description).toContain(
			"SAVED SKILL DESCRIPTION",
		);
		mode.handleUpdateCommand("skills");
		const updated = await installed!.getSuggestions(["/skill:al"], 0, 9, { signal: new AbortController().signal });
		expect(updated?.items.find((item) => item.value === "skill:alpha")?.description).toContain(
			"CHANGED DISK DESCRIPTION",
		);
		const changedLeaf = harness.sessionManager.getLeafId()!;
		const savedLeaf = harness.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "assistant")!.id;
		await harness.session.navigateTree(savedLeaf);
		mode.refreshEffectiveResources();
		const selected = await installed!.getSuggestions(["/skill:al"], 0, 9, { signal: new AbortController().signal });
		expect(selected?.items.find((item) => item.value === "skill:alpha")?.description).toContain(
			"SAVED SKILL DESCRIPTION",
		);
		await harness.session.navigateTree(changedLeaf);
		mode.refreshEffectiveResources();
		const restored = await installed!.getSuggestions(["/skill:al"], 0, 9, { signal: new AbortController().signal });
		expect(restored?.items.find((item) => item.value === "skill:alpha")?.description).toContain(
			"CHANGED DISK DESCRIPTION",
		);
	} finally {
		harness?.cleanup();
		rmSync(root, { recursive: true, force: true });
	}
});
