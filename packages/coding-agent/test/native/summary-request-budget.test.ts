import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createProvider, fauxAssistantMessage, type ImageContent, normalizeContext } from "@earendil-works/pi-ai";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import { afterEach, expect, it, vi } from "vitest";
import {
	completeSummarization,
	generateSummaryWithUsage,
	prepareBranchEntries,
} from "../../src/core/compaction/index.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createNativeTokenizerFixture, type NativeTokenizerFixture } from "./tokenizer-fixture.ts";

const fixtures: NativeTokenizerFixture[] = [];
afterEach(() => {
	while (fixtures.length) fixtures.pop()?.cleanup();
});

it.each(["compact", "branch", "standalone", "builder"] as const)(
	"sizes %s from current request text instead of historical usage",
	async (operation) => {
		const current = await createNativeTokenizerFixture({
			settings: {
				compaction: { enabled: false, reserveTokens: 1024 },
				branchSummary: { reserveTokens: 1024 },
				retry: { enabled: false },
			},
		});
		fixtures.push(current);
		const selected = current.session.model;
		if (!selected) throw new Error("Missing native model");
		const model = { ...selected, contextWindow: 10000, maxTokens: 4096 };
		await current.session.setModel(model);
		const target = current.manager.getLeafId();
		if (!target) throw new Error("Missing branch target");
		const historical = {
			...fauxAssistantMessage("original large response"),
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 100000,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 100000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		const historicalId = current.manager.appendMessage(historical);
		current.manager.appendContextEdit(historicalId, { content: "edited small response" });
		current.manager.appendMessage({ role: "user", content: "retained input", timestamp: Date.now() });
		current.session.refreshContext();
		const canonical = structuredClone(current.manager.getEntries());
		if (operation === "compact") await current.session.compact({ keepRecentMessages: 1 });
		else if (operation === "branch") await current.session.navigateTree(target, { summarize: true });
		else {
			const context = normalizeContext({
				systemPrompt: "small baseline",
				messages: [{ ...historical, content: [{ type: "text", text: "edited small response" }] }],
			});
			const before = structuredClone(context);
			await completeSummarization(
				model,
				operation === "builder" ? async () => context : context,
				{ apiKey: "offline", maxTokens: 800 },
				current.session.agent.streamFunction,
			);
			expect(context).toEqual(before);
		}
		expect(current.summaries).toHaveLength(1);
		const wire = JSON.parse(current.summaries[0].body);
		expect(wire.max_completion_tokens ?? wire.max_tokens).toBeGreaterThan(1);
		expect(current.summaries[0].body).toContain("edited small response");
		for (const entry of canonical) expect(current.manager.getEntry(entry.id)).toEqual(entry);
		expect(historical.usage.totalTokens).toBe(100000);
	},
);

it.each([100, 25000, 50000])(
	"keeps useful native output headroom for %i-character tool results",
	async (characters) => {
		const current = await createNativeTokenizerFixture({
			settings: { compaction: { enabled: false, reserveTokens: 4096 }, retry: { enabled: false } },
		});
		fixtures.push(current);
		const selected = current.session.model;
		if (!selected) throw new Error("Missing native model");
		await current.session.setModel({ ...selected, contextWindow: 10000, maxTokens: 4096 });
		current.manager.appendMessage({ role: "user", content: "inspect completed work", timestamp: 1 });
		current.manager.appendMessage({
			...fauxAssistantMessage({
				type: "toolCall",
				id: "budget-read",
				name: "read",
				arguments: { path: "/project/work.ts" },
			}),
			api: selected.api,
			provider: selected.provider,
			model: selected.id,
			stopReason: "toolUse",
		});
		current.manager.appendMessage({
			role: "toolResult",
			toolCallId: "budget-read",
			toolName: "read",
			content: [{ type: "text", text: `POLICY_VISIBLE_TOOL ${"x".repeat(characters)}` }],
			isError: false,
			timestamp: 2,
		});
		current.manager.appendMessage({ role: "user", content: "kept input", timestamp: 3 });
		current.session.refreshContext();
		const before = structuredClone(current.manager.getEntries());
		const result = await current.session.compact({ keepRecentMessages: 1 });
		expect(result.summary).toContain("safe checkpoint");
		expect(current.summaries).toHaveLength(1);
		const wire = JSON.parse(current.summaries[0].body);
		expect(wire.max_completion_tokens ?? wire.max_tokens).toBeGreaterThan(1);
		const body = current.summaries[0].body;
		if (characters === 100) expect(body).toContain('"role":"tool"');
		else {
			expect(body).toContain("[Tool result]");
			expect(body).toContain("POLICY_VISIBLE_TOOL");
			expect(body).not.toContain('"role":"tool"');
		}
		for (const entry of before) expect(current.manager.getEntry(entry.id)).toEqual(entry);
	},
);

it.each(["native", "faux"] as const)(
	"preserves policy-visible images in bounded %s summary requests",
	async (provider) => {
		const current = await createNativeTokenizerFixture({
			models: [{ id: "vision", input: ["text", "image"], contextWindow: 10000, maxTokens: 4096 }],
			settings: { compaction: { enabled: false, reserveTokens: 4096 }, retry: { enabled: false } },
		});
		fixtures.push(current);
		const session = provider === "native" ? current.session : current.owner.session;
		const manager = provider === "native" ? current.manager : current.owner.sessionManager;
		const selected = session.model;
		if (!selected) throw new Error("Missing vision model");
		await session.setModel({ ...selected, contextWindow: 10000, maxTokens: 4096 });
		const userImage: ImageContent = { type: "image", mimeType: "image/png", data: "dXNlciBzY3JlZW5zaG90" };
		const toolImage: ImageContent = { type: "image", mimeType: "image/png", data: "dG9vbCBzY3JlZW5zaG90" };
		const privateImage: ImageContent = { type: "image", mimeType: "image/png", data: "cHJpdmF0ZSBpbWFnZQ==" };
		manager.appendMessage({ role: "system", content: "PRIVATE_RAW_AUTHORITY", timestamp: 0 });
		manager.appendMessage({ role: "user", content: [userImage, privateImage], timestamp: 1 });
		manager.appendMessage({
			...fauxAssistantMessage({ type: "toolCall", id: "vision-read", name: "read", arguments: {} }),
			api: selected.api,
			provider: selected.provider,
			model: selected.id,
			stopReason: "toolUse",
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "vision-read",
			toolName: "read",
			content: [{ type: "text", text: `VISIBLE_TOOL_START ${"x".repeat(50000)} PRIVATE_TOOL_TAIL` }, toolImage],
			isError: false,
			timestamp: 2,
		});
		manager.appendMessage({ role: "user", content: "retained input", timestamp: 3 });
		session.refreshContext();
		const convert = session.agent.convertToLlm;
		session.agent.convertToLlm = async (messages) =>
			(await convert(messages))
				.filter((message) => message.role !== "system")
				.map((message) =>
					message.role === "user" && Array.isArray(message.content)
						? {
								...message,
								content: message.content.filter(
									(block) => block.type !== "image" || block.data !== privateImage.data,
								),
							}
						: message,
				);
		const seenImages: ImageContent[][] = [];
		current.owner.setResponses([
			(context, options) => {
				seenImages.push(
					context.messages.flatMap((message) =>
						Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : [],
					),
				);
				expect(JSON.stringify(context.messages)).toContain("VISIBLE_TOOL_START");
				expect(JSON.stringify(context.messages)).not.toContain("PRIVATE_TOOL_TAIL");
				expect(JSON.stringify(context.messages)).not.toContain("PRIVATE_RAW_AUTHORITY");
				expect(
					context.messages.reduce((total, message) => total + estimateMessageTokens(message), 0) +
						(options?.maxTokens ?? 0),
				).toBeLessThanOrEqual(10000);
				return fauxAssistantMessage("image-aware checkpoint");
			},
		]);
		const before = structuredClone(manager.getEntries());
		const result = await session.compact({ keepRecentMessages: 1 });
		expect(result.summary).toContain(provider === "native" ? "safe checkpoint" : "image-aware checkpoint");
		if (provider === "native") {
			expect(current.summaries).toHaveLength(1);
			const wire = JSON.parse(current.summaries[0].body) as {
				messages: Array<{ content: string | Array<{ type: string; image_url?: { url: string } }> }>;
			};
			const images = wire.messages.flatMap((message) =>
				Array.isArray(message.content)
					? message.content.filter((block) => block.type === "image_url").map((block) => block.image_url?.url)
					: [],
			);
			expect(images).toEqual([userImage, toolImage].map((image) => `data:${image.mimeType};base64,${image.data}`));
			expect(current.summaries[0].body).toContain("VISIBLE_TOOL_START");
			expect(current.summaries[0].body).not.toContain("PRIVATE_TOOL_TAIL");
			expect(current.summaries[0].body).not.toContain("PRIVATE_RAW_AUTHORITY");
		} else expect(seenImages).toEqual([[userImage, toolImage]]);
		for (const entry of before) expect(manager.getEntry(entry.id)).toEqual(entry);
	},
);

it.each(["native", "faux"] as const)(
	"rejects unfit images before %s dispatch or checkpoint publication",
	async (provider) => {
		const current = await createNativeTokenizerFixture({
			models: [{ id: "vision", input: ["text", "image"], contextWindow: 10000, maxTokens: 4096 }],
			settings: { compaction: { enabled: false, reserveTokens: 4096 }, retry: { enabled: false } },
		});
		fixtures.push(current);
		const session = provider === "native" ? current.session : current.owner.session;
		const manager = provider === "native" ? current.manager : current.owner.sessionManager;
		const selected = session.model;
		if (!selected) throw new Error("Missing vision model");
		await session.setModel({ ...selected, contextWindow: 10000, maxTokens: 4096 });
		manager.appendMessage({
			role: "user",
			content: Array.from({ length: 9 }, (_, index) => ({
				type: "image" as const,
				mimeType: "image/png",
				data: Buffer.from(`screenshot ${index}`).toString("base64"),
			})),
			timestamp: 1,
		});
		manager.appendMessage({
			...fauxAssistantMessage({ type: "toolCall", id: "unfit-read", name: "read", arguments: {} }),
			api: selected.api,
			provider: selected.provider,
			model: selected.id,
			stopReason: "toolUse",
		});
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "unfit-read",
			toolName: "read",
			content: [{ type: "text", text: "x".repeat(50000) }],
			isError: false,
			timestamp: 2,
		});
		manager.appendMessage({ role: "user", content: "retained input", timestamp: 3 });
		session.refreshContext();
		current.owner.setResponses([fauxAssistantMessage("must not publish")]);
		const callsBefore = current.owner.faux.state.callCount;
		const before = structuredClone(manager.getEntries());
		const leaf = manager.getLeafId();
		await expect(session.compact({ keepRecentMessages: 1 })).rejects.toThrow(/token budget/);
		expect(current.summaries).toEqual([]);
		expect(current.owner.faux.state.callCount).toBe(callsBefore);
		expect(manager.getEntries()).toEqual(before);
		expect(manager.getLeafId()).toBe(leaf);
	},
);

