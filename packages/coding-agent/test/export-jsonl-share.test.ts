import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import {
	type AssistantImages,
	type ClassifierModel,
	type ClassifierResult,
	fauxAssistantMessage,
	fauxToolCall,
	type ImageModel,
} from "@earendil-works/pi-ai";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai/compat";
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
import { type SessionEntry, SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { getUsageCostBreakdown, getUsageTotals } from "../src/core/usage-totals.ts";
import { createCodemodeExtension } from "../src/extensions/codemode/index.ts";
import { exportSessionForShare } from "../src/modes/interactive/session-share.ts";
import { createHarness, getToolResult } from "./suite/harness.ts";
import { assistantMsg, userMsg } from "./utilities.ts";

function exportUsage(input: number, cost: number): Usage {
	return {
		input,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input,
		cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

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
			const conversationRecords = records.filter(
				(record) => record.type !== "session" && record.type !== "leaf" && record.customType !== "pi.share",
			);
			expect(conversationRecords.map((record) => record.id)).toEqual(originalEntryIds);
			expect(conversationRecords.map((record) => record.parentId)).toEqual([null, ...originalEntryIds.slice(0, -1)]);
			expect(conversationRecords.slice(-3).map((record) => record.id)).toEqual([userId, assistantId, resultId]);

			const shareEntry = records.find((record) => record.customType === "pi.share") as {
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

	for (const format of ["jsonl", "radius"] as const) {
		it(`retains awaited classifier and image receipts when ${format} export is reopened`, async () => {
			const harness = await createHarness({
				initialActiveToolNames: ["codemode"],
				extensionFactories: [createCodemodeExtension()],
			});
			const classifier: ClassifierModel<"export-classifier"> = {
				type: "classifier",
				id: "judge",
				name: "Judge",
				api: "export-classifier",
				provider: "export-paid",
				baseUrl: "https://unused.test",
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1000,
			};
			const painter: ImageModel<"export-images"> = {
				type: "image",
				id: "painter",
				name: "Painter",
				api: "export-images",
				provider: "export-paid",
				baseUrl: "https://unused.test",
				input: ["text"],
				output: ["image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			};
			try {
				harness.session.modelRuntime.registerProvider("export-paid", {
					apiKey: "offline-key",
					models: [classifier, painter],
					classifiers: {
						"export-classifier": {
							classify: async (model): Promise<ClassifierResult> => ({
								api: model.api,
								provider: model.provider,
								model: model.id,
								answers: { approved: { type: "bool", probability: 0.9 } },
								usage: exportUsage(300, 0.125),
								stopReason: "stop",
								timestamp: 1,
							}),
						},
					},
					images: {
						"export-images": {
							generateImages: async (model): Promise<AssistantImages> => ({
								api: model.api,
								provider: model.provider,
								model: model.id,
								output: [],
								usage: exportUsage(100, 0.5),
								stopReason: "stop",
								timestamp: 2,
							}),
						},
					},
				});
				harness.setResponses([
					fauxAssistantMessage(
						[
							fauxToolCall("codemode", {
								code: `
									await models.classify({ provider: "export-paid", id: "judge" }, {
										state: { text: "good" },
										questions: { approved: { type: "bool", instructions: "Approval?", criteria: { true: "yes", false: "no" } } },
									});
									await models.generateImages({ provider: "export-paid", id: "painter" }, {
										input: [{ type: "text", text: "a fox" }],
									});
								`,
							}),
						],
						{ stopReason: "toolUse" },
					),
					fauxAssistantMessage("done"),
				]);
				await harness.session.prompt("classify and paint");
				const result = getToolResult(harness, "codemode");
				expect(result.isError).toBe(false);
				expect(result.usage).toBeUndefined();
				const manager = harness.sessionManager;
				const receipts = manager.getEntries().filter((entry) => entry.type === "usage");
				expect(receipts).toEqual([
					expect.objectContaining({
						kind: "codemode",
						provider: "export-paid",
						model: "judge",
						usage: exportUsage(300, 0.125),
					}),
					expect.objectContaining({
						kind: "codemode",
						provider: "export-paid",
						model: "painter",
						usage: exportUsage(100, 0.5),
					}),
				]);
				const branch = structuredClone(manager.getBranch());
				expect(receipts.every((receipt) => branch.some((entry) => entry.id === receipt.parentId))).toBe(true);
				expect(branch.some((entry) => entry.type === "usage")).toBe(false);
				const selected = manager.getLeafId();
				const path = join(harness.tempDir, `${format}.jsonl`);
				if (format === "jsonl") harness.session.exportToJsonl(path);
				else exportSessionForShare(path, harness.session);
				const imported = SessionManager.open(path);
				expect(imported.getEntries().filter((entry) => entry.type === "usage")).toEqual(receipts);
				expect(getUsageTotals(imported.getEntries()).cost).toBeCloseTo(harness.session.getSessionStats().cost, 10);
				expect(getUsageCostBreakdown(imported.getEntries())).toEqual(getUsageCostBreakdown(manager.getEntries()));
				expect(
					getUsageCostBreakdown(imported.getEntries()).filter((entry) => entry.key.startsWith("export-paid/")),
				).toEqual([
					{ key: "export-paid/painter", cost: 0.5, tokens: 100 },
					{ key: "export-paid/judge", cost: 0.125, tokens: 300 },
				]);
				const share = imported
					.getEntries()
					.find((entry) => entry.type === "custom" && entry.customType === "pi.share");
				expect(imported.getLeafId()).toBe(format === "radius" ? share?.id : selected);
				if (format === "radius") expect(share?.parentId).toBe(selected);
				expect(imported.buildSessionContext().messages).toEqual(manager.buildSessionContext().messages);
				expect(manager.getLeafId()).toBe(selected);
				expect(manager.getBranch()).toEqual(branch);
			} finally {
				harness.cleanup();
			}
		});

		it.each(["conversation", "ancestor", "usage", "empty"] as const)(
			`exports only branch-owned receipt chains and preserves %s selection in ${format}`,
			async (selection) => {
				const tempDir = mkdtempSync(join(tmpdir(), "pi-receipt-export-"));
				tempDirs.push(tempDir);
				const manager = SessionManager.inMemory(tempDir);
				const harness = await createHarness({ cwd: tempDir, sessionManager: manager });
				try {
					const root = manager.appendMessage(userMsg("selected question"));
					const owner = manager.appendMessage(assistantMsg("dispatch"));
					const inline = manager.appendUsage("cache_warm", "owned", "warm", exportUsage(10, 0.25));
					const conversation = manager.appendMessage(userMsg("selected continuation"));
					manager.branch(root);
					const unrelated = manager.appendMessage(assistantMsg("unrelated dispatch"));
					const excluded = manager.appendUsageAt(unrelated, "codemode", "other", "judge", exportUsage(1000, 8));
					const excludedChild = manager.appendUsageAt(
						excluded.id,
						"codemode",
						"other",
						"painter",
						exportUsage(2000, 16),
					);
					manager.branch(conversation);
					const first = manager.appendUsageAt(owner, "codemode", "owned", "judge", exportUsage(20, 0.5));
					const sameCharge = manager.appendUsageAt(owner, "codemode", "owned", "judge", exportUsage(20, 0.5));
					const nested = manager.appendUsageAt(first.id, "codemode", "owned", "painter", exportUsage(30, 0.75));
					let expectedReceipts = [inline, first, sameCharge, nested];
					if (selection === "ancestor") manager.branch(owner);
					else if (selection === "usage") manager.branch(first.id);
					else if (selection === "empty") {
						manager.resetLeaf();
						const rootReceipt = manager.appendUsageAt(null, "codemode", "root", "judge", exportUsage(40, 1));
						const childReceipt = manager.appendUsageAt(
							rootReceipt.id,
							"codemode",
							"root",
							"painter",
							exportUsage(50, 2),
						);
						expectedReceipts = [rootReceipt, childReceipt];
					}
					const selected = manager.getLeafId();
					const branch = structuredClone(manager.getBranch());
					const sourceEntries = structuredClone(manager.getEntries());
					const expectedEntries: SessionEntry[] = [
						...new Map([...branch, ...expectedReceipts].map((entry) => [entry.id, entry])).values(),
					];
					const path = join(tempDir, `${format}-${selection}.jsonl`);
					if (format === "jsonl") harness.session.exportToJsonl(path);
					else exportSessionForShare(path, harness.session);
					const records = readFileSync(path, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line) as { type: string; id?: string });
					const recordIds = records.flatMap((record) =>
						record.id === undefined || record.type === "session" ? [] : [record.id],
					);
					expect(new Set(recordIds).size).toBe(recordIds.length);
					const imported = SessionManager.open(path);
					const share = imported
						.getEntries()
						.find((entry) => entry.type === "custom" && entry.customType === "pi.share");
					const entries = imported.getEntries().filter((entry) => entry.id !== share?.id);
					expect(entries.map((entry) => entry.id).sort()).toEqual(expectedEntries.map((entry) => entry.id).sort());
					for (const entry of expectedEntries) expect(imported.getEntry(entry.id)).toEqual(entry);
					expect(imported.getEntry(excluded.id)).toBeUndefined();
					expect(imported.getEntry(excludedChild.id)).toBeUndefined();
					expect(imported.getEntry(unrelated)).toBeUndefined();
					expect(getUsageTotals(entries)).toEqual(
						selection === "empty"
							? { input: 90, output: 0, cacheRead: 0, cacheWrite: 0, cost: 3 }
							: { input: 81, output: 1, cacheRead: 0, cacheWrite: 0, cost: 2 },
					);
					expect(
						getUsageCostBreakdown(entries).filter((entry) =>
							entry.key.startsWith(selection === "empty" ? "root/" : "owned/"),
						),
					).toEqual(
						selection === "empty"
							? [
									{ key: "root/painter", cost: 2, tokens: 50 },
									{ key: "root/judge", cost: 1, tokens: 40 },
								]
							: [
									{ key: "owned/judge", cost: 1, tokens: 40 },
									{ key: "owned/painter", cost: 0.75, tokens: 30 },
									{ key: "owned/warm", cost: 0.25, tokens: 10 },
								],
					);
					const exportedLeaf = format === "radius" ? share?.id : selected;
					if (format === "radius") {
						expect(share).toBeDefined();
						expect(share?.parentId).toBe(selected);
					}
					expect(imported.getLeafId()).toBe(exportedLeaf);
					expect(imported.buildSessionContext().messages).toEqual(manager.buildSessionContext().messages);
					if (format === "jsonl") expect(imported.getBranch()).toEqual(branch);
					const next = imported.appendMessage(userMsg("continue imported selection"));
					expect(imported.getEntry(next)?.parentId).toBe(exportedLeaf);
					expect(SessionManager.open(path).getEntry(next)?.parentId).toBe(exportedLeaf);
					expect(manager.getEntries()).toEqual(sourceEntries);
					expect(manager.getLeafId()).toBe(selected);
				} finally {
					harness.cleanup();
				}
			},
		);
	}
});
