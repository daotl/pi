import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { fauxAssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { exportSessionToHtml } from "../src/core/export-html/index.ts";
import { createToolHtmlRenderer } from "../src/core/export-html/tool-renderer.ts";
import type { ToolRenderers } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createEditToolDefinition } from "../src/core/tools/edit.ts";
import { editRenderers } from "../src/core/tools/renderers/edit.ts";
import { readRenderers } from "../src/core/tools/renderers/read.ts";
import { writeRenderers } from "../src/core/tools/renderers/write.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";

function renderExportedCall(html: string, ownerId: string, leafId = ownerId): string {
	const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	if (!encoded) throw new Error("Missing exported session payload");
	const data = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	const viewer = scripts.pop();
	if (!viewer) throw new Error("Missing viewer script");
	const context = createContext({
		atob,
		TextDecoder,
		URLSearchParams,
		document: { getElementById: () => ({ textContent: encoded }), querySelector: () => null },
		window: { location: { search: `?leafId=${leafId}` } },
	});
	const render = runInContext(
		viewer.replace("function renderEntry(entry) {", "return renderEntry; function renderEntry(entry) {"),
		context,
	) as (entry: unknown) => string;
	return render(data.entries.find((entry: { id: string }) => entry.id === ownerId));
}

describe("export HTML historical tool content", () => {
	it("keeps successful read output collapsed and supports local and global expansion", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-export-read-"));
		try {
			initTheme("dark", false);
			const manager = SessionManager.create(cwd, cwd);
			const call: ToolCall = { type: "toolCall", id: "read-1", name: "read", arguments: { path: "read.txt" } };
			manager.appendMessage({ role: "user", content: "read the file", timestamp: 1 });
			const ownerId = manager.appendMessage({ ...fauxAssistantMessage(""), content: [call] });
			manager.appendMessage({
				role: "toolResult",
				toolCallId: call.id,
				toolName: call.name,
				content: [{ type: "text", text: "first recorded line\nlast recorded line" }],
				isError: false,
				timestamp: 2,
			});
			const html = readFileSync(
				await exportSessionToHtml(manager, undefined, {
					outputPath: join(cwd, "out.html"),
					toolRenderer: createToolHtmlRenderer({ getToolRenderers: () => readRenderers, theme, cwd }),
				}),
				"utf8",
			);
			const rendered = renderExportedCall(html, ownerId, manager.getLeafId()!);
			expect(rendered).toContain('class="tool-output expandable ansi-rendered"');
			const preview = rendered.match(/<div class="output-preview">([\s\S]*?)<\/div>/)?.[1];
			expect(preview).toContain("Click to expand output");
			expect(preview).not.toContain("first recorded line");
			expect(rendered).toMatch(/output-full[\s\S]*first recorded line[\s\S]*last recorded line/);
			const classes = new Set<string>();
			const output = {
				classList: {
					toggle: (name: string, force?: boolean) => {
						if (force ?? !classes.has(name)) classes.add(name);
						else classes.delete(name);
					},
				},
			};
			const click = rendered.match(/onclick="([^"]+)"/)?.[1];
			if (!click) throw new Error("Missing output click handler");
			const clickHandler = runInContext(
				`(function(){${click}})`,
				createContext({ window: { getSelection: () => "" } }),
			);
			clickHandler.call(output);
			expect(classes.has("expanded")).toBe(true);
			clickHandler.call(output);
			expect(classes.has("expanded")).toBe(false);
			const viewer = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1];
			const toggle = viewer?.match(/function setToolOutputsExpanded\(expanded\) \{([\s\S]*?)\n {6}\}/)?.[0];
			if (!toggle) throw new Error("Missing global tool toggle");
			const setExpanded = runInContext(
				`(function(){let toolOutputsExpanded;${toggle};return setToolOutputsExpanded;})()`,
				createContext({
					document: {
						querySelector: () => null,
						querySelectorAll: (selector: string) => (selector === ".tool-output.expandable" ? [output] : []),
					},
				}),
			);
			setExpanded(true);
			expect(classes.has("expanded")).toBe(true);
			setExpanded(false);
			expect(classes.has("expanded")).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it.each(["missing", "changed"] as const)(
		"isolates the recorded successful edit diff from error and pending siblings after the target is %s",
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
				const ownerId = manager.appendMessage({ ...fauxAssistantMessage(""), content: [call] });
				const successId = manager.appendMessage({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					...result,
					details: result.details ? { ...result.details } : undefined,
					isError: false,
					timestamp: 2,
				});
				manager.branch(ownerId);
				const errorId = manager.appendMessage({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [{ type: "text", text: "alternate edit failed" }],
					isError: true,
					timestamp: 3,
				});
				manager.branch(ownerId);
				const pendingId = manager.appendMessage({
					role: "user",
					content: "continue without the edit result",
					timestamp: 4,
				});
				const output = await exportSessionToHtml(manager, undefined, {
					outputPath: join(cwd, "out.html"),
					toolRenderer: createToolHtmlRenderer({
						getToolRenderers: (name) => (name === "edit" ? editRenderers : undefined),
						theme,
						cwd,
					}),
				});
				const html = readFileSync(output, "utf8");
				const rendered = renderExportedCall(html, ownerId, successId).replace(/<[^>]*>/g, "");
				expect(rendered).toMatch(/-1\s+recordedRemovedValue/);
				expect(rendered).toMatch(/\+1\s+recordedAddedValue/);
				expect(rendered).not.toContain("unrelatedCurrentContents");
				const errorHtml = renderExportedCall(html, ownerId, errorId);
				expect(errorHtml).toContain('class="tool-execution error"');
				expect(errorHtml).toContain("target.txt");
				expect(errorHtml).toContain("alternate edit failed");
				expect(errorHtml).not.toMatch(/recordedRemovedValue|recordedAddedValue|unrelatedCurrentContents/);
				const pendingHtml = renderExportedCall(html, ownerId, pendingId);
				expect(pendingHtml).toContain('class="tool-execution pending"');
				expect(pendingHtml).toContain("target.txt");
				expect(pendingHtml).not.toMatch(/recordedRemovedValue|recordedAddedValue|alternate edit failed/);
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
			const ownerId = manager.appendMessage({ ...fauxAssistantMessage(""), content: [call] });
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
			const rendered = renderExportedCall(readFileSync(output, "utf8"), ownerId, manager.getLeafId()!).replace(
				/<[^>]*>/g,
				"",
			);
			for (const line of args.content.split("\n")) expect(rendered).toContain(line);
			expect(rendered).not.toContain("to expand");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it.each(["builtin", "custom", "fallback"] as const)(
		"keeps edited calls, results, images and pending branches separate with %s renderers",
		async (mode) => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-export-branches-"));
			try {
				initTheme("dark", false);
				const name = mode === "custom" ? "branch_tool" : "read";
				const original: ToolCall = { type: "toolCall", id: "reused-call", name, arguments: { path: "/original" } };
				const edited: ToolCall = { ...original, arguments: { path: "/edited" } };
				const pending: ToolCall = { ...original, arguments: { path: "/pending" } };
				const manager = SessionManager.create(cwd, cwd);
				manager.appendMessage({ role: "user", content: "read", timestamp: 1 });
				const originalId = manager.appendMessage({ ...fauxAssistantMessage(""), content: [original] });
				const originalResultId = manager.appendMessage({
					role: "toolResult",
					toolCallId: original.id,
					toolName: name,
					content: [
						{ type: "text", text: "original-output" },
						{ type: "image", data: "b3JpZ2luYWw=", mimeType: "image/png" },
					],
					isError: false,
					timestamp: 2,
				});
				manager.replaceMessages([
					{ entryId: originalId, message: { ...fauxAssistantMessage(""), content: [edited] } },
				]);
				const editedId = manager.getLeafId()!;
				const editedResultId = manager.appendMessage({
					role: "toolResult",
					toolCallId: edited.id,
					toolName: name,
					content: [
						{ type: "text", text: "edited-output" },
						{ type: "image", data: "ZWRpdGVk", mimeType: "image/png" },
					],
					isError: true,
					timestamp: 3,
				});
				manager.replaceMessages([
					{ entryId: editedId, message: { ...fauxAssistantMessage(""), content: [pending] } },
				]);
				const pendingId = manager.getLeafId()!;
				manager.branch(originalId);
				const alternateResultId = manager.appendMessage({
					role: "toolResult",
					toolCallId: original.id,
					toolName: name,
					content: [
						{ type: "text", text: "alternate-output" },
						{ type: "image", data: "YWx0ZXJuYXRl", mimeType: "image/png" },
					],
					isError: true,
					timestamp: 4,
				});
				manager.branch(originalId);
				const siblingId = manager.appendMessage({
					role: "user",
					content: "continue without the result",
					timestamp: 4,
				});
				const custom: ToolRenderers = {
					renderCall(args, _theme, context) {
						if (!args || typeof args !== "object" || !("path" in args)) throw new Error("Missing path");
						context.state.path ??= args.path;
						const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
						text.setText(`custom call ${context.state.path}`);
						context.state.call = text;
						return text;
					},
					renderResult(result, _options, _theme, context) {
						const args = context.args;
						if (!args || typeof args !== "object" || !("path" in args)) throw new Error("Missing path");
						const path = args.path;
						context.state.call.setText(`custom call ${context.state.path} finalized ${path}`);
						const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
						text.setText(
							`custom result ${path} ${result.content
								.filter((c) => c.type === "text")
								.map((c) => c.text)
								.join("")}`,
						);
						return text;
					},
				};
				const html = readFileSync(
					await exportSessionToHtml(manager, undefined, {
						outputPath: join(cwd, "out.html"),
						toolRenderer:
							mode === "fallback"
								? undefined
								: createToolHtmlRenderer({
										getToolRenderers: (toolName) =>
											toolName === name ? (mode === "builtin" ? readRenderers : custom) : undefined,
										theme,
										cwd,
									}),
					}),
					"utf8",
				);
				const originalHtml = renderExportedCall(html, originalId, originalResultId);
				const editedHtml = renderExportedCall(html, editedId, editedResultId);
				const pendingHtml = renderExportedCall(html, pendingId);
				const siblingHtml = renderExportedCall(html, originalId, siblingId);
				const alternateHtml = renderExportedCall(html, originalId, alternateResultId);
				expect(originalHtml).toContain('class="tool-execution success"');
				expect(originalHtml).toContain("/original");
				expect(originalHtml).toContain("original-output");
				expect(originalHtml).toContain('src="data:image/png;base64,b3JpZ2luYWw="');
				expect(originalHtml).not.toMatch(/\/edited|\/pending|edited-output|alternate-output|ZWRpdGVk|YWx0ZXJuYXRl/);
				expect(editedHtml).toContain('class="tool-execution error"');
				expect(editedHtml).toContain("/edited");
				expect(editedHtml).toContain("edited-output");
				expect(editedHtml).toContain('src="data:image/png;base64,ZWRpdGVk"');
				expect(editedHtml).not.toMatch(/\/original|original-output|b3JpZ2luYWw=/);
				expect(alternateHtml).toContain('class="tool-execution error"');
				expect(alternateHtml).toContain("/original");
				expect(alternateHtml).toContain("alternate-output");
				expect(alternateHtml).toContain('src="data:image/png;base64,YWx0ZXJuYXRl"');
				expect(alternateHtml).not.toMatch(/original-output|edited-output|b3JpZ2luYWw=|ZWRpdGVk/);
				for (const [rendered, path] of [
					[pendingHtml, "/pending"],
					[siblingHtml, "/original"],
				]) {
					expect(rendered).toContain('class="tool-execution pending"');
					expect(rendered).toContain(path);
					expect(rendered).not.toMatch(/original-output|edited-output|alternate-output|tool-image|finalized/);
				}
				if (mode === "custom") {
					expect(originalHtml).toContain("custom result /original");
					expect(editedHtml).toContain("custom result /edited");
				}
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		},
	);
});
