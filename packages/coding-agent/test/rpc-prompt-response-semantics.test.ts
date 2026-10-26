import * as fs from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	getModel,
	type Model,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { LoadExtensionsResult } from "../src/core/extensions/index.ts";
import { DefaultResourceLoader, type ResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { runRpcMode } from "../src/modes/rpc/rpc-mode.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createHarness, getMessageText } from "./suite/harness.ts";
import { enableBuiltinProviders } from "./test-network-env.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, appendFileSync: vi.fn(actual.appendFileSync) };
});

const rpcIo = vi.hoisted(() => ({
	outputLines: [] as string[],
	lineHandler: undefined as ((line: string) => void) | undefined,
}));

vi.mock("../src/core/output-guard.js", () => ({
	flushRawStdout: vi.fn(async () => {}),
	takeOverStdout: vi.fn(),
	waitForRawStdoutBackpressure: vi.fn(async () => {}),
	writeRawStdout: (line: string) => {
		rpcIo.outputLines.push(line);
	},
}));

vi.mock("../src/modes/interactive/theme/theme.js", () => ({ theme: {} }));

vi.mock("../src/modes/rpc/jsonl.js", () => ({
	attachJsonlLineReader: vi.fn((_stream: NodeJS.ReadableStream, onLine: (line: string) => void) => {
		rpcIo.lineHandler = onLine;
		return () => {};
	}),
	serializeJsonLine: (value: unknown) => `${JSON.stringify(value)}\n`,
}));

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

type ParsedOutputLine = Record<string, unknown>;

function parseOutputLines(outputLines: string[]): ParsedOutputLine[] {
	return outputLines
		.flatMap((line) => line.split("\n"))
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as ParsedOutputLine);
}

