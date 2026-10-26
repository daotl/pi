import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage, getCurrentTools } from "@earendil-works/pi-ai";
import type { ExtensionAPI, InputEvent } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, getAssistantTexts, getMessageText, getUserTexts, type Harness } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, appendFileSync: vi.fn(actual.appendFileSync) };
});

async function createWaitingHarness(
	options: {
		tools?: AgentTool[];
		extensionFactories?: Harness["session"]["extensionRunner"] extends never
			? never
			: Array<(pi: ExtensionAPI) => void>;
	} = {},
): Promise<{
	harness: Harness;
	releaseToolExecution: () => void;
	promptPromise: Promise<void>;
	waitForToolStart: Promise<void>;
}> {
	let releaseToolExecution: (() => void) | undefined;
	const toolRelease = new Promise<void>((resolve) => {
		releaseToolExecution = resolve;
	});
	const waitTool: AgentTool = {
		name: "wait",
		label: "Wait",
		description: "Wait for release",
		parameters: Type.Object({}),
		execute: async () => {
			await toolRelease;
			return {
				content: [{ type: "text", text: "released" }],
				details: {},
			};
		},
	};
	const harness = await createHarness({
		tools: [waitTool, ...(options.tools ?? [])],
		extensionFactories: options.extensionFactories,
	});

	const waitForToolStart = new Promise<void>((resolve) => {
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "tool_execution_start" && event.toolName === "wait") {
				unsubscribe();
				resolve();
			}
		});
	});

	return {
		harness,
		releaseToolExecution: () => releaseToolExecution?.(),
		promptPromise: harness.session.prompt("start"),
		waitForToolStart,
	};
}

