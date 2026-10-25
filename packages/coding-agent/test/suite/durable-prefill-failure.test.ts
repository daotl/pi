import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageTotals } from "../../src/core/usage-totals.ts";
import { createHarness, getMessageText } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return {
		...actual,
		writeFileSync: vi.fn(actual.writeFileSync),
		renameSync: vi.fn(actual.renameSync),
		appendFileSync: vi.fn(actual.appendFileSync),
	};
});
let cwd: string;
beforeEach(async () => {
	const actual = await vi.importActual<typeof fs>("fs");
	vi.mocked(fs.writeFileSync).mockReset().mockImplementation(actual.writeFileSync);
	vi.mocked(fs.renameSync).mockReset().mockImplementation(actual.renameSync);
	vi.mocked(fs.appendFileSync).mockReset().mockImplementation(actual.appendFileSync);
	cwd = fs.mkdtempSync(join(tmpdir(), "pi-prefill-publication-failure-"));
});
afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(cwd, { recursive: true, force: true });
});

it.each([
	{ failure: "write", retryRestore: false },
	{ failure: "rename", retryRestore: false },
	{ failure: "write", retryRestore: true },
	{ failure: "rename", retryRestore: true },
	{ failure: "listener", retryRestore: false },
] as const)(
	"retains completed charge and original context after $failure failure (restore retry $retryRestore)",
	async ({ failure, retryRestore }) => {
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		let replacementReady = false;
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("message_end", (event) => {
						if (
							event.message.role === "assistant" &&
							getMessageText(event.message) === "original prefix completed"
						) {
							replacementReady = true;
							return { message: { ...event.message, content: [{ type: "text", text: "normalized answer" }] } };
						}
					});
				},
			],
		});
		try {
			const model = harness.getModel();
			const original: AssistantMessage = {
				...fauxAssistantMessage("original prefix", { stopReason: "aborted" }),
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 7,
					output: 2,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 9,
					cost: { input: 0.007, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.009 },
				},
			};
			const terminal: AssistantMessage = {
				...original,
				stopReason: "stop",
				content: [{ type: "text", text: "original prefix completed" }],
				responseId: "charged-unpublished",
				responseModel: "physical-deployment",
				diagnostics: [{ type: "provider-recovery", timestamp: 1, details: { attempt: 2 } }],
				usage: {
					input: 100,
					output: 10,
					cacheRead: 5,
					cacheWrite: 3,
					totalTokens: 118,
					cost: { input: 0.1, output: 0.01, cacheRead: 0.005, cacheWrite: 0.003, total: 0.118 },
				},
			};
			let response = original;
			harness.session.agent.streamFunction = () => {
				const stream = createAssistantMessageEventStream();
				if (response.stopReason === "aborted")
					stream.push({ type: "error", reason: "aborted", error: structuredClone(response) });
				else stream.push({ type: "done", reason: "stop", message: structuredClone(response) });
				return stream;
			};
			await harness.session.prompt("original request");
			const savedOriginal = structuredClone(manager.getBranch().at(-1));
			if (!savedOriginal) throw new Error("Expected persisted prefix");
			const actual = await vi.importActual<typeof fs>("fs");
			let failed = false;
			let restoreArmed = false;
			let restoreFailed = false;
			harness.session.subscribe((event) => {
				if (event.type === "turn_end" && event.message.role === "assistant" && event.message.stopReason === "error")
					restoreArmed = true;
				if (
					failure === "listener" &&
					event.type === "message_end" &&
					event.message.role === "assistant" &&
					event.message.stopReason === "stop" &&
					event.message.responseId === terminal.responseId
				) {
					failed = true;
					throw new Error("injected prepublication listener failure");
				}
			});
			vi.mocked(fs.writeFileSync).mockImplementation((...args) => {
				if (retryRestore && restoreArmed && !restoreFailed) {
					restoreFailed = true;
					throw new Error("injected restoration write failure");
				}
				if (
					!failed &&
					failure === "write" &&
					typeof args[1] === "string" &&
					args[1].includes("normalized answer")
				) {
					failed = true;
					throw new Error("injected replacement write failure");
				}
				return actual.writeFileSync(...args);
			});
			vi.mocked(fs.renameSync).mockImplementation((...args) => {
				if (!failed && failure === "rename" && replacementReady) {
					failed = true;
					throw new Error("injected replacement rename failure");
				}
				return actual.renameSync(...args);
			});
			response = terminal;
			if (retryRestore) {
				await expect(harness.session.continue()).rejects.toBeInstanceOf(Error);
				expect(restoreFailed).toBe(true);
				expect(harness.session.isIdle).toBe(true);
				response = {
					...original,
					content: [{ type: "text", text: "new prompt answer" }],
					stopReason: "stop",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
				};
				await harness.session.prompt("recover pending restoration");
			} else await harness.session.continue();
			expect(failed).toBe(true);
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				expect(current.getEntry(savedOriginal.id)).toMatchObject({
					...savedOriginal,
					supersededBy: expect.any(String),
				});
				const receipts = current
					.getEntries()
					.filter(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "assistant" &&
							entry.message.responseId === terminal.responseId,
					);
				expect(receipts).toEqual([
					expect.objectContaining({
						message: expect.objectContaining({
							content: [{ type: "text", text: "" }],
							stopReason: "error",
							api: terminal.api,
							provider: terminal.provider,
							model: terminal.model,
							responseModel: terminal.responseModel,
							diagnostics: terminal.diagnostics,
							usage: terminal.usage,
						}),
					}),
				]);
				expect(current.getBranch()).not.toContainEqual(receipts[0]);
				expect(getUsageTotals(current.getEntries())).toEqual({
					input: 107,
					output: 12,
					cacheRead: 5,
					cacheWrite: 3,
					cost: expect.closeTo(0.127),
				});
				const texts = current.buildSessionContext().messages.map(getMessageText);
				expect(texts).toContain("original prefix");
				expect(texts).not.toContain("normalized answer");
			}
		} finally {
			await harness.session.abort();
			harness.cleanup();
		}
	},
);