it("preserves structured tool history for an arbitrary custom stream within its physical window", async () => {
	const current = await createNativeTokenizerFixture();
	fixtures.push(current);
	const selected = current.session.model;
	if (!selected) throw new Error("Missing model");
	const model = { ...selected, contextWindow: 10000 };
	const messages: AgentMessage[] = [
		{ role: "user", content: "inspect", timestamp: 0 },
		{
			...fauxAssistantMessage({
				type: "toolCall",
				id: "custom-read",
				name: "read",
				arguments: { path: "/project/file.ts" },
			}),
			stopReason: "toolUse",
		},
		{
			role: "toolResult",
			toolCallId: "custom-read",
			toolName: "read",
			content: [{ type: "text", text: "x".repeat(25000) }],
			isError: false,
			timestamp: 1,
		},
	];
	const contexts: AgentMessage[][] = [];
	const requestedCaps: Array<number | undefined> = [];
	const native = current.session.agent.streamFunction;
	await generateSummaryWithUsage(
		messages,
		model,
		4096,
		"offline",
		undefined,
		undefined,
		undefined,
		undefined,
		(requestModel, context, options) => {
			contexts.push(structuredClone(context.messages));
			requestedCaps.push(options?.maxTokens);
			return native(requestModel, context, options);
		},
	);
	expect(contexts).toHaveLength(1);
	expect(contexts[0].some((message) => message.role === "toolResult")).toBe(true);
	expect(requestedCaps).toEqual([Math.floor(0.8 * 4096)]);
});

