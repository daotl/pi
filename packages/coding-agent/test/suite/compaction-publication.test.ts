import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime, SessionReplacementPendingUsageError } from "../../src/core/agent-session-runtime.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageCostBreakdown, getUsageTotals } from "../../src/core/usage-totals.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { createHarness, getMessageText } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, appendFileSync: vi.fn(actual.appendFileSync) };
});

afterEach(async () => {
	const actual = await vi.importActual<typeof fs>("fs");
	vi.mocked(fs.appendFileSync).mockReset().mockImplementation(actual.appendFileSync);
});

it.each(
	(["manual", "automatic"] as const).flatMap((mode) =>
		(["summary-tokenize", "final-context", "normal", "before-summary"] as const).map((gate) => ({ mode, gate })),
	),
)(
	"preserves native summary billing and checkpoint state for $mode at $gate (normal is the no-abort control)",
	async ({ mode, gate }) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-summary-publication-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			settings: {
				retry: { enabled: false },
				compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 1 },
			},
		});
		const started = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		let running: Promise<unknown> | undefined;
		let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
		try {
			for (let index = 0; index < 4; index++) {
				manager.appendMessage({ role: "user", content: `question ${index}`, timestamp: index * 2 });
				manager.appendMessage(fauxAssistantMessage(`answer ${index}`));
			}
			harness.session.modelRuntime.registerProvider("summary-publication", {
				api: "openai-completions",
				baseUrl: "https://summary-publication.invalid/v1",
				apiKey: "offline-summary-key",
				models: [
					{
						id: "physical-summary",
						name: "Physical summary",
						reasoning: false,
						input: ["text"],
						cost: { input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 },
						contextWindow: 100000,
						maxTokens: 4096,
					},
				],
			});
			const model = harness.session.modelRuntime.getModel("summary-publication", "physical-summary");
			if (!model) throw new Error("Missing native summary model");
			({ session } = await createAgentSession({
				cwd,
				agentDir: harness.tempDir,
				model,
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				sessionManager: manager,
				resourceLoader: harness.session.resourceLoader,
				tools: [],
			}));
			const original = structuredClone(manager.buildSessionContext().messages);
			const before = getUsageTotals(manager.getEntries());
			const requests: Array<{ model: string; authorization: string | null }> = [];
			vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
				const url = String(input);
				const body = JSON.parse(String(init?.body));
				if (!url.endsWith("/tokenize") && !url.endsWith("/chat/completions/input_tokens")) {
					requests.push({ model: body.model, authorization: new Headers(init?.headers).get("authorization") });
					if (gate === "before-summary") {
						started.resolve();
						await released.promise;
						if (init?.signal?.aborted) throw new DOMException("Cancelled summary", "AbortError");
					}
					const chunk = {
						id: "summary-charge",
						object: "chat.completion.chunk",
						created: 0,
						model: model.id,
						choices: [
							{ index: 0, delta: { role: "assistant", content: "billed summary" }, finish_reason: "stop" },
						],
						usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
					};
					return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
						headers: { "content-type": "text/event-stream" },
					});
				}
				const blocked =
					gate === "summary-tokenize"
						? url.endsWith("/tokenize") && body.content === "billed summary"
						: gate === "final-context" && url.endsWith("/chat/completions/input_tokens");
				if (blocked) {
					if (gate === "final-context")
						expect(manager.getBranch().at(-1)).toMatchObject({ type: "compaction", summary: "billed summary" });
					if (gate === "summary-tokenize")
						expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toEqual([]);
					started.resolve();
					await released.promise;
					if (init?.signal?.aborted) throw new DOMException("Cancelled tokenizer", "AbortError");
				}
				return url.endsWith("/tokenize")
					? Response.json({ tokens: Array(42).fill(0) })
					: Response.json({ input_tokens: 100 });
			});
			const events: Array<{ aborted: boolean }> = [];
			session.subscribe((event) => {
				if (event.type === "compaction_end") events.push(event);
			});
			const auto = session as unknown as {
				_runAutoCompaction(reason: "threshold", willRetry: boolean): Promise<boolean>;
			};
			running =
				mode === "manual"
					? session.compact({ keepRecentMessages: 1 })
					: auto._runAutoCompaction("threshold", false);
			const outcome = running.then(
				(result) => ({ result }),
				(error: unknown) => ({ error }),
			);
			if (gate !== "normal") {
				await Promise.race([
					started.promise,
					outcome.then(() => {
						throw new Error("Summary gate did not start");
					}),
				]);
				session.abortCompaction();
				released.resolve();
			}
			const settled = await outcome;
			const committed = gate === "normal" || gate === "final-context";
			const completed = gate !== "before-summary";
			if (!committed && mode === "manual") expect(settled).toMatchObject({ error: expect.any(Error) });
			expect(events).toEqual([expect.objectContaining({ aborted: !committed })]);
			expect(requests).toEqual([{ model: "physical-summary", authorization: "Bearer offline-summary-key" }]);
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				expect(current.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(committed ? 1 : 0);
				expect(getUsageTotals(current.getEntries())).toEqual({
					input: before.input + (completed ? 100 : 0),
					output: before.output + (completed ? 10 : 0),
					cacheRead: before.cacheRead,
					cacheWrite: before.cacheWrite,
					cost: expect.closeTo(before.cost + (completed ? 0.11 : 0)),
				});
				if (!committed) expect(current.buildSessionContext().messages).toEqual(original);
				if (gate === "summary-tokenize")
					expect(getUsageCostBreakdown(current.getEntries())).toContainEqual({
						key: "summary-publication/physical-summary",
						tokens: 110,
						cost: 0.11,
					});
			}
			expect(session.isIdle).toBe(true);
		} finally {
			released.resolve();
			await running?.catch(() => {});
			await session?.dispose();
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it.each(
	(["manual", "automatic"] as const).flatMap((mode) =>
		(["immediate", "prompt", "compact", "continue"] as const).map((recovery) => ({ mode, recovery })),
	),
)(
	"recovers one completed $mode summary charge after checkpoint and receipt append failures via $recovery",
	async ({ mode, recovery }) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-summary-append-failure-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: {
				retry: { enabled: false },
				compaction: { enabled: false, reserveTokens: 512, keepRecentTokens: 1 },
			},
		});
		const actual = await vi.importActual<typeof fs>("fs");
		try {
			for (let index = 0; index < 3; index++) {
				manager.appendMessage({ role: "user", content: `question ${index}`, timestamp: index * 2 });
				manager.appendMessage(
					fauxAssistantMessage(index === 2 ? "original partial" : `answer ${index}`, {
						stopReason: index === 2 ? "aborted" : "stop",
					}),
				);
			}
			harness.session.refreshContext();
			const original = structuredClone(harness.session.messages);
			const before = getUsageTotals(manager.getEntries());
			const usage = {
				input: 100,
				output: 10,
				cacheRead: 5,
				cacheWrite: 3,
				totalTokens: 118,
				cost: { input: 0.1, output: 0.01, cacheRead: 0.005, cacheWrite: 0.003, total: 0.118 },
			};
			const expected = {
				input: before.input + 100,
				output: before.output + 10,
				cacheRead: before.cacheRead + 5,
				cacheWrite: before.cacheWrite + 3,
				cost: expect.closeTo(before.cost + 0.118),
			};
			let completedRequests = 0;
			const totalsAtDispatch: ReturnType<typeof getUsageTotals>[] = [];
			harness.session.agent.streamFunction = () => {
				totalsAtDispatch.push(getUsageTotals(manager.getEntries()));
				const response = {
					...fauxAssistantMessage("original partial completed"),
					usage:
						completedRequests++ === 0
							? usage
							: {
									input: 0,
									output: 0,
									cacheRead: 0,
									cacheWrite: 0,
									totalTokens: 0,
									cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
								},
				};
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: "stop", message: response });
				return stream;
			};
			vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 404 }));
			let checkpointFailed = false;
			let receiptFailures = 0;
			let writable = recovery === "immediate";
			vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
				const record = JSON.parse(String(args[1])) as { type: string; kind?: string };
				if (record.type === "compaction" && !checkpointFailed) {
					checkpointFailed = true;
					throw new Error("injected checkpoint append failure");
				}
				if (record.type === "usage" && record.kind === "compaction" && !writable) {
					receiptFailures++;
					throw new Error("injected receipt append failure");
				}
				return actual.appendFileSync(...args);
			});
			const auto = harness.session as unknown as {
				_runAutoCompaction(reason: "threshold", willRetry: boolean): Promise<boolean>;
			};
			if (mode === "manual")
				await expect(harness.session.compact({ keepRecentMessages: 1 })).rejects.toThrow(
					"injected checkpoint append failure",
				);
			else expect(await auto._runAutoCompaction("threshold", false)).toBe(false);
			expect(checkpointFailed).toBe(true);
			expect(completedRequests).toBe(1);
			expect(manager.getEntries().filter((entry) => entry.type === "compaction")).toEqual([]);
			expect(harness.session.messages).toEqual(original);
			const recover = async () => {
				if (recovery === "compact") await harness.session.compact({ keepRecentMessages: 1 });
				else if (recovery === "continue") await harness.session.continue();
				else await harness.session.prompt("recover pending charge");
			};
			if (recovery !== "immediate") {
				expect(receiptFailures).toBe(1);
				await expect(recover()).rejects.toThrow("injected receipt append failure");
				expect(completedRequests).toBe(1);
				writable = true;
				let nested: Promise<unknown> | undefined;
				const stopReentry = harness.session.subscribe((event) => {
					if (event.type === "entry_appended" && event.entry.type === "usage") {
						nested = harness.session.continue().then(
							() => "unexpected accepted continuation",
							(error: unknown) => error,
						);
					}
				});
				await recover();
				expect(totalsAtDispatch[1]).toEqual(expected);
				stopReentry();
				expect(await nested).toBeInstanceOf(Error);
			}
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				const receipts = current
					.getEntries()
					.filter((entry) => entry.type === "usage" && entry.kind === "compaction");
				expect(receipts.filter((entry) => entry.usageSourceId === undefined)).toEqual([
					expect.objectContaining({ provider: harness.getModel().provider, model: harness.getModel().id, usage }),
				]);
				expect(new Set(receipts.map((entry) => entry.usageSourceId ?? entry.id)).size).toBe(1);
				expect(getUsageTotals(current.getEntries())).toEqual(expected);
			}
		} finally {
			vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it.each(["checkpoint", "receipt"] as const)(
	"does not replay a completed charge after its %s notification fails",
	async (notification) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-summary-notification-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			settings: {
				retry: { enabled: false },
				compaction: { enabled: false, reserveTokens: 512, keepRecentTokens: 1 },
			},
		});
		const actual = await vi.importActual<typeof fs>("fs");
		try {
			for (let index = 0; index < 3; index++) {
				manager.appendMessage({ role: "user", content: `question ${index}`, timestamp: index * 2 });
				manager.appendMessage(fauxAssistantMessage(`answer ${index}`));
			}
			harness.session.refreshContext();
			const before = getUsageTotals(manager.getEntries());
			const usage = {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 110,
				cost: { input: 0.1, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.11 },
			};
			let calls = 0;
			harness.session.agent.streamFunction = () => {
				const stream = createAssistantMessageEventStream();
				stream.push({
					type: "done",
					reason: "stop",
					message: {
						...fauxAssistantMessage("summary"),
						usage:
							calls++ === 0
								? usage
								: {
										input: 0,
										output: 0,
										cacheRead: 0,
										cacheWrite: 0,
										totalTokens: 0,
										cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
									},
					},
				});
				return stream;
			};
			vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 404 }));
			if (notification === "receipt")
				vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
					if (JSON.parse(String(args[1])).type === "compaction")
						throw new Error("injected checkpoint append failure");
					return actual.appendFileSync(...args);
				});
			let notified = false;
			const unsubscribe = harness.session.subscribe((event) => {
				if (
					(notification === "checkpoint" && event.type === "compaction_end" && event.result) ||
					(notification === "receipt" && event.type === "entry_appended" && event.entry.type === "usage")
				) {
					notified = true;
					throw new Error("injected postpublication notification failure");
				}
			});
			await expect(harness.session.compact({ keepRecentMessages: 1 })).rejects.toBeInstanceOf(Error);
			unsubscribe();
			expect(notified).toBe(true);
			await harness.session.prompt("next request");
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				expect(getUsageTotals(current.getEntries())).toEqual({
					input: before.input + 100,
					output: before.output + 10,
					cacheRead: before.cacheRead,
					cacheWrite: before.cacheWrite,
					cost: expect.closeTo(before.cost + 0.11),
				});
				expect(current.getEntries().filter((entry) => entry.type === "usage")).toHaveLength(
					notification === "receipt" ? 1 : 0,
				);
				expect(current.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(
					notification === "checkpoint" ? 1 : 0,
				);
			}
		} finally {
			vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it.each([
	"new",
	"resume",
	"fork",
	"import",
	"same-resume",
	"same-import",
	"dispose",
	"interactive",
	"signal",
	"late-interactive",
	"interactive-new",
	"interactive-resume",
	"interactive-resume-missing-cwd",
	"interactive-fork",
	"interactive-import",
	"interactive-import-missing-cwd",
	"extension-new",
	"extension-fork",
] as const)("persists pending summary charge to outgoing session before runtime %s", async (operation) => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-summary-switch-"));
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const shutdownTotals: ReturnType<typeof getUsageTotals>[] = [];
	let lateReceiptCreated = false;
	const terminalInputs: string[] = [];
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: {
			retry: { enabled: false },
			compaction: { enabled: false, reserveTokens: 512, keepRecentTokens: 1 },
		},
		extensionFactories: [
			(pi) => {
				pi.on("session_start", (_event, context) => {
					context.ui.onTerminalInput((data) => {
						terminalInputs.push(data);
						return undefined;
					});
				});
				pi.on("session_shutdown", async () => {
					shutdownTotals.push(getUsageTotals(manager.getEntries()));
					if (operation === "late-interactive" && !lateReceiptCreated) {
						lateReceiptCreated = true;
						vi.mocked(fs.appendFileSync).mockImplementation(() => {
							throw new Error("outgoing storage unavailable");
						});
						await expect(harness.session.compact({ keepRecentMessages: 1 })).rejects.toThrow(
							"outgoing storage unavailable",
						);
					}
				});
			},
		],
	});
	const actual = await vi.importActual<typeof fs>("fs");
	let runtime: AgentSessionRuntime | undefined;
	let interactive: InteractiveMode | undefined;
	const dispose = vi.spyOn(harness.session, "dispose");
	const terminal = new VirtualTerminal(120, 40);
	const exit = vi.spyOn(process, "exit").mockImplementation(() => {
		throw new Error("test process exit");
	});
	const replacingInteractively =
		operation.startsWith("interactive-") || operation === "extension-new" || operation === "extension-fork";
	const storageError = new Error("outgoing storage unavailable");
	try {
		for (let index = 0; index < 3; index++) {
			manager.appendMessage({ role: "user", content: `question ${index}`, timestamp: index * 2 });
			manager.appendMessage(fauxAssistantMessage(`answer ${index}`));
		}
		harness.session.refreshContext();
		const target = manager.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user")!;
		const usage = {
			input: 100,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 110,
			cost: { input: 0.1, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.11 },
		};
		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: { ...fauxAssistantMessage("summary"), usage } });
			return stream;
		};
		vi.stubGlobal("fetch", async () => new Response("unavailable", { status: 404 }));
		vi.mocked(fs.appendFileSync).mockImplementation(() => {
			throw storageError;
		});
		await expect(harness.session.compact({ keepRecentMessages: 1 })).rejects.toThrow("outgoing storage unavailable");
		const services = {
			cwd,
			agentDir: harness.tempDir,
			modelRuntime: harness.session.modelRuntime,
			settingsManager: harness.settingsManager,
			resourceLoader: harness.session.resourceLoader,
			diagnostics: [],
		};
		let replacements = 0;
		runtime = new AgentSessionRuntime(harness.session, services, async ({ sessionManager }) => {
			replacements++;
			return {
				...(await createAgentSession({
					cwd,
					agentDir: harness.tempDir,
					model: harness.getModel(),
					modelRuntime: services.modelRuntime,
					settingsManager: services.settingsManager,
					resourceLoader: services.resourceLoader,
					sessionManager,
					tools: [],
				})),
				services,
				diagnostics: [],
			};
		});
		if (
			operation === "interactive" ||
			operation === "signal" ||
			operation === "late-interactive" ||
			replacingInteractively
		) {
			interactive = new InteractiveMode(runtime, { terminal });
			await interactive.init();
			terminal.sendInput("retryable draft");
		}
		const shutdownMode = interactive as unknown as {
			shutdown(options?: { fromSignal?: boolean }): Promise<void>;
			isShuttingDown: boolean;
			isInitialized: boolean;
			handleScheduleCommand(text: string): Promise<void>;
			handleHeartbeatCommand(text: string): Promise<void>;
			scheduledMessages: Array<{ id: number; text: string; when: unknown }>;
			heartbeats: Array<{ id: number; text: string; nextFireAt: number | null }>;
			defaultEditor: { onSubmit(text: string): Promise<void> };
			handleResumeSession(path: string): Promise<{ cancelled: boolean }>;
			forkToMessage(entryId: string, role: "user" | "assistant"): Promise<void>;
			handleImportCommand(text: string): Promise<void>;
		};
		const signalListeners = process.listeners("SIGTERM");
		if (operation === "late-interactive" || operation === "signal" || replacingInteractively) {
			await shutdownMode.handleScheduleCommand("1h\nretained scheduled work");
			// /new clears the editor, legitimately resetting idle-based interval deadlines.
			await shutdownMode.handleHeartbeatCommand(
				`${operation === "interactive-new" ? "23:59:59" : "1h"}\nretained heartbeat`,
			);
		}
		const schedulesBefore = interactive
			? shutdownMode.scheduledMessages.map(({ id, text, when }) => ({ id, text, when }))
			: [];
		const heartbeatsBefore = interactive
			? shutdownMode.heartbeats.map(({ id, text, nextFireAt }) => ({ id, text, nextFireAt }))
			: [];
		if (operation === "late-interactive") vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
		const outgoing = manager.getSessionFile()!;
		const missingCwd = join(cwd, "missing-cwd");
		if (operation.endsWith("missing-cwd")) actual.mkdirSync(missingCwd);
		const other = SessionManager.create(
			operation.endsWith("missing-cwd") ? missingCwd : cwd,
			join(cwd, "other-sessions"),
		);
		other.appendMessage({ role: "user", content: "other", timestamp: 1 });
		if (operation.endsWith("missing-cwd")) {
			actual.rmdirSync(missingCwd);
			vi.spyOn(
				interactive as unknown as { promptForMissingSessionCwd(): Promise<string> },
				"promptForMissingSessionCwd",
			).mockResolvedValue(cwd);
		}
		if (operation.startsWith("interactive-import")) {
			vi.spyOn(
				interactive as unknown as { showExtensionConfirm(): Promise<boolean> },
				"showExtensionConfirm",
			).mockResolvedValue(true);
		}
		const replace = async () => {
			if (operation === "new") await runtime!.newSession();
			else if (operation === "resume") await runtime!.switchSession(other.getSessionFile()!);
			else if (operation === "same-resume") await runtime!.switchSession(outgoing);
			else if (operation === "fork") await runtime!.fork(target.id);
			else if (operation === "import") await runtime!.importFromJsonl(other.getSessionFile()!);
			else if (operation === "same-import") await runtime!.importFromJsonl(outgoing);
			else if (operation === "interactive-new") {
				await shutdownMode.defaultEditor.onSubmit("/new");
			} else if (operation.startsWith("interactive-resume"))
				await shutdownMode.handleResumeSession(other.getSessionFile()!);
			else if (operation === "interactive-fork") await shutdownMode.forkToMessage(target.id, "user");
			else if (operation.startsWith("interactive-import"))
				await shutdownMode.handleImportCommand(`/import ${other.getSessionFile()!}`);
			else if (operation === "extension-new")
				await harness.session.extensionRunner.createCommandContext().newSession();
			else if (operation === "extension-fork")
				await harness.session.extensionRunner.createCommandContext().fork(target.id);
			else if (interactive) await shutdownMode.shutdown({ fromSignal: operation === "signal" });
			else await runtime!.dispose();
		};
		if (interactive) await replace();
		else if (operation === "dispose") await expect(replace()).rejects.toBe(storageError);
		else
			await expect(replace()).rejects.toMatchObject({
				constructor: SessionReplacementPendingUsageError,
				cause: storageError,
			});
		expect(runtime.session).toBe(harness.session);
		expect(replacements).toBe(0);
		if (operation === "signal") {
			expect(shutdownTotals).toEqual([{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }]);
			expect(dispose).not.toHaveBeenCalled();
			expect(getUsageTotals(SessionManager.open(outgoing).getEntries())).toEqual({
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0,
			});
		}
		if (interactive) {
			expect(shutdownMode.isInitialized).toBe(true);
			expect(shutdownMode.isShuttingDown).toBe(false);
			if (operation !== "late-interactive") expect(process.listeners("SIGTERM")).toEqual(signalListeners);
			else expect(process.listeners("SIGTERM")).toHaveLength(signalListeners.length);
			if (operation === "late-interactive" || operation === "signal" || replacingInteractively) {
				expect(shutdownMode.scheduledMessages.map(({ id, text, when }) => ({ id, text, when }))).toEqual(
					schedulesBefore,
				);
				expect(shutdownMode.heartbeats.map(({ id, text, nextFireAt }) => ({ id, text, nextFireAt }))).toEqual(
					heartbeatsBefore,
				);
			}
			await vi.waitFor(async () =>
				expect((await terminal.flushAndGetViewport()).join("\n")).toContain(
					replacingInteractively
						? "outgoing storage unavailable"
						: "Failed to shut down: outgoing storage unavailable",
				),
			);
			const inputCount = terminalInputs.length;
			if (operation === "interactive-new") terminal.sendInput("retryable draft");
			terminal.sendInput(" remains usable");
			await vi.waitFor(async () =>
				expect((await terminal.flushAndGetViewport()).join("\n")).toContain("retryable draft remains usable"),
			);
			if (operation === "late-interactive" || replacingInteractively)
				expect(terminalInputs.slice(inputCount)).toContain(" remains usable");
			if (replacingInteractively) {
				expect(exit).not.toHaveBeenCalled();
				expect(dispose).not.toHaveBeenCalled();
				expect(shutdownTotals).toEqual([]);
				expect(harness.session.extensionRunner.createContext().cwd).toBe(cwd);
			}
		}
		vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
		if (interactive && !replacingInteractively) await expect(replace()).rejects.toThrow("test process exit");
		else await replace();
		if (operation === "signal") expect(dispose).toHaveBeenCalledTimes(1);
		if (replacingInteractively) {
			expect(exit).not.toHaveBeenCalled();
			expect(replacements).toBe(1);
			expect(runtime.session).not.toBe(harness.session);
		}
		expect(getUsageTotals(SessionManager.open(outgoing).getEntries())).toEqual({
			input: operation === "late-interactive" ? 200 : 100,
			output: operation === "late-interactive" ? 20 : 10,
			cacheRead: 0,
			cacheWrite: 0,
			cost: operation === "late-interactive" ? 0.22 : 0.11,
		});
		expect(
			SessionManager.open(outgoing)
				.getEntries()
				.filter((entry) => entry.type === "usage"),
		).toEqual([
			expect.objectContaining({ kind: "compaction", usage }),
			...(operation === "late-interactive" ? [expect.objectContaining({ kind: "compaction", usage })] : []),
		]);
		if (operation === "same-resume" || operation === "same-import")
			expect(getUsageTotals(runtime.session.sessionManager.getEntries())).toEqual({
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0.11,
			});
		expect(shutdownTotals).toEqual(
			operation === "late-interactive"
				? [
						{ input: 100, output: 10, cacheRead: 0, cacheWrite: 0, cost: 0.11 },
						{ input: 200, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.22 },
					]
				: operation === "signal"
					? [
							{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
							{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
						]
					: [{ input: 100, output: 10, cacheRead: 0, cacheWrite: 0, cost: 0.11 }],
		);
	} finally {
		vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
		interactive?.stop();
		exit.mockRestore();
		await runtime?.dispose();
		await harness.session.abort();
		harness.cleanup();
		rmSync(cwd, { recursive: true, force: true });
	}
});