it("retains an ordinary completed response charge after a prepublication listener rejects it", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		const model = harness.getModel();
		const terminal: AssistantMessage = {
			...fauxAssistantMessage("unpublished ordinary answer"),
			api: model.api,
			provider: model.provider,
			model: model.id,
			responseId: "ordinary-listener-charge",
			responseModel: "physical-deployment",
			diagnostics: [{ type: "provider-recovery", timestamp: 1, details: { attempt: 1 } }],
			usage: {
				input: 100,
				output: 10,
				cacheRead: 5,
				cacheWrite: 3,
				totalTokens: 118,
				cost: { input: 0.1, output: 0.01, cacheRead: 0.005, cacheWrite: 0.003, total: 0.118 },
			},
		};
		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: structuredClone(terminal) });
			return stream;
		};
		let rejected = false;
		harness.session.subscribe((event) => {
			if (!rejected && event.type === "message_end" && event.message.role === "assistant") {
				rejected = true;
				throw new Error("ordinary publication rejected");
			}
		});
		await harness.session.prompt("ordinary request");
		expect(rejected).toBe(true);
		for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
			const assistants = current
				.getEntries()
				.filter((entry) => entry.type === "message" && entry.message.role === "assistant");
			expect(assistants).toEqual([
				expect.objectContaining({
					message: expect.objectContaining({
						content: [{ type: "text", text: "" }],
						stopReason: "error",
						responseId: terminal.responseId,
						responseModel: terminal.responseModel,
						diagnostics: terminal.diagnostics,
						usage: terminal.usage,
					}),
				}),
			]);
			expect(current.buildSessionContext().messages.map(getMessageText)).not.toContain(
				"unpublished ordinary answer",
			);
			expect(getUsageTotals(current.getEntries())).toEqual({
				input: 100,
				output: 10,
				cacheRead: 5,
				cacheWrite: 3,
				cost: expect.closeTo(0.118),
			});
		}
	} finally {
		harness.cleanup();
	}
});