it("rejects an oversized converted request before native dispatch when bounded history still cannot fit", async () => {
	const current = await createNativeTokenizerFixture();
	fixtures.push(current);
	const selected = current.session.model;
	if (!selected) throw new Error("Missing model");
	await expect(
		generateSummaryWithUsage(
			[
				{ role: "user", content: "x".repeat(50000), timestamp: 0 },
				{
					role: "toolResult",
					toolCallId: "orphan",
					toolName: "read",
					content: [{ type: "text", text: "tiny" }],
					isError: false,
					timestamp: 1,
				},
			],
			{ ...selected, contextWindow: 10000 },
			4096,
			"offline",
			undefined,
			undefined,
			undefined,
			undefined,
			current.session.agent.streamFunction,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			current.session.agent,
		),
	).rejects.toThrow(/token budget/);
	expect(current.summaries).toEqual([]);
});

it("reselects complete native branch groups to leave useful adapter output headroom", async () => {
	const current = await createNativeTokenizerFixture({ settings: { branchSummary: { reserveTokens: 1024 } } });
	fixtures.push(current);
	const selected = current.session.model;
	if (!selected) throw new Error("Missing model");
	await current.session.setModel({ ...selected, contextWindow: 10000 });
	current.manager.appendMessage({ role: "system", content: "s".repeat(18000), timestamp: 0 });
	const target = current.manager.appendMessage({ role: "user", content: "shared target", timestamp: 1 });
	current.manager.appendMessage({ role: "user", content: `OLDER ${"a".repeat(5000)}`, timestamp: 2 });
	current.manager.appendMessage({ role: "user", content: `NEWEST ${"b".repeat(1000)}`, timestamp: 3 });
	current.session.refreshContext();
	const before = structuredClone(current.manager.getEntries());
	const result = await current.session.navigateTree(target, { summarize: true });
	expect(result.summaryEntry?.summary).toContain("safe checkpoint");
	expect(current.summaries).toHaveLength(1);
	const wire = JSON.parse(current.summaries[0].body);
	expect(wire.max_completion_tokens ?? wire.max_tokens).toBeGreaterThan(1);
	expect(current.summaries[0].body).toContain("NEWEST");
	expect(current.summaries[0].body).not.toContain("OLDER");
	for (const entry of before) expect(current.manager.getEntry(entry.id)).toEqual(entry);
});

