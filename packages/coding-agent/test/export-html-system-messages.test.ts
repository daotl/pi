import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import type { SystemMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { exportFromFile } from "../src/core/export-html/index.ts";
import { CURRENT_SESSION_VERSION } from "../src/core/session-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

async function loadExportedRenderer(
	entries: unknown[],
	functionName = "renderEntry",
): Promise<(entry: unknown) => string> {
	initTheme("dark");
	const cwd = mkdtempSync(join(tmpdir(), "pi-export-system-"));
	tempDirs.push(cwd);
	const sessionPath = join(cwd, "session.jsonl");
	const header = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: "system-test",
		timestamp: new Date(0).toISOString(),
		cwd,
	};
	writeFileSync(sessionPath, [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n"));
	const html = readFileSync(await exportFromFile(sessionPath, join(cwd, "out.html")), "utf8");
	const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	const viewer = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
	if (!encoded || !viewer) throw new Error("Missing exported session payload or viewer script");
	const context = createContext({
		atob,
		TextDecoder,
		URLSearchParams,
		document: { getElementById: () => ({ textContent: encoded }), querySelector: () => null },
		window: { location: { search: "" } },
	});
	return runInContext(
		viewer.replace("function renderEntry(entry) {", `return ${functionName}; function renderEntry(entry) {`),
		context,
	) as (entry: unknown) => string;
}

const initial: SystemMessage = {
	role: "system",
	content: "You are a helpful assistant.",
	sections: { rules: "<rules>\nbe concise\n</rules>", project_context: "<project_context>\nv1\n</project_context>" },
	toolsAdded: [{ name: "read", description: "Read a file", parameters: { type: "object", properties: {} } as never }],
	timestamp: 1,
};

const update: SystemMessage = {
	role: "system",
	content: [{ type: "text", text: "Extra instructions" }],
	sections: { project_context: "<project_context>\nv2\n</project_context>", rules: null },
	toolsAdded: [
		{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } as never },
	],
	toolsRemoved: [{ name: "read" }],
	timestamp: 2,
};

const entries = [
	{ type: "message", id: "s1", parentId: null, message: initial },
	{ type: "message", id: "u1", parentId: "s1", message: { role: "user", content: "hi" } },
	{ type: "message", id: "s2", parentId: "u1", message: update },
];

// Regression tests for #11261: system messages were stored in the export but never rendered.
describe("export HTML system messages", () => {
	it("renders the initial prompt, sections and available tools in the transcript", async () => {
		const render = await loadExportedRenderer(entries);
		const html = render(entries[0]);
		expect(html).toContain('class="system-entry" id="entry-s1"');
		expect(html).toContain("System Prompt</div>");
		expect(html).not.toContain("System Prompt Update");
		expect(html).toContain("You are a helpful assistant.");
		expect(html).toContain("&lt;rules&gt;\nbe concise\n&lt;/rules&gt;");
		expect(html).toContain("&lt;project_context&gt;\nv1\n&lt;/project_context&gt;");
		expect(html).toContain("Available Tools</div>");
		expect(html).toContain('class="tool-item-name">read</span>');
		expect(html).toContain("Read a file");
	});

	it("renders later instructions, changed sections and added and removed tools", async () => {
		const render = await loadExportedRenderer(entries);
		const html = render(entries[2]);
		expect(html).toContain('class="system-entry" id="entry-s2"');
		expect(html).toContain("System Prompt Update: instructions, project_context, -rules, tools +bash -read");
		expect(html).toContain("Extra instructions");
		expect(html).toContain("Updated system prompt section &quot;project_context&quot;:");
		expect(html).toContain("&lt;project_context&gt;\nv2\n&lt;/project_context&gt;");
		expect(html).toContain("Removed system prompt section &quot;rules&quot;.");
		expect(html).toContain("Tools Added</div>");
		expect(html).toContain('class="tool-item-name">bash</span>');
		expect(html).toContain("Run a command");
		expect(html).toContain(
			'Tools Removed</div><div class="tools-content"><div class="tool-item"><span class="tool-item-name">read</span>',
		);
		expect(html).not.toContain("Available Tools");
		expect(html).not.toContain("be concise");
	});

	it("renders a system entry after a compaction snapshot as an update", async () => {
		const compacted = [
			{
				type: "compaction",
				id: "c1",
				parentId: null,
				summary: "Prior work",
				firstKeptEntryId: "s2",
				tokensBefore: 100,
				systemMessage: initial,
			},
			{ type: "message", id: "s2", parentId: "c1", message: update },
		];
		const render = await loadExportedRenderer(compacted);
		const baseline = render(compacted[0]);
		expect(baseline).toContain("System Prompt</div>");
		expect(baseline).toContain("You are a helpful assistant.");
		expect(baseline).toContain("&lt;rules&gt;\nbe concise\n&lt;/rules&gt;");
		expect(baseline).toContain("Available Tools</div>");
		expect(baseline).toContain('class="tool-item-name">read</span>');
		expect(baseline).toContain("Prior work");
		const search = await loadExportedRenderer(compacted, "getSearchableText");
		expect(search(compacted[0])).toContain("you are a helpful assistant.");
		expect(search(compacted[0])).toContain("read");
		const html = render(compacted[1]);
		expect(html).toContain("System Prompt Update:");
		expect(html).toContain("Extra instructions");
		expect(html).toContain("Tools Added");
		expect(html).toContain("Tools Removed");
		expect(html).not.toContain("Available Tools");
	});
});