it("keeps an accepted branch navigation instead of replaying failed recovery from its abandoned branch", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		fauxApi: "openai-completions",
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		harness.setResponses([
			fauxAssistantMessage("selected answer"),
			fauxAssistantMessage("abandoned partial", { stopReason: "aborted" }),
		]);
		await harness.session.prompt("selected request");
		const target = manager.getBranch().at(-1);
		if (!target) throw new Error("Expected navigation target");
		await harness.session.prompt("abandoned request");
		let restoreArmed = false;
		harness.session.subscribe((event) => {
			if (event.type === "turn_end" && event.message.role === "assistant" && event.message.stopReason === "error")
				restoreArmed = true;
		});
		const actual = await vi.importActual<typeof fs>("fs");
		let failed = false;
		vi.mocked(fs.writeFileSync).mockImplementation((...args) => {
			if (restoreArmed && !failed) {
				failed = true;
				throw new Error("injected restoration failure");
			}
			return actual.writeFileSync(...args);
		});
		harness.setResponses([fauxAssistantMessage("different terminal")]);
		await expect(harness.session.continue()).rejects.toBeInstanceOf(Error);
		expect(failed).toBe(true);
		vi.mocked(fs.writeFileSync).mockImplementation(actual.writeFileSync);
		expect(await harness.session.navigateTree(target.id)).toMatchObject({ cancelled: false });
		let request: string[] = [];
		harness.setResponses([
			(context) => {
				request = context.messages.filter((message) => message.role !== "system").map(getMessageText);
				return fauxAssistantMessage("selected work completed");
			},
		]);
		await harness.session.prompt("work here");
		expect(request).toEqual(["selected request", "selected answer", "work here"]);
		expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
			harness.session.messages,
		);
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});

it.each(["select", "regenerate", "edit-version", "edit-swipe"] as const)(
	"discards failed prefix recovery after accepted swipe %s",
	async (action) => {
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			harness.setResponses([
				fauxAssistantMessage("selected answer"),
				fauxAssistantMessage("abandoned partial", { stopReason: "aborted" }),
			]);
			await harness.session.prompt("same question");
			const selected = harness.session.getSwipeGroup()!.versions[0];
			await harness.session.regenerateSwipe(harness.session.getSwipeGroup()!);
			let restoration = false;
			harness.session.subscribe((event) => {
				if (event.type === "turn_end" && event.message.role === "assistant" && event.message.stopReason === "error")
					restoration = true;
			});
			const actual = await vi.importActual<typeof fs>("fs");
			let failed = false;
			vi.mocked(fs.writeFileSync).mockImplementation((...args) => {
				if (restoration && !failed) {
					failed = true;
					throw new Error("injected failed prefix restoration");
				}
				return actual.writeFileSync(...args);
			});
			harness.setResponses([fauxAssistantMessage("wrong terminal")]);
			await expect(harness.session.continue()).rejects.toBeInstanceOf(Error);
			expect(failed).toBe(true);
			vi.mocked(fs.writeFileSync).mockImplementation(actual.writeFileSync);
			const beforeLeaf = manager.getLeafId();
			const anchorId = harness.session.getSwipeGroup()!.anchorEntryId;
			if (action === "select")
				expect(harness.session.goToSwipeVersion(harness.session.getSwipeGroup()!, 0)).toBe(true);
			else if (action === "regenerate") harness.session.prepareSwipeRegeneration(harness.session.getSwipeGroup()!);
			else if (action === "edit-version")
				harness.session.applyMessageEdits(
					'<pi_edit id="0" role="assistant"><pi_content>edited version</pi_content></pi_edit>',
				);
			else
				harness.session.applyMessageEdits(
					`<pi_swipe timestamp="${selected.timestamp}" role="assistant"><pi_content>edited selected</pi_content></pi_swipe>`,
				);
			const selectedTexts = manager
				.buildSessionContext()
				.messages.filter((message) => message.role !== "system")
				.map(getMessageText);
			const expectedSelected = {
				select: ["same question", "selected answer"],
				regenerate: ["same question"],
				"edit-version": ["same question", "edited version"],
				"edit-swipe": ["same question", "edited selected"],
			}[action];
			expect(selectedTexts).toEqual(expectedSelected);
			expect(manager.getLeafId()).not.toBe(beforeLeaf);
			if (action === "select") expect(manager.getLeafId()).toBe(selected.id);
			else if (action === "regenerate") expect(manager.getLeafId()).toBe(anchorId);
			else if (action === "edit-version") {
				const version = manager.getEntry(manager.getLeafId()!);
				expect(version).toMatchObject({
					type: "message",
					parentId: anchorId,
					message: { role: "assistant", content: [{ type: "text", text: "edited version" }] },
				});
				expect(manager.getBranch().map((entry) => entry.id)).not.toContain(selected.id);
			}
			let requested: string[] = [];
			harness.setResponses([
				(context) => {
					requested = context.messages.filter((message) => message.role !== "system").map(getMessageText);
					return fauxAssistantMessage("accepted next answer");
				},
			]);
			await harness.session.prompt("next instruction");
			expect(requested).toEqual([...expectedSelected, "next instruction"]);
			expect(requested).not.toContain("abandoned partial");
			expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
				harness.session.messages,
			);
		} finally {
			await harness.session.abort();
			harness.cleanup();
		}
	},
);

