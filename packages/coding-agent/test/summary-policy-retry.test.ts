import { Agent, type AgentMessage, type StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, type Message } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { generateBranchSummary, generateSummaryWithUsage } from "../src/core/compaction/index.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

it.each(["compact", "branch"] as const)(
	"rebuilds isolated %s retry history with live policy and payload callbacks",
	async (operation) => {
		const source: AgentMessage[] = [{ role: "user", content: "original history", timestamp: 1 }];
		const snapshots: string[] = [];
		const payloads: unknown[] = [];
		let attempt = 0;
		const agent = new Agent({
			incomingMessagePrefix: "FIRST PREFIX ",
			streamFn: () => {
				throw new Error("Unexpected normal dispatch");
			},
		});
		agent.transformContext = async (messages) => {
			const user = messages.find((message) => message.role === "user");
			if (user?.role === "user") user.content = `FIRST POLICY ${user.content}`;
			await Promise.resolve();
			agent.onPayload = () => ({ policy: "first payload" });
			return messages;
		};
		const streamFn: StreamFn = (_model, context, options) => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(async () => {
				snapshots.push(JSON.stringify(context.messages));
				payloads.push(await options?.onPayload?.({ history: context.messages }, _model));
				attempt++;
				if (attempt === 1) {
					context.messages.push({ role: "user", content: "TRANSPORT FIRST ATTEMPT MUTATION", timestamp: 2 });
					agent.incomingMessagePrefix = "SECOND PREFIX ";
					agent.transformContext = async (messages) => {
						const user = messages.find((message) => message.role === "user");
						if (user?.role === "user") user.content = `SECOND POLICY ${user.content}`;
						await Promise.resolve();
						agent.onPayload = () => ({ policy: "second payload" });
						return messages;
					};
					stream.push({
						type: "error",
						reason: "error",
						error: fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." }),
					});
				} else stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("policy-safe summary") });
			});
			return stream;
		};
		const model = {
			id: "test",
			name: "test",
			api: "openai-completions",
			provider: "test",
			baseUrl: "https://example.invalid/v1",
			reasoning: false,
			input: ["text"] as ("text" | "image")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 10000,
			maxTokens: 1000,
		};
		const retry = { enabled: true, maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 };
		if (operation === "compact")
			await generateSummaryWithUsage(
				source,
				model,
				1000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				streamFn,
				undefined,
				retry,
				undefined,
				undefined,
				"SAFE BASE POLICY",
				agent,
			);
		else {
			const entries: SessionEntry[] = [
				{
					type: "message",
					id: "history",
					parentId: null,
					timestamp: new Date(1).toISOString(),
					message: source[0],
				},
			];
			await generateBranchSummary(entries, {
				model,
				agent,
				streamFn,
				retry,
				systemPrompt: "SAFE BASE POLICY",
				signal: new AbortController().signal,
			});
		}
		expect(snapshots).toHaveLength(2);
		expect(snapshots[0]).toContain("FIRST PREFIX FIRST POLICY original history");
		expect(snapshots[1]).toContain("SECOND PREFIX SECOND POLICY original history");
		expect(snapshots[1]).not.toContain("FIRST POLICY");
		expect(snapshots[1]).not.toContain("TRANSPORT FIRST ATTEMPT MUTATION");
		expect(payloads).toEqual([{ policy: "first payload" }, { policy: "second payload" }]);
		expect(source).toEqual([{ role: "user", content: "original history", timestamp: 1 }]);
	},
);

it.each(["compact", "branch"] as const)(
	"isolates converter input references from %s transport mutations",
	async (operation) => {
		const shared: Message[] = [{ role: "user", content: "SHARED CONVERTER HISTORY", timestamp: 1 }];
		const original = structuredClone(shared);
		const agent = new Agent({
			convertToLlm: (messages) =>
				messages.filter(
					(message): message is Message =>
						message.role === "user" ||
						message.role === "assistant" ||
						message.role === "system" ||
						message.role === "toolResult",
				),
			streamFn: () => {
				throw new Error("Unexpected normal dispatch");
			},
		});
		const snapshots: string[] = [];
		const model = {
			id: "test",
			name: "test",
			api: "openai-completions",
			provider: "test",
			baseUrl: "https://example.invalid/v1",
			reasoning: false,
			input: ["text"] as ("text" | "image")[],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 10000,
			maxTokens: 1000,
		};
		const streamFn: StreamFn = (_model, context) => {
			snapshots.push(JSON.stringify(context.messages));
			context.messages.find((message) => message.role === "user")!.content = "TRANSPORT MUTATION";
			const stream = createAssistantMessageEventStream();
			if (snapshots.length === 1)
				stream.push({
					type: "error",
					reason: "error",
					error: fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." }),
				});
			else stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("isolated summary") });
			return stream;
		};
		const retry = { enabled: true, maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 };
		if (operation === "compact") {
			const result = await generateSummaryWithUsage(
				shared,
				model,
				1000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				streamFn,
				undefined,
				retry,
				undefined,
				undefined,
				undefined,
				agent,
			);
			expect(result.text).toBe("isolated summary");
		} else {
			const result = await generateBranchSummary(
				[
					{
						type: "message",
						id: "shared",
						parentId: null,
						timestamp: new Date(1).toISOString(),
						message: shared[0],
					},
				],
				{ model, agent, streamFn, retry, signal: new AbortController().signal },
			);
			expect(result.summary).toContain("isolated summary");
		}
		expect(snapshots).toHaveLength(2);
		for (const snapshot of snapshots) {
			expect(snapshot).toContain("SHARED CONVERTER HISTORY");
			expect(snapshot).not.toContain("TRANSPORT MUTATION");
		}
		expect(shared).toEqual(original);
	},
);