it.each(["atomic-result", "converted-expansion"] as const)(
	"does not navigate or publish an oversized branch %s",
	async (mode) => {
		const current = await createNativeTokenizerFixture({ settings: { branchSummary: { reserveTokens: 1024 } } });
		fixtures.push(current);
		const selected = current.session.model;
		if (!selected) throw new Error("Missing model");
		await current.session.setModel({ ...selected, contextWindow: 10000 });
		const target = current.manager.getLeafId();
		if (!target) throw new Error("Missing target");
		current.manager.appendMessage({
			...fauxAssistantMessage({ type: "toolCall", id: "atomic", name: "read", arguments: {} }),
			api: selected.api,
			provider: selected.provider,
			model: selected.id,
			stopReason: "toolUse",
		});
		current.manager.appendMessage({
			role: "toolResult",
			toolCallId: "atomic",
			toolName: "read",
			content: [{ type: "text", text: mode === "atomic-result" ? "x".repeat(50000) : "small result" }],
			isError: false,
			timestamp: 3,
		});
		current.session.refreshContext();
		if (mode === "converted-expansion") {
			const convert = current.session.agent.convertToLlm;
			current.session.agent.convertToLlm = async (messages) =>
				(await convert(messages)).map((message) =>
					message.role === "toolResult"
						? { ...message, content: [{ type: "text", text: "x".repeat(50000) }] }
						: message,
				);
		}
		const before = structuredClone(current.manager.getEntries());
		const leaf = current.manager.getLeafId();
		await expect(current.session.navigateTree(target, { summarize: true })).rejects.toThrow(/token budget/);
		expect(current.summaries).toEqual([]);
		expect(current.manager.getLeafId()).toBe(leaf);
		expect(current.manager.getEntries()).toEqual(before);
	},
);

it("never resurrects the discarded prefix of an abandoned checkpoint", async () => {
	const current = await createNativeTokenizerFixture();
	fixtures.push(current);
	const target = current.manager.getLeafId();
	if (!target) throw new Error("Missing target");
	current.manager.appendMessage({ role: "user", content: "DISCARDED_BRANCH_PREFIX", timestamp: 1 });
	current.manager.appendCompaction("authoritative abandoned checkpoint", null, 100, undefined, true);
	current.session.refreshContext();
	const result = await current.session.navigateTree(target, { summarize: true });
	expect(result.summaryEntry?.summary).toContain("safe checkpoint");
	expect(current.summaries[0].body).toContain("authoritative abandoned checkpoint");
	expect(current.summaries[0].body).not.toContain("DISCARDED_BRANCH_PREFIX");
});

