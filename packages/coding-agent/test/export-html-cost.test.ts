import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { exportFromFile, exportSessionToHtml } from "../src/core/export-html/index.ts";
import { CURRENT_SESSION_VERSION, type SessionHeader, SessionManager } from "../src/core/session-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("export HTML cost", () => {
	it("exports renderer overrides for built-in tool calls and results", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-export-renderer-"));
		try {
			initTheme("dark");
			const manager = SessionManager.create(cwd, cwd);
			manager.appendMessage({ role: "user", content: "read", timestamp: 1 });
			manager.appendMessage({
				...fauxAssistantMessage(""),
				content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "file" } }],
			});
			manager.appendMessage({
				role: "toolResult",
				toolCallId: "read-1",
				toolName: "read",
				content: [
					{ type: "text", text: "raw" },
					{ type: "image", data: "cGl4ZWxz", mimeType: "image/png" },
				],
				isError: false,
				timestamp: 2,
			});
			const html = readFileSync(
				await exportSessionToHtml(manager, undefined, {
					outputPath: join(cwd, "out.html"),
					toolRenderer: {
						renderCall: (_id, name) => (name === "read" ? "custom read call" : undefined),
						renderResult: (_id, name) => (name === "read" ? { expanded: "custom read result" } : undefined),
					},
				}),
				"utf8",
			);
			const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
			if (!encoded) throw new Error("Missing exported session payload");
			const exported = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
				renderedTools: Record<string, unknown>;
			};
			expect(exported.renderedTools["read-1"]).toEqual({
				callHtml: "custom read call",
				resultHtmlExpanded: "custom read result",
			});
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
			) as (call: { id: string; name: string; arguments: object }) => string;
			const rendered = render({ id: "read-1", name: "read", arguments: { path: "file" } });
			expect(rendered).toContain("custom read call");
			expect(rendered).toContain("custom read result");
			expect(rendered).toContain('src="data:image/png;base64,cGl4ZWxz"');
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("exports recorded charges, legacy component sums, and summary usage without billing mirrors twice", async () => {
		// #9980: recorded totals can differ from the estimated components; old sessions omit total.
		const cwd = mkdtempSync(join(tmpdir(), "pi-export-cost-"));
		try {
			initTheme("dark");
			const header = {
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: "cost-test",
				timestamp: new Date(0).toISOString(),
				cwd,
			} satisfies SessionHeader;
			const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 };
			const recorded = {
				...usage,
				cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.9 },
			};
			const assistant = fauxAssistantMessage("recorded charge");
			const entries = [
				{
					type: "message",
					id: "recorded",
					parentId: null,
					timestamp: header.timestamp,
					message: { ...assistant, usage: recorded },
				},
				{
					type: "message",
					id: "legacy",
					parentId: "recorded",
					timestamp: header.timestamp,
					message: {
						...assistant,
						usage: { ...usage, cost: { input: 0.4, output: 0.1, cacheRead: 0, cacheWrite: 0 } },
					},
				},
				{
					type: "message",
					id: "mirror",
					usageSourceId: "recorded",
					parentId: "legacy",
					timestamp: header.timestamp,
					message: { ...assistant, usage: recorded },
				},
				{
					type: "compaction",
					id: "summary",
					parentId: "mirror",
					timestamp: header.timestamp,
					firstKeptEntryId: "legacy",
					summary: "checkpoint",
					tokensBefore: 10,
					usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } },
				},
			];
			const input = join(cwd, "session.jsonl");
			writeFileSync(input, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
			const html = readFileSync(await exportFromFile(input, join(cwd, "out.html")), "utf8");
			const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
			if (!encoded) throw new Error("Missing exported session payload");
			const exported = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
				usageTotals: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
			};
			expect(exported.usageTotals).toEqual({ input: 3, output: 6, cacheRead: 9, cacheWrite: 12, cost: 1.65 });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
