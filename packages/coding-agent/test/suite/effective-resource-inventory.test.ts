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
import { createHarness, getMessageText, type Harness } from "./harness.ts";

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

it("keeps a saved skill over a newly discovered same-name path while admitting another skill", async () => {
	const root = mkdtempSync(join(tmpdir(), "pi-skill-name-collision-"));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	mkdirSync(cwd);
	const savedDir = join(root, "saved-alpha");
	const collisionDir = join(root, "discovered-alpha");
	const betaDir = join(root, "discovered-beta");
	for (const [directory, name, description, body] of [
		[savedDir, "alpha", "SAVED ALPHA", "saved alpha instructions"],
		[collisionDir, "alpha", "COLLIDING ALPHA", "wrong discovered alpha instructions"],
		[betaDir, "beta", "DISCOVERED BETA", "new beta instructions"],
	]) {
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
	}
	const seedLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		noExtensions: true,
		noSkills: true,
		additionalSkillPaths: [savedDir],
		noThemes: true,
		noPromptTemplates: true,
		noContextFiles: true,
	});
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
		noSkills: true,
		noThemes: true,
		noPromptTemplates: true,
		noContextFiles: true,
		extensionFactories: [
			(pi) => {
				pi.on("resources_discover", () => ({ skillPaths: [collisionDir, betaDir] }));
			},
		],
	});
	let active: Harness | undefined;
	try {
		await seedLoader.reload();
		await loader.reload();
		const saved = seedLoader.getSkills().skills.find((skill) => skill.name === "alpha");
		if (!saved) throw new Error("Missing saved alpha fixture");
		expect(loader.getSkills().skills).toEqual([]);
		const manager = SessionManager.create(cwd, join(root, "sessions"));
		manager.appendSystemPrompt("saved policy", undefined, [saved]);
		manager.appendMessage({ role: "user", content: "historical context", timestamp: 1 });
		active = await createHarness({
			cwd,
			sessionManager: manager,
			resourceLoader: loader,
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
		});
		await active.session.bindExtensions({});
		expect(loader.getSkills().skills.map((skill) => [skill.name, skill.filePath])).toEqual([
			["alpha", join(collisionDir, "SKILL.md")],
			["beta", join(betaDir, "SKILL.md")],
		]);
		expect(active.session.getEffectiveSkills().map((skill) => [skill.name, skill.filePath])).toEqual([
			["alpha", join(savedDir, "SKILL.md")],
			["beta", join(betaDir, "SKILL.md")],
		]);
		const requests: string[] = [];
		active.setResponses(
			Array.from({ length: 2 }, () => (context) => {
				requests.push(getMessageText(context.messages.filter((message) => message.role === "user").at(-1)));
				return fauxAssistantMessage("accepted skill");
			}),
		);
		await active.session.prompt("/skill:alpha task");
		await active.session.prompt("/skill:beta task");
		expect(requests[0]).toContain(`location="${join(savedDir, "SKILL.md")}"`);
		expect(requests[0]).toContain("saved alpha instructions");
		expect(requests[0]).not.toContain("wrong discovered alpha instructions");
		expect(requests[1]).toContain("new beta instructions");
		expect(active.session.systemPrompt).toContain("SAVED ALPHA");
		expect(active.session.systemPrompt).toContain("DISCOVERED BETA");
		expect(active.session.systemPrompt).not.toContain("COLLIDING ALPHA");
	} finally {
		active?.cleanup();
		rmSync(root, { recursive: true, force: true });
	}
});
