import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	type Container,
	isPadLinesToWidth,
	isWrapLinesToWidth,
	setPadLinesToWidth,
	setWrapLinesToWidth,
	Text,
} from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../../src/core/agent-session-services.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { AssistantMessageComponent } from "../../src/modes/interactive/components/assistant-message.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import {
	isMessageBackground,
	isMessageSeparator,
	setMessageBackground,
	setMessageSeparator,
} from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

async function createTranscriptMode(harness: Harness) {
	const previous = {
		pad: isPadLinesToWidth(),
		wrap: isWrapLinesToWidth(),
		background: isMessageBackground(),
		separator: isMessageSeparator(),
	};
	const services: AgentSessionServices = {
		cwd: harness.sessionManager.getCwd(),
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
	const terminal = new VirtualTerminal(120, 50);
	const mode = new InteractiveMode(runtime, { terminal });
	const internal = mode as unknown as {
		chatContainer: Container;
		defaultEditor: { onSubmit?: (text: string) => void | Promise<void> };
		rebuildChatFromMessages(): void;
	};
	return {
		mode,
		terminal,
		internal,
		output: () => stripAnsi(internal.chatContainer.render(120).join("\n")),
		assistants: () =>
			internal.chatContainer.children
				.filter((child) => child instanceof AssistantMessageComponent)
				.map((child) => stripAnsi(child.render(120).join("\n")).trim())
				.filter(Boolean),
		stop: async () => {
			mode.stop();
			await runtime.dispose();
			setPadLinesToWidth(previous.pad);
			setWrapLinesToWidth(previous.wrap);
			setMessageBackground(previous.background);
			setMessageSeparator(previous.separator);
		},
	};
}

it("renders edited and omitted contributions while retaining source cache-miss billing", async () => {
	const harness = await createHarness({
		settings: { quietStartup: true, showCacheMissNotices: true, compaction: { enabled: false } },
	});
	for (let index = 0; index < 2; index++) {
		const answer = fauxAssistantMessage(`cached raw answer ${index}`, { timestamp: index + 2 });
		answer.usage = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 100000,
			totalTokens: 100000,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 1, total: 1 },
		};
		const id = harness.sessionManager.appendMessage(answer);
		if (index === 1) harness.sessionManager.appendContextEdit(id, { content: "edited billed answer" });
	}
	const omitted = harness.sessionManager.appendCustomMessageEntry("omitted", "omitted visible note", true);
	harness.sessionManager.appendContextEdit(omitted, null);
	harness.session.refreshContext();
	const ui = await createTranscriptMode(harness);
	try {
		await ui.mode.init();
		for (const rebuild of [false, true]) {
			if (rebuild) ui.internal.rebuildChatFromMessages();
			expect(ui.output()).toContain("edited billed answer");
			expect(ui.output()).not.toContain("cached raw answer 1");
			expect(ui.output()).not.toContain("omitted visible note");
			expect(ui.output().match(/tokens re-billed/g)).toHaveLength(1);
		}
		await ui.terminal.waitForRender();
		expect(ui.terminal.getViewport().join("\n")).toContain("edited billed answer");
	} finally {
		await ui.stop();
		harness.cleanup();
	}
});

