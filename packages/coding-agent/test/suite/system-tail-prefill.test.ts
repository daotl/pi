import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	getCurrentSystemMessage,
} from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { estimateProjectedContextTokens, estimateTokens } from "../../src/core/compaction/compaction.ts";
import { FooterDataProvider } from "../../src/core/footer-data-provider.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageTotals } from "../../src/core/usage-totals.ts";
import { FooterComponent, formatTokens } from "../../src/modes/interactive/components/footer.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createNativeTokenizerFixture } from "../native/tokenizer-fixture.ts";
import { createHarness, getMessageText } from "./harness.ts";

it.each((["success", "mismatch"] as const).flatMap((outcome) => [false, true].map((clone) => ({ outcome, clone }))))(
	"captures the assistant before trailing patches ($outcome, cloned tail $clone)",
	async ({ outcome, clone }) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-system-tail-prefill-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
		});
		try {
			if (clone) {
				harness.setResponses([fauxAssistantMessage("older retained answer")]);
				await harness.session.prompt("older retained request");
			}
			harness.setResponses([fauxAssistantMessage("original partial", { stopReason: "aborted" })]);
			await harness.session.prompt("start");
			const patch = { role: "system" as const, content: "preserved trailing policy", timestamp: 2 };
			harness.sessionManager.appendMessage(patch);
			const laterPatch = { role: "system" as const, content: "second trailing policy", timestamp: 3 };
			harness.sessionManager.appendMessage(laterPatch);
			const hiddenPolicy = "soft-deleted policy must stay hidden";
			const hiddenId = manager.appendMessage({ role: "system", content: hiddenPolicy, timestamp: 4 });
			manager.softDeleteUnits([{ entryId: hiddenId }]);
			harness.session.refreshContext();
			if (clone) {
				const earlier = manager
					.getBranch()
					.find(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "assistant" &&
							getMessageText(entry.message) === "older retained answer",
					);
				if (!earlier) throw new Error("Expected earlier assistant");
				harness.session.deleteMessage(earlier.id);
			}
			let prefill: boolean | undefined;
			let request: string[] = [];
			harness.session.agent.streamFunction = (_model, context, options) => {
				prefill = options?.returnPrefill;
				request = context.messages.map(getMessageText);
				const stream = createAssistantMessageEventStream();
				stream.push({
					type: "done",
					reason: "stop",
					message: fauxAssistantMessage(
						outcome === "success" ? "original partial completed" : "different terminal",
					),
				});
				return stream;
			};
			await harness.session.continue();
			expect(prefill).toBe(true);
			expect(request.slice(-3)).toEqual([patch.content, laterPatch.content, "original partial"]);
			expect(request).not.toContain(hiddenPolicy);
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				const context = current.buildSessionContext().messages;
				expect(context.map(getMessageText)).not.toContain(hiddenPolicy);
				const hidden = current
					.getBranch()
					.filter(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "system" &&
							getMessageText(entry.message) === hiddenPolicy,
					);
				expect(hidden).toEqual([expect.objectContaining({ deletedAt: expect.any(String) })]);
				if (clone)
					expect(context.filter((message) => message.role === "user").map(getMessageText)).toEqual([
						"older retained request",
						"start",
					]);
				expect(
					context
						.filter(
							(message) =>
								message.role === "system" &&
								[patch.content, laterPatch.content].includes(getMessageText(message)),
						)
						.map(getMessageText),
				).toEqual([patch.content, laterPatch.content]);
				expect(context.filter((message) => message.role === "assistant").map(getMessageText)).toEqual([
					outcome === "success" ? "original partial completed" : "original partial",
				]);
			}
			expect(harness.session.isIdle).toBe(true);
		} finally {
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it.each([true, false])("preserves live discovery on continuation (trusted %s)", async (trusted) => {
	let injected = false;
	const harness = await createHarness({
		fauxApi: "openai-completions",
		settings: { compaction: { enabled: false }, retry: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", (event) => {
					if (injected) return;
					injected = true;
					event.systemPromptOptions.sections.mcp_servers = "indirect server namespace: docs";
				});
			},
		],
	});
	try {
		harness.settingsManager.setProjectTrusted(trusted);
		harness.setResponses([fauxAssistantMessage("partial", { stopReason: "aborted" })]);
		await harness.session.prompt("start discovery");
		expect(getCurrentSystemMessage(harness.session.messages)?.sections?.mcp_servers).toContain("docs");
		harness.session.setCustomSystemPrompt("new accepted preamble");
		let sections: Record<string, string | null> | undefined;
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("partial continued", { stopReason: "aborted" });
			},
		]);
		await harness.session.continue();
		expect(sections?.mcp_servers).toBe("<mcp_servers>\nindirect server namespace: docs\n</mcp_servers>");
		expect(sections?.preamble).toBe("new accepted preamble");
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("partial continued twice", { stopReason: "aborted" });
			},
		]);
		await harness.session.continue();
		expect(sections?.mcp_servers).toContain("indirect server namespace: docs");
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("fresh prefix", { stopReason: "aborted" });
			},
		]);
		await harness.session.prompt("new start without discovery injection");
		expect(sections?.mcp_servers).toBeUndefined();
		harness.setResponses([
			(context) => {
				sections = getCurrentSystemMessage(context.messages)?.sections;
				return fauxAssistantMessage("fresh prefix completed");
			},
		]);
		await harness.session.continue();
		expect(sections?.mcp_servers).toBeUndefined();
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});

