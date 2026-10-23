import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, type Usage } from "@earendil-works/pi-ai";
import {
	Container,
	isPadLinesToWidth,
	isWrapLinesToWidth,
	setPadLinesToWidth,
	setWrapLinesToWidth,
} from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../src/core/agent-session-services.ts";
import type { CompactionSummaryMessage } from "../src/core/messages.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { CompactionSummaryMessageComponent } from "../src/modes/interactive/components/compaction-summary-message.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import {
	initTheme,
	isMessageBackground,
	isMessageSeparator,
	setMessageBackground,
	setMessageSeparator,
} from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness } from "./suite/harness.ts";

describe("InteractiveMode compaction events", () => {
	test("restores Escape and clears progress and status after a no-result automatic compaction", async () => {
		initTheme("dark");
		const defaultEscape = vi.fn();
		const progress: boolean[] = [];
		const indicators = new Set<string>();
		const context = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			autoCompactionEscapeHandler: undefined as (() => void) | undefined,
			retryEscapeHandler: undefined as (() => void) | undefined,
			defaultEditor: { onEscape: defaultEscape as () => void },
			settingsManager: { getShowTerminalProgress: () => true },
			session: { abortCompaction: vi.fn() },
			ui: {
				requestRender: vi.fn(),
				terminal: {
					setProgress: (active: boolean) => {
						progress.push(active);
					},
				},
			},
			showStatusIndicator: () => {
				indicators.add("compaction");
			},
			clearStatusIndicator: (kind: string) => {
				indicators.delete(kind);
			},
			flushCompactionQueue: vi.fn().mockResolvedValue(undefined),
			fireDueScheduledMessages: vi.fn(),
			showStatus: vi.fn(),
			showError: vi.fn(),
		};
		const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent");
		await Reflect.apply(handleEvent, context, [{ type: "compaction_start", reason: "threshold" }]);
		expect(context.defaultEditor.onEscape).not.toBe(defaultEscape);
		expect(progress).toEqual([true]);
		expect([...indicators]).toEqual(["compaction"]);
		await Reflect.apply(handleEvent, context, [
			{ type: "compaction_end", reason: "threshold", result: undefined, aborted: false, willRetry: false },
		]);
		expect(context.defaultEditor.onEscape).toBe(defaultEscape);
		expect(context.autoCompactionEscapeHandler).toBeUndefined();
		expect(progress).toEqual([true, false]);
		expect([...indicators]).toEqual([]);
		expect(context.showStatus).not.toHaveBeenCalled();
		expect(context.showError).not.toHaveBeenCalled();
	});

	test("uses the cache miss notice setting for compaction and branch summary costs", () => {
		const usage: Usage = {
			input: 10,
			output: 20,
			cacheRead: 30,
			cacheWrite: 40,
			totalTokens: 100,
			cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.065, total: 0.125 },
		};
		const addCompactionCostNotice = Reflect.get(InteractiveMode.prototype, "addCompactionCostNotice") as (
			this: { chatContainer: Container; settingsManager: { getShowCacheMissNotices(): boolean } },
			notice: {
				type: "compaction_cost";
				kind: "compaction" | "branch_summary";
				usage: Usage;
			},
		) => void;

		initTheme("dark");
		const enabled = {
			chatContainer: new Container(),
			settingsManager: { getShowCacheMissNotices: () => true },
		};
		addCompactionCostNotice.call(enabled, { type: "compaction_cost", kind: "compaction", usage });
		addCompactionCostNotice.call(enabled, {
			type: "compaction_cost",
			kind: "branch_summary",
			usage,
		});
		const output = stripAnsi(enabled.chatContainer.render(120).join("\n"));
		expect(output).toContain("Compaction: 100 tokens billed (~$0.13)");
		expect(output).toContain("Branch summary: 100 tokens billed (~$0.13)");

		const disabled = {
			chatContainer: new Container(),
			settingsManager: { getShowCacheMissNotices: () => false },
		};
		addCompactionCostNotice.call(disabled, { type: "compaction_cost", kind: "compaction", usage });
		expect(disabled.chatContainer.children).toHaveLength(0);
	});

	test("updates the working state when the same agent run resumes after compaction", async () => {
		const fakeThis = {
			isInitialized: true,
			footer: { invalidate: vi.fn() },
			activeStatusIndicator: undefined,
			workingVisible: true,
			showWorkingStatusIndicator: vi.fn(),
			clearStatusIndicator: vi.fn(),
			settingsManager: { getShowTerminalProgress: () => true },
			ui: { requestRender: vi.fn(), terminal: { setProgress: vi.fn() } },
		};
		const handleEvent = Reflect.get(InteractiveMode.prototype, "handleEvent") as (
			this: typeof fakeThis,
			event: { type: "turn_start" },
		) => Promise<void>;

		await handleEvent.call(fakeThis, { type: "turn_start" });

		expect(fakeThis.ui.terminal.setProgress).toHaveBeenCalledWith(true);
		expect(fakeThis.showWorkingStatusIndicator).toHaveBeenCalledTimes(1);
		expect(fakeThis.clearStatusIndicator).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);

		fakeThis.workingVisible = false;
		await handleEvent.call(fakeThis, { type: "turn_start" });

		expect(fakeThis.showWorkingStatusIndicator).toHaveBeenCalledTimes(1);
		expect(fakeThis.clearStatusIndicator).toHaveBeenCalledTimes(1);
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(2);
	});

	// Regression test for #9340.
	test("routes interactive response aborts through AgentSession", () => {
		const abort = vi.fn(async () => {});
		const ui = {
			clearAllQueues: () => ({ steering: [], followUp: [] }),
			updatePendingMessagesDisplay: vi.fn(),
			session: { abort },
		};
		const restoreQueuedMessagesToEditor = Reflect.get(InteractiveMode.prototype, "restoreQueuedMessagesToEditor") as (
			this: typeof ui,
			options?: { abort?: boolean },
		) => number;

		restoreQueuedMessagesToEditor.call(ui, { abort: true });

		expect(abort).toHaveBeenCalledOnce();
	});

	test.each(
		(["context", "chronological"] as const).flatMap((placement) =>
			(["initial", "completion", "boundary", "rebuild", "reopen"] as const).map((phase) => ({ placement, phase })),
		),
	)("keeps persisted selected summaries in $placement order after $phase", async ({ placement, phase }) => {
		const previous = {
			pad: isPadLinesToWidth(),
			wrap: isWrapLinesToWidth(),
			background: isMessageBackground(),
			separator: isMessageSeparator(),
		};
		const dir = mkdtempSync(join(tmpdir(), "pi-summary-presentation-"));
		const manager = SessionManager.create(dir, join(dir, "sessions"));
		const usage: Usage = {
			input: 10,
			output: 20,
			cacheRead: 30,
			cacheWrite: 40,
			totalTokens: 100,
			cost: { input: 0.01, output: 0.02, cacheRead: 0.03, cacheWrite: 0.04, total: 0.1 },
		};
		const newerUsage: Usage = { ...usage, input: 110, totalTokens: 200, cost: { ...usage.cost, total: 0.2 } };
		const manualUsage: Usage = { ...usage, input: 210, totalTokens: 300, cost: { ...usage.cost, total: 0.3 } };
		const boundaryUsage: Usage = { ...usage, input: 310, totalTokens: 400, cost: { ...usage.cost, total: 0.4 } };
		manager.appendMessage(fauxAssistantMessage("discarded history"));
		const kept = manager.appendMessage({ role: "user", content: "retained marker", timestamp: 1 });
		manager.appendCompaction("filtered checkpoint", kept, 50, undefined, true, usage, 10_000);
		manager.appendCompaction("older marker", kept, 100, undefined, true, usage, 1);
		manager.appendCompaction("newest marker", kept, 200, undefined, true, newerUsage, 1);
		manager.appendMessage(fauxAssistantMessage("retained answer"));
		let boundaryCommitted = false;
		const settings = {
			quietStartup: true,
			retry: { enabled: false },
			compaction: { enabled: false, summaryPlacement: placement, summaryBlockMaxTokens: 100 },
			showCacheMissNotices: true,
		};
		const harness = await createHarness({
			cwd: dir,
			sessionManager: manager,
			settings,
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", () => ({
						compaction: {
							summary: "manual marker",
							firstKeptEntryId: kept,
							tokensBefore: 300,
							usage: manualUsage,
						},
					}));
					pi.on("turn_end", () => {
						if (phase !== "boundary" || boundaryCommitted) return;
						boundaryCommitted = true;
						return {
							entries: [
								{
									type: "compaction",
									summary: "boundary marker",
									firstKeptEntryId: kept,
									usage: boundaryUsage,
								},
								{ type: "custom_message", customType: "boundary", content: "trailing marker", display: true },
							],
						};
					});
				},
			],
		});
		const services: AgentSessionServices = {
			cwd: dir,
			agentDir: harness.tempDir,
			modelRuntime: harness.session.modelRuntime,
			settingsManager: harness.settingsManager,
			resourceLoader: harness.session.resourceLoader,
			diagnostics: [],
		};
		const runtime = new AgentSessionRuntime(
			harness.session,
			services,
			async ({ sessionManager, sessionStartEvent }) => ({
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model: harness.getModel(),
					noTools: "all",
				})),
				services,
				diagnostics: [],
			}),
		);
		const terminal = new VirtualTerminal(160, 70);
		const mode = new InteractiveMode(runtime, { terminal });
		const internal = mode as unknown as { chatContainer: Container; rebuildChatFromMessages(): void };
		let reopened: Awaited<ReturnType<typeof createHarness>> | undefined;
		let reopenedRuntime: AgentSessionRuntime | undefined;
		let reopenedMode: InteractiveMode | undefined;
		try {
			await mode.init();
			let target = internal.chatContainer;
			let observedManager = manager;
			let observedTerminal = terminal;
			if (phase === "completion") {
				await harness.session.compact({ keepRecentMessages: 1 });
				expect(harness.eventsOfType("compaction_end").at(-1)?.result?.summary).toBe("manual marker");
			} else if (phase === "boundary") {
				harness.setResponses([fauxAssistantMessage("boundary answer")]);
				await harness.session.prompt("boundary request");
				expect(
					harness
						.eventsOfType("entry_appended")
						.some((event) => event.entry.type === "compaction" && event.entry.summary === "boundary marker"),
				).toBe(true);
			} else if (phase === "rebuild") internal.rebuildChatFromMessages();
			else if (phase === "reopen") {
				const file = manager.getSessionFile();
				if (!file) throw new Error("Missing persisted session");
				reopened = await createHarness({ cwd: dir, sessionManager: SessionManager.open(file), settings });
				const reopenedServices: AgentSessionServices = {
					cwd: dir,
					agentDir: reopened.tempDir,
					modelRuntime: reopened.session.modelRuntime,
					settingsManager: reopened.settingsManager,
					resourceLoader: reopened.session.resourceLoader,
					diagnostics: [],
				};
				const reopenedModel = reopened.getModel();
				reopenedRuntime = new AgentSessionRuntime(
					reopened.session,
					reopenedServices,
					async ({ sessionManager, sessionStartEvent }) => ({
						...(await createAgentSessionFromServices({
							services: reopenedServices,
							sessionManager,
							sessionStartEvent,
							model: reopenedModel,
							noTools: "all",
						})),
						services: reopenedServices,
						diagnostics: [],
					}),
				);
				observedTerminal = new VirtualTerminal(160, 70);
				reopenedMode = new InteractiveMode(reopenedRuntime, { terminal: observedTerminal });
				await reopenedMode.init();
				target = (reopenedMode as unknown as { chatContainer: Container }).chatContainer;
				observedManager = reopened.sessionManager;
			}
			const selected = observedManager.buildContextEntries();
			const persisted = selected.filter((entry) => entry.type === "compaction");
			const summaries = persisted.map((entry) => entry.summary);
			const selectedIds = new Set(selected.map((entry) => entry.id));
			const presentation =
				placement === "context"
					? selected
					: observedManager.getBranch().filter((entry) => selectedIds.has(entry.id));
			const expected = presentation.flatMap((entry) => {
				if (entry.type === "compaction") return [entry.summary];
				if (entry.type === "custom_message") return typeof entry.content === "string" ? [entry.content] : [];
				if (entry.type !== "message") return [];
				if (entry.message.role === "user" && typeof entry.message.content === "string")
					return [entry.message.content];
				if (entry.message.role !== "assistant") return [];
				return entry.message.content.flatMap((content) => (content.type === "text" ? [content.text] : []));
			});
			const output = stripAnsi(target.render(160).join("\n"));
			for (const label of expected) expect(output.split(label), label).toHaveLength(2);
			expect([...expected].sort((a, b) => output.indexOf(a) - output.indexOf(b))).toEqual(expected);
			expect(output).not.toContain("filtered checkpoint");
			expect(output).not.toContain("discarded history");
			const notices: Record<string, string> = {
				"older marker": "Compaction: 100 tokens billed (~$0.10)",
				"newest marker": "Compaction: 200 tokens billed (~$0.20)",
				"manual marker": "Compaction: 300 tokens billed (~$0.30)",
				"boundary marker": "Compaction: 400 tokens billed (~$0.40)",
			};
			const billed = summaries.map((summary) => [summary, notices[summary]]);
			for (const [summary, notice] of billed) {
				expect(output.split(notice)).toHaveLength(2);
				expect(output.indexOf(notice)).toBeGreaterThan(output.indexOf(summary));
				const next = expected[expected.indexOf(summary) + 1];
				if (next) expect(output.indexOf(notice)).toBeLessThan(output.indexOf(next));
			}
			const displayed = target.children
				.filter((child) => child instanceof CompactionSummaryMessageComponent)
				.map((child) => (child as unknown as { message: CompactionSummaryMessage }).message);
			expect(displayed.map((message) => ({ summary: message.summary, timestamp: message.timestamp }))).toEqual(
				persisted.map((entry) => ({ summary: entry.summary, timestamp: new Date(entry.timestamp).getTime() })),
			);
			expect(
				observedManager
					.buildSessionContext()
					.messages.filter((message) => message.role === "compactionSummary")
					.map((message) => message.summary),
			).toEqual(summaries);
			await observedTerminal.waitForRender();
			const viewport = observedTerminal.getScrollBuffer().join("\n");
			for (const label of expected) expect(viewport).toContain(label);
		} finally {
			reopenedMode?.stop();
			await reopenedRuntime?.dispose();
			reopened?.cleanup();
			mode.stop();
			await runtime.dispose();
			harness.cleanup();
			rmSync(dir, { recursive: true, force: true });
			setPadLinesToWidth(previous.pad);
			setWrapLinesToWidth(previous.wrap);
			setMessageBackground(previous.background);
			setMessageSeparator(previous.separator);
		}
	});
});
