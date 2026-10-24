import * as fs from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { type HeartbeatEntry, InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness, getMessageText } from "./harness.ts";

describe("startup heartbeat project trust", () => {
	it.each([
		{ trusted: false, cli: false },
		{ trusted: true, cli: false },
		{ trusted: false, cli: true },
	])("gates automatic scheduling with %j", async ({ trusted, cli }) => {
		const offline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "1";
		const harness = await createHarness({ settings: { compaction: { enabled: false }, retry: { enabled: false } } });
		const cwd = vi.spyOn(harness.sessionManager, "getCwd").mockReturnValue(harness.tempDir);
		harness.settingsManager.setProjectTrusted(trusted);
		fs.writeFileSync(
			join(harness.sessionManager.getCwd(), "HEARTBEAT.md"),
			"/heartbeat 1s\nrepository instruction\n",
		);
		const runtime = {
			session: harness.session,
			setBeforeSessionInvalidate: () => {},
			setRebindSession: () => {},
		} as unknown as ConstructorParameters<typeof InteractiveMode>[0];
		const mode = new InteractiveMode(runtime, {
			terminal: new VirtualTerminal(80, 24),
			heartbeatSpecs: cli ? ["1s"] : [],
		});
		const internal = mode as unknown as {
			init(): Promise<void>;
			checkTmuxKeyboardSetup(): Promise<undefined>;
			maybeWarnAboutAnthropicSubscriptionAuth(): Promise<void>;
			getUserInput(): Promise<string>;
			heartbeats: HeartbeatEntry[];
			markActivity(): void;
			tickHeartbeats(): void;
			clearHeartbeats(): void;
			handleHeartbeatCommand(arg: string): Promise<void>;
		};
		internal.init = async () => {};
		internal.checkTmuxKeyboardSetup = async () => undefined;
		internal.maybeWarnAboutAnthropicSubscriptionAuth = async () => {};
		internal.getUserInput = async () => {
			throw new Error("startup observed");
		};
		harness.setResponses([fauxAssistantMessage("heartbeat answer")]);
		try {
			await expect(mode.run()).rejects.toThrow("startup observed");
			expect(internal.heartbeats.map((entry) => entry.text)).toEqual(
				trusted ? ["repository instruction"] : cli ? [""] : [],
			);
			if (!cli) {
				const now = Date.now();
				vi.useFakeTimers({ toFake: ["Date"] });
				vi.setSystemTime(now - 2000);
				internal.markActivity();
				vi.setSystemTime(now);
				internal.tickHeartbeats();
				vi.useRealTimers();
				if (trusted) {
					await vi.waitFor(() =>
						expect(
							harness.session.messages.filter((message) => message.role !== "system").map(getMessageText),
						).toEqual(["repository instruction", "heartbeat answer"]),
					);
					await harness.session.waitForIdle();
				} else expect(harness.faux.state.callCount).toBe(0);
			}
			if (!trusted && !cli) {
				await internal.handleHeartbeatCommand("load");
				expect(internal.heartbeats.map((entry) => entry.text)).toEqual(["repository instruction"]);
			}
		} finally {
			vi.useRealTimers();
			internal.clearHeartbeats();
			mode.stop();
			harness.cleanup();
			cwd.mockRestore();
			if (offline === undefined) delete process.env.PI_OFFLINE;
			else process.env.PI_OFFLINE = offline;
		}
	});
});
