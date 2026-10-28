import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "../../agent/src/harness/context.ts";
import { NodeExecutionEnv } from "../../agent/src/harness/env/nodejs.ts";
import { JsonlStorage } from "../../agent/src/harness/session/jsonl/storage.ts";
import { branchTip } from "../../agent/src/harness/session/values.ts";
import { getExportTemplateDir } from "../src/config.ts";
import { defineTool } from "../src/core/extensions/types.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { exportSessionForShare } from "../src/modes/interactive/session-share.ts";
import { assistantMsg, userMsg } from "./utilities.ts";

describe("JSONL share export", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it.each(["a", null])("imports the downloaded selection %s rather than the abandoned tail", async (leafId) => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-download-checkpoint-"));
		tempDirs.push(tempDir);
		const source = readFileSync(join(getExportTemplateDir(), "template.js"), "utf8");
		const start = source.indexOf("window.downloadSessionJson = function()");
		const download = source.slice(start, source.indexOf("\n      }", start) + 8);
		let blob: Blob | undefined;
		const sandbox = {
			window: {} as { downloadSessionJson?: () => void },
			header: { type: "session", version: 3, id: "export", timestamp: new Date(1).toISOString(), cwd: tempDir },
			entries: [
				{
					type: "message",
					id: "a",
					parentId: null,
					timestamp: new Date(1).toISOString(),
					message: userMsg("root"),
				},
				{
					type: "message",
					id: "b",
					parentId: "a",
					timestamp: new Date(2).toISOString(),
					message: userMsg("abandoned tail"),
				},
			],
			defaultLeafId: leafId,
			Blob,
			URL: {
				createObjectURL: (value: Blob) => {
					blob = value;
					return "blob:download";
				},
				revokeObjectURL: () => {},
			},
			document: {
				createElement: () => ({ click: () => {} }),
				body: { appendChild: () => {}, removeChild: () => {} },
			},
		};
		runInNewContext(download, sandbox);
		sandbox.window.downloadSessionJson?.();
		if (!blob) throw new Error("Download did not create a Blob");
		const path = join(tempDir, "download.jsonl");
		writeFileSync(path, await blob.text());
		const storage = await JsonlStorage.open(
			{ fileSystem: new NodeExecutionEnv({ cwd: tempDir }), path },
			BACKGROUND_CONTEXT,
		);
		try {
			const checkpoint = await storage.getValue(branchTip("main"), BACKGROUND_CONTEXT);
			expect(checkpoint).toBeDefined();
			const tip = checkpoint?.value;
			if (leafId === null) expect(tip).toBeNull();
			else {
				const entries = await storage.scanEntries({ order: "asc" }, BACKGROUND_CONTEXT);
				const selected = entries.find((entry) => entry.id === tip);
				expect(selected?.type).toBe("message");
				if (selected?.type !== "message") throw new Error("Selected entry is not a message");
				expect(selected.message).toMatchObject({ role: "user", content: "root" });
			}
		} finally {
			await storage.close(BACKGROUND_CONTEXT);
		}
	});

	it("adds presentation data without changing conversation IDs or links", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-jsonl-share-"));
		tempDirs.push(tempDir);
		const sessionManager = SessionManager.inMemory(tempDir);
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: join(tempDir, "agent"),
			model: getModel("anthropic", "claude-sonnet-4-5")!,
			settingsManager: SettingsManager.inMemory(),
			sessionManager,
			tools: ["share_tool"],
			customTools: [
				defineTool({
					name: "share_tool",
					label: "Share Tool",
					description: "Render a value for sharing",
					parameters: Type.Object({ value: Type.String({ description: "Value to render" }) }),
					execute: async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
				}),
			],
		});

		try {
			const userId = sessionManager.appendMessage(userMsg("hello"));
			const assistant: AssistantMessage = {
				...assistantMsg(""),
				content: [{ type: "toolCall", id: "call-1", name: "share_tool", arguments: { value: "example" } }],
				stopReason: "toolUse",
			};
			const assistantId = sessionManager.appendMessage(assistant);
			const result: ToolResultMessage = {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "share_tool",
				content: [{ type: "text", text: "done" }],
				details: {},
				isError: false,
				timestamp: Date.now(),
			};
			const resultId = sessionManager.appendMessage(result);
			const originalEntryIds = sessionManager.getBranch().map((entry) => entry.id);

			const normalPath = join(tempDir, "normal.jsonl");
			session.exportToJsonl(normalPath);
			const normalRecords = readFileSync(normalPath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			expect(normalRecords.some((record) => record.type === "custom" && record.customType === "pi.share")).toBe(
				false,
			);

			const sharePath = join(tempDir, "share.jsonl");
			exportSessionForShare(sharePath, session);
			const records = readFileSync(sharePath, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			const conversationRecords = records.slice(1, -1);
			expect(conversationRecords.map((record) => record.id)).toEqual(originalEntryIds);
			expect(conversationRecords.map((record) => record.parentId)).toEqual([null, ...originalEntryIds.slice(0, -1)]);
			expect(conversationRecords.slice(-3).map((record) => record.id)).toEqual([userId, assistantId, resultId]);

			const shareEntry = records.at(-1) as {
				id: string;
				data?: {
					systemPrompt?: string;
					tools?: Array<Record<string, unknown>>;
				};
			};
			expect(shareEntry).toMatchObject({
				type: "custom",
				customType: "pi.share",
				parentId: resultId,
				timestamp: expect.any(String),
			});
			expect(shareEntry.data?.systemPrompt).toBe(session.state.systemPrompt);
			expect(shareEntry.data?.tools).toEqual([
				expect.objectContaining({
					name: "share_tool",
					description: "Render a value for sharing",
				}),
			]);
			expect(shareEntry.data).not.toHaveProperty("renderedTools");
			expect(shareEntry.data).not.toHaveProperty("theme");
			expect(shareEntry.data).not.toHaveProperty("version");

			const imported = SessionManager.open(sharePath);
			expect(imported.getLeafId()).toBe(shareEntry.id);
			expect(imported.buildSessionContext().messages.map((message) => message.role)).toEqual([
				"user",
				"assistant",
				"toolResult",
			]);
		} finally {
			session.dispose();
		}
	});
});
