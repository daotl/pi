import { Agent, type AgentMessage, type StreamFn as AgentStream } from "@earendil-works/pi-agent-core";
import {
	contentText,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	getCurrentSystemPrompt,
	getCurrentTools,
	type Model,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { generateBranchSummary, generateSummaryWithUsage } from "../src/core/compaction/index.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";

const model: Model<"anthropic-messages"> = {
	id: "summary-boundary-model",
	name: "Summary boundary model",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "https://example.invalid",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 8192,
};

const history: AgentMessage = { role: "user", content: "Selected summary history", timestamp: 1 };
const entries: SessionEntry[] = [
	{
		type: "message",
		id: "summary-boundary-history",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		message: history,
	},
];
const retry = { enabled: true, maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 };
const focus = "BOUNDARY SUMMARY FOCUS";

type Operation = "compact" | "branch";

interface SummaryRequestSnapshot {
	policy: string;
	tools: string[];
	users: string[];
	serialized: string;
}

async function summarize(operation: Operation, agent: Agent, streamFn: AgentStream): Promise<string | undefined> {
	if (operation === "compact") {
		const result = await generateSummaryWithUsage(
			[history],
			model,
			1000,
			undefined,
			undefined,
			undefined,
			focus,
			undefined,
			streamFn,
			undefined,
			retry,
			undefined,
			undefined,
			"FALLBACK POLICY MUST NOT REAPPEAR",
			agent,
		);
		return result.text;
	}
	const result = await generateBranchSummary(entries, {
		model,
		agent,
		streamFn,
		retry,
		customInstructions: focus,
		systemPrompt: "FALLBACK POLICY MUST NOT REAPPEAR",
		signal: new AbortController().signal,
	});
	return result.summary;
}

function publicPolicy<T extends AgentMessage>(messages: T[], removeBaseline: boolean): T[] {
	return messages
		.filter((message) => !removeBaseline || message.role !== "system")
		.map((message) =>
			message.role === "system"
				? {
						...message,
						content: "PUBLIC SUMMARY POLICY",
						sections: undefined,
						toolsAdded: undefined,
						toolsRemoved: undefined,
					}
				: message,
		);
}

function snapshot(context: TranscriptContext): SummaryRequestSnapshot {
	return {
		policy: getCurrentSystemPrompt(context.messages),
		tools: getCurrentTools(context.messages).map((tool) => tool.name),
		users: context.messages
			.filter((message) => message.role === "user")
			.map((message) => (typeof message.content === "string" ? message.content : contentText(message.content))),
		serialized: JSON.stringify(context),
	};
}

it("restores only the policy preceding selected standalone compaction history", async () => {
	const selected: AgentMessage[] = [
		{ role: "user", content: "before selected legacy policy", timestamp: 1 },
		{ role: "system", content: "SELECTED RAW POLICY", sections: { custom: "SELECTED CUSTOM SECTION" }, timestamp: 2 },
		{ role: "user", content: "after selected legacy policy", timestamp: 3 },
	];
	const original = structuredClone(selected);
	const hooks: AgentMessage[][] = [];
	const agent = new Agent({
		streamFn: () => {
			throw new Error("Unexpected normal request");
		},
		initialState: {
			messages: [
				{ role: "system", content: "PRECEDING RAW POLICY", timestamp: 0 },
				...selected,
				{ role: "system", content: "UNSELECTED SUFFIX POLICY", timestamp: 4 },
			],
		},
		transformContext: async (messages) => {
			hooks.push(structuredClone(messages));
			return messages;
		},
	});
	let sent: TranscriptContext | undefined;
	const streamFn: AgentStream = (_model, context) => {
		sent = context;
		const stream = createAssistantMessageEventStream();
		stream.end(fauxAssistantMessage("ordered standalone summary"));
		return stream;
	};
	await generateSummaryWithUsage(
		selected,
		model,
		1000,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		streamFn,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		agent,
	);
	expect(hooks).toHaveLength(1);
	for (const messages of [hooks[0], sent!.messages]) {
		const policy = getCurrentSystemPrompt(messages);
		expect(policy.match(/PRECEDING RAW POLICY/g)).toHaveLength(1);
		expect(policy.match(/SELECTED RAW POLICY/g)).toHaveLength(1);
		expect(policy).toContain("SELECTED CUSTOM SECTION");
		expect(policy).not.toContain("UNSELECTED SUFFIX POLICY");
		expect(messages.slice(0, 4).map((message) => message.role)).toEqual(["system", "user", "system", "user"]);
	}
	expect(selected).toEqual(original);
});

describe.each(["compact", "branch"] as const)("%s summary policy boundaries", (operation) => {
	it.each([
		["transform", "baseline", false],
		["converter", "baseline", false],
		["transform", "tools", false],
		["converter", "tools", false],
		["transform", "baseline", true],
		["converter", "baseline", true],
		["transform", "tools", true],
		["converter", "tools", true],
	] as const)("does not resurrect a %s-removed %s with synthetic=%s", async (stage, removed, synthetic) => {
		const privateTool = {
			name: "private_summary_tool",
			label: "Private summary tool",
			description: "A private executable tool",
			parameters: { type: "object", properties: {} },
			execute: async () => ({ content: [{ type: "text" as const, text: "private result" }], details: {} }),
		};
		const agent = new Agent({
			streamFn: () => {
				throw new Error("Unexpected normal agent dispatch");
			},
			initialState: {
				systemPrompt: "PRIVATE LIVE POLICY MUST NOT REAPPEAR",
				tools: [privateTool],
				messages: [
					{
						role: "system",
						content: "PRIVATE SAVED POLICY MUST NOT REAPPEAR",
						toolsAdded: [
							{
								name: privateTool.name,
								description: privateTool.description,
								parameters: privateTool.parameters,
							},
						],
						timestamp: 0,
					},
					history,
				],
			},
		});
		if (synthetic) agent.state.messages = [history];
		const convert = agent.convertToLlm;
		if (stage === "transform") {
			agent.transformContext = async (messages) => publicPolicy(messages, removed === "baseline");
		} else {
			agent.convertToLlm = async (messages) => publicPolicy(await convert(messages), removed === "baseline");
		}
		const requests: SummaryRequestSnapshot[] = [];
		const streamFn: AgentStream = (_model, context) => {
			requests.push(snapshot(context));
			const stream = createAssistantMessageEventStream();
			stream.end(fauxAssistantMessage("Boundary-safe summary"));
			return stream;
		};

		expect(await summarize(operation, agent, streamFn)).toContain("Boundary-safe summary");
		expect(requests).toHaveLength(1);
		expect(requests[0].policy).toBe(removed === "baseline" ? "" : "PUBLIC SUMMARY POLICY");
		expect(requests[0].tools).toEqual([]);
		expect(requests[0].serialized).not.toContain("PRIVATE");
		expect(requests[0].serialized).not.toContain("FALLBACK");
		expect(requests[0].serialized).not.toContain(privateTool.name);
		expect(requests[0].users[0]).toBe("Selected summary history");
		expect(requests[0].users[1]).toContain(focus);
	});

	it("uses the retry's context and converter policy without prefixing the generated instruction", async () => {
		const prefix = "HISTORY-ONLY PREFIX: ";
		const agent = new Agent({
			incomingMessagePrefix: prefix,
			initialState: { systemPrompt: "ORIGINAL SUMMARY BASELINE" },
			streamFn: () => {
				throw new Error("Unexpected normal agent dispatch");
			},
		});
		const convert = agent.convertToLlm;
		const installPolicy = (version: "FIRST" | "SECOND") => {
			agent.transformContext = async (messages) =>
				messages.map((message) =>
					message.role === "system" ? { ...message, content: `${version} CONTEXT POLICY` } : message,
				);
			agent.convertToLlm = async (messages) =>
				(await convert(messages)).map((message) =>
					message.role === "system"
						? { ...message, content: `${message.content}\n${version} CONVERTER POLICY` }
						: message,
				);
		};
		installPolicy("FIRST");
		const requests: SummaryRequestSnapshot[] = [];
		const streamFn: AgentStream = (_model, context) => {
			requests.push(snapshot(context));
			const stream = createAssistantMessageEventStream();
			if (requests.length === 1) {
				installPolicy("SECOND");
				stream.push({
					type: "error",
					reason: "error",
					error: fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." }),
				});
			} else {
				stream.end(fauxAssistantMessage("Current-policy summary"));
			}
			return stream;
		};

		expect(await summarize(operation, agent, streamFn)).toContain("Current-policy summary");
		expect(requests.map((request) => request.policy)).toEqual([
			"FIRST CONTEXT POLICY\nFIRST CONVERTER POLICY",
			"SECOND CONTEXT POLICY\nSECOND CONVERTER POLICY",
		]);
		for (const request of requests) {
			expect(request.users).toHaveLength(2);
			expect(request.users[0]).toBe(`${prefix}Selected summary history`);
			expect(request.users[1]).toContain(focus);
			expect(request.users[1]).not.toContain(prefix);
		}
	});
});
