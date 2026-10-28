import { createAssistantMessageEventStream, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { generateBranchSummary, generateSummaryWithUsage } from "../src/core/compaction/index.ts";
import { computeFileLists, createFileOps, extractFileOpsFromMessage } from "../src/core/compaction/utils.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

describe("compaction file operations", () => {
	it.each(["compact", "branch"] as const)(
		"tracks authorized nested tool-result files through %s requests",
		async (operation) => {
			const model: Model<"openai-completions"> = {
				id: "offline",
				name: "Offline",
				api: "openai-completions",
				provider: "local",
				baseUrl: "https://example.invalid",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 8192,
				maxTokens: 1024,
			};
			const result: ToolResultMessage = {
				role: "toolResult",
				toolCallId: "code",
				toolName: "codemode",
				content: [{ type: "text", text: "done" }],
				isError: false,
				timestamp: 2,
				nestedCalls: {
					calls: [
						{ id: "read", name: "read", arguments: { path: "notes.txt" }, status: "ok" },
						{ id: "write", name: "write", arguments: { path: "changed.txt", content: "x" }, status: "ok" },
						{ id: "failed", name: "write", arguments: { path: "failed.txt" }, status: "error" },
						{ id: "unfinished", name: "read", arguments: { path: "unfinished.txt" }, status: "unfinished" },
					],
					complete: true,
				},
			};
			const history = [
				{ role: "user" as const, content: "do work", timestamp: 0 },
				{
					...fauxAssistantMessage(""),
					content: [{ type: "toolCall" as const, id: "code", name: "codemode", arguments: { code: "work" } }],
					stopReason: "toolUse" as const,
				},
				result,
			];
			const stream = () => {
				const value = createAssistantMessageEventStream();
				value.end(fauxAssistantMessage("summary"));
				return value;
			};
			if (operation === "compact") {
				const summary = await generateSummaryWithUsage(
					history,
					model,
					1024,
					"unused",
					undefined,
					undefined,
					undefined,
					undefined,
					stream,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					() => true,
				);
				expect(computeFileLists(summary.fileOps)).toEqual({
					readFiles: ["notes.txt"],
					modifiedFiles: ["changed.txt"],
				});
			} else {
				const entries: SessionEntry[] = history.map((message, index) => ({
					type: "message",
					id: String(index),
					parentId: index === 0 ? null : String(index - 1),
					timestamp: new Date(index).toISOString(),
					message,
				}));
				const summary = await generateBranchSummary(entries, {
					model,
					streamFn: stream,
					requestHistoryPolicy: () => true,
					signal: new AbortController().signal,
				});
				expect(summary.readFiles).toEqual(["notes.txt"]);
				expect(summary.modifiedFiles).toEqual(["changed.txt"]);
				expect(summary.summary).toContain("notes.txt");
				expect(summary.summary).toContain("changed.txt");
			}
		},
	);

	it("include files touched by nested calls recorded on tool results", () => {
		const result: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "codemode-1",
			toolName: "codemode",
			content: [],
			isError: false,
			timestamp: 0,
			nestedCalls: {
				calls: [
					{ id: "codemode-1/1", name: "read", arguments: { path: "a.ts" }, status: "ok" },
					{ id: "codemode-1/2", name: "edit", arguments: { path: "b.ts", edits: [] }, status: "ok" },
					{ id: "codemode-1/3", name: "write", argumentsBytes: 40000, status: "ok" },
				],
				complete: false,
			},
		};
		const fileOps = createFileOps();
		extractFileOpsFromMessage(result, fileOps);
		expect(computeFileLists(fileOps)).toEqual({ readFiles: ["a.ts"], modifiedFiles: ["b.ts"] });
	});
});