it.each(
	(["new", "dispose", "interactive", "signal"] as const).flatMap((operation) =>
		(["bash", "custom"] as const).flatMap((record) => [false, true].map((outage) => ({ operation, record, outage }))),
	),
)(
	"drains retained $record before $operation without another prompt (outage=$outage)",
	async ({ operation, record, outage }) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-outgoing-records-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const terminalInputs: string[] = [];
		let shutdowns = 0;
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("session_start", (_event, context) => {
						context.ui.onTerminalInput((data) => {
							terminalInputs.push(data);
							return undefined;
						});
					});
					pi.on("session_shutdown", () => {
						shutdowns++;
					});
				},
			],
		});
		const actual = await vi.importActual<typeof fs>("fs");
		const failure = new Error("retained output storage unavailable");
		let unavailable = true;
		let queued = false;
		const expected = ["retained first", "retained second", "retained third"];
		let customNotifications = 0;
		const off = harness.session.subscribe((event) => {
			if (event.type === "message_start" && event.message.role === "custom") customNotifications++;
			if (event.type !== "agent_end" || queued) return;
			queued = true;
			for (const content of expected) {
				if (record === "bash")
					harness.session.recordBashResult(content, {
						output: content,
						exitCode: 0,
						cancelled: false,
						truncated: false,
					});
				else
					void harness.session.sendCustomMessage(
						{ customType: "outgoing-retained", content, display: true },
						{ triggerTurn: false },
					);
			}
		});
		const records = () =>
			SessionManager.open(manager.getSessionFile()!)
				.getBranch()
				.flatMap((entry) =>
					record === "bash"
						? entry.type === "message" && entry.message.role === "bashExecution"
							? [entry.message.command]
							: []
						: entry.type === "custom_message" && entry.customType === "outgoing-retained"
							? [getMessageText(entry)]
							: [],
				);
		let runtime: AgentSessionRuntime | undefined;
		let interactive: InteractiveMode | undefined;
		const terminal = new VirtualTerminal(120, 40);
		const exit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("test process exit");
		});
		try {
			vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
				if (unavailable && typeof args[1] === "string" && args[1].includes("retained second")) throw failure;
				return actual.appendFileSync(...args);
			});
			harness.setResponses([fauxAssistantMessage("completed answer")]);
			await expect(harness.session.prompt("accepted request")).rejects.toBe(failure);
			expect(harness.session.isIdle).toBe(true);
			expect(records()).toEqual(["retained first"]);
			const calls = harness.faux.state.callCount;
			const notificationsBefore = customNotifications;
			const services = {
				cwd,
				agentDir: harness.tempDir,
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: harness.session.resourceLoader,
				diagnostics: [],
			};
			let replacements = 0;
			runtime = new AgentSessionRuntime(harness.session, services, async ({ sessionManager }) => {
				expect(records()).toEqual(expected);
				replacements++;
				return {
					...(await createAgentSession({
						cwd,
						agentDir: harness.tempDir,
						model: harness.getModel(),
						modelRuntime: services.modelRuntime,
						settingsManager: services.settingsManager,
						resourceLoader: services.resourceLoader,
						sessionManager,
						tools: [],
					})),
					services,
					diagnostics: [],
				};
			});
			runtime.setBeforeSessionInvalidate(() => {
				expect(records()).toEqual(expected);
			});
			const disposed = vi.spyOn(harness.session, "dispose");
			if (operation === "interactive" || operation === "signal") {
				interactive = new InteractiveMode(runtime, { terminal });
				await interactive.init();
				terminal.sendInput("retryable draft");
			}
			const mode = interactive as unknown as {
				shutdown(options?: { fromSignal?: boolean }): Promise<void>;
				isInitialized: boolean;
				isShuttingDown: boolean;
				defaultEditor: { onSubmit(text: string): Promise<void> };
				handleScheduleCommand(text: string): Promise<void>;
				scheduledMessages: Array<{ id: number; text: string; when: unknown }>;
				handleHeartbeatCommand(text: string): Promise<void>;
				heartbeats: Array<{ id: number; text: string; nextFireAt: number | null }>;
			};
			if (interactive) {
				await mode.handleScheduleCommand("1h\nretained scheduled work");
				await mode.handleHeartbeatCommand("1h\nretained heartbeat");
			}
			const scheduled = interactive ? mode.scheduledMessages.map(({ id, text, when }) => ({ id, text, when })) : [];
			const heartbeats = interactive
				? mode.heartbeats.map(({ id, text, nextFireAt }) => ({ id, text, nextFireAt }))
				: [];
			const listeners = process.listeners("SIGTERM");
			const leave = () =>
				operation === "new"
					? runtime!.newSession()
					: operation === "interactive"
						? mode.defaultEditor.onSubmit("/quit")
						: interactive
							? mode.shutdown({ fromSignal: true })
							: runtime!.dispose();
			if (outage) {
				if (interactive) await leave();
				else if (operation === "new")
					await expect(leave()).rejects.toMatchObject({
						constructor: SessionReplacementPendingUsageError,
						cause: failure,
					});
				else await expect(leave()).rejects.toBe(failure);
				expect(runtime.session).toBe(harness.session);
				expect(replacements).toBe(0);
				expect(disposed).not.toHaveBeenCalled();
				expect(exit).not.toHaveBeenCalled();
				expect(records()).toEqual(["retained first"]);
				expect(shutdowns).toBe(operation === "signal" ? 1 : 0);
				if (interactive) {
					expect(mode.isInitialized).toBe(true);
					expect(mode.isShuttingDown).toBe(false);
					expect(process.listeners("SIGTERM")).toEqual(listeners);
					expect(mode.scheduledMessages.map(({ id, text, when }) => ({ id, text, when }))).toEqual(scheduled);
					expect(mode.heartbeats.map(({ id, text, nextFireAt }) => ({ id, text, nextFireAt }))).toEqual(
						heartbeats,
					);
					// /quit consumes its command text before attempting shutdown.
					if (operation === "interactive") terminal.sendInput("retryable draft");
					terminal.sendInput(" remains usable");
					await vi.waitFor(async () =>
						expect((await terminal.flushAndGetViewport()).join("\n")).toContain("retryable draft remains usable"),
					);
					expect(terminalInputs).toContain(" remains usable");
				}
			}
			unavailable = false;
			if (operation === "signal") await expect(leave()).rejects.toThrow("test process exit");
			else await leave();
			if (operation === "interactive") await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
			expect(records()).toEqual(expected);
			expect(harness.faux.state.callCount).toBe(calls);
			expect(customNotifications).toBe(notificationsBefore);
			expect(disposed).toHaveBeenCalledTimes(1);
			expect(shutdowns).toBe(operation === "signal" && outage ? 2 : 1);
			if (operation === "new") {
				expect(replacements).toBe(1);
				expect(runtime.session).not.toBe(harness.session);
			}
		} finally {
			unavailable = false;
			off();
			vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
			runtime?.setBeforeSessionInvalidate(undefined);
			interactive?.stop();
			exit.mockRestore();
			await runtime?.dispose();
			await harness.session.abort();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);

