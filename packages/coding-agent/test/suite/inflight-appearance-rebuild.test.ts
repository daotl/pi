import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type Container,
	isPadLinesToWidth,
	isWrapLinesToWidth,
	setPadLinesToWidth,
	setWrapLinesToWidth,
	Text,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../../src/core/agent-session-services.ts";
import { SettingsSelectorComponent } from "../../src/modes/interactive/components/settings-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import {
	isMessageBackground,
	isMessageSeparator,
	setMessageBackground,
	setMessageSeparator,
} from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness } from "./harness.ts";

type InflightMode = {
	defaultEditor: { onSubmit?: (text: string) => void | Promise<void> };
	editorContainer: Container;
	chatContainer: Container;
	streamingComponent?: Container;
	pendingTools: Map<string, Container>;
	setToolsExpanded(expanded: boolean): void;
};

it.each(["pad-lines", "wrap-lines", "message-background", "message-separator"] as const)(
	"keeps assistant deltas and tool progress attached through %s appearance rebuilds",
	async (setting) => {
		const previous = {
			pad: isPadLinesToWidth(),
			wrap: isWrapLinesToWidth(),
			background: isMessageBackground(),
			separator: isMessageSeparator(),
		};
		const toolGate = Promise.withResolvers<void>();
		const toolStarted = Promise.withResolvers<void>();
		const tool: AgentTool = {
			name: "live_output",
			label: "Live output",
			description: "Produces live output",
			parameters: Type.Object({}),
			execute: async (_id, _args, _signal, onUpdate) => {
				onUpdate?.({ content: [{ type: "text", text: "live tool progress" }], details: {} });
				toolStarted.resolve();
				await toolGate.promise;
				return { content: [{ type: "text", text: "final tool result" }], details: {} };
			},
		};
		const harness = await createHarness({
			tools: [tool],
			settings: { retry: { enabled: false }, compaction: { enabled: false }, quietStartup: true },
		});
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
		const terminal = new VirtualTerminal(100, 40);
		const mode = new InteractiveMode(runtime, { terminal });
		const internal = mode as unknown as InflightMode;
		const streams = [createAssistantMessageEventStream(), createAssistantMessageEventStream()];
		let requests = 0;
		harness.session.agent.streamFunction = () => streams[requests++];
		const visible = () => stripAnsi(internal.chatContainer.render(100).join("\n"));
		const toggle = async () => {
			await internal.defaultEditor.onSubmit?.("/settings");
			const selector = internal.editorContainer.children.find((child) => child instanceof SettingsSelectorComponent);
			if (!(selector instanceof SettingsSelectorComponent)) throw new Error("Expected mounted settings selector");
			selector.getSettingsList().selectItem(setting);
			terminal.sendInput("\r");
			terminal.sendInput("\x1b");
		};
		let running: Promise<void> | undefined;
		try {
			await mode.init();
			internal.setToolsExpanded(true);
			running = harness.session.prompt("show progress");
			await vi.waitFor(() => expect(requests).toBe(1));
			const partial = fauxAssistantMessage([
				{ type: "text", text: "unfinished answer" },
				fauxToolCall("live_output", {}, { id: "live-tool" }),
			]);
			streams[0].push({ type: "start", partial });
			streams[0].push({ type: "text_delta", contentIndex: 0, delta: "unfinished answer", partial });
			await vi.waitFor(() => expect(visible()).toContain("unfinished answer"));
			const assistant = internal.streamingComponent;
			const pendingTool = internal.pendingTools.get("live-tool");
			expect(assistant).toBeDefined();
			expect(pendingTool).toBeDefined();
			await toggle();
			expect(visible()).toContain("unfinished answer");
			expect(internal.chatContainer.children).toContain(assistant);
			expect(internal.pendingTools.get("live-tool")).toBe(pendingTool);
			const completed = fauxAssistantMessage(
				[
					{ type: "text", text: "unfinished answer completed" },
					fauxToolCall("live_output", {}, { id: "live-tool" }),
				],
				{ stopReason: "toolUse" },
			);
			streams[0].push({ type: "text_delta", contentIndex: 0, delta: " completed", partial: completed });
			streams[0].push({ type: "done", reason: "toolUse", message: completed });
			await Promise.race([
				toolStarted.promise,
				running.then(() => {
					throw new Error("Tool did not start");
				}),
			]);
			await vi.waitFor(() => expect(visible()).toContain("live tool progress"));
			const liveTool = internal.pendingTools.get("live-tool");
			await toggle();
			expect(visible()).toContain("live tool progress");
			expect(internal.pendingTools.get("live-tool")).toBe(liveTool);
			expect(internal.chatContainer.children).toContain(liveTool);
			expect(visible().match(/unfinished answer completed/g)).toHaveLength(1);
			toolGate.resolve();
			await vi.waitFor(() => expect(requests).toBe(2));
			const continuation = fauxAssistantMessage("follow-up streaming");
			streams[1].push({ type: "start", partial: continuation });
			streams[1].push({ type: "text_delta", contentIndex: 0, delta: "follow-up streaming", partial: continuation });
			await vi.waitFor(() => expect(visible()).toContain("follow-up streaming"));
			await toggle();
			expect(visible()).toContain("follow-up streaming");
			const final = fauxAssistantMessage("follow-up streaming finished");
			streams[1].push({ type: "text_delta", contentIndex: 0, delta: " finished", partial: final });
			streams[1].push({ type: "done", reason: "stop", message: final });
			await running;
			for (const text of ["unfinished answer completed", "final tool result", "follow-up streaming finished"])
				expect(visible().split(text)).toHaveLength(2);
			await terminal.waitForRender();
			expect(terminal.getScrollBuffer().join("\n")).toContain("follow-up streaming finished");
		} finally {
			toolGate.resolve();
			for (const stream of streams) stream.end(fauxAssistantMessage("cleanup"));
			await harness.session.abort();
			await running?.catch(() => {});
			mode.stop();
			await runtime.dispose();
			harness.cleanup();
			setPadLinesToWidth(previous.pad);
			setWrapLinesToWidth(previous.wrap);
			setMessageBackground(previous.background);
			setMessageSeparator(previous.separator);
		}
	},
);

