import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import {
	isPadLinesToWidth,
	isWrapLinesToWidth,
	ProcessTerminal,
	setPadLinesToWidth,
	setWrapLinesToWidth,
} from "@earendil-works/pi-tui";
import chalk from "chalk";
import { Type } from "typebox";
import { afterEach, describe, expect, test, vi } from "vitest";
import { VirtualTerminal } from "../../../../tui/test/virtual-terminal.ts";
import { APP_NAME } from "../../../src/config.ts";
import { AgentSessionRuntime } from "../../../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../../../src/core/agent-session-services.ts";
import type { SessionManager } from "../../../src/core/session-manager.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import {
	isMessageBackground,
	isMessageSeparator,
	setMessageBackground,
	setMessageSeparator,
} from "../../../src/modes/interactive/theme/theme.ts";
import { createHarness } from "../harness.ts";

// Regression for https://github.com/earendil-works/pi/issues/5080
//
// On SIGTERM/SIGHUP the graceful shutdown must emit `session_shutdown`
// (runtimeHost.dispose) BEFORE touching the terminal. Extension teardown such
// as removing a socket does not write to the tty, so it must not be skipped if
// a later terminal-restore write fails on a dead or stalled terminal. The
// interactive quit path (Ctrl+D, /quit) keeps the opposite order to preserve
// the final TUI frame.

type ShutdownThis = {
	isShuttingDown: boolean;
	session: { abort: () => Promise<void>; flushPendingPersistence: () => void };
	unregisterSignalHandlers: () => void;
	runtimeHost: { dispose: () => Promise<void> };
	ui: {
		stop: (options: { preserveScreen: boolean }) => void;
		terminal: { drainInput: (ms: number) => Promise<void> };
	};
	themeController: { disableAutoSync: () => void };
	stop: () => void;
	sessionManager: SessionManager;
};

type InteractiveModePrototypeWithShutdown = {
	shutdown(this: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void>;
};

const interactiveModePrototype = InteractiveMode.prototype as unknown;
const tempDirs: string[] = [];
const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

class ProcessExitError extends Error {}

function createSessionManager(options: { sessionFile?: string } = {}): SessionManager {
	return {
		isPersisted: () => options.sessionFile !== undefined,
		getSessionFile: () => options.sessionFile,
		getSessionId: () => "test-session",
		getSessionDir: () => "/tmp/pi-sessions",
		usesDefaultSessionDir: () => true,
	} as unknown as SessionManager;
}

function createTempFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-shutdown-resume-hint-"));
	tempDirs.push(dir);
	const file = join(dir, "session.jsonl");
	writeFileSync(file, "\n");
	return file;
}

function setStdoutIsTTY(value: boolean): void {
	Object.defineProperty(process.stdout, "isTTY", { configurable: true, value });
}

function restoreStdoutIsTTY(): void {
	if (originalStdoutIsTTY) {
		Object.defineProperty(process.stdout, "isTTY", originalStdoutIsTTY);
	} else {
		Reflect.deleteProperty(process.stdout, "isTTY");
	}
}

function createContext(order: string[], sessionManager = createSessionManager()): ShutdownThis {
	return {
		isShuttingDown: false,
		session: { abort: async () => {}, flushPendingPersistence: () => {} },
		unregisterSignalHandlers: vi.fn(),
		runtimeHost: {
			dispose: vi.fn(async () => {
				order.push("dispose");
			}),
		},
		ui: {
			stop: () => {
				order.push("suspend");
			},
			terminal: {
				drainInput: vi.fn(async () => {
					order.push("drainInput");
				}),
			},
		},
		themeController: { disableAutoSync: vi.fn() },
		stop: vi.fn(() => {
			order.push("stop");
		}),
		sessionManager,
	};
}

async function callShutdown(context: ShutdownThis, options?: { fromSignal?: boolean }): Promise<void> {
	try {
		await (interactiveModePrototype as InteractiveModePrototypeWithShutdown).shutdown.call(context, options);
	} catch (error) {
		if (!(error instanceof ProcessExitError)) throw error;
	}
}