it("preserves failed restoration after aborting an approved active prefix retry", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	let recoveryEnabled = false;
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		fauxApi: "openai-completions",
		settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 }, compaction: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("turn_end", (event) =>
					recoveryEnabled && event.outcome === "aborted"
						? {
								entries: [
									{
										type: "custom_message",
										customType: "abort-recovery",
										content: "retained abort recovery",
										display: false,
									},
								],
							}
						: undefined,
				);
			},
		],
	});
	try {
		harness.setResponses([fauxAssistantMessage("original prefix", { stopReason: "aborted" })]);
		await harness.session.prompt("original request");
		recoveryEnabled = true;
		let armed = false;
		harness.session.subscribe((event) => {
			if (event.type === "turn_end" && event.message.role === "assistant" && event.message.stopReason === "aborted")
				armed = true;
		});
		const actual = await vi.importActual<typeof fs>("fs");
		let failed = false;
		vi.mocked(fs.writeFileSync).mockImplementation((...args) => {
			if (armed && !failed) {
				failed = true;
				throw new Error("injected aborted restore failure");
			}
			return actual.writeFileSync(...args);
		});
		const started = Promise.withResolvers<void>();
		let attempts = 0;
		harness.session.agent.streamFunction = (_model, _context, options) => {
			const stream = createAssistantMessageEventStream();
			if (++attempts === 1)
				stream.push({
					type: "error",
					reason: "error",
					error: fauxAssistantMessage("orig", { stopReason: "error", errorMessage: "Connection error." }),
				});
			else {
				options?.signal?.addEventListener(
					"abort",
					() =>
						stream.push({
							type: "error",
							reason: "aborted",
							error: fauxAssistantMessage("orig", { stopReason: "aborted" }),
						}),
					{ once: true },
				);
				started.resolve();
			}
			return stream;
		};
		const running = harness.session.continue();
		const outcome = running.then(
			() => undefined,
			(error: unknown) => error,
		);
		await Promise.race([
			started.promise,
			running.then(() => {
				throw new Error("Retry did not start");
			}),
		]);
		const abort = harness.session.abort();
		expect(await outcome).toBeInstanceOf(Error);
		await abort;
		expect(failed).toBe(true);
		expect(harness.session.retryAttempt).toBe(0);
		expect(harness.session.isIdle).toBe(true);
		vi.mocked(fs.writeFileSync).mockImplementation(actual.writeFileSync);
		harness.session.agent.streamFunction = harness.session.modelRuntime.streamSimple.bind(
			harness.session.modelRuntime,
		);
		let request = "";
		harness.setResponses([
			(context) => {
				request = JSON.stringify(context.messages);
				return fauxAssistantMessage("new request completed");
			},
		]);
		await harness.session.prompt("new request after abort");
		expect(request).toContain("original prefix");
		expect(request).toContain("retained abort recovery");
		expect(request).not.toContain('"text":"orig"');
		expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
			harness.session.messages,
		);
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});

