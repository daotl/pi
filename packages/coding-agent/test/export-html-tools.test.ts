import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { fauxAssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { exportSessionToHtml } from "../src/core/export-html/index.ts";
import { createToolHtmlRenderer } from "../src/core/export-html/tool-renderer.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { editRenderers } from "../src/core/tools/renderers/edit.ts";
import { writeRenderers } from "../src/core/tools/renderers/write.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function renderExportedCall(html: string, call: ToolCall): string {
	const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	if (!encoded) throw new Error("Missing exported session payload");
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	const viewer = scripts.pop();
	if (!viewer) throw new Error("Missing viewer script");
	const context = createContext({
		atob,
		TextDecoder,
		URLSearchParams,
		document: { getElementById: () => ({ textContent: encoded }), querySelector: () => null },
		window: { location: { search: "" } },
	});
	const render = runInContext(
		viewer.replace("function renderToolCall(call) {", "return renderToolCall; function renderToolCall(call) {"),
		context,
	) as (call: ToolCall) => string;
	return render(call);
}

describe("export HTML historical tool content", () => {
	it.each(["missing", "changed"] as const)(
		"renders the recorded successful edit diff after the target is %s",
		async (targetState) => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-export-edit-"));
			try {
				initTheme("dark", false);
				const target = join(cwd, "target.txt");
				writeFileSync(target, "recordedRemovedValue\n");
				const args = {
					path: "target.txt",
					edits: [{ oldText: "recordedRemovedValue", newText: "recordedAddedValue" }],
				};
				const tool = createEditToolDefinition(cwd);
				const result = await wrapToolDefinition(tool).execute("edit-1", args);
				if (targetState === "missing") rmSync(target);
				else writeFileSync(target, "unrelatedCurrentContents\n");
				const call: ToolCall = { type: "toolCall", id: "edit-1", name: "edit", arguments: args };
				const manager = SessionManager.create(cwd, cwd);
				manager.appendMessage({ role: "user", content: "edit the file", timestamp: 1 });
				manager.appendMessage({ ...fauxAssistantMessage(""), content: [call] });
				manager.appendMessage({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					...result,
					details: result.details ? { ...result.details } : undefined,
					isError: false,
					timestamp: 2,
				});
				const output = await exportSessionToHtml(manager, undefined, {
					outputPath: join(cwd, "out.html"),
					toolRenderer: createToolHtmlRenderer({
						getToolRenderers: (name) => (name === "edit" ? editRenderers : undefined),
						theme,
						cwd,
					}),
				});
				const rendered = renderExportedCall(readFileSync(output, "utf8"), call).replace(/<[^>]*>/g, "");
				expect(rendered).toMatch(/-1\s+recordedRemovedValue/);
				expect(rendered).toMatch(/\+1\s+recordedAddedValue/);
				expect(rendered).not.toContain("unrelatedCurrentContents");
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		},
	);

	it("shows the final line of a successful write longer than ten lines", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-export-write-"));
		try {
			initTheme("dark", false);
			const args = {
				path: "target.txt",
				content: Array.from({ length: 12 }, (_, index) => `write-line-${index + 1}`).join("\n"),
			};
			const tool = createWriteToolDefinition(cwd);
			const result = await wrapToolDefinition(tool).execute("write-1", args);
			const call: ToolCall = { type: "toolCall", id: "write-1", name: "write", arguments: args };
			const manager = SessionManager.create(cwd, cwd);
			manager.appendMessage({ role: "user", content: "write the file", timestamp: 1 });
			manager.appendMessage({ ...fauxAssistantMessage(""), content: [call] });
			manager.appendMessage({
				role: "toolResult",
				toolCallId: call.id,
				toolName: call.name,
				...result,
				isError: false,
				timestamp: 2,
			});
			const output = await exportSessionToHtml(manager, undefined, {
				outputPath: join(cwd, "out.html"),
				toolRenderer: createToolHtmlRenderer({
					getToolRenderers: (name) => (name === "write" ? writeRenderers : undefined),
					theme,
					cwd,
				}),
			});
			const rendered = renderExportedCall(readFileSync(output, "utf8"), call).replace(/<[^>]*>/g, "");
			for (const line of args.content.split("\n")) expect(rendered).toContain(line);
			expect(rendered).not.toContain("to expand");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