describe("InteractiveMode.shutdown ordering (#5080)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		restoreStdoutIsTTY();
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("signal-triggered shutdown emits session_shutdown before terminal writes", async () => {
		vi.spyOn(process, "exit").mockImplementation((() => {
			throw new ProcessExitError();
		}) as typeof process.exit);
		const order: string[] = [];
		const context = createContext(order);

		await callShutdown(context, { fromSignal: true });

		expect(order).toEqual(["dispose", "drainInput", "stop"]);
		expect(context.isShuttingDown).toBe(true);
	});

	test.each(["EIO", "EPIPE"])(
		"finishes signal cleanup before active abort writes progress to a dead tty (%s)",
		async (code) => {
			const previous = {
				pad: isPadLinesToWidth(),
				wrap: isWrapLinesToWidth(),
				background: isMessageBackground(),
				separator: isMessageSeparator(),
			};
			const started = Promise.withResolvers<void>();
			const order: string[] = [];
			const progressCleanupCounts: number[] = [];
			let cleanupCount = 0;
			let failProgress = false;
			const harness = await createHarness({
				settings: {
					quietStartup: true,
					terminal: { showTerminalProgress: true },
					compaction: { enabled: false },
					retry: { enabled: false },
				},
				extensionFactories: [
					(pi) => {
						pi.on("session_shutdown", async () => {
							await Promise.resolve();
							cleanupCount++;
							order.push("cleanup");
						});
						pi.registerTool({
							name: "block",
							label: "Block",
							description: "Wait for abort",
							parameters: Type.Object({}),
							execute: (_id, _params, signal) => {
								const result = Promise.withResolvers<{
									content: { type: "text"; text: string }[];
									details: object;
								}>();
								signal?.addEventListener(
									"abort",
									() => {
										order.push("abort");
										result.resolve({ content: [{ type: "text", text: "interrupted tool" }], details: {} });
									},
									{ once: true },
								);
								started.resolve();
								return result.promise;
							},
						});
					},
				],
			});
			const services: AgentSessionServices = {
				cwd: harness.sessionManager.getCwd(),
				agentDir: harness.tempDir,
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: harness.session.resourceLoader,
				diagnostics: [],
			};
			const runtime = new AgentSessionRuntime(harness.session, services, async () => {
				throw new Error("Unexpected session replacement");
			});
			const terminal = new VirtualTerminal(120, 40);
			const progressTerminal = new ProcessTerminal();
			vi.spyOn(terminal, "setProgress").mockImplementation((active) => {
				if (!active && failProgress) progressTerminal.setProgress(false);
			});
			const mode = new InteractiveMode(runtime, { terminal });
			const internal = mode as unknown as { shutdown(options?: { fromSignal?: boolean }): Promise<void> };
			const disposed = vi.spyOn(harness.session, "dispose");
			const exit = vi.spyOn(process, "exit").mockImplementation((() => {
				throw new ProcessExitError();
			}) as typeof process.exit);
			let running: Promise<void> | undefined;
			let restoreStdoutWrite: (() => void) | undefined;
			try {
				await mode.init();
				harness.setResponses([fauxAssistantMessage(fauxToolCall("block", {}), { stopReason: "toolUse" })]);
				running = harness.session.prompt("start blocking tool");
				await started.promise;
				await terminal.waitForRender();
				expect(terminal.getViewport().join("\n")).toContain("start blocking tool");
				const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
					if (String(chunk) === "\x1b]9;4;0\x07") {
						progressCleanupCounts.push(cleanupCount);
						failProgress = false;
						try {
							process.stdout.emit("error", Object.assign(new Error("dead tty"), { code }));
						} catch (error) {
							if (!(error instanceof ProcessExitError)) throw error;
						}
					}
					return true;
				}) as typeof process.stdout.write);
				restoreStdoutWrite = () => stdoutWrite.mockRestore();
				failProgress = true;
				try {
					await internal.shutdown({ fromSignal: true });
				} catch (error) {
					if (!(error instanceof ProcessExitError)) throw error;
				}
				await running;
				expect(progressCleanupCounts).toEqual([1]);
				expect(order).toEqual(["cleanup", "abort"]);
				expect(harness.eventsOfType("agent_end")).toHaveLength(1);
				expect(disposed).toHaveBeenCalledTimes(1);
				expect(exit).toHaveBeenCalledWith(129);
				expect(harness.sessionManager.getEntries()).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							type: "message",
							message: expect.objectContaining({
								role: "toolResult",
								content: [{ type: "text", text: "interrupted tool" }],
							}),
						}),
					]),
				);
			} finally {
				failProgress = false;
				restoreStdoutWrite?.();
				mode.stop();
				await harness.session.abort();
				await running;
				harness.cleanup();
				setPadLinesToWidth(previous.pad);
				setWrapLinesToWidth(previous.wrap);
				setMessageBackground(previous.background);
				setMessageSeparator(previous.separator);
			}
		},
	);

	test("interactive quit stops the TUI before emitting session_shutdown", async () => {
		vi.spyOn(process, "exit").mockImplementation((() => {
			throw new ProcessExitError();
		}) as typeof process.exit);
		const order: string[] = [];
		const context = createContext(order);

		await callShutdown(context);

		expect(order).toEqual(["drainInput", "suspend", "dispose", "stop"]);
	});

	test.each([false, true])(
		"holds shutdown work until resource reactivation settles (reactivation fails: %s)",
		async (failReactivation) => {
			const previous = {
				pad: isPadLinesToWidth(),
				wrap: isWrapLinesToWidth(),
				background: isMessageBackground(),
				separator: isMessageSeparator(),
			};
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const resourceFile = createTempFile();
			writeFileSync(resourceFile, "resource remains callable");
			const closed: number[] = [];
			let resource: number | undefined;
			let starts = 0;
			const harness = await createHarness({
				settings: { quietStartup: true, compaction: { enabled: false }, retry: { enabled: false } },
				extensionFactories: [
					(pi) => {
						pi.on("session_start", async () => {
							resource = openSync(resourceFile, "r");
							if (++starts > 1) {
								entered.resolve();
								await release.promise;
							}
						});
						pi.on("session_shutdown", () => {
							if (resource !== undefined) {
								closed.push(resource);
								closeSync(resource);
								resource = undefined;
							}
						});
						pi.registerTool({
							name: "read_resource",
							label: "Read resource",
							description: "Read the extension-owned open file",
							parameters: Type.Object({}),
							execute: async () => {
								if (resource === undefined) throw new Error("Resource closed");
								return { content: [{ type: "text", text: readFileSync(resource, "utf8") }], details: {} };
							},
						});
					},
				],
			});
			const runtime = new AgentSessionRuntime(
				harness.session,
				{
					cwd: harness.sessionManager.getCwd(),
					agentDir: harness.tempDir,
					modelRuntime: harness.session.modelRuntime,
					settingsManager: harness.settingsManager,
					resourceLoader: harness.session.resourceLoader,
					diagnostics: [],
				},
				async () => {
					throw new Error("Unexpected replacement");
				},
			);
			const terminal = new VirtualTerminal(120, 40);
			const mode = new InteractiveMode(runtime, { terminal });
			const internal = mode as unknown as {
				shutdown(options?: { fromSignal?: boolean }): Promise<void>;
				isShuttingDown: boolean;
				compactionQueuedMessages: Array<{ text: string; mode: "followUp" }>;
			};
			const storageError = new Error("retained receipt unavailable");
			const reactivationError = new Error("resource discovery failed");
			const disposal = vi.spyOn(runtime, "dispose");
			const bind = harness.session.bindExtensions.bind(harness.session);
			const bindSpy = vi.spyOn(harness.session, "bindExtensions").mockImplementation(async (bindings) => {
				await bind(bindings);
				if (starts > 1 && failReactivation) throw reactivationError;
			});
			const flush = vi.spyOn(harness.session, "flushPendingPersistence");
			try {
				await mode.init();
				flush.mockImplementationOnce(() => {
					throw storageError;
				});
				harness.setResponses([
					fauxAssistantMessage(fauxToolCall("read_resource", {}), { stopReason: "toolUse" }),
					fauxAssistantMessage("resource consumer finished"),
				]);
				internal.compactionQueuedMessages.push({ text: "consume recovered resource", mode: "followUp" });
				const shutdown = internal.shutdown({ fromSignal: true });
				await entered.promise;
				expect(internal.isShuttingDown).toBe(true);
				expect(harness.eventsOfType("agent_start")).toEqual([]);
				expect(closed).toHaveLength(1);
				release.resolve();
				await shutdown;
				await terminal.waitForRender();
				const screen = terminal.getViewport().join("\n");
				expect(screen).toContain("retained receipt unavailable");
				if (failReactivation) {
					expect(screen).toContain("extension reactivation failed: resource discovery failed");
					expect(internal.isShuttingDown).toBe(true);
					expect(runtime.shutdownPending).toBe(true);
					expect(closed).toHaveLength(2);
					expect(() => fstatSync(closed[1])).toThrow();
					expect(harness.eventsOfType("agent_start")).toEqual([]);
					const failure = await disposal.mock.results[0].value.catch((error: unknown) => error);
					expect(failure).toMatchObject({ cause: storageError, errors: [storageError, reactivationError] });
				} else {
					expect(internal.isShuttingDown).toBe(false);
					await vi.waitFor(() => expect(harness.eventsOfType("agent_settled")).toHaveLength(1));
					expect(harness.session.messages).toContainEqual(
						expect.objectContaining({
							role: "toolResult",
							content: [{ type: "text", text: "resource remains callable" }],
							isError: false,
						}),
					);
				}
			} finally {
				release.resolve();
				bindSpy.mockRestore();
				flush.mockRestore();
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

	test.each([
		{ fromSignal: false, retryKey: "/quit", tuiMode: "fullscreen" as const },
		{ fromSignal: true, retryKey: "Ctrl+D", tuiMode: "regular" as const },
	])(
		"restricts work and retries $retryKey after failed reactivation (signal: $fromSignal)",
		async ({ fromSignal, retryKey, tuiMode }) => {
			const previous = {
				pad: isPadLinesToWidth(),
				wrap: isWrapLinesToWidth(),
				background: isMessageBackground(),
				separator: isMessageSeparator(),
			};
			const actions: string[] = [];
			let starts = 0;
			let closed = false;
			let failFlush = false;
			const retryEntered = Promise.withResolvers<void>();
			const releaseRetry = Promise.withResolvers<void>();
			const harness = await createHarness({
				settings: { quietStartup: true, compaction: { enabled: false }, retry: { enabled: false } },
				extensionFactories: [
					(pi) => {
						pi.on("session_start", () => {
							starts++;
							closed = false;
						});
						pi.on("session_shutdown", () => {
							closed = true;
							failFlush = true;
						});
						pi.on("user_bash", () => {
							actions.push("bash");
						});
						pi.registerCommand("use-resource", {
							handler: async () => {
								actions.push(`command:${closed}`);
							},
						});
						pi.registerShortcut("ctrl+x", {
							handler: async () => {
								actions.push(`shortcut:${closed}`);
							},
						});
						pi.registerTool({
							name: "resource",
							label: "Resource",
							description: "Use resource",
							parameters: Type.Object({}),
							execute: async () => {
								actions.push(`tool:${closed}`);
								return { content: [], details: {} };
							},
						});
					},
				],
			});
			const runtime = new AgentSessionRuntime(
				harness.session,
				{
					cwd: harness.sessionManager.getCwd(),
					agentDir: harness.tempDir,
					modelRuntime: harness.session.modelRuntime,
					settingsManager: harness.settingsManager,
					resourceLoader: harness.session.resourceLoader,
					diagnostics: [],
				},
				async () => {
					throw new Error("Unexpected replacement");
				},
			);
			const terminal = new VirtualTerminal(120, 40);
			const mode = new InteractiveMode(runtime, { terminal, tuiMode });
			const internal = mode as unknown as {
				shutdown(options?: { fromSignal?: boolean }): Promise<void>;
				defaultEditor: { onSubmit(text: string): Promise<void> };
				onInputCallback?: (text: string) => void;
				pendingUserInputs: string[];
				switchTuiMode(mode: "regular" | "fullscreen"): boolean;
			};
			const bind = harness.session.bindExtensions.bind(harness.session);
			const bindSpy = vi.spyOn(harness.session, "bindExtensions").mockImplementation(async (bindings) => {
				await bind(bindings);
				if (starts > 1) throw new Error("resource reactivation failed");
			});
			const flushOriginal = harness.session.flushPendingPersistence.bind(harness.session);
			const flush = vi.spyOn(harness.session, "flushPendingPersistence").mockImplementation(() => {
				if (failFlush) {
					failFlush = false;
					throw new Error("receipt unavailable");
				}
				flushOriginal();
			});
			const dispose = runtime.dispose.bind(runtime);
			const disposal = vi.spyOn(runtime, "dispose");
			const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as typeof process.exit);
			const prompt = vi.spyOn(harness.session, "prompt");
			const continuation = vi.spyOn(harness.session, "continue");
			const bash = vi.spyOn(harness.session, "executeBash");
			const input = mode.getUserInput.bind(mode);
			const loopStopped = new Error("prompt loop stopped");
			const getInput = vi.spyOn(mode, "getUserInput").mockImplementationOnce(input).mockRejectedValue(loopStopped);
			let loop: Promise<unknown> | undefined;
			vi.stubEnv("PI_OFFLINE", "1");
			try {
				await mode.init();
				expect(internal.switchTuiMode(tuiMode === "fullscreen" ? "regular" : "fullscreen")).toBe(true);
				loop = mode.run().catch((error: unknown) => error);
				await vi.waitFor(() => expect(internal.onInputCallback).toBeDefined());
				await internal.shutdown({ fromSignal });
				expect(runtime.shutdownPending).toBe(true);
				expect(closed).toBe(true);
				await terminal.waitForRender();
				expect(terminal.getViewport().join("\n")).toContain("resource reactivation failed");
				const submitKeyboard = async (text: string) => {
					terminal.sendInput(`\x1b[200~${text}\x1b[201~`);
					terminal.sendInput("\r");
					await terminal.waitForRender();
				};
				for (const text of ["ordinary prompt", "/continue", "!echo forbidden", "/use-resource"]) {
					await submitKeyboard(text);
				}
				terminal.sendInput("\x18");
				await terminal.waitForRender();
				expect(prompt).not.toHaveBeenCalled();
				expect(continuation).not.toHaveBeenCalled();
				expect(bash).not.toHaveBeenCalled();
				expect(actions).toEqual([]);
				expect(internal.pendingUserInputs).toEqual([]);
				// Work captured before shutdown must also be rejected at the prompt-loop boundary.
				internal.onInputCallback?.("captured prompt");
				expect(await loop).toBe(loopStopped);
				expect(prompt).not.toHaveBeenCalled();
				// An already captured editor callback must not bypass the terminal recovery gate.
				await internal.defaultEditor.onSubmit("/use-resource");
				expect(prompt).not.toHaveBeenCalled();
				expect(actions).toEqual([]);
				bindSpy.mockRestore();
				flush.mockRestore();
				disposal.mockImplementation(async (options) => {
					retryEntered.resolve();
					await releaseRetry.promise;
					await dispose(options);
				});
				if (retryKey === "/quit") await submitKeyboard("/quit");
				else terminal.sendInput("\x04");
				await vi.waitFor(() => expect(disposal).toHaveBeenCalledTimes(2));
				await retryEntered.promise;
				terminal.sendInput("\x04");
				await terminal.waitForRender();
				expect(disposal).toHaveBeenCalledTimes(2);
				expect(exit).not.toHaveBeenCalled();
				releaseRetry.resolve();
				await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
				expect(actions).toEqual([]);
				expect(starts).toBe(2);
			} finally {
				releaseRetry.resolve();
				bindSpy.mockRestore();
				flush.mockRestore();
				disposal.mockRestore();
				mode.stop();
				internal.onInputCallback?.("stop prompt loop");
				await loop;
				getInput.mockRestore();
				vi.unstubAllEnvs();
				await runtime.dispose();
				harness.cleanup();
				setPadLinesToWidth(previous.pad);
				setWrapLinesToWidth(previous.wrap);
				setMessageBackground(previous.background);
				setMessageSeparator(previous.separator);
			}
		},
	);

	test.each(["regular", "fullscreen"] as const)(
		"repaints %s after disposal rejects with shutdown UI updates pending, without keyboard input",
		async (tuiMode) => {
			const previous = {
				pad: isPadLinesToWidth(),
				wrap: isWrapLinesToWidth(),
				background: isMessageBackground(),
				separator: isMessageSeparator(),
			};
			const entered = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			let failFlush = false;
			let commandCalls = 0;
			const harness = await createHarness({
				settings: { quietStartup: true, compaction: { enabled: false }, retry: { enabled: false } },
				extensionFactories: [
					(pi) => {
						pi.on("session_shutdown", async (_event, ctx) => {
							ctx.ui.notify("shutdown cleanup notice");
							entered.resolve();
							await release.promise;
						});
						pi.registerCommand("still-registered", {
							handler: async () => {
								commandCalls++;
							},
						});
					},
				],
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
			const terminal = new VirtualTerminal(120, 40);
			const mode = new InteractiveMode(runtime, { terminal, tuiMode });
			const internal = mode as unknown as {
				shutdown(): Promise<void>;
				isShuttingDown: boolean;
				defaultEditor: { setText(text: string): void };
			};
			const flushPendingPersistence = harness.session.flushPendingPersistence.bind(harness.session);
			const flush = vi.spyOn(harness.session, "flushPendingPersistence").mockImplementation(() => {
				if (failFlush) {
					failFlush = false;
					throw new Error("shutdown receipt unavailable");
				}
				flushPendingPersistence();
			});
			try {
				await mode.init();
				mode.showWarning("original session remains usable");
				internal.defaultEditor.setText("unsent recovery draft");
				await terminal.waitForRender();
				expect(terminal.getViewport().join("\n")).toContain("original session remains usable");

				const shutdown = internal.shutdown();
				await entered.promise;
				await terminal.waitForRender();
				expect(internal.isShuttingDown).toBe(true);
				expect(terminal.getViewport().join("\n")).not.toContain("shutdown cleanup notice");
				failFlush = true;
				release.resolve();
				await shutdown;
				await terminal.waitForRender();

				const resumed = terminal.getViewport().join("\n");
				expect(resumed).toContain("shutdown cleanup notice");
				expect(resumed).toContain("Failed to shut down: shutdown receipt unavailable");
				expect(resumed).toContain("original session remains usable");
				expect(resumed).toContain("unsent recovery draft");
				expect(internal.isShuttingDown).toBe(false);
				await harness.session.prompt("/still-registered");
				expect(commandCalls).toBe(1);
			} finally {
				release.resolve();
				flush.mockRestore();
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

	test("interactive quit appends the resume hint without erasing terminal history", async () => {
		vi.spyOn(process, "exit").mockImplementation((() => {
			throw new ProcessExitError();
		}) as typeof process.exit);
		const stdoutWrite = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((() => true) as typeof process.stdout.write);
		setStdoutIsTTY(true);
		const order: string[] = [];
		const context = createContext(order, createSessionManager({ sessionFile: createTempFile() }));

		await callShutdown(context);

		expect(order).toEqual(["drainInput", "suspend", "dispose", "stop"]);
		const resumeCall = stdoutWrite.mock.calls.find((call) => String(call[0]).includes("To resume this session:"));
		expect(resumeCall?.[0]).toBe(`${chalk.dim("To resume this session:")} ${APP_NAME} --session test-session\n`);
	});

	test("signal-triggered shutdown does not print a resume hint", async () => {
		vi.spyOn(process, "exit").mockImplementation((() => {
			throw new ProcessExitError();
		}) as typeof process.exit);
		const stdoutWrite = vi
			.spyOn(process.stdout, "write")
			.mockImplementation((() => true) as typeof process.stdout.write);
		setStdoutIsTTY(true);
		const order: string[] = [];
		const context = createContext(order, createSessionManager({ sessionFile: createTempFile() }));

		await callShutdown(context, { fromSignal: true });

		for (const call of stdoutWrite.mock.calls) {
			expect(call[0]).not.toContain("To resume this session:");
		}
	});

	test("re-entrant shutdown is a no-op", async () => {
		vi.spyOn(process, "exit").mockImplementation((() => {
			throw new ProcessExitError();
		}) as typeof process.exit);
		const order: string[] = [];
		const context = createContext(order);
		context.isShuttingDown = true;

		await callShutdown(context, { fromSignal: true });

		expect(order).toEqual([]);
		expect(context.runtimeHost.dispose).not.toHaveBeenCalled();
	});
});