it.each(["success", "failure"] as const)(
	"submitted /continue uses the live projection and reconciles %s after persistence",
	async (outcome) => {
		const dir = mkdtempSync(join(tmpdir(), "pi-live-transcript-"));
		const manager = SessionManager.create(dir, join(dir, "sessions"));
		const harness = await createHarness({
			cwd: dir,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: {
				quietStartup: true,
				showCacheMissNotices: true,
				retry: { enabled: false },
				compaction: { enabled: false },
			},
			extensionFactories: [
				(pi) => {
					pi.registerEntryRenderer("state", () => new Text("state-only marker", 0, 0));
				},
			],
		});
		manager.appendCustomEntry("state", { retained: true });
		manager.appendCustomMessageEntry("visible", "visible continuation note", true);
		manager.appendCustomMessageEntry("hidden", "hidden continuation note", false);
		const prefix = manager.appendMessage(fauxAssistantMessage("saved original prefix", { stopReason: "length" }));
		manager.appendContextEdit(prefix, { content: "edited prefix" });
		manager.appendUsage("cache_warm", harness.getModel().provider, harness.getModel().id, {
			input: 20,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 20,
			cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
		});
		harness.session.refreshContext();
		const started = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let request: { prefill: boolean; text: string } | undefined;
		harness.setResponses([
			async (context, options) => {
				request = { prefill: options?.returnPrefill === true, text: getMessageText(context.messages.at(-1)) };
				started.resolve();
				await release.promise;
				return outcome === "success"
					? fauxAssistantMessage("edited prefix completed")
					: fauxAssistantMessage("", { stopReason: "error", errorMessage: "permanent continuation failure" });
			},
		]);
		const ui = await createTranscriptMode(harness);
		const updates: string[][] = [];
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "message_update") updates.push(ui.assistants());
		});
		let running: Promise<void> | undefined;
		try {
			await ui.mode.init();
			running = Promise.resolve(ui.internal.defaultEditor.onSubmit!("/continue"));
			await Promise.race([
				started.promise,
				running.then(() => {
					throw new Error("Continuation ended before held request");
				}),
			]);
			expect(request).toEqual({ prefill: true, text: "edited prefix" });
			const file = manager.getSessionFile();
			if (!file) throw new Error("Missing persisted session");
			expect(
				SessionManager.open(file)
					.buildSessionContext()
					.messages.filter((message) => message.role === "assistant")
					.map(getMessageText),
			).toEqual(["edited prefix"]);
			expect(ui.assistants()).toEqual([]);
			for (const text of ["visible continuation note", "state-only marker", "Cache warm"])
				expect(ui.output()).toContain(text);
			expect(ui.output()).not.toContain("hidden continuation note");
			release.resolve();
			await running;
			const expected = outcome === "success" ? "edited prefix completed" : "edited prefix";
			const visibleAnswers = ui.assistants();
			const prefixRows = visibleAnswers.filter((text) => text.includes("edited prefix"));
			expect(prefixRows).toHaveLength(1);
			expect(prefixRows[0].split(expected)).toHaveLength(2);
			if (outcome === "failure") expect(prefixRows[0]).toContain("Response was truncated before completion.");
			expect(visibleAnswers.some((text) => text.includes("saved original prefix"))).toBe(false);
			expect(
				SessionManager.open(file)
					.buildSessionContext()
					.messages.filter((message) => message.role === "assistant")
					.map(getMessageText),
			).toContain(expected);
			if (outcome === "success") {
				expect(updates.some((answers) => answers.some((text) => text.includes("edited prefix")))).toBe(true);
				expect(
					updates.every((answers) => answers.length <= 1),
					JSON.stringify(updates),
				).toBe(true);
				expect(ui.assistants()).toEqual([expected]);
			}
			ui.internal.rebuildChatFromMessages();
			const rebuiltRows = ui.assistants().filter((text) => text.includes("edited prefix"));
			expect(rebuiltRows).toHaveLength(1);
			expect(rebuiltRows[0].split(expected)).toHaveLength(2);
			if (outcome === "failure") expect(rebuiltRows[0]).toContain("Response was truncated before completion.");
			for (const text of ["visible continuation note", "state-only marker", "Cache warm"])
				expect(ui.output()).toContain(text);
			await ui.terminal.waitForRender();
			expect(ui.terminal.getScrollBuffer().join("\n")).toContain(expected);
		} finally {
			release.resolve();
			await running?.catch(() => {});
			await harness.session.abort();
			unsubscribe();
			await ui.stop();
			harness.cleanup();
			rmSync(dir, { recursive: true, force: true });
		}
	},
);