function getPromptResponses(outputLines: string[], id: string): ParsedOutputLine[] {
	return parseOutputLines(outputLines).filter(
		(record) => record.id === id && record.type === "response" && record.command === "prompt",
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createRuntimeHost(options: {
	withAuth: boolean;
	responseDelayMs: number;
	model?: Model<any>;
	extensionsResult?: LoadExtensionsResult;
	cwd?: string;
	resourceLoader?: ResourceLoader;
	sessionManager?: SessionManager;
	session?: AgentSession;
}): Promise<{
	runtimeHost: AgentSessionRuntime;
	cleanup: () => Promise<void>;
}> {
	const tempDir = options.cwd ?? join(tmpdir(), `pi-rpc-prompt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });

	const model = options.model ?? getModel("anthropic", "claude-sonnet-4-5");
	if (!model) {
		throw new Error("Test model not found");
	}

	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: {
			model,
			systemPrompt: "Test",
			tools: [],
		},
		streamFn: (_model, _context, _options) => {
			const stream = createAssistantMessageEventStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: createAssistantMessage("") });
				setTimeout(() => {
					stream.push({ type: "done", reason: "stop", message: createAssistantMessage("done") });
				}, options.responseDelayMs);
			});
			return stream;
		},
	});

	const sessionManager = options.sessionManager ?? SessionManager.inMemory();
	const settingsManager = SettingsManager.create(tempDir, tempDir);
	const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
	const modelRegistry = await createInMemoryModelRegistry(authStorage);
	if (options.withAuth) {
		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
	}

	const session =
		options.session ??
		new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader:
				options.resourceLoader ?? createTestResourceLoader({ extensionsResult: options.extensionsResult }),
		});

	const runtimeHost = {
		session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
	} as unknown as AgentSessionRuntime;

	return {
		runtimeHost,
		cleanup: async () => {
			try {
				await session.abort();
			} catch {
				// ignore test cleanup failures
			}
			session.dispose();
			if (!options.cwd && existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true });
			}
		},
	};
}

async function startRpcMode(options: Parameters<typeof createRuntimeHost>[0]): Promise<{
	lineHandler: (line: string) => void;
	runtimeHost: AgentSessionRuntime;
	cleanup: () => Promise<void>;
}> {
	rpcIo.outputLines = [];
	rpcIo.lineHandler = undefined;

	const { runtimeHost, cleanup } = await createRuntimeHost(options);
	const signals = ["SIGTERM", "SIGHUP"] as const;
	const signalListeners = signals.map((signal) => ({ signal, listeners: new Set(process.listeners(signal)) }));
	const inputEndListeners = new Set(process.stdin.listeners("end"));
	void runRpcMode(runtimeHost);
	await vi.waitFor(() => expect(rpcIo.lineHandler).toBeDefined());
	const ownedSignalListeners = signalListeners.flatMap(({ signal, listeners }) =>
		process
			.listeners(signal)
			.filter((listener) => !listeners.has(listener))
			.map((listener) => ({ signal, listener })),
	);
	const ownedInputEndListeners = process.stdin.listeners("end").filter((listener) => !inputEndListeners.has(listener));

	return {
		lineHandler: rpcIo.lineHandler!,
		runtimeHost,
		cleanup: async () => {
			try {
				await cleanup();
			} finally {
				for (const { signal, listener } of ownedSignalListeners) process.off(signal, listener);
				for (const listener of ownedInputEndListeners) process.stdin.off("end", listener as () => void);
			}
		},
	};
}

describe("RPC prompt response semantics", () => {
	// Successful preflight uses bundled metadata; all responses use the scripted Agent stream.
	afterEach(() => {
		rpcIo.outputLines = [];
		rpcIo.lineHandler = undefined;
	});

	it("lists restored skill metadata until skills are explicitly refreshed from disk", async () => {
		const cwd = join(tmpdir(), `pi-rpc-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const skillRoot = join(cwd, "skills");
		const savedDirectory = join(skillRoot, "saved");
		const currentDirectory = join(skillRoot, "current");
		mkdirSync(savedDirectory, { recursive: true });
		writeFileSync(
			join(savedDirectory, "SKILL.md"),
			"---\nname: lookup\ndescription: Saved lookup instructions\n---\nSaved lookup body.\n",
		);
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: join(cwd, "agent"),
			settingsManager: SettingsManager.inMemory(),
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			additionalSkillPaths: [skillRoot],
		});
		let cleanup = async () => {};
		try {
			await loader.reload();
			const manager = SessionManager.create(cwd, join(cwd, "sessions"));
			const first = await createRuntimeHost({
				withAuth: false,
				responseDelayMs: 0,
				cwd,
				resourceLoader: loader,
				sessionManager: manager,
			});
			cleanup = first.cleanup;
			const savedSkill = manager.getSavedSystemPrompt()!.skills![0];
			manager.appendMessage({ role: "user", content: "Remember this resource inventory.", timestamp: 1 });
			await first.cleanup();
			cleanup = async () => {};
			rmSync(savedDirectory, { recursive: true });
			mkdirSync(currentDirectory, { recursive: true });
			writeFileSync(
				join(currentDirectory, "SKILL.md"),
				"---\nname: lookup\ndescription: Current lookup instructions\n---\nCurrent lookup body.\n",
			);
			loader.reloadSkills();
			const currentSkill = loader.getSkills().skills[0];
			const started = await startRpcMode({
				withAuth: false,
				responseDelayMs: 0,
				cwd,
				resourceLoader: loader,
				sessionManager: SessionManager.open(manager.getSessionFile()!, join(cwd, "sessions"), cwd),
			});
			cleanup = started.cleanup;
			const expectCommands = async (id: string, description: string, sourceInfo: unknown) => {
				started.lineHandler(JSON.stringify({ id, type: "get_commands" }));
				await vi.waitFor(() => {
					expect(parseOutputLines(rpcIo.outputLines).filter((line) => line.id === id)).toEqual([
						{
							id,
							type: "response",
							command: "get_commands",
							success: true,
							data: { commands: [{ name: "skill:lookup", description, source: "skill", sourceInfo }] },
						},
					]);
				});
			};
			expect(currentSkill.description).toBe("Current lookup instructions");
			expect(currentSkill.sourceInfo.path).not.toBe(savedSkill.sourceInfo.path);
			await expectCommands("restored", "Saved lookup instructions", savedSkill.sourceInfo);
			await started.runtimeHost.session.reload();
			await expectCommands("reloaded", "Saved lookup instructions", savedSkill.sourceInfo);
			started.runtimeHost.session.reloadSkillsFromFiles();
			await expectCommands("refreshed", "Current lookup instructions", currentSkill.sourceInfo);
		} finally {
			try {
				await cleanup();
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		}
	});

	it("retains nextTurn context through repeated RPC receipt failures and dispatches it once after recovery", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-rpc-receipt-outage-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
		});
		const actual = await vi.importActual<typeof fs>("fs");
		let writable = false;
		let receiptFailures = 0;
		let cleanup = async () => {};
		const requests: string[][] = [];
		const contexts = ["first accepted RPC context", "later accepted RPC context", "latest accepted RPC context"];
		const queueContext = async (index: number) => {
			await harness.session.sendCustomMessage(
				{ customType: "rpc-next-turn", content: contexts[index], display: true, details: { index } },
				{ deliverAs: "nextTurn" },
			);
		};
		try {
			for (let index = 0; index < 3; index++) {
				manager.appendMessage({ role: "user", content: `question ${index}`, timestamp: index * 2 });
				manager.appendMessage(fauxAssistantMessage(`answer ${index}`));
			}
			harness.session.refreshContext();
			harness.setResponses([
				fauxAssistantMessage("completed retained summary"),
				(context) => {
					requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
					expect(
						manager.getEntries().filter((entry) => entry.type === "usage" && entry.kind === "compaction"),
					).toHaveLength(1);
					expect(getPromptResponses(rpcIo.outputLines, "receipt-recovered")).toMatchObject([
						{ success: true, data: { disposition: "started" } },
					]);
					return fauxAssistantMessage("RPC recovery completed");
				},
				(context) => {
					requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
					return fauxAssistantMessage("subsequent RPC completed");
				},
			]);
			vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
				const entry = JSON.parse(String(args[1])) as { type: string; kind?: string };
				if (entry.type === "compaction") throw new Error("checkpoint storage unavailable");
				if (entry.type === "usage" && entry.kind === "compaction" && !writable) {
					receiptFailures++;
					throw new Error("summary receipt storage unavailable");
				}
				return actual.appendFileSync(...args);
			});
			await expect(harness.session.compact({ keepRecentMessages: 1 })).rejects.toThrow(
				"checkpoint storage unavailable",
			);
			expect(receiptFailures).toBe(1);
			const callsAfterSummary = harness.faux.state.callCount;
			const rpc = await startRpcMode({ withAuth: false, responseDelayMs: 0, session: harness.session });
			cleanup = rpc.cleanup;
			for (const [index, id] of ["receipt-blocked", "receipt-blocked-again"].entries()) {
				await queueContext(index);
				rpc.lineHandler(JSON.stringify({ id, type: "prompt", message: "retry retained RPC input" }));
				await vi.waitFor(() => {
					expect(getPromptResponses(rpcIo.outputLines, id)).toEqual([
						{
							id,
							type: "response",
							command: "prompt",
							success: false,
							error: "summary receipt storage unavailable",
						},
					]);
				});
				await harness.session.waitForIdle();
				expect(requests).toEqual([]);
				expect(harness.faux.state.callCount).toBe(callsAfterSummary);
				expect(
					harness.session.messages.filter((message) => message.role === "user").map(getMessageText),
				).not.toContain("retry retained RPC input");
				expect(harness.session.messages.filter((message) => message.role === "custom")).toEqual([]);
				expect(parseOutputLines(rpcIo.outputLines).filter((line) => line.type === "agent_start")).toEqual([]);
			}
			expect(receiptFailures).toBeGreaterThanOrEqual(3);
			await queueContext(2);
			writable = true;
			rpc.lineHandler(
				JSON.stringify({ id: "receipt-recovered", type: "prompt", message: "retry retained RPC input" }),
			);
			await vi.waitFor(() => {
				expect(getPromptResponses(rpcIo.outputLines, "receipt-recovered")).toEqual([
					{
						id: "receipt-recovered",
						type: "response",
						command: "prompt",
						success: true,
						data: { disposition: "started" },
					},
				]);
			});
			await harness.session.waitForIdle();
			const expectedRequest = ["question 0", "question 1", "question 2", "retry retained RPC input", ...contexts];
			expect(requests).toEqual([expectedRequest]);
			expect(harness.faux.state.callCount).toBe(callsAfterSummary + 1);
			const expectedCustomMessages = contexts.map((content, index) => ({
				customType: "rpc-next-turn",
				content,
				display: true,
				details: { index },
			}));
			const expectRetainedHistory = () => {
				const reopened = SessionManager.open(manager.getSessionFile()!);
				expect(
					reopened.getEntries().filter((entry) => entry.type === "usage" && entry.kind === "compaction"),
				).toHaveLength(1);
				expect(reopened.getEntries().filter((entry) => entry.type === "custom_message")).toMatchObject(
					expectedCustomMessages,
				);
				for (const messages of [harness.session.messages, reopened.buildSessionContext().messages]) {
					expect(messages.filter((message) => message.role === "custom")).toMatchObject(expectedCustomMessages);
					expect(
						messages
							.filter((message) => message.role === "user")
							.map(getMessageText)
							.filter((text) => text === "retry retained RPC input"),
					).toEqual(["retry retained RPC input"]);
				}
			};
			expectRetainedHistory();
			rpc.lineHandler(JSON.stringify({ id: "receipt-subsequent", type: "prompt", message: "subsequent RPC input" }));
			await vi.waitFor(() => {
				expect(getPromptResponses(rpcIo.outputLines, "receipt-subsequent")).toEqual([
					{
						id: "receipt-subsequent",
						type: "response",
						command: "prompt",
						success: true,
						data: { disposition: "started" },
					},
				]);
			});
			await harness.session.waitForIdle();
			expect(requests).toEqual([expectedRequest, [...expectedRequest, "subsequent RPC input"]]);
			expect(harness.faux.state.callCount).toBe(callsAfterSummary + 2);
			expectRetainedHistory();
			for (const id of ["receipt-blocked", "receipt-blocked-again"]) {
				expect(getPromptResponses(rpcIo.outputLines, id)).toMatchObject([{ success: false }]);
			}
			expect(parseOutputLines(rpcIo.outputLines).filter((line) => line.type === "agent_start")).toHaveLength(2);
		} finally {
			writable = true;
			vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
			await cleanup();
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("emits one failure response when prompt preflight rejects", async () => {
		const { lineHandler, cleanup } = await startRpcMode({
			withAuth: false,
			responseDelayMs: 0,
			model: {
				id: "fake-model",
				name: "Fake Model",
				api: "openai-completions",
				provider: "fake-provider",
				baseUrl: "https://example.invalid",
				reasoning: false,
				input: [],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 0,
				maxTokens: 0,
			},
		});

		try {
			lineHandler(JSON.stringify({ id: "b1", type: "prompt", message: "Hello" }));

			await vi.waitFor(() => {
				const responses = getPromptResponses(rpcIo.outputLines, "b1");
				expect(responses).toHaveLength(1);
				expect(responses[0]).toMatchObject({
					id: "b1",
					type: "response",
					command: "prompt",
					success: false,
					error: expect.stringContaining(
						"No API key found for fake-provider.\n\nUse /login to log into a provider via OAuth or API key. See:",
					),
				});
			});
		} finally {
			await cleanup();
		}
	});

	// #9098: a successful prompt may start an agent run or be consumed by an extension.
	it("emits one started response when prompt preflight succeeds", async () => {
		enableBuiltinProviders();
		const { lineHandler, cleanup } = await startRpcMode({ withAuth: true, responseDelayMs: 0 });

		try {
			lineHandler(JSON.stringify({ id: "b2", type: "prompt", message: "Hello" }));

			await vi.waitFor(() => {
				const responses = getPromptResponses(rpcIo.outputLines, "b2");
				expect(responses).toHaveLength(1);
				expect(responses[0]).toMatchObject({
					id: "b2",
					type: "response",
					command: "prompt",
					success: true,
					data: { disposition: "started" },
				});
			});
		} finally {
			await cleanup();
		}
	});

	it("reports extension commands and intercepted input as handled without starting a run", async () => {
		const { lineHandler, cleanup } = await startRpcMode({
			withAuth: false,
			responseDelayMs: 0,
			extensionsResult: await createTestExtensionsResult([
				(pi) => {
					pi.registerCommand("handled", { handler: async () => {} });
					pi.on("input", (event) => {
						if (event.text === "handled input") return { action: "handled" };
					});
				},
			]),
		});

		try {
			for (const [id, message] of [
				["command", "/handled"],
				["input", "handled input"],
			]) {
				lineHandler(JSON.stringify({ id, type: "prompt", message }));
				await vi.waitFor(() => {
					expect(getPromptResponses(rpcIo.outputLines, id)).toEqual([
						{ id, type: "response", command: "prompt", success: true, data: { disposition: "handled" } },
					]);
				});
			}
			expect(parseOutputLines(rpcIo.outputLines).filter((line) => line.type === "agent_start")).toHaveLength(0);
		} finally {
			await cleanup();
		}
	});

	it("emits one success response when prompt is queued during streaming", async () => {
		enableBuiltinProviders();
		const { lineHandler, cleanup } = await startRpcMode({ withAuth: true, responseDelayMs: 100 });

		try {
			lineHandler(JSON.stringify({ id: "b3-start", type: "prompt", message: "Start" }));
			await vi.waitFor(() => {
				expect(getPromptResponses(rpcIo.outputLines, "b3-start")).toHaveLength(1);
			});

			rpcIo.outputLines = [];
			lineHandler(
				JSON.stringify({
					id: "b3",
					type: "prompt",
					message: "Queue this",
					streamingBehavior: "followUp",
				}),
			);

			await vi.waitFor(() => {
				const responses = getPromptResponses(rpcIo.outputLines, "b3");
				expect(responses).toHaveLength(1);
				expect(responses[0]).toMatchObject({
					id: "b3",
					type: "response",
					command: "prompt",
					success: true,
					data: { disposition: "queued" },
				});
			});

			await sleep(150);
		} finally {
			await cleanup();
		}
	});

	// #9803: a handler can consume A while independently queueing B; report A's outcome.
	it.each(["steer", "follow_up"] as const)(
		"reports %s as handled even when an extension queues another message",
		async (type) => {
			enableBuiltinProviders();
			const { lineHandler, cleanup } = await startRpcMode({
				withAuth: true,
				responseDelayMs: 500,
				extensionsResult: await createTestExtensionsResult([
					(pi) => {
						pi.on("input", (event) => {
							if (event.text === "A" && event.source === "rpc") {
								pi.sendUserMessage("B", { deliverAs: type === "steer" ? "steer" : "followUp" });
								return { action: "handled" };
							}
						});
					},
				]),
			});

			try {
				lineHandler(JSON.stringify({ id: "start", type: "prompt", message: "Start" }));
				await vi.waitFor(() => expect(getPromptResponses(rpcIo.outputLines, "start")).toHaveLength(1));

				lineHandler(JSON.stringify({ id: "A", type, message: "A" }));
				await vi.waitFor(() => {
					expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
						id: "A",
						type: "response",
						command: type,
						success: true,
						data: { disposition: "handled" },
					});
					expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
						type: "queue_update",
						steering: type === "steer" ? ["B"] : [],
						followUp: type === "follow_up" ? ["B"] : [],
					});
				});
				await vi.waitFor(() => {
					expect(
						parseOutputLines(rpcIo.outputLines).filter((line) => line.type === "response" && line.id === "A"),
					).toHaveLength(1);
				});
			} finally {
				await cleanup();
			}
		},
	);

	it.each(["steer", "follow_up"] as const)("reports %s as queued after input transformation", async (type) => {
		const { lineHandler, cleanup } = await startRpcMode({
			withAuth: false,
			responseDelayMs: 0,
			extensionsResult: await createTestExtensionsResult([
				(pi) => {
					pi.on("input", (event) => {
						if (event.text === "A") return { action: "transform", text: "B" };
					});
				},
			]),
		});

		try {
			lineHandler(JSON.stringify({ id: "A", type, message: "A" }));
			await vi.waitFor(() => {
				expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
					id: "A",
					type: "response",
					command: type,
					success: true,
					data: { disposition: "queued" },
				});
				expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
					type: "queue_update",
					steering: type === "steer" ? ["B"] : [],
					followUp: type === "follow_up" ? ["B"] : [],
				});
			});
		} finally {
			await cleanup();
		}
	});

	it("returns and clears queued steering and follow-up messages", async () => {
		enableBuiltinProviders();
		const { lineHandler, cleanup } = await startRpcMode({ withAuth: true, responseDelayMs: 500 });

		try {
			lineHandler(JSON.stringify({ id: "clear-start", type: "prompt", message: "Start" }));
			await vi.waitFor(() => {
				expect(getPromptResponses(rpcIo.outputLines, "clear-start")).toHaveLength(1);
			});

			lineHandler(
				JSON.stringify({
					id: "clear-steering",
					type: "prompt",
					message: "Change direction",
					streamingBehavior: "steer",
				}),
			);
			await vi.waitFor(() => {
				expect(getPromptResponses(rpcIo.outputLines, "clear-steering")).toMatchObject([
					{ data: { disposition: "queued" } },
				]);
			});

			lineHandler(
				JSON.stringify({
					id: "clear-follow-up",
					type: "prompt",
					message: "Summarize when finished",
					streamingBehavior: "followUp",
				}),
			);
			await vi.waitFor(() => {
				expect(getPromptResponses(rpcIo.outputLines, "clear-follow-up")).toHaveLength(1);
			});

			lineHandler(JSON.stringify({ id: "clear", type: "clear_queue" }));
			await vi.waitFor(() => {
				expect(parseOutputLines(rpcIo.outputLines)).toContainEqual({
					id: "clear",
					type: "response",
					command: "clear_queue",
					success: true,
					data: {
						steering: ["Change direction"],
						followUp: ["Summarize when finished"],
					},
				});
			});

			await sleep(600);
			expect(parseOutputLines(rpcIo.outputLines).filter((record) => record.type === "agent_start")).toHaveLength(1);
		} finally {
			await cleanup();
		}
	});
});
