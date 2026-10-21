import * as fs from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../../src/core/agent-session-services.ts";
import { type HeartbeatEntry, InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness } from "./harness.ts";

for (const transition of ["replacement", "stop"] as const) {
	describe(`heartbeat file load during real ${transition}`, () => {
		it.each(["content", "failure"] as const)("discards the outgoing %s result", async (result) => {
			const harness = await createHarness({
				settings: { compaction: { enabled: false }, retry: { enabled: false } },
			});
			const services: AgentSessionServices = {
				cwd: harness.session.sessionManager.getCwd(),
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
			const mode = new InteractiveMode(runtime, { terminal: new VirtualTerminal(100, 30) });
			const internal = mode as unknown as {
				heartbeats: HeartbeatEntry[];
				heartbeatTicker?: ReturnType<typeof setInterval>;
				handleHeartbeatCommand(arg: string): Promise<void>;
				showStatus(message: string): void;
			};
			const entered = Promise.withResolvers<void>();
			const gate = Promise.withResolvers<string>();
			let pending: Promise<void> | undefined;
			let read: ReturnType<typeof vi.spyOn> | undefined;
			let statuses: ReturnType<typeof vi.spyOn> | undefined;
			try {
				await mode.init();
				const outgoingSession = runtime.session;
				const target = join(harness.tempDir, "outgoing-heartbeats.md");
				const originalRead = fs.promises.readFile.bind(fs.promises);
				read = vi.spyOn(fs.promises, "readFile").mockImplementation((file, ...args) => {
					if (String(file) !== target) return originalRead(file, ...args);
					entered.resolve();
					return gate.promise;
				});
				statuses = vi.spyOn(internal, "showStatus");
				pending = internal.handleHeartbeatCommand(`load ${target}`);
				await entered.promise;
				if (transition === "replacement") {
					expect(await runtime.newSession()).toEqual({ cancelled: false });
					expect(runtime.session).not.toBe(outgoingSession);
				} else mode.stop();
				statuses.mockClear();
				if (result === "failure") gate.reject(new Error("outgoing read failed"));
				else gate.resolve("/heartbeat 5m\noutgoing instruction\n");
				await pending;
				expect(internal.heartbeats).toEqual([]);
				expect(internal.heartbeatTicker).toBeUndefined();
				expect(statuses).not.toHaveBeenCalled();
				if (transition === "replacement") {
					read.mockRestore();
					const currentTarget = join(harness.tempDir, "current-heartbeats.md");
					fs.writeFileSync(currentTarget, "/heartbeat 5m\ncurrent instruction\n");
					await internal.handleHeartbeatCommand(`load ${currentTarget}`);
					expect(internal.heartbeats.map((entry) => entry.text)).toEqual(["current instruction"]);
					expect(internal.heartbeatTicker).toBeDefined();
				}
			} finally {
				gate.resolve("");
				await pending;
				read?.mockRestore();
				statuses?.mockRestore();
				mode.stop();
				await runtime.dispose();
				harness.cleanup();
			}
		});
	});
}