it("refreshes unresolved historical tool renderers through actual /reload", async () => {
	const previous = {
		pad: isPadLinesToWidth(),
		wrap: isWrapLinesToWidth(),
		background: isMessageBackground(),
		separator: isMessageSeparator(),
	};
	let version = 1;
	let extensions = await createTestExtensionsResult([
		(pi) => {
			pi.registerTool({
				name: "versioned_tool",
				label: "Versioned tool",
				description: "Historical tool renderer",
				parameters: Type.Object({}),
				renderCall: () => new Text("renderer v1", 0, 0),
				execute: async () => ({ content: [], details: {} }),
			});
		},
	]);
	const loader = createTestResourceLoader();
	loader.getExtensions = () => extensions;
	loader.reload = async () => {
		const reloadedVersion = ++version;
		extensions = await createTestExtensionsResult([
			(pi) => {
				pi.registerTool({
					name: "versioned_tool",
					label: "Versioned tool",
					description: "Historical tool renderer",
					parameters: Type.Object({}),
					renderCall: () => new Text(`renderer v${reloadedVersion}`, 0, 0),
					execute: async () => ({ content: [], details: {} }),
				});
			},
		]);
	};
	const harness = await createHarness({
		resourceLoader: loader,
		settings: { retry: { enabled: false }, compaction: { enabled: false }, quietStartup: true },
	});
	harness.sessionManager.appendMessage({ role: "user", content: "historical request", timestamp: 1 });
	harness.sessionManager.appendMessage(
		fauxAssistantMessage([fauxToolCall("versioned_tool", {}, { id: "unresolved" })], { stopReason: "toolUse" }),
	);
	const services: AgentSessionServices = {
		cwd: harness.sessionManager.getCwd(),
		agentDir: harness.tempDir,
		modelRuntime: harness.session.modelRuntime,
		settingsManager: harness.settingsManager,
		resourceLoader: loader,
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
	const terminal = new VirtualTerminal(100, 40);
	const mode = new InteractiveMode(runtime, { terminal });
	const internal = mode as unknown as InflightMode;
	const visible = () => stripAnsi(internal.chatContainer.render(100).join("\n"));
	try {
		await mode.init();
		expect(harness.session.isStreaming).toBe(false);
		expect(internal.pendingTools.has("unresolved")).toBe(true);
		expect(visible()).toContain("renderer v1");
		await internal.defaultEditor.onSubmit!("/reload");
		expect(visible()).toContain("renderer v2");
		expect(visible()).not.toContain("renderer v1");
		await terminal.waitForRender();
		expect(terminal.getViewport().join("\n")).toContain("renderer v2");
	} finally {
		mode.stop();
		await runtime.dispose();
		harness.cleanup();
		setPadLinesToWidth(previous.pad);
		setWrapLinesToWidth(previous.wrap);
		setMessageBackground(previous.background);
		setMessageSeparator(previous.separator);
	}
});
