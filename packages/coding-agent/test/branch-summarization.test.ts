import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	getCurrentSystemPrompt,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { generateBranchSummary } from "../src/core/compaction/index.ts";
import { type SessionEntry, SessionManager } from "../src/core/session-manager.ts";

const model: Model<"anthropic-messages"> = {
	id: "test-model",
	name: "Test Model",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://api.anthropic.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
};

const entries: SessionEntry[] = [
	{
		type: "message",
		id: "branch-user",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		message: { role: "user", content: "Abandoned request", timestamp: 1 },
	},
];

function response(content: AssistantMessage["content"]): AssistantMessage {
	return {
		...fauxAssistantMessage(""),
		content,
		api: model.api,
		provider: model.provider,
		model: model.id,
	};
}

describe("branch summarization", () => {
	it("does not override tool choice for branch summaries", async () => {
		let requestOptions: SimpleStreamOptions | undefined;
		const streamFn: StreamFn = (_model, _context, options) => {
			requestOptions = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: response([{ type: "text", text: "summary" }]) }),
			);
			return stream;
		};

		await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
		});

		expect(requestOptions?.maxTokens).toBe(4096);
		expect(requestOptions?.toolChoice).toBeUndefined();
	});

	it("preserves a standalone caller's explicit policy without duplicating the system baseline", async () => {
		let policy = "";
		const result = await generateBranchSummary(entries, {
			model,
			systemPrompt: "STANDALONE SUMMARY POLICY",
			signal: new AbortController().signal,
			streamFn: (_model, context) => {
				policy = getCurrentSystemPrompt(context.messages);
				const stream = createAssistantMessageEventStream();
				stream.end(response([{ type: "text", text: "Standalone summary" }]));
				return stream;
			},
		});
		expect(policy).toBe("STANDALONE SUMMARY POLICY");
		expect(result.summary).toContain("Standalone summary");
	});

	it.each([false, true])(
		"keeps complete policy before a leading branch section delta with agent=%s",
		async (withAgent) => {
			const delta: SessionEntry = {
				type: "message",
				id: "policy-delta",
				parentId: "prior-answer",
				timestamp: new Date(2).toISOString(),
				message: {
					role: "system",
					content: "",
					sections: { rules: "<rules>\nCURRENT BRANCH RULE\n</rules>" },
					timestamp: 2,
				},
			};
			const branch = [delta, ...entries];
			const agent = withAgent
				? new Agent({
						streamFn: () => {
							throw new Error("Unexpected normal request");
						},
						initialState: {
							messages: [
								{
									role: "system",
									content: "",
									sections: { preamble: "COMPLETE BRANCH POLICY", cwd: "<cwd>\n/project\n</cwd>" },
									timestamp: 0,
								},
								{ ...response([{ type: "text", text: "prior answer" }]) },
								delta.message,
								entries[0].type === "message"
									? entries[0].message
									: { role: "user", content: "branch", timestamp: 3 },
							],
						},
					})
				: undefined;
			let sent: TranscriptContext | undefined;
			await generateBranchSummary(branch, {
				model,
				agent,
				systemPrompt: withAgent ? undefined : "COMPLETE BRANCH POLICY",
				signal: new AbortController().signal,
				streamFn: (_model, context) => {
					sent = context;
					const stream = createAssistantMessageEventStream();
					stream.end(response([{ type: "text", text: "summary" }]));
					return stream;
				},
			});
			expect(getCurrentSystemPrompt(sent!.messages)).toContain("COMPLETE BRANCH POLICY");
			expect(getCurrentSystemPrompt(sent!.messages)).toContain("CURRENT BRANCH RULE");
			if (withAgent) expect(getCurrentSystemPrompt(sent!.messages)).toContain("<cwd>\n/project\n</cwd>");
		},
	);

	it("keeps the transformed policy and tool declarations together in the native leading system message", async () => {
		const agent = new Agent({
			streamFn: () => {
				throw new Error("Unexpected normal request");
			},
			initialState: {
				systemPrompt: "ORIGINAL POLICY",
				tools: [
					{
						name: "inspect",
						label: "Inspect",
						description: "Inspect values",
						parameters: { type: "object", properties: {} },
						execute: async () => ({ content: [{ type: "text", text: "inspected" }], details: {} }),
					},
				],
			},
			transformContext: async (messages) =>
				messages.map((message) =>
					message.role === "system" ? { ...message, content: "TRANSFORMED POLICY" } : message,
				),
		});
		let sent: TranscriptContext | undefined;
		await generateBranchSummary(entries, {
			model,
			agent,
			signal: new AbortController().signal,
			streamFn: (_model, context) => {
				sent = context;
				const stream = createAssistantMessageEventStream();
				stream.end(response([{ type: "text", text: "summary" }]));
				return stream;
			},
		});
		expect(getCurrentSystemPrompt([sent!.messages[0]])).toBe("TRANSFORMED POLICY");
		expect(sent!.messages[0]).toMatchObject({
			role: "system",
			toolsAdded: [expect.objectContaining({ name: "inspect" })],
		});
		expect(sent!.messages.filter((message) => message.role === "system")).toHaveLength(1);
	});

	it("uses the old-branch projection rather than an unrelated live policy", async () => {
		const manager = SessionManager.inMemory("/old-branch");
		manager.appendMessage({
			role: "system",
			content: "",
			sections: { preamble: "OLD BRANCH POLICY", cwd: "<cwd>\n/old-branch\n</cwd>" },
			timestamp: 0,
		});
		manager.appendMessage({ role: "user", content: "shared input", timestamp: 1 });
		manager.appendMessage(response([{ type: "text", text: "shared answer" }]));
		const delta = manager.appendMessage({
			role: "system",
			content: "",
			sections: { rules: "<rules>\nOLD BRANCH DELTA\n</rules>" },
			timestamp: 2,
		});
		manager.appendMessage({ role: "user", content: "abandoned branch input", timestamp: 3 });
		const branch = manager.getBranch();
		const selected = structuredClone(branch.slice(branch.findIndex((entry) => entry.id === delta)));
		const agent = new Agent({
			initialState: { systemPrompt: "UNRELATED CURRENT POLICY" },
			streamFn: () => {
				throw new Error("Unexpected normal request");
			},
		});
		let policy = "";
		await generateBranchSummary(selected, {
			model,
			agent,
			contextProjection: manager.buildSessionProjection(),
			signal: new AbortController().signal,
			streamFn: (_model, context) => {
				policy = getCurrentSystemPrompt(context.messages);
				const stream = createAssistantMessageEventStream();
				stream.end(response([{ type: "text", text: "summary" }]));
				return stream;
			},
		});
		expect(policy).toContain("OLD BRANCH POLICY");
		expect(policy).toContain("OLD BRANCH DELTA");
		expect(policy).not.toContain("UNRELATED CURRENT POLICY");
	});

	it("rejects branch entries outside the supplied policy projection", async () => {
		const unrelated = SessionManager.inMemory("/unrelated");
		unrelated.appendMessage({ role: "user", content: "other branch", timestamp: 0 });
		const result = await generateBranchSummary(entries, {
			model,
			contextProjection: unrelated.buildSessionProjection(),
			signal: new AbortController().signal,
			streamFn: () => {
				throw new Error("Mismatched policy must not dispatch");
			},
		});
		expect(result).toMatchObject({ error: expect.any(String) });
		expect(result.summary).toBeUndefined();
	});

	it("uses the live Agent request prefix for branch history only", async () => {
		const agent = new Agent({
			incomingMessagePrefix: "[branch] ",
			streamFn: () => {
				throw new Error("unused normal request");
			},
		});
		let sent: unknown;
		await generateBranchSummary(entries, {
			model,
			agent,
			signal: new AbortController().signal,
			streamFn: (_model, context) => {
				sent = context.messages;
				const stream = createAssistantMessageEventStream();
				stream.end(response([{ type: "text", text: "summary" }]));
				return stream;
			},
		});
		expect(sent).toContainEqual(expect.objectContaining({ role: "user", content: "[branch] Abandoned request" }));
		expect(JSON.stringify(sent)).not.toContain("[branch] Do not continue");
		expect(entries[0]).toMatchObject({ message: { content: "Abandoned request" } });
	});

	it("clamps the branch summary output cap to the model limit", async () => {
		let requestOptions: SimpleStreamOptions | undefined;
		const streamFn: StreamFn = (_model, _context, options) => {
			requestOptions = options;
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({ type: "done", reason: "stop", message: response([{ type: "text", text: "summary" }]) }),
			);
			return stream;
		};

		await generateBranchSummary(entries, {
			model: { ...model, maxTokens: 1024 },
			signal: new AbortController().signal,
			streamFn,
		});

		expect(requestOptions?.maxTokens).toBe(1024);
	});

	it("rejects tool calls from branch summaries", async () => {
		const streamFn: StreamFn = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({
					type: "done",
					reason: "toolUse",
					message: response([
						{ type: "toolCall", id: "tool-call-1", name: "read", arguments: { path: "README.md" } },
					]),
				}),
			);
			return stream;
		};

		const result = await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
		});

		expect(result.error).toBe("Branch summarization attempted to call a tool");
	});

	it("rejects length-limited branch summaries", async () => {
		const streamFn: StreamFn = () => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() =>
				stream.push({
					type: "done",
					reason: "length",
					message: { ...response([{ type: "text", text: "partial" }]), stopReason: "length" },
				}),
			);
			return stream;
		};

		const result = await generateBranchSummary(entries, {
			model,
			signal: new AbortController().signal,
			streamFn,
		});

		expect(result.error).toBe(
			"Branch summarization failed: generation hit the token cap and the summary is incomplete",
		);
	});
});