it("retries committed recovery input without moving the restored prefix after it", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		fauxApi: "openai-completions",
		settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 }, compaction: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("turn_end", (event) =>
					event.outcome === "error"
						? {
								entries: [
									{
										type: "custom_message",
										customType: "recovery",
										content: "recovery input",
										display: false,
									},
								],
							}
						: undefined,
				);
			},
		],
	});
	try {
		harness.setResponses([fauxAssistantMessage("original prefix", { stopReason: "aborted" })]);
		await harness.session.prompt("original user");
		const requests: Array<{ texts: string[]; prefill: boolean }> = [];
		harness.setResponses([
			(context, options) => {
				requests.push({
					texts: context.messages.filter((message) => message.role !== "system").map(getMessageText),
					prefill: options?.returnPrefill === true,
				});
				return fauxAssistantMessage("orig", { stopReason: "error", errorMessage: "Connection error." });
			},
			(context, options) => {
				requests.push({
					texts: context.messages.filter((message) => message.role !== "system").map(getMessageText),
					prefill: options?.returnPrefill === true,
				});
				return fauxAssistantMessage("answer to recovery");
			},
		]);
		await harness.session.continue();
		expect(requests).toEqual([
			{ texts: ["original user", "original prefix"], prefill: true },
			{ texts: ["original user", "original prefix", "recovery input"], prefill: false },
		]);
		expect(
			manager
				.buildSessionContext()
				.messages.filter((message) => message.role === "assistant")
				.map(getMessageText),
		).toEqual(["original prefix", "answer to recovery"]);
		expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
			harness.session.messages,
		);
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});

it("retains normalized published echo and its executed tool after a later request fails", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const executed: string[] = [];
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		fauxApi: "openai-completions",
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
		tools: [
			{
				name: "record",
				label: "Record",
				description: "Record a value",
				parameters: Type.Object({ value: Type.String() }),
				execute: async (_id, args) => {
					executed.push(typeof args === "object" && args !== null && "value" in args ? String(args.value) : "");
					return { content: [{ type: "text", text: "TOOL RESULT" }], details: {} };
				},
			},
		],
		extensionFactories: [
			(pi) => {
				pi.on("message_end", (event) =>
					event.message.role === "assistant" && getMessageText(event.message) === "original prefix completed"
						? {
								message: {
									...event.message,
									content: event.message.content.map((block) =>
										block.type === "text" ? { ...block, text: "normalized completed" } : block,
									),
								},
							}
						: undefined,
				);
			},
		],
	});
	try {
		harness.setResponses([fauxAssistantMessage("original prefix", { stopReason: "aborted" })]);
		await harness.session.prompt("original request");
		let nextRequest: { prefill: boolean; texts: string[]; lastRole?: string } | undefined;
		harness.setResponses([
			fauxAssistantMessage(
				[{ type: "text", text: "original prefix completed" }, fauxToolCall("record", { value: "once" })],
				{ stopReason: "toolUse" },
			),
			(context, options) => {
				nextRequest = {
					prefill: options?.returnPrefill === true,
					texts: context.messages.map(getMessageText),
					lastRole: context.messages.findLast((message) => message.role !== "system")?.role,
				};
				return fauxAssistantMessage("", { stopReason: "error", errorMessage: "unrecoverable failure" });
			},
		]);
		await harness.session.continue();
		expect(executed).toEqual(["once"]);
		expect(nextRequest).toEqual({
			prefill: false,
			texts: expect.arrayContaining(["normalized completed", "TOOL RESULT"]),
			lastRole: "toolResult",
		});
		expect(nextRequest?.texts).not.toContain("original prefix");
		for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
			const texts = current.buildSessionContext().messages.map(getMessageText);
			expect(texts).toContain("normalized completed");
			expect(texts).toContain("TOOL RESULT");
			expect(texts).not.toContain("original prefix");
		}
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});

