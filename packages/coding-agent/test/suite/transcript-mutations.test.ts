import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	type Container,
	isPadLinesToWidth,
	isWrapLinesToWidth,
	setPadLinesToWidth,
	setWrapLinesToWidth,
} from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../../src/core/agent-session-services.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import {
	isMessageBackground,
	isMessageSeparator,
	setMessageBackground,
	setMessageSeparator,
} from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness, getMessageText } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

const operations = ["delete-last", "delete-one", "replace", "add", "version", "swipe"] as const;

it.each(operations)("publishes committed %s once to subscribers and the initialized transcript", async (operation) => {
	const previous = {
		pad: isPadLinesToWidth(),
		wrap: isWrapLinesToWidth(),
		background: isMessageBackground(),
		separator: isMessageSeparator(),
	};
	const dir = fs.mkdtempSync(join(tmpdir(), "pi-mutation-invalidation-"));
	const manager = SessionManager.create(dir, join(dir, "sessions"));
	const harness = await createHarness({
		cwd: dir,
		sessionManager: manager,
		settings: { quietStartup: true, retry: { enabled: false }, compaction: { enabled: false } },
	});
	vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-24T00:00:00Z") });
	const question = manager.appendMessage({ role: "user", content: "original question", timestamp: 1 });
	manager.appendMessage(fauxAssistantMessage("answer version one"));
	manager.branch(question);
	vi.setSystemTime(new Date("2026-10-24T00:00:01Z"));
	const current = manager.appendMessage(fauxAssistantMessage("answer version two"));
	harness.session.refreshContext();
	const stamp = manager.getEntry(current)!.timestamp;
	const mutate = () => {
		switch (operation) {
			case "delete-last":
				return harness.session.deleteLastMessages(1);
			case "delete-one":
				return harness.session.deleteMessage(current);
			case "replace":
				return harness.session.applyMessageEdits('<pi_edit id="1" role="user">edited question</pi_edit>');
			case "add":
				return harness.session.applyMessageEdits('<pi_edit id="-1" role="user">added input</pi_edit>');
			case "version":
				return harness.session.applyMessageEdits(
					'<pi_edit id="0" role="assistant"><pi_content>new swipe answer</pi_content></pi_edit>',
				);
			case "swipe":
				return harness.session.applyMessageEdits(
					`<pi_swipe timestamp="${stamp}" role="assistant"><pi_content>changed swipe answer</pi_content></pi_swipe>`,
				);
		}
	};
	const expected =
		operation === "replace"
			? ["edited question", "answer version two"]
			: operation === "add"
				? ["original question", "answer version two", "added input"]
				: operation === "version"
					? ["original question", "new swipe answer"]
					: operation === "swipe"
						? ["original question", "changed swipe answer"]
						: ["original question"];
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
	const terminal = new VirtualTerminal(120, 40);
	const mode = new InteractiveMode(runtime, { terminal });
	const internal = mode as unknown as { chatContainer: Container };
	const snapshots: Array<{ live: string[]; disk: string[]; leaf: string | null }> = [];
	const file = manager.getSessionFile();
	if (!file) throw new Error("Missing mutation session file");
	const unsubscribe = harness.session.subscribe((event) => {
		if (event.type !== "transcript_changed") return;
		const reopened = SessionManager.open(file);
		snapshots.push({
			live: harness.session.messages.filter((message) => message.role !== "system").map(getMessageText),
			disk: reopened
				.buildSessionContext()
				.messages.filter((message) => message.role !== "system")
				.map(getMessageText),
			leaf: reopened.getLeafId(),
		});
	});
	const actual = await vi.importActual<typeof fs>("fs");
	try {
		await mode.init();
		const before = fs.readFileSync(file);
		const originalMessages = structuredClone(harness.session.messages);
		const originalOutput = stripAnsi(internal.chatContainer.render(120).join("\n"));
		vi.mocked(fs.renameSync).mockImplementationOnce(() => {
			throw new Error("injected mutation rename failure");
		});
		expect(mutate).toThrow("injected mutation rename failure");
		expect(snapshots).toEqual([]);
		expect(fs.readFileSync(file)).toEqual(before);
		expect(harness.session.messages).toEqual(originalMessages);
		expect(stripAnsi(internal.chatContainer.render(120).join("\n"))).toBe(originalOutput);
		vi.mocked(fs.renameSync).mockImplementation(actual.renameSync);
		mutate();
		expect(snapshots).toEqual([{ live: expected, disk: expected, leaf: manager.getLeafId() }]);
		const output = stripAnsi(internal.chatContainer.render(120).join("\n"));
		for (const label of expected) expect(output.split(label), label).toHaveLength(2);
		for (const absent of [
			"original question",
			"answer version one",
			"answer version two",
			"edited question",
			"added input",
			"new swipe answer",
			"changed swipe answer",
		].filter((label) => !expected.includes(label)))
			expect(output).not.toContain(absent);
		await terminal.waitForRender();
		for (const label of expected) expect(terminal.getViewport().join("\n")).toContain(label);
		const count = snapshots.length;
		harness.session.deleteLastMessages(0);
		harness.session.deleteMessage("missing");
		harness.session.applyMessageEdits("ordinary text");
		expect(() => harness.session.applyMessageEdits('<pi_edit id="999" role="user">missing target</pi_edit>')).toThrow(
			"No message to edit",
		);
		expect(snapshots).toHaveLength(count);
	} finally {
		vi.mocked(fs.renameSync).mockImplementation(actual.renameSync);
		unsubscribe();
		mode.stop();
		await runtime.dispose();
		harness.cleanup();
		fs.rmSync(dir, { recursive: true, force: true });
		vi.useRealTimers();
		setPadLinesToWidth(previous.pad);
		setWrapLinesToWidth(previous.wrap);
		setMessageBackground(previous.background);
		setMessageSeparator(previous.separator);
	}
});
