import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import { FooterComponent } from "../../src/modes/interactive/components/footer.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createNativeTokenizerFixture, type NativeTokenizerFixture } from "./tokenizer-fixture.ts";

const fixtures: NativeTokenizerFixture[] = [];
beforeAll(() => initTheme(undefined, false));
afterEach(() => {
	while (fixtures.length) fixtures.pop()?.cleanup();
});

async function fixture() {
	const current = await createNativeTokenizerFixture();
	fixtures.push(current);
	return current;
}

function footer(current: NativeTokenizerFixture) {
	return new FooterComponent(current.session, {
		getGitBranch: () => null,
		getExtensionStatuses: () => new Map(),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	});
}

it.each(
	(["custom", "bash", "model", "context-edit", "checkpoint"] as const).flatMap((mutation) =>
		(["during", "after"] as const).map((timing) => ({ mutation, timing })),
	),
)("does not reuse a count after $mutation changes $timing chat counting", async ({ mutation, timing }) => {
	const current = await fixture();
	const started = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	current.setTokenizer(async (url) => {
		if (url.endsWith("/chat/completions/input_tokens")) {
			started.resolve();
			if (timing === "during") await released.promise;
			return Response.json({ input_tokens: 100 });
		}
		return Response.json({ tokens: [1, 2, 3] });
	});
	const run = current.session.compact({ keepRecentMessages: 2 });
	const outcome = run.then(
		(result) => ({ result }),
		(error: unknown) => ({ error }),
	);
	try {
		if (timing === "during") {
			await Promise.race([
				started.promise,
				outcome.then(() => {
					throw new Error("Chat count gate did not start");
				}),
			]);
		} else {
			expect(await outcome).toMatchObject({ result: { summary: "safe checkpoint" } });
			expect(current.session.getContextUsage()?.tokens).toBe(100);
		}
		if (mutation === "custom") {
			await current.session.sendCustomMessage(
				{ customType: "notice", content: "new visible context".repeat(100), display: true },
				{ triggerTurn: false },
			);
		} else if (mutation === "bash") {
			current.session.recordBashResult("printf output", {
				output: "new output".repeat(100),
				exitCode: 0,
				cancelled: false,
				truncated: false,
			});
		} else if (mutation === "model") {
			const selected = current.session.model;
			if (!selected) throw new Error("Missing selected model");
			await current.session.setModel({ ...selected, id: "other", contextWindow: 200000 });
		} else if (mutation === "context-edit") {
			const retained = current.manager
				.getBranch()
				.findLast((entry) => entry.type === "message" && entry.message.role === "user");
			if (!retained) throw new Error("Missing retained user");
			current.manager.appendContextEdit(retained.id, { content: "changed counted context" });
			current.session.refreshContext();
		} else {
			current.manager.appendCompaction("new checkpoint", current.manager.getLeafId()!, 100);
			current.session.refreshContext();
		}
		released.resolve();
		expect(await outcome).toHaveProperty("result");
		const expected = { tokens: null, contextWindow: current.session.model?.contextWindow, percent: null };
		expect(current.session.getContextUsage()).toEqual(expected);
		expect(current.session.getSessionStats().contextUsage).toEqual(expected);
	} finally {
		released.resolve();
		await outcome;
	}
});

it.each(["unavailable", "transient", "denied"] as const)(
	"does not publish an estimate as exact after %s counting",
	async (failure) => {
		const current = await fixture();
		if (failure === "denied") {
			const stream = current.session.agent.streamFunction;
			current.session.agent.streamFunction = (...args) => stream(...args);
		} else
			current.setTokenizer(async () => {
				if (failure === "transient") throw new Error("ECONNREFUSED");
				return new Response("missing", { status: 404 });
			});
		const result = await current.session.compact({ keepRecentMessages: 2 });
		expect(result.estimatedTokensAfter).toBeGreaterThan(0);
		expect(current.session.getContextUsage()).toEqual({ tokens: null, contextWindow: 100000, percent: null });
	},
);