it("continues the context-edited canonical partial during a prompt-owned automatic retry", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	let editedSource: string | undefined;
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		fauxApi: "openai-completions",
		settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 }, compaction: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("turn_end", (event) => {
					if (event.outcome !== "error") return;
					editedSource = event.messageEntryId;
					return {
						entries: [
							{
								type: "context_edit",
								targetId: event.messageEntryId,
								replacement: { content: [{ type: "text", text: "edited partial" }] },
							},
						],
					};
				});
			},
		],
	});
	try {
		let request: { texts: string[]; prefill: boolean } | undefined;
		harness.setResponses([
			fauxAssistantMessage("raw partial", { stopReason: "error", errorMessage: "Connection error." }),
			(context, options) => {
				request = {
					texts: context.messages.filter((message) => message.role !== "system").map(getMessageText),
					prefill: options?.returnPrefill === true,
				};
				return fauxAssistantMessage("edited partial completed");
			},
		]);
		await harness.session.prompt("original request");
		if (!editedSource) throw new Error("Expected edited failed response source");
		expect(
			manager
				.getEntries()
				.filter((entry) => entry.type === "context_edit" && entry.targetId === editedSource)
				.map((entry) => (entry.type === "context_edit" ? entry.replacement : undefined)),
		).toEqual([{ content: [{ type: "text", text: "edited partial" }] }]);
		expect(manager.getEntry(editedSource)?.supersededBy).toBe(manager.getLeafId());
		expect(request).toEqual({ texts: ["original request", "edited partial"], prefill: true });
		expect(
			manager
				.buildSessionContext()
				.messages.filter((message) => message.role === "assistant")
				.map(getMessageText),
		).toEqual(["edited partial completed"]);
		expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
			harness.session.messages,
		);
	} finally {
		await harness.session.abort();
		harness.cleanup();
	}
});

it("restores a prompt-owned captured prefix after aborting its automatic retry mid-echo", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		fauxApi: "openai-completions",
		settings: { retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 }, compaction: { enabled: false } },
	});
	let running: Promise<void> | undefined;
	try {
		const started = Promise.withResolvers<void>();
		let attempts = 0;
		harness.session.agent.streamFunction = (_model, _context, options) => {
			const stream = createAssistantMessageEventStream();
			if (++attempts === 1)
				stream.push({
					type: "error",
					reason: "error",
					error: fauxAssistantMessage("original partial", {
						stopReason: "error",
						errorMessage: "Connection error.",
					}),
				});
			else {
				options?.signal?.addEventListener(
					"abort",
					() =>
						stream.push({
							type: "error",
							reason: "aborted",
							error: fauxAssistantMessage("orig", { stopReason: "aborted" }),
						}),
					{ once: true },
				);
				started.resolve();
			}
			return stream;
		};
		running = harness.session.prompt("original request");
		await Promise.race([
			started.promise,
			running.then(() => {
				throw new Error("Retry did not start");
			}),
		]);
		const abort = harness.session.abort();
		await running;
		await abort;
		for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
			expect(
				current
					.buildSessionContext()
					.messages.filter((message) => message.role === "assistant")
					.map(getMessageText),
			).toEqual(["original partial"]);
		}
		expect(harness.session.retryAttempt).toBe(0);
		expect(harness.session.isIdle).toBe(true);
	} finally {
		await harness.session.abort();
		await running?.catch(() => {});
		harness.cleanup();
	}
});