it("keeps a tool result across transparent system patches without reordering history", async () => {
	const current = await createNativeTokenizerFixture();
	fixtures.push(current);
	const target = current.manager.getLeafId();
	if (!target) throw new Error("Missing target");
	const model = current.session.model;
	if (!model) throw new Error("Missing model");
	current.manager.appendMessage({
		...fauxAssistantMessage({ type: "toolCall", id: "patch-read", name: "read", arguments: {} }),
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "toolUse",
	});
	current.manager.appendMessage({ role: "system", content: "SYSTEM_PATCH_BETWEEN_TOOL", timestamp: 2 });
	current.manager.appendMessage({
		role: "toolResult",
		toolCallId: "patch-read",
		toolName: "read",
		content: [{ type: "text", text: "REAL_PATCH_RESULT" }],
		isError: false,
		timestamp: 3,
	});
	current.session.refreshContext();
	const converted: AgentMessage[][] = [];
	const convert = current.session.agent.convertToLlm;
	current.session.agent.convertToLlm = async (messages) => {
		const result = await convert(messages);
		converted.push(structuredClone(result));
		return result;
	};
	await current.session.navigateTree(target, { summarize: true });
	const body = current.summaries[0].body;
	expect(body).toContain("REAL_PATCH_RESULT");
	// Native Completions folds system patches into its leading wire system message.
	// Atomic grouping retains source order before that ordinary normalization.
	const request = JSON.stringify(converted[0]);
	expect(request.indexOf("patch-read")).toBeLessThan(request.indexOf("SYSTEM_PATCH_BETWEEN_TOOL"));
	expect(request.indexOf("SYSTEM_PATCH_BETWEEN_TOOL")).toBeLessThan(request.indexOf("REAL_PATCH_RESULT"));
});

it.each(["user", "custom", "assistant"] as const)(
	"does not associate reused tool IDs across a %s boundary",
	(boundary) => {
		const manager = SessionManager.inMemory();
		manager.appendMessage({
			...fauxAssistantMessage({ type: "toolCall", id: "reused", name: "read", arguments: {} }),
			stopReason: "toolUse",
		});
		if (boundary === "custom") manager.appendCustomMessageEntry("notice", "BOUNDARY", true);
		else if (boundary === "user") manager.appendMessage({ role: "user", content: "BOUNDARY", timestamp: 1 });
		else manager.appendMessage(fauxAssistantMessage("BOUNDARY"));
		manager.appendMessage({ role: "system", content: "transparent patch", timestamp: 2 });
		manager.appendMessage({
			role: "toolResult",
			toolCallId: "reused",
			toolName: "read",
			content: [{ type: "text", text: "UNRELATED_RESULT" }],
			isError: false,
			timestamp: 3,
		});
		const before = structuredClone(manager.getEntries());
		const result = prepareBranchEntries(manager.getBranch());
		expect(JSON.stringify(result.messages)).toContain("BOUNDARY");
		expect(JSON.stringify(result.messages)).not.toContain("UNRELATED_RESULT");
		expect(manager.getEntries()).toEqual(before);
	},
);

it("bounds only converted tool output and does not restore removed system authority", async () => {
	const current = await createNativeTokenizerFixture();
	fixtures.push(current);
	const model = current.session.model;
	if (!model) throw new Error("Missing model");
	await current.session.setModel({ ...model, contextWindow: 10000 });
	current.manager.appendMessage({ role: "system", content: "PRIVATE_REMOVED_AUTHORITY", timestamp: 1 });
	current.manager.appendMessage({
		...fauxAssistantMessage({ type: "toolCall", id: "private-read", name: "read", arguments: {} }),
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "toolUse",
	});
	current.manager.appendMessage({
		role: "toolResult",
		toolCallId: "private-read",
		toolName: "read",
		content: [{ type: "text", text: "PRIVATE_RAW_TOOL_OUTPUT" }],
		isError: false,
		timestamp: 2,
	});
	current.manager.appendMessage({ role: "user", content: "retained input", timestamp: 3 });
	current.session.refreshContext();
	const convert = current.session.agent.convertToLlm;
	current.session.agent.convertToLlm = async (messages) =>
		(await convert(messages))
			.filter((message) => message.role !== "system")
			.map((message) =>
				message.role === "toolResult"
					? { ...message, content: [{ type: "text", text: `PUBLIC_CONVERTED_RESULT ${"x".repeat(50000)}` }] }
					: message,
			);
	await current.session.compact({ keepRecentMessages: 1 });
	const wire = current.summaries[0].body;
	expect(wire).toContain("[Tool result]");
	expect(wire).toContain("PUBLIC_CONVERTED_RESULT");
	expect(wire).not.toContain("PRIVATE_RAW_TOOL_OUTPUT");
	expect(wire).not.toContain("PRIVATE_REMOVED_AUTHORITY");
});