it.each(
	(["regenerate", "reopen"] as const).flatMap((operation) => [true, false].map((trusted) => ({ operation, trusted }))),
)(
	"preserves only authorized discovery through $operation continuation with project trust $trusted",
	async ({ operation, trusted }) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-discovery-resume-"));
		let injected = false;
		let harness = await createHarness({
			cwd,
			sessionManager: SessionManager.create(cwd, join(cwd, "sessions")),
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						if (injected) return;
						injected = true;
						event.systemPromptOptions.sections.mcp_servers = "selected namespace docs";
					});
				},
			],
		});
		try {
			harness.settingsManager.setProjectTrusted(trusted);
			harness.setResponses([fauxAssistantMessage("selected prefix", { stopReason: "aborted" })]);
			await harness.session.prompt("selected request");
			if (operation === "reopen") {
				const file = harness.sessionManager.getSessionFile()!;
				harness.cleanup();
				harness = await createHarness({
					cwd,
					sessionManager: SessionManager.open(file),
					fauxApi: "openai-completions",
					settings: { compaction: { enabled: false }, retry: { enabled: false } },
				});
				harness.settingsManager.setProjectTrusted(trusted);
			}
			let discovery: string | null | undefined;
			harness.setResponses([
				(context) => {
					discovery = getCurrentSystemMessage(context.messages)?.sections?.mcp_servers;
					return fauxAssistantMessage(
						operation === "reopen" ? "selected prefix completed" : "regenerated prefix",
						operation === "regenerate" ? { stopReason: "aborted" } : {},
					);
				},
			]);
			if (operation === "regenerate") await harness.session.regenerateSwipe(harness.session.getSwipeGroup()!);
			else await harness.session.continue();
			expect(discovery).toBe(trusted ? "<mcp_servers>\nselected namespace docs\n</mcp_servers>" : undefined);
			if (operation === "regenerate") {
				harness.setResponses([
					(context) => {
						discovery = getCurrentSystemMessage(context.messages)?.sections?.mcp_servers;
						return fauxAssistantMessage("regenerated prefix completed");
					},
				]);
				await harness.session.continue();
				expect(discovery).toBe(trusted ? "<mcp_servers>\nselected namespace docs\n</mcp_servers>" : undefined);
			}
		} finally {
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it("reselects the preserved saved-policy suffix of a continued swipe", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	const harness = await createHarness({
		fauxApi: "openai-completions",
		settings: { compaction: { enabled: false }, retry: { enabled: false } },
	});
	try {
		harness.setResponses([fauxAssistantMessage("partial", { stopReason: "aborted" })]);
		await harness.session.prompt("start");
		harness.session.setCustomSystemPrompt("VERSION_ONE");
		harness.setResponses([
			() => {
				vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
				return fauxAssistantMessage("partial completed");
			},
		]);
		await harness.session.continue();
		const selectedLeaf = harness.sessionManager.getLeafId();
		const selectedVersion = harness.session.getSwipeGroup()!.versions[0].id;
		harness.setResponses([fauxAssistantMessage("alternative answer")]);
		await harness.session.regenerateSwipe(harness.session.getSwipeGroup()!);
		const group = harness.session.getSwipeGroup()!;
		expect(
			harness.session.goToSwipeVersion(
				group,
				group.versions.findIndex((entry) => entry.id === selectedVersion),
			),
		).toBe(true);
		expect(harness.sessionManager.getLeafId()).toBe(selectedLeaf);
		expect(harness.session.systemPrompt).toContain("VERSION_ONE");
	} finally {
		harness.cleanup();
		vi.useRealTimers();
	}
});

it("keeps accepted discovery while a rejected competing prompt awaits preflight", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const streaming = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const harness = await createHarness({
		fauxApi: "openai-completions",
		settings: { compaction: { enabled: false }, retry: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", async (event) => {
					if (event.messageType !== "user") return;
					if (event.prompt === "paused competing prompt") {
						entered.resolve();
						await release.promise;
					} else event.systemPromptOptions.sections.mcp_servers = "accepted current namespace";
				});
			},
		],
	});
	let continuation: Promise<void> | undefined;
	let paused: Promise<unknown> | undefined;
	try {
		harness.settingsManager.setProjectTrusted(false);
		harness.setResponses([fauxAssistantMessage("accepted prefix", { stopReason: "aborted" })]);
		await harness.session.prompt("initial request");
		paused = harness.session.prompt("paused competing prompt").catch((error: unknown) => error);
		await entered.promise;
		let discovery: string | null | undefined;
		harness.setResponses([
			async (context) => {
				discovery = getCurrentSystemMessage(context.messages)?.sections?.mcp_servers;
				streaming.resolve();
				await finish.promise;
				return fauxAssistantMessage("accepted prefix completed");
			},
		]);
		continuation = harness.session.continue();
		await streaming.promise;
		release.resolve();
		expect(await paused).toBeInstanceOf(Error);
		expect(discovery).toBe("<mcp_servers>\naccepted current namespace\n</mcp_servers>");
		finish.resolve();
		await continuation;
		expect(getCurrentSystemMessage(harness.session.messages)?.sections?.mcp_servers).toBe(discovery);
	} finally {
		release.resolve();
		finish.resolve();
		await paused;
		await continuation;
		await harness.session.abort();
		harness.cleanup();
	}
});