it.each(["setter", "overrides"] as const)(
	"invalidates the rendered exact count on a live summary budget %s change",
	async (method) => {
		const current = await fixture();
		await current.session.compact({ keepRecentMessages: 2 });
		const component = footer(current);
		expect(stripAnsi(component.render(120)[1])).toContain("100/");
		const leaf = current.manager.getLeafId();
		if (method === "setter") current.owner.settingsManager.setSummaryBlockMaxTokens(0);
		else current.owner.settingsManager.applyOverrides({ compaction: { summaryBlockMaxTokens: 0 } });
		expect(stripAnsi(component.render(120)[1])).toContain("?/");
		expect(current.manager.getLeafId()).toBe(leaf);
	},
);

it("refreshes the footer when an asynchronous exact count finishes without another entry", async () => {
	const current = await fixture();
	const component = footer(current);
	const uiContext = {
		isInitialized: true,
		footer: component,
		settingsManager: current.owner.settingsManager,
		defaultEditor: {},
		clearStatusIndicator: () => {},
		rebuildChatFromMessages: () => {},
		flushCompactionQueue: async () => {},
		fireDueScheduledMessages: () => {},
		ui: { requestRender: () => {}, terminal: { setProgress: () => {} } },
	};
	// This established prototype seam executes the real event consumer without launching a TUI.
	const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
		this: typeof uiContext,
		event: AgentSessionEvent,
	) => Promise<void>;
	const eventWork: Promise<void>[] = [];
	const unsubscribe = current.session.subscribe((event) => {
		if (event.type === "compaction_end" && event.result) eventWork.push(handleEvent.call(uiContext, event));
	});
	const started = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	current.setTokenizer(async (url) => {
		if (!url.endsWith("/chat/completions/input_tokens")) return Response.json({ tokens: [1, 2, 3] });
		started.resolve();
		await released.promise;
		return Response.json({ input_tokens: 100 });
	});
	const outcome = current.session.compact({ keepRecentMessages: 2 }).then(
		(result) => ({ result }),
		(error: unknown) => ({ error }),
	);
	try {
		await Promise.race([
			started.promise,
			outcome.then(() => {
				throw new Error("Chat count did not start");
			}),
		]);
		const leaf = current.manager.getLeafId();
		expect(stripAnsi(component.render(120)[1])).toContain("?/");
		released.resolve();
		expect(await outcome).toHaveProperty("result");
		await Promise.all(eventWork);
		expect(current.manager.getLeafId()).toBe(leaf);
		expect(stripAnsi(component.render(120)[1])).toContain("100/");
	} finally {
		released.resolve();
		await outcome;
		unsubscribe();
	}
});

it("does not use a context-omitted post-compaction response as current usage", async () => {
	const current = await fixture();
	await current.session.compact({ keepRecentMessages: 2 });
	const id = current.manager.appendMessage({
		...fauxAssistantMessage("omitted answer"),
		usage: {
			input: 500,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 500,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	});
	current.manager.appendContextEdit(id, null);
	current.session.refreshContext();
	expect(current.session.getContextUsage()).toEqual({ tokens: null, contextWindow: 100000, percent: null });
});

it.each(["setter", "overrides"] as const)(
	"does not publish a count started before a summary budget %s change",
	async (method) => {
		const current = await fixture();
		const started = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		current.setTokenizer(async (url) => {
			if (!url.endsWith("/chat/completions/input_tokens")) return Response.json({ tokens: [1] });
			started.resolve();
			await released.promise;
			return Response.json({ input_tokens: 100 });
		});
		const outcome = current.session.compact({ keepRecentMessages: 2 }).then(
			(result) => ({ result }),
			(error: unknown) => ({ error }),
		);
		try {
			await Promise.race([
				started.promise,
				outcome.then(() => {
					throw new Error("Budget gate did not start");
				}),
			]);
			if (method === "setter") current.owner.settingsManager.setSummaryBlockMaxTokens(0);
			else current.owner.settingsManager.applyOverrides({ compaction: { summaryBlockMaxTokens: 0 } });
			// Synchronize before completion too: the late assignment must not resurrect the invalidated count.
			expect(current.session.getContextUsage()?.tokens).toBeNull();
			released.resolve();
			expect(await outcome).toHaveProperty("result");
			expect(current.session.getContextUsage()).toEqual({ tokens: null, contextWindow: 100000, percent: null });
		} finally {
			released.resolve();
			await outcome;
		}
	},
);