it("rechecks a retry-expanded branch request before a second dispatch or navigation", async () => {
	const current = await createNativeTokenizerFixture({
		settings: {
			branchSummary: { reserveTokens: 1024 },
			retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
		},
	});
	fixtures.push(current);
	const model = current.session.model;
	if (!model) throw new Error("Missing model");
	await current.session.setModel({ ...model, contextWindow: 10000 });
	const target = current.manager.getLeafId();
	if (!target) throw new Error("Missing target");
	current.manager.appendMessage({ role: "user", content: "short abandoned input", timestamp: 1 });
	current.session.refreshContext();
	const convert = current.session.agent.convertToLlm;
	current.session.subscribe((event) => {
		if (event.type === "summarization_retry_scheduled")
			current.session.agent.convertToLlm = async (messages) =>
				(await convert(messages)).map((message) =>
					message.role === "user" ? { ...message, content: "x".repeat(50000) } : message,
				);
	});
	current.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." })]);
	const before = structuredClone(current.manager.getEntries());
	const leaf = current.manager.getLeafId();
	await expect(current.session.navigateTree(target, { summarize: true })).rejects.toThrow(/token budget/);
	expect(current.summaries).toHaveLength(1);
	expect(current.manager.getLeafId()).toBe(leaf);
	expect(current.manager.getEntries()).toEqual(before);
});

it.each([0, 1, 2])(
	"recovers native tool-history headroom with exactly %i physical output tokens left",
	async (remaining) => {
		const current = await createNativeTokenizerFixture();
		fixtures.push(current);
		const selected = current.session.model;
		if (!selected) throw new Error("Missing model");
		const model = { ...selected, contextWindow: 10000 };
		const agent = current.session.agent;
		const convert = agent.convertToLlm;
		agent.convertToLlm = async (messages) =>
			(await convert(messages)).map((message) =>
				message.role === "toolResult"
					? { ...message, content: [{ type: "text", text: "x".repeat(38000) }] }
					: message,
			);
		const native = agent.streamFunction;
		await generateSummaryWithUsage(
			[
				{ role: "user", content: "inspect", timestamp: 0 },
				{
					...fauxAssistantMessage({ type: "toolCall", id: "exact", name: "read", arguments: {} }),
					stopReason: "toolUse",
				},
				{
					role: "toolResult",
					toolCallId: "exact",
					toolName: "read",
					content: [{ type: "text", text: "initial" }],
					isError: false,
					timestamp: 1,
				},
			],
			model,
			4096,
			"offline",
			undefined,
			undefined,
			undefined,
			undefined,
			native,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			agent,
			undefined,
			() => {
				// Capture the generated instruction's actual cost instead of pinning its wording.
				return true;
			},
		);
		// Size a second request at the physical boundary using the first request's exact
		// generated instruction and policy-visible baseline; no native reserve is duplicated.
		const instruction = JSON.parse(current.summaries[0].body).messages.at(-1).content;
		const instructionTokens = estimateMessageTokens({ role: "user", content: instruction, timestamp: 0 });
		const toolCall = {
			...fauxAssistantMessage({ type: "toolCall" as const, id: "exact", name: "read", arguments: {} }),
			stopReason: "toolUse" as const,
		};
		const fixed =
			instructionTokens +
			estimateMessageTokens(toolCall) +
			estimateMessageTokens({ role: "user", content: "inspect", timestamp: 0 });
		agent.convertToLlm = async (messages) => {
			const visible = (await convert(messages))
				.filter((message) => message.role !== "system")
				.map((message) =>
					message.role === "toolResult"
						? {
								...message,
								content: [{ type: "text" as const, text: "x".repeat((10000 - remaining - fixed) * 4) }],
							}
						: message,
				);
			expect(
				model.contextWindow -
					visible.reduce((total, message) => total + estimateMessageTokens(message), instructionTokens),
			).toBe(remaining);
			return visible;
		};
		await generateSummaryWithUsage(
			[
				{ role: "user", content: "inspect", timestamp: 0 },
				toolCall,
				{
					role: "toolResult",
					toolCallId: "exact",
					toolName: "read",
					content: [{ type: "text", text: "initial" }],
					isError: false,
					timestamp: 1,
				},
			],
			model,
			4096,
			"offline",
			undefined,
			undefined,
			undefined,
			undefined,
			native,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			agent,
			undefined,
			() => true,
		);
		const wire = JSON.parse(current.summaries.at(-1)!.body);
		expect(wire.max_completion_tokens ?? wire.max_tokens).toBeGreaterThan(1);
		expect(JSON.stringify(wire)).toContain("[Tool result]");
	},
);