it("reconciles automatic transient prefill retries without duplicate assistant rows", async () => {
	const harness = await createHarness({
		fauxApi: "openai-completions",
		settings: {
			quietStartup: true,
			retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 },
			compaction: { enabled: false },
		},
	});
	harness.sessionManager.appendCustomMessageEntry("retry-note", "visible retry note", true);
	harness.session.refreshContext();
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const requests: Array<{ prefill: boolean; text: string }> = [];
	harness.setResponses([
		fauxAssistantMessage("interrupted retry prefix", { stopReason: "error", errorMessage: "Connection error." }),
		(context, options) => {
			requests.push({ prefill: options?.returnPrefill === true, text: getMessageText(context.messages.at(-1)) });
			return fauxAssistantMessage("", { stopReason: "error", errorMessage: "Connection error." });
		},
		async (context, options) => {
			requests.push({ prefill: options?.returnPrefill === true, text: getMessageText(context.messages.at(-1)) });
			started.resolve();
			await release.promise;
			return fauxAssistantMessage("interrupted retry prefix recovered");
		},
	]);
	const ui = await createTranscriptMode(harness);
	const updates: string[][] = [];
	const unsubscribe = harness.session.subscribe((event) => {
		if (event.type === "message_update" && requests.length === 2) updates.push(ui.assistants());
	});
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = harness.session.prompt("finish interrupted response");
		await Promise.race([
			started.promise,
			running.then(() => {
				throw new Error("Retry request absent");
			}),
		]);
		expect(requests).toEqual([
			{ prefill: true, text: "interrupted retry prefix" },
			{ prefill: true, text: "interrupted retry prefix" },
		]);
		expect(ui.assistants()).toEqual([]);
		expect(ui.output()).toContain("visible retry note");
		release.resolve();
		await running;
		expect(updates.some((answers) => answers.some((text) => text.includes("interrupted retry prefix")))).toBe(true);
		expect(
			updates.every((answers) => answers.length <= 1),
			JSON.stringify(updates),
		).toBe(true);
		expect(ui.assistants()).toEqual(["interrupted retry prefix recovered"]);
		expect(harness.eventsOfType("auto_retry_end").map((event) => event.success)).toEqual([true]);
		ui.internal.rebuildChatFromMessages();
		expect(ui.assistants()).toEqual(["interrupted retry prefix recovered"]);
	} finally {
		release.resolve();
		await running?.catch(() => {});
		await harness.session.abort();
		unsubscribe();
		await ui.stop();
		harness.cleanup();
	}
});

it("reconciles a durable prefix at settlement after restoration persistence fails", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-live-restore-failure-"));
	const manager = SessionManager.create(dir, join(dir, "sessions"));
	let ui: Awaited<ReturnType<typeof createTranscriptMode>> | undefined;
	let beforeSettlement: { visible: string[]; projected: string[] } | undefined;
	const harness = await createHarness({
		cwd: dir,
		sessionManager: manager,
		fauxApi: "openai-completions",
		settings: { quietStartup: true, retry: { enabled: false }, compaction: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("agent_settled", () => {
					beforeSettlement = {
						visible: ui?.assistants() ?? [],
						projected: harness.session
							.getSessionProjection()
							.messages.filter((message) => message.role === "assistant")
							.map(getMessageText),
					};
				});
			},
		],
	});
	manager.appendMessage({ role: "user", content: "saved request", timestamp: 1 });
	manager.appendMessage(fauxAssistantMessage("durable original prefix", { stopReason: "length" }));
	harness.session.refreshContext();
	harness.setResponses([
		fauxAssistantMessage("", { stopReason: "error", errorMessage: "permanent continuation failure" }),
	]);
	let armed = false;
	let failed = false;
	const unsubscribe = harness.session.subscribe((event) => {
		if (event.type === "turn_end" && event.message.role === "assistant" && event.message.stopReason === "error")
			armed = true;
	});
	const actual = await vi.importActual<typeof fs>("fs");
	try {
		ui = await createTranscriptMode(harness);
		await ui.mode.init();
		vi.mocked(fs.writeFileSync).mockImplementation((...args) => {
			if (armed && !failed) {
				failed = true;
				throw new Error("injected transcript restoration failure");
			}
			return actual.writeFileSync(...args);
		});
		await ui.internal.defaultEditor.onSubmit!("/continue");
		expect(failed).toBe(true);
		expect(harness.session.isIdle).toBe(true);
		expect(beforeSettlement?.projected).toContain("durable original prefix");
		expect(beforeSettlement?.visible.some((text) => text.includes("durable original prefix"))).toBe(false);
		expect(ui.assistants().filter((text) => text.includes("durable original prefix"))).toHaveLength(1);
		expect(ui.output()).toContain("injected transcript restoration failure");
		await ui.terminal.waitForRender();
		expect(ui.terminal.getViewport().join("\n")).toContain("durable original prefix");
	} finally {
		vi.mocked(fs.writeFileSync).mockImplementation(actual.writeFileSync);
		unsubscribe();
		await ui?.stop();
		harness.cleanup();
		rmSync(dir, { recursive: true, force: true });
	}
});