it.each(["delete", "delete-parent", "soft-delete", "shred", "replace", "swipe-delete", "swipe-shred"] as const)(
	"does not replay failed prefix recovery after accepted %s",
	async (mutation) => {
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			harness.setResponses([fauxAssistantMessage("abandoned partial", { stopReason: "aborted" })]);
			await harness.session.prompt("original question");
			const prefix = manager
				.getBranch()
				.findLast((entry) => entry.type === "message" && entry.message.role === "assistant")!;
			const parent = prefix.parentId!;
			let armed = false;
			const off = harness.session.subscribe((event) => {
				if (event.type === "turn_end" && event.message.role === "assistant" && event.message.stopReason === "error")
					armed = true;
			});
			const actual = await vi.importActual<typeof fs>("fs");
			let failed = false;
			vi.mocked(fs.writeFileSync).mockImplementation((...args) => {
				if (armed && !failed) {
					failed = true;
					throw new Error("held recovery write failed");
				}
				return actual.writeFileSync(...args);
			});
			harness.setResponses([fauxAssistantMessage("wrong terminal")]);
			await expect(harness.session.continue()).rejects.toBeInstanceOf(Error);
			expect(failed).toBe(true);
			off();
			vi.mocked(fs.writeFileSync).mockImplementation(actual.writeFileSync);
			if (mutation === "delete") harness.session.deleteLastMessages(1);
			else if (mutation === "delete-parent") harness.session.deleteMessage(parent);
			else if (mutation === "soft-delete") expect(harness.session.softDeleteMessage(prefix.id)).toBe(true);
			else if (mutation === "shred") harness.session.shredLastMessages(1);
			else if (mutation === "swipe-delete") harness.session.deleteSwipeVersions([1]);
			else if (mutation === "swipe-shred") harness.session.shredSwipeVersions([1]);
			else harness.session.applyMessageEdits('<pi_edit id="1" role="user">accepted replacement</pi_edit>');
			const accepted = harness.session.messages.filter((message) => message.role !== "system").map(getMessageText);
			let requested: string[] = [];
			harness.setResponses([
				(context) => {
					requested = context.messages.filter((message) => message.role !== "system").map(getMessageText);
					return fauxAssistantMessage("next answer");
				},
			]);
			await harness.session.prompt("next request");
			expect(requested).toEqual([...accepted, "next request"]);
			expect(SessionManager.open(manager.getSessionFile()!).buildSessionContext().messages).toEqual(
				harness.session.messages,
			);
		} finally {
			await harness.session.abort();
			harness.cleanup();
		}
	},
);

