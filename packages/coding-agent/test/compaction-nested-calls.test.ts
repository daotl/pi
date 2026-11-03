import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type Message,
	type Model,
} from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { generateBranchSummary, generateSummaryWithUsage } from "../src/core/compaction/index.ts";
import { computeFileLists, createFileOps, extractFileOpsFromMessage } from "../src/core/compaction/utils.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

describe("compaction file operations", () => {
	it.each(
		(["compact", "branch"] as const).flatMap((operation) =>
			(["error", "aborted", "user", "assistant"] as const).map((boundary) => ({ operation, boundary })),
		),
	)(
		"scopes nested file ownership across $boundary boundaries in $operation requests",
		async ({ operation, boundary }) => {
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
			const history: Message[] = [
				{ role: "user", content: "do work", timestamp: 0 },
				{
					...fauxAssistantMessage(""),
					content: [
						{ type: "toolCall", id: "code", name: "codemode", arguments: { code: "work" } },
						{ type: "toolCall", id: "sibling", name: "codemode", arguments: { code: "more work" } },
					],
					stopReason: "toolUse",
				},
				result,
				{ role: "system", content: "updated instructions", timestamp: 3 },
				{
					...result,
					toolCallId: "sibling",
					nestedCalls: {
						calls: [{ id: "sibling/read", name: "read", arguments: { path: "sibling.txt" }, status: "ok" }],
						complete: true,
					},
				},
				boundary === "user"
					? { role: "user", content: "new request", timestamp: 4 }
					: {
							...fauxAssistantMessage("next assistant"),
							content:
								boundary === "assistant"
									? [{ type: "text", text: "next assistant" }]
									: [{ type: "toolCall", id: "code", name: "codemode", arguments: { code: "interrupted" } }],
							stopReason: boundary === "assistant" ? "stop" : boundary,
						},
				{
					...result,
					nestedCalls: {
						calls: [
							{ id: "stale/read", name: "read", arguments: { path: "unowned-read.txt" }, status: "ok" },
							{ id: "stale/write", name: "write", arguments: { path: "unowned-write.txt" }, status: "ok" },
						],
						complete: true,
					},
				},
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
					readFiles: ["notes.txt", "sibling.txt"],
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
				expect(summary.readFiles).toEqual(["notes.txt", "sibling.txt"]);
				expect(summary.modifiedFiles).toEqual(["changed.txt"]);
				expect(summary.summary).toContain("notes.txt");
				expect(summary.summary).toContain("sibling.txt");
				expect(summary.summary).not.toContain("unowned-read.txt");
				expect(summary.summary).not.toContain("unowned-write.txt");
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