it.each(["shutdown-receipt", "invalidation", "creation"] as const)(
	"keeps interactive replacement failures fatal after %s",
	async (stage) => {
		const harness = await createHarness();
		const session = harness.session;
		const failure = new Error(`injected ${stage} failure`);
		const runtime = new AgentSessionRuntime(
			session,
			{
				cwd: harness.tempDir,
				agentDir: harness.tempDir,
				modelRuntime: session.modelRuntime,
				settingsManager: harness.settingsManager,
				resourceLoader: session.resourceLoader,
				diagnostics: [],
			},
			async () => {
				throw failure;
			},
		);
		const terminal = new VirtualTerminal(120, 40);
		const interactive = new InteractiveMode(runtime, { terminal });
		const mode = interactive as unknown as {
			handleClearCommand(): Promise<void>;
			handleFatalRuntimeError(prefix: string, error: unknown): Promise<never>;
		};
		const exit = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("test process exit");
		});
		const fatal = vi.spyOn(mode, "handleFatalRuntimeError");
		try {
			await interactive.init();
			if (stage === "shutdown-receipt") {
				vi.spyOn(session, "flushPendingPersistence")
					.mockImplementationOnce(() => {})
					.mockImplementationOnce(() => {
						throw failure;
					});
			} else if (stage === "invalidation") {
				runtime.setBeforeSessionInvalidate(() => {
					throw failure;
				});
			}
			await expect(mode.handleClearCommand()).rejects.toThrow("test process exit");
			expect(exit).toHaveBeenCalledWith(1);
			expect(fatal).toHaveBeenCalledWith("Failed to create session", failure);
		} finally {
			runtime.setBeforeSessionInvalidate(undefined);
			interactive.stop();
			exit.mockRestore();
			fatal.mockRestore();
			await runtime.dispose();
			harness.cleanup();
		}
	},
);