it.each([
	{ prefill: false, recovery: "prompt" },
	{ prefill: true, recovery: "prompt" },
	{ prefill: false, recovery: "disposal" },
	{ prefill: true, recovery: "disposal" },
] as const)(
	"retains one physical terminal charge across sustained storage outage (prefill $prefill, $recovery)",
	async ({ prefill, recovery }) => {
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			if (prefill) {
				harness.setResponses([fauxAssistantMessage("original prefix", { stopReason: "aborted" })]);
				await harness.session.prompt("original request");
			}
			const before = getUsageTotals(manager.getEntries());
			const model = harness.getModel();
			const terminal: AssistantMessage = {
				...fauxAssistantMessage(prefill ? "original prefix completed" : "ordinary answer"),
				api: model.api,
				provider: model.provider,
				model: model.id,
				responseId: "sustained-outage-physical-response",
				responseModel: "physical-deployment",
				diagnostics: [{ type: "provider-recovery", timestamp: 1, details: { attempt: 2 } }],
				usage: {
					input: 100,
					output: 10,
					cacheRead: 5,
					cacheWrite: 3,
					totalTokens: 118,
					cost: { input: 0.1, output: 0.01, cacheRead: 0.005, cacheWrite: 0.003, total: 0.118 },
				},
			};
			let outage = false;
			const actual = await vi.importActual<typeof fs>("fs");
			vi.mocked(fs.writeFileSync).mockImplementation((...args) => {
				if (outage) throw new Error("sustained session storage outage");
				return actual.writeFileSync(...args);
			});
			vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
				if (outage) throw new Error("sustained session storage outage");
				return actual.appendFileSync(...args);
			});
			vi.mocked(fs.renameSync).mockImplementation((...args) => {
				if (outage) throw new Error("sustained session storage outage");
				return actual.renameSync(...args);
			});
			const off = harness.session.subscribe((event) => {
				if (
					event.type === "message_end" &&
					event.message.role === "assistant" &&
					event.message.responseId === terminal.responseId
				)
					outage = true;
			});
			harness.session.agent.streamFunction = () => {
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: "stop", message: structuredClone(terminal) });
				return stream;
			};
			await expect(
				prefill ? harness.session.continue() : harness.session.prompt("original request"),
			).rejects.toThrow("sustained session storage outage");
			expect(harness.session.isIdle).toBe(true);
			expect(getUsageTotals(manager.getEntries())).toEqual(before);
			expect(() => harness.session.flushPendingUsage()).toThrow("sustained session storage outage");
			off();
			outage = false;
			let recoveredUsage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			if (recovery === "prompt") {
				harness.session.agent.streamFunction = harness.session.modelRuntime.streamSimple.bind(
					harness.session.modelRuntime,
				);
				harness.setResponses([
					(context) => {
						const receipt = SessionManager.open(manager.getSessionFile()!)
							.getEntries()
							.find(
								(entry) =>
									entry.type === "message" &&
									entry.message.role === "assistant" &&
									entry.message.responseId === terminal.responseId,
							);
						expect(receipt).toMatchObject({ message: { usage: terminal.usage } });
						if (prefill) expect(context.messages.map(getMessageText)).toContain("original prefix");
						return fauxAssistantMessage("recovered answer", { responseId: "recovered-request-response" });
					},
				]);
				await harness.session.prompt("recovered request");
				const recovered = manager
					.getEntries()
					.findLast(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "assistant" &&
							entry.message.responseId === "recovered-request-response",
					);
				if (recovered?.type !== "message" || recovered.message.role !== "assistant")
					throw new Error("Missing recovered response");
				recoveredUsage = recovered.message.usage;
			} else {
				const runtime = new AgentSessionRuntime(
					harness.session,
					{
						cwd,
						agentDir: harness.tempDir,
						modelRuntime: harness.session.modelRuntime,
						settingsManager: harness.settingsManager,
						resourceLoader: harness.session.resourceLoader,
						diagnostics: [],
					},
					async () => {
						throw new Error("Disposal must not replace the runtime");
					},
				);
				await runtime.dispose();
			}
			harness.session.flushPendingUsage();
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				const receipts = current
					.getEntries()
					.flatMap((entry) =>
						entry.type === "message" &&
						entry.message.role === "assistant" &&
						entry.message.responseId === terminal.responseId
							? [entry.message]
							: [],
					);
				expect(receipts).toEqual([
					expect.objectContaining({
						api: terminal.api,
						provider: terminal.provider,
						model: terminal.model,
						responseModel: terminal.responseModel,
						diagnostics: terminal.diagnostics,
						usage: terminal.usage,
						content: [{ type: "text", text: "" }],
						stopReason: "error",
					}),
				]);
				expect(getUsageTotals(current.getEntries())).toEqual({
					input: before.input + 100 + recoveredUsage.input,
					output: before.output + 10 + recoveredUsage.output,
					cacheRead: before.cacheRead + 5 + recoveredUsage.cacheRead,
					cacheWrite: before.cacheWrite + 3 + recoveredUsage.cacheWrite,
					cost: expect.closeTo(before.cost + 0.118 + recoveredUsage.cost.total),
				});
				expect(current.buildSessionContext().messages.map(getMessageText)).not.toContain(getMessageText(terminal));
			}
		} finally {
			harness.cleanup();
		}
	},
);

it("does not retain a second terminal charge after the original response committed", async () => {
	const manager = SessionManager.create(cwd, join(cwd, "sessions"));
	const harness = await createHarness({
		cwd,
		sessionManager: manager,
		settings: { retry: { enabled: false }, compaction: { enabled: false } },
	});
	try {
		const terminal = {
			...fauxAssistantMessage("durable answer"),
			responseId: "already-committed",
			usage: {
				input: 17,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 20,
				cost: { input: 0.017, output: 0.003, cacheRead: 0, cacheWrite: 0, total: 0.02 },
			},
		};
		harness.session.agent.streamFunction = () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: terminal });
			return stream;
		};
		const off = harness.session.subscribe((event) => {
			if (event.type === "turn_end") throw new Error("postpublication notification failed");
		});
		await expect(harness.session.prompt("request")).rejects.toThrow("postpublication notification failed");
		off();
		harness.session.flushPendingUsage();
		harness.session.flushPendingUsage();
		for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
			expect(
				current
					.getEntries()
					.filter(
						(entry) =>
							entry.type === "message" &&
							entry.message.role === "assistant" &&
							entry.message.responseId === terminal.responseId,
					),
			).toEqual([expect.objectContaining({ message: terminal })]);
			expect(getUsageTotals(current.getEntries())).toEqual({
				input: 17,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				cost: 0.02,
			});
		}
	} finally {
		harness.cleanup();
	}
});