it("navigates away from a fully soft-deleted abandoned range without a provider request", async () => {
	const current = await createNativeTokenizerFixture();
	fixtures.push(current);
	const target = current.manager.getLeafId();
	if (!target) throw new Error("Missing target");
	const deleted = current.manager.appendMessage({ role: "user", content: "deleted abandoned input", timestamp: 1 });
	current.session.refreshContext();
	expect(current.session.softDeleteMessage(deleted)).toBe(true);
	expect(current.manager.getLeafId()).toBe(deleted);
	const result = await current.session.navigateTree(target, { summarize: true });
	expect(result.cancelled).toBe(false);
	expect(current.summaries).toEqual([]);
	expect(current.manager.getEntry(deleted)?.deletedAt).toBeDefined();
	expect(current.manager.getBranch().some((entry) => entry.id === deleted)).toBe(false);
	expect(current.manager.getBranch().some((entry) => entry.id === target)).toBe(true);
	expect(current.manager.getLeafId()).toBe(result.summaryEntry?.id ?? target);
	if (result.summaryEntry) expect(result.summaryEntry.parentId).toBe(target);
});

it("budgets the native Google adapter without granting history or tokenizer authority", async () => {
	const current = await createNativeTokenizerFixture({
		settings: { compaction: { enabled: false, reserveTokens: 4096 } },
	});
	fixtures.push(current);
	const provider = createProvider({
		id: "native-google-budget",
		auth: { apiKey: { name: "offline", resolve: async () => ({ auth: { apiKey: "offline" } }) } },
		models: [
			{
				id: "gemini-2.0-flash",
				name: "Google budget",
				api: "google-generative-ai",
				provider: "native-google-budget",
				baseUrl: "https://google-budget.invalid",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 10000,
				maxTokens: 4096,
			},
		],
		api: googleGenerativeAIApi(),
	});
	current.session.modelRuntime.registerNativeProvider(provider);
	const model = provider.getModels()[0];
	await current.session.setModel(model);
	const requests: Array<Record<string, unknown>> = [];
	vi.stubGlobal("fetch", async (_input: string | URL | Request, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body));
		requests.push(body);
		return new Response(
			`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "google safe checkpoint" }] }, finishReason: "STOP" }] })}\n\n`,
			{ headers: { "content-type": "text/event-stream" } },
		);
	});
	current.manager.appendMessage({ role: "user", content: "inspect", timestamp: 1 });
	current.manager.appendMessage({
		...fauxAssistantMessage({ type: "toolCall", id: "google-read", name: "read", arguments: {} }),
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "toolUse",
	});
	current.manager.appendMessage({
		role: "toolResult",
		toolCallId: "google-read",
		toolName: "read",
		content: [{ type: "text", text: "x".repeat(25000) }],
		isError: false,
		timestamp: 2,
	});
	current.manager.appendMessage({ role: "user", content: "kept", timestamp: 3 });
	current.session.refreshContext();
	const result = await current.session.compact({ keepRecentMessages: 1 });
	expect(result.summary).toContain("google safe checkpoint");
	expect(requests).toHaveLength(1);
	expect(requests[0]).toMatchObject({ generationConfig: { maxOutputTokens: expect.any(Number) } });
	const config = requests[0].generationConfig as { maxOutputTokens: number };
	expect(config.maxOutputTokens).toBeGreaterThan(1);
	expect(JSON.stringify(requests[0])).toContain("[Tool result]");
	expect(current.session.modelRuntime.canAttributeRequestHistory(model)).toBe(false);
	expect(current.session.modelRuntime.canAttributeRequestHistory(model, true)).toBe(false);
});