it.each(["faux", "native"] as const)("counts a continued policy suffix only once (%s)", async (runtime) => {
	initTheme(undefined, false);
	const cwd = mkdtempSync(join(tmpdir(), "pi-policy-usage-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const native = runtime === "native" ? await createNativeTokenizerFixture() : undefined;
	const harness = native?.owner ?? (await createHarness({ fauxApi: "openai-completions" }));
	const model = native?.session.model ?? harness.getModel();
	if (!model) throw new Error("Expected model");
	manager.appendMessage({ role: "system", content: "baseline", timestamp: 0 });
	const user = manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
	manager.appendMessage({
		...fauxAssistantMessage("partial", { stopReason: "aborted" }),
		api: model.api,
		provider: model.provider,
		model: model.id,
	});
	let { session } = await createAgentSession({
		cwd,
		agentDir: cwd,
		model,
		modelRuntime: harness.session.modelRuntime,
		settingsManager: harness.settingsManager,
		resourceLoader: harness.session.resourceLoader,
		sessionManager: manager,
		tools: [],
	});
	const footerData = new FooterDataProvider(cwd);
	try {
		session.setCustomSystemPrompt("accepted policy ".repeat(200));
		const completedText = "partial completed";
		if (native) native.setResponses([fauxAssistantMessage(completedText)]);
		else harness.setResponses([fauxAssistantMessage(completedText)]);
		await session.continue();
		const response = manager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "assistant");
		if (response?.type !== "message" || response.message.role !== "assistant")
			throw new Error("Expected continued response");
		const billed = response.message.usage.totalTokens;
		if (native) {
			expect(billed).toBe(10 + Math.ceil(completedText.length / 4));
			expect(native.summaries[0]?.body).toContain("accepted policy");
			const request = JSON.parse(native.summaries[0]!.body) as {
				messages: Array<{ role: string; content: string }>;
			};
			expect(request.messages.at(-1)).toMatchObject({ role: "assistant", content: "partial" });
		}
		const totals = getUsageTotals(manager.getEntries());
		const continuedIndex = manager.getBranch().findIndex((entry) => entry.id === response.id);
		expect(
			manager
				.getBranch()
				.slice(continuedIndex + 1)
				.some((entry) => entry.type === "message" && entry.message.role === "system"),
		).toBe(true);
		const file = manager.getSessionFile()!;
		for (const reopen of [false, true]) {
			if (reopen) {
				session.dispose();
				({ session } = await createAgentSession({
					cwd,
					agentDir: cwd,
					model,
					modelRuntime: harness.session.modelRuntime,
					settingsManager: harness.settingsManager,
					resourceLoader: harness.session.resourceLoader,
					sessionManager: SessionManager.open(file),
					tools: [],
				}));
			}
			expect(session.getContextUsage()?.tokens).toBe(billed);
			expect(session.getSessionStats().contextUsage?.tokens).toBe(billed);
			expect(stripAnsi(new FooterComponent(session, footerData).render(160).join("\n"))).toContain(
				`${formatTokens(billed)}/${formatTokens(model.contextWindow)} (${((billed / model.contextWindow) * 100).toFixed(1)}%)`,
			);
		}
		const current = session.sessionManager;
		const later = { role: "system" as const, content: "new policy not counted", timestamp: 5 };
		current.appendMessage(later);
		session.refreshContext();
		expect(session.getContextUsage()?.tokens).toBe(billed + estimateTokens(later));
		for (const selected of [current, SessionManager.open(file)]) {
			expect(estimateProjectedContextTokens(selected.buildSessionProjection(), selected.getBranch()).tokens).toBe(
				billed + estimateTokens(later),
			);
		}
		current.replaceMessages([{ entryId: user, message: { role: "user", content: "changed", timestamp: 6 } }]);
		session.refreshContext();
		for (const copy of [current, SessionManager.open(file)]) {
			expect(estimateProjectedContextTokens(copy.buildSessionProjection(), copy.getBranch()).usageTokens).toBe(0);
			expect(getUsageTotals(copy.getEntries())).toEqual(totals);
			const copied = copy
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (copied?.type !== "message") throw new Error("Expected copied assistant");
			expect(copy.getBranch().some((entry) => entry.id === copied.usageContextEntryId)).toBe(true);
		}
		const copiedUser = current
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "user")!;
		current.appendCompaction("new uncounted checkpoint", copiedUser.id, billed);
		session.refreshContext();
		expect(session.getContextUsage()?.tokens).toBeNull();
	} finally {
		session.dispose();
		footerData.dispose();
		if (native) native.cleanup();
		else harness.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});