describe("AgentSession queue characterization", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("dispatches extension commands immediately when prompted while idle", async () => {
		const commandRuns: string[] = [];
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("testcmd", {
						description: "Test command",
						handler: async (args) => {
							commandRuns.push(args);
						},
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("/testcmd hello world");

		expect(commandRuns).toEqual(["hello world"]);
		expect(harness.getPendingResponseCount()).toBe(0);
		expect(harness.session.messages).toEqual([]);
	});

	it("delivers extension-origin steering messages before the next LLM call", async () => {
		let extensionApi: ExtensionAPI | undefined;
		const waiting = await createWaitingHarness({
			extensionFactories: [
				(pi) => {
					extensionApi = pi;
				},
			],
		});
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				const sawSteer = context.messages.some(
					(message) => message.role === "user" && getMessageText(message) === "steer now",
				);
				return fauxAssistantMessage(sawSteer ? "saw steer" : "missing steer");
			},
		]);

		await waitForToolStart;
		await new Promise((resolve) => setTimeout(resolve, 0));

		extensionApi?.sendUserMessage("steer now", { deliverAs: "steer" });
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "steer now"]);
		expect(getAssistantTexts(harness)).toContain("saw steer");
	});

	it("delivers follow-up messages only after the current run finishes", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		const assistantSeenBeforeFollowUp: string[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				assistantSeenBeforeFollowUp.push(
					...context.messages
						.filter((message) => message.role === "assistant")
						.map((message) =>
							message.content
								.filter((part): part is { type: "text"; text: string } => part.type === "text")
								.map((part) => part.text)
								.join("\n"),
						),
				);
				return fauxAssistantMessage("follow-up response");
			},
		]);

		await waitForToolStart;
		await harness.session.followUp("after current run");
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "after current run"]);
		expect(assistantSeenBeforeFollowUp).toContain("");
		expect(getAssistantTexts(harness)).toContain("follow-up response");
	});

	// Regression test for #8718.
	it("runs direct steering and follow-up messages through input handlers", async () => {
		const inputEvents: Array<Pick<InputEvent, "text" | "source" | "streamingBehavior">> = [];
		const waiting = await createWaitingHarness({
			extensionFactories: [
				(pi) => {
					pi.on("input", (event) => {
						inputEvents.push({
							text: event.text,
							source: event.source,
							streamingBehavior: event.streamingBehavior,
						});
						if (event.text.startsWith("handle")) return { action: "handled" };
						return { action: "transform", text: `transformed: ${event.text}` };
					});
				},
			],
		});
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("steered"),
			fauxAssistantMessage("followed up"),
		]);

		await waitForToolStart;
		inputEvents.length = 0;
		try {
			await harness.session.steer("steer me", undefined, { source: "rpc" });
			await harness.session.steer("handle steer", undefined, { source: "rpc" });
			await harness.session.followUp("follow me", undefined, { source: "rpc" });
			await harness.session.followUp("handle follow", undefined, { source: "rpc" });

			expect(inputEvents).toEqual([
				{ text: "steer me", source: "rpc", streamingBehavior: "steer" },
				{ text: "handle steer", source: "rpc", streamingBehavior: "steer" },
				{ text: "follow me", source: "rpc", streamingBehavior: "followUp" },
				{ text: "handle follow", source: "rpc", streamingBehavior: "followUp" },
			]);
			expect(harness.session.getSteeringMessages()).toEqual(["transformed: steer me"]);
			expect(harness.session.getFollowUpMessages()).toEqual(["transformed: follow me"]);
		} finally {
			releaseToolExecution();
		}
		await promptPromise;
	});

	it("delivers multiple steering messages in order in one-at-a-time mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("handled steer 1"),
			fauxAssistantMessage("handled steer 2"),
		]);

		await waitForToolStart;
		await harness.session.steer("steer 1");
		await harness.session.steer("steer 2");
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "steer 1", "steer 2"]);
		expect(getAssistantTexts(harness)).toEqual(["", "handled steer 1", "handled steer 2"]);
	});

	it("delivers multiple follow-up messages in order in one-at-a-time mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("original turn complete"),
			fauxAssistantMessage("handled follow-up 1"),
			fauxAssistantMessage("handled follow-up 2"),
		]);

		await waitForToolStart;
		await harness.session.followUp("follow-up 1");
		await harness.session.followUp("follow-up 2");
		releaseToolExecution();
		await promptPromise;

		expect(getUserTexts(harness)).toEqual(["start", "follow-up 1", "follow-up 2"]);
		expect(getAssistantTexts(harness)).toEqual([
			"",
			"original turn complete",
			"handled follow-up 1",
			"handled follow-up 2",
		]);
	});

	it("delivers all steering messages in one batch in all mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		harness.session.setSteeringMode("all");
		let batchedUserMessages: string[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				batchedUserMessages = context.messages
					.filter((message) => message.role === "user")
					.map((message) => getMessageText(message));
				return fauxAssistantMessage("batched steer response");
			},
		]);

		await waitForToolStart;
		await harness.session.steer("steer 1");
		await harness.session.steer("steer 2");
		releaseToolExecution();
		await promptPromise;

		expect(batchedUserMessages).toEqual(["start", "steer 1", "steer 2"]);
		expect(getAssistantTexts(harness)).toEqual(["", "batched steer response"]);
	});

	it("delivers all follow-up messages in one batch in all mode", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		harness.session.setFollowUpMode("all");
		let batchedUserMessages: string[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("original turn complete"),
			(context) => {
				batchedUserMessages = context.messages
					.filter((message) => message.role === "user")
					.map((message) => getMessageText(message));
				return fauxAssistantMessage("batched follow-up response");
			},
		]);

		await waitForToolStart;
		await harness.session.followUp("follow-up 1");
		await harness.session.followUp("follow-up 2");
		releaseToolExecution();
		await promptPromise;

		expect(batchedUserMessages).toEqual(["start", "follow-up 1", "follow-up 2"]);
		expect(getAssistantTexts(harness)).toEqual(["", "original turn complete", "batched follow-up response"]);
	});

	it("queues custom messages with deliverAs steer while streaming", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		let sawCustomMessage = false;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			(context) => {
				sawCustomMessage = context.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content !== "string" &&
						message.content.some((part) => part.type === "text" && part.text === "steer custom"),
				);
				return fauxAssistantMessage("done");
			},
		]);

		await waitForToolStart;
		await harness.session.sendCustomMessage(
			{ customType: "queue-test", content: "steer custom", display: true, details: { value: 1 } },
			{ deliverAs: "steer" },
		);
		releaseToolExecution();
		await promptPromise;

		expect(sawCustomMessage).toBe(true);
		expect(
			harness.session.messages.some((message) => message.role === "custom" && message.customType === "queue-test"),
		).toBe(true);
	});

	it("queues custom messages with deliverAs followUp while streaming", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		let sawCustomMessage = false;

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("original turn complete"),
			(context) => {
				sawCustomMessage = context.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content !== "string" &&
						message.content.some((part) => part.type === "text" && part.text === "follow-up custom"),
				);
				return fauxAssistantMessage("done");
			},
		]);

		await waitForToolStart;
		await harness.session.sendCustomMessage(
			{ customType: "queue-test", content: "follow-up custom", display: true, details: { value: 1 } },
			{ deliverAs: "followUp" },
		);
		releaseToolExecution();
		await promptPromise;

		expect(sawCustomMessage).toBe(true);
		expect(
			harness.session.messages.some((message) => message.role === "custom" && message.customType === "queue-test"),
		).toBe(true);
	});

	it("injects nextTurn custom messages into the next prompt", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		let sawCustomMessage = false;

		await harness.session.sendCustomMessage(
			{ customType: "next-turn", content: "carry this", display: true, details: {} },
			{ deliverAs: "nextTurn" },
		);

		harness.setResponses([
			(context) => {
				sawCustomMessage = context.messages.some(
					(message) =>
						message.role === "user" &&
						typeof message.content !== "string" &&
						message.content.some((part) => part.type === "text" && part.text === "carry this"),
				);
				return fauxAssistantMessage("done");
			},
		]);

		await harness.session.prompt("normal prompt");

		expect(sawCustomMessage).toBe(true);
		expect(harness.session.messages.map((message) => message.role)).toEqual([
			"system",
			"user",
			"custom",
			"assistant",
		]);
	});

	it("retains nextTurn context across rejected receipt admissions without consuming later callback messages", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-next-turn-receipt-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						if (event.messageType !== "user") return;
						return { message: { customType: "hook", content: `hook: ${event.prompt}`, display: false } };
					});
				},
			],
		});
		const actual = await vi.importActual<typeof fs>("fs");
		let writable = false;
		let receiptFailures = 0;
		const requests: string[][] = [];
		const dispositions: string[] = [];
		const reentrantAttempts: Promise<void>[] = [];
		const queue = (content: string) =>
			harness.session.sendCustomMessage(
				{ customType: "next-turn", content, display: true, details: { content } },
				{ deliverAs: "nextTurn" },
			);
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
					return fauxAssistantMessage("recovered answer");
				},
				(context) => {
					requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
					return fauxAssistantMessage("later answer");
				},
			]);
			vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
				const record = JSON.parse(String(args[1])) as { type: string; kind?: string };
				if (record.type === "compaction") throw new Error("checkpoint storage unavailable");
				if (record.type === "usage" && record.kind === "compaction" && !writable) {
					receiptFailures++;
					throw new Error("summary receipt storage unavailable");
				}
				return actual.appendFileSync(...args);
			});
			await expect(harness.session.compact({ keepRecentMessages: 1 })).rejects.toThrow(
				"checkpoint storage unavailable",
			);
			expect(receiptFailures).toBe(1);
			await queue("accepted first");
			for (const text of ["rejected first", "rejected second"]) {
				await expect(
					harness.session.prompt(text, { preflightResult: (value) => dispositions.push(value) }),
				).rejects.toThrow("summary receipt storage unavailable");
				if (text === "rejected first") await queue("accepted second");
			}
			expect(receiptFailures).toBe(3);
			expect(dispositions).toEqual([]);
			expect(requests).toEqual([]);
			expect(harness.eventsOfType("agent_start")).toEqual([]);
			expect(getUserTexts(harness)).toEqual(["question 0", "question 1", "question 2"]);
			harness.session.subscribe((event) => {
				if (event.type === "entry_appended" && event.entry.type === "usage") {
					expect(harness.session.isStreaming).toBe(true);
					reentrantAttempts.push(
						expect(harness.session.prompt("reentrant receipt prompt")).rejects.toThrow(
							"Agent is already processing.",
						),
					);
					void queue("queued during receipt");
				}
			});
			writable = true;
			await harness.session.prompt("recovered prompt", {
				preflightResult: (value) => {
					dispositions.push(value);
					reentrantAttempts.push(
						expect(harness.session.prompt("reentrant admission prompt")).rejects.toThrow(
							"Agent is already processing.",
						),
					);
					void queue("queued during admission");
				},
			});
			await Promise.all(reentrantAttempts);
			expect(requests[0].slice(-4)).toEqual([
				"recovered prompt",
				"accepted first",
				"accepted second",
				"hook: recovered prompt",
			]);
			expect(dispositions).toEqual(["started"]);
			await harness.session.prompt("later prompt");
			expect(requests[1].slice(-4)).toEqual([
				"later prompt",
				"queued during receipt",
				"queued during admission",
				"hook: later prompt",
			]);
			const reopened = SessionManager.open(manager.getSessionFile()!);
			expect(
				reopened.getEntries().filter((entry) => entry.type === "usage" && entry.kind === "compaction"),
			).toHaveLength(1);
			expect(
				reopened.getEntries().flatMap((entry) => (entry.type === "custom_message" ? [entry.content] : [])),
			).toEqual([
				"accepted first",
				"accepted second",
				"hook: recovered prompt",
				"queued during receipt",
				"queued during admission",
				"hook: later prompt",
			]);
		} finally {
			vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("preserves accepted discovery and tools after a receipt-rejected prompt before untrusted continuation", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-policy-receipt-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", (event) => {
						if (event.messageType !== "user") return;
						const rejected = event.prompt === "rejected candidate";
						event.systemPromptOptions.selectedTools = rejected ? [] : ["read"];
						event.systemPromptOptions.sections.mcp_servers = rejected
							? "REJECTED DISCOVERY"
							: "ACCEPTED DISCOVERY";
					});
				},
			],
		});
		const actual = await vi.importActual<typeof fs>("fs");
		let writable = false;
		const dispositions: string[] = [];
		try {
			harness.settingsManager.setProjectTrusted(false);
			harness.setResponses([
				fauxAssistantMessage("earlier answer"),
				fauxAssistantMessage("accepted prefix", { stopReason: "aborted" }),
				fauxAssistantMessage("completed summary"),
			]);
			await harness.session.prompt("earlier question");
			await harness.session.prompt("accepted question");
			const acceptedLeaf = manager.getLeafId();
			const beforeRejected = structuredClone(manager.getEntries());
			const starts = harness.eventsOfType("agent_start").length;
			vi.mocked(fs.appendFileSync).mockImplementation((...args) => {
				const record = JSON.parse(String(args[1])) as { type: string; kind?: string };
				if (!writable && record.type === "compaction") throw new Error("checkpoint storage unavailable");
				if (!writable && record.type === "usage" && record.kind === "compaction") {
					throw new Error("summary receipt storage unavailable");
				}
				return actual.appendFileSync(...args);
			});
			await expect(harness.session.compact({ keepRecentMessages: 1 })).rejects.toThrow(
				"checkpoint storage unavailable",
			);
			expect(harness.faux.state.callCount).toBe(3);
			await expect(
				harness.session.prompt("rejected candidate", { preflightResult: (value) => dispositions.push(value) }),
			).rejects.toThrow("summary receipt storage unavailable");
			expect(harness.faux.state.callCount).toBe(3);
			expect(harness.eventsOfType("agent_start")).toHaveLength(starts);
			expect(dispositions).toEqual([]);
			expect(manager.getLeafId()).toBe(acceptedLeaf);
			expect(manager.getEntries()).toEqual(beforeRejected);
			writable = true;
			let discovery: string | null | undefined;
			let tools: string[] = [];
			harness.setResponses([
				(context) => {
					discovery = getCurrentSystemMessage(context.messages)?.sections?.mcp_servers;
					tools = getCurrentTools(context.messages).map((tool) => tool.name);
					return fauxAssistantMessage("accepted prefix completed");
				},
			]);
			await harness.session.continue();
			expect(discovery).toBe("<mcp_servers>\nACCEPTED DISCOVERY\n</mcp_servers>");
			expect(tools).toEqual(["read"]);
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				const messages = current.buildSessionContext().messages;
				expect(getCurrentSystemMessage(messages)?.sections?.mcp_servers).toBe(discovery);
				expect(getCurrentTools(messages).map((tool) => tool.name)).toEqual(["read"]);
				expect(messages.filter((message) => message.role === "user").map(getMessageText)).toEqual([
					"earlier question",
					"accepted question",
				]);
			}
		} finally {
			vi.mocked(fs.appendFileSync).mockImplementation(actual.appendFileSync);
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("does not replay dispatched nextTurn context after a run rejects", async () => {
		const harness = await createHarness({ settings: { compaction: { enabled: false } } });
		harnesses.push(harness);
		await harness.session.sendCustomMessage(
			{ customType: "next-turn", content: "already dispatched", display: true, details: {} },
			{ deliverAs: "nextTurn" },
		);
		const unsubscribe = harness.session.subscribe((event) => {
			if (event.type === "agent_end") throw new Error("run completion listener failed");
		});
		harness.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);
		await expect(harness.session.prompt("first prompt")).rejects.toThrow("run completion listener failed");
		unsubscribe();
		await harness.session.prompt("second prompt");
		expect(
			harness.sessionManager
				.getEntries()
				.flatMap((entry) => (entry.type === "custom_message" ? [entry.content] : [])),
		).toEqual(["already dispatched"]);
		expect(getUserTexts(harness)).toEqual(["first prompt", "second prompt"]);
	});

	it("updates pendingMessageCount and removes queued text before message_start is emitted", async () => {
		const waiting = await createWaitingHarness();
		const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
		harnesses.push(harness);
		const countsAtQueuedMessageStart: number[] = [];

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		harness.session.subscribe((event) => {
			if (
				event.type === "message_start" &&
				event.message.role === "user" &&
				getMessageText(event.message) === "queued"
			) {
				countsAtQueuedMessageStart.push(harness.session.pendingMessageCount);
			}
		});

		await waitForToolStart;
		await harness.session.steer("queued");
		expect(harness.session.pendingMessageCount).toBe(1);
		releaseToolExecution();
		await promptPromise;

		expect(countsAtQueuedMessageStart).toEqual([0]);
		expect(harness.session.pendingMessageCount).toBe(0);
	});

	it("throws when queueing an extension command with steer", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("testcmd", {
						description: "Test command",
						handler: async () => {},
					});
				},
			],
		});
		harnesses.push(harness);

		await expect(harness.session.steer("/testcmd queued")).rejects.toThrow(
			'Extension command "/testcmd" cannot be queued. Use prompt() or execute the command when not streaming.',
		);
	});

	it("throws when queueing an extension command with followUp", async () => {
		const harness = await createHarness({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("testcmd", {
						description: "Test command",
						handler: async () => {},
					});
				},
			],
		});
		harnesses.push(harness);

		await expect(harness.session.followUp("/testcmd queued")).rejects.toThrow(
			'Extension command "/testcmd" cannot be queued. Use prompt() or execute the command when not streaming.',
		);
	});

	it("delivers follow-ups queued during agent_end", async () => {
		let sent = false;
		const harness = await createHarness({
			extensionFactories: [
				(pi: ExtensionAPI) => {
					pi.on("agent_end", async () => {
						if (sent) return;
						sent = true;
						pi.sendUserMessage("conflict report", { deliverAs: "followUp" });
					});
				},
			],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("reply"), fauxAssistantMessage("follow-up reply")]);

		await harness.session.prompt("hello");
		await harness.session.agent.waitForIdle();

		expect(getUserTexts(harness)).toEqual(["hello", "conflict report"]);
	});
});
