import { setImmediate } from "node:timers/promises";
import { type AssistantMessage, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { isPadLinesToWidth, isWrapLinesToWidth, setPadLinesToWidth, setWrapLinesToWidth } from "@earendil-works/pi-tui";
import { expect, it, type MockInstance, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../../src/core/agent-session-services.ts";
import type { TreeSelectorComponent } from "../../src/modes/interactive/components/tree-selector.ts";
import {
	type HeartbeatEntry,
	InteractiveMode,
	type ScheduledMessage,
} from "../../src/modes/interactive/interactive-mode.ts";
import {
	isMessageBackground,
	isMessageSeparator,
	setMessageBackground,
	setMessageSeparator,
} from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, getMessageText, type HarnessOptions } from "./harness.ts";

async function createSchedulingMode(options: HarnessOptions = {}) {
	const previous = {
		pad: isPadLinesToWidth(),
		wrap: isWrapLinesToWidth(),
		background: isMessageBackground(),
		separator: isMessageSeparator(),
	};
	const harness = await createHarness({
		settings: { quietStartup: true, compaction: { enabled: false }, retry: { enabled: false } },
		...options,
	});
	harness.sessionManager.appendMessage({ role: "user", content: "original context", timestamp: 1 });
	harness.session.refreshContext();
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
	const mode = new InteractiveMode(runtime, { terminal });
	const internal = mode as unknown as {
		handleScheduleCommand(text: string): Promise<void>;
		fireDueScheduledMessages(): void;
		fireScheduledMessage(id: number): void;
		countScheduledMessageEvent(message: AssistantMessage): void;
		deferOrRunScheduledAction(entry: ScheduledMessage): void;
		clearScheduledMessages(): void;
		handleHeartbeatCommand(text: string): Promise<void>;
		tickHeartbeats(): void;
		fireHeartbeat(id: number): void;
		clearHeartbeats(): void;
		markActivity(): void;
		heartbeats: HeartbeatEntry[];
		editor: { getText(): string };
		queueCompactionMessage(text: string, mode: "steer" | "followUp"): void;
		flushCompactionQueue(options?: { willRetry?: boolean }): Promise<void>;
		compactionQueuedMessages: Array<{ text: string; mode: "steer" | "followUp" }>;
		scheduledMessages: ScheduledMessage[];
		deferredScheduledActions: ScheduledMessage[];
		showTreeSelector(initialSelectedId?: string): void;
		showExtensionSelector(): Promise<string | undefined>;
		editorContainer: { children: unknown[] };
		defaultEditor: { onEscape?: () => void; setText(text: string): void; getText(): string };
		activeStatusIndicator?: { kind: string };
	};
	return {
		harness,
		mode,
		runtime,
		internal,
		terminal,
		cleanup: async () => {
			internal.clearScheduledMessages();
			internal.clearHeartbeats();
			await runtime.session.abort();
			await runtime.session.waitForIdle();
			mode.stop();
			await runtime.dispose();
			harness.cleanup();
			vi.useRealTimers();
			setPadLinesToWidth(previous.pad);
			setWrapLinesToWidth(previous.wrap);
			setMessageBackground(previous.background);
			setMessageSeparator(previous.separator);
		},
	};
}

it("holds due work through shutdown abort settlement and resumes once after rejection", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const shutdownError = new Error("retained receipt unavailable");
	const ui = await createSchedulingMode();
	const requests: string[] = [];
	ui.harness.setResponses([
		async () => {
			entered.resolve();
			await release.promise;
			return fauxAssistantMessage("initial answer", { stopReason: "aborted" });
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("scheduled answer");
		},
	]);
	const shutdownMode = ui.mode as unknown as { shutdown(): Promise<void>; isShuttingDown: boolean };
	const flush = vi.spyOn(ui.harness.session, "flushPendingUsage").mockImplementationOnce(() => {
		throw shutdownError;
	});
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("initial request");
		await entered.promise;
		await ui.internal.handleScheduleCommand("\nretained after abort");
		const shutdown = shutdownMode.shutdown();
		await setImmediate();
		expect(shutdownMode.isShuttingDown).toBe(true);
		expect(requests).toEqual([]);
		release.resolve();
		await running;
		await shutdown;
		await vi.waitFor(() => expect(requests).toEqual(["retained after abort"]));
		await ui.harness.session.waitForIdle();
		expect(ui.internal.scheduledMessages).toEqual([]);
	} finally {
		release.resolve();
		flush.mockRestore();
		await running?.catch(() => {});
		await ui.cleanup();
	}
});

it.each(["handled input", "/handled", "rejected edit", "no-op deferred edit"] as const)(
	"advances no-run %s once and never consumes settled work during an active run",
	async (kind) => {
		const handled: string[] = [];
		const ui = await createSchedulingMode({
			extensionFactories: [
				(pi) => {
					pi.registerCommand("handled", {
						handler: async () => {
							handled.push("/handled");
						},
					});
					pi.on("input", (event) => {
						if (event.text === "handled input") {
							handled.push(event.text);
							return { action: "handled" };
						}
					});
				},
			],
		});
		const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
		const requests: string[] = [];
		ui.harness.setResponses([
			async () => {
				requests.push("start");
				await gates[0].promise;
				return fauxAssistantMessage("initial answer");
			},
			async (context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				await gates[1].promise;
				return fauxAssistantMessage("second answer");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("third answer");
			},
		]);
		let running: Promise<void> | undefined;
		try {
			await ui.mode.init();
			running = ui.harness.session.prompt("start");
			await vi.waitFor(() => expect(requests).toEqual(["start"]));
			if (kind === "no-op deferred edit") {
				await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">allocated edit</pi_edit>');
				const entry = ui.internal.scheduledMessages.pop();
				if (!entry) throw new Error("Missing allocated scheduled edit");
				ui.internal.deferOrRunScheduledAction({ ...entry, text: "not an edit" });
			} else
				await ui.internal.handleScheduleCommand(
					`\n${kind === "rejected edit" ? '<pi_edit id="99" role="user">invalid</pi_edit>' : kind}`,
				);
			await ui.internal.handleScheduleCommand("\nsecond scheduled");
			await ui.internal.handleScheduleCommand("\nthird scheduled");
			ui.internal.fireDueScheduledMessages();
			ui.internal.fireDueScheduledMessages();
			await setImmediate();
			expect(requests).toEqual(["start"]);
			expect(handled).toEqual([]);
			expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
			gates[0].resolve();
			await running;
			await vi.waitFor(() => expect(requests).toEqual(["start", "second scheduled"]));
			ui.internal.fireDueScheduledMessages();
			ui.internal.fireDueScheduledMessages();
			await setImmediate();
			expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
			if (kind === "handled input" || kind === "/handled") expect(handled).toEqual([kind]);
			gates[1].resolve();
			await vi.waitFor(() => expect(requests).toEqual(["start", "second scheduled", "third scheduled"]));
			await ui.harness.session.waitForIdle();
		} finally {
			for (const gate of gates) gate.resolve();
			await running?.catch(() => {});
			await ui.cleanup();
		}
	},
);

it("retains first settled delivery across asynchronous prompt preflight", async () => {
	const preflight = Promise.withResolvers<void>();
	const entered = Promise.withResolvers<void>();
	const inputs: string[] = [];
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("input", (event) => {
					inputs.push(event.text);
				});
				pi.on("before_agent_start", async (event) => {
					if (event.prompt === "first scheduled") {
						entered.resolve();
						await preflight.promise;
					}
				});
			},
		],
	});
	const initial = Promise.withResolvers<void>();
	const scheduled = Promise.withResolvers<void>();
	const requests: string[] = [];
	ui.harness.setResponses([
		async () => {
			requests.push("start");
			await initial.promise;
			return fauxAssistantMessage("initial");
		},
		async (context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			await scheduled.promise;
			return fauxAssistantMessage("scheduled");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("last");
		},
	]);
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("start");
		await vi.waitFor(() => expect(requests).toEqual(["start"]));
		await ui.internal.handleScheduleCommand("\nfirst scheduled");
		await ui.internal.handleScheduleCommand("\nsecond scheduled");
		initial.resolve();
		await running;
		await entered.promise;
		ui.internal.fireDueScheduledMessages();
		ui.internal.fireDueScheduledMessages();
		await setImmediate();
		expect(inputs).toEqual(["start", "first scheduled"]);
		expect(requests).toEqual(["start"]);
		preflight.resolve();
		await vi.waitFor(() => expect(requests).toEqual(["start", "first scheduled"]));
		expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
		scheduled.resolve();
		await vi.waitFor(() => expect(requests).toEqual(["start", "first scheduled", "second scheduled"]));
		await ui.harness.session.waitForIdle();
	} finally {
		initial.resolve();
		preflight.resolve();
		scheduled.resolve();
		await running?.catch(() => {});
		await ui.cleanup();
	}
});

it("orders eligible reverse timer arrivals and intervening settled work by creation ID", async () => {
	const inputs: string[] = [];
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("input", (event) => {
					inputs.push(event.text);
				});
			},
		],
	});
	const gates = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
	const requests: string[][] = [];
	ui.harness.setResponses(
		gates.map((gate, index) => async (context) => {
			requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
			await gate.promise;
			return fauxAssistantMessage(`answer ${index}`);
		}),
	);
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("start");
		await vi.waitFor(() => expect(requests).toHaveLength(1));
		vi.useFakeTimers({ toFake: ["Date"] });
		await ui.internal.handleScheduleCommand('2s\n<pi_edit id="-1" role="user">first created edit</pi_edit>');
		await ui.internal.handleScheduleCommand("\nsecond created message");
		await ui.internal.handleScheduleCommand('1s\n<pi_edit id="-1" role="user">third created edit</pi_edit>');
		vi.setSystemTime(Date.now() + 2000);
		ui.internal.fireScheduledMessage(3);
		ui.internal.fireScheduledMessage(1);
		vi.useRealTimers();
		gates[0].resolve();
		await running;
		await vi.waitFor(() => expect(requests).toHaveLength(2));
		expect(requests[1]).toEqual(["original context", "start", "first created edit"]);
		ui.internal.fireDueScheduledMessages();
		ui.internal.fireDueScheduledMessages();
		await setImmediate();
		expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
		expect(inputs).toEqual(["start"]);
		gates[1].resolve();
		await vi.waitFor(() => expect(requests).toHaveLength(3));
		expect(requests[2]).toEqual(["original context", "start", "first created edit", "second created message"]);
		gates[2].resolve();
		await vi.waitFor(() => expect(requests).toHaveLength(4));
		expect(requests[3]).toEqual([
			"original context",
			"start",
			"first created edit",
			"second created message",
			"third created edit",
		]);
		gates[3].resolve();
		await ui.harness.session.waitForIdle();
	} finally {
		for (const gate of gates) gate.resolve();
		await running?.catch(() => {});
		await ui.cleanup();
	}
});

it("does not release a held scheduled preflight when an unrelated run settles", async () => {
	const entered = Promise.withResolvers<void>();
	const preflight = Promise.withResolvers<void>();
	const inputs: string[] = [];
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("input", (event) => {
					inputs.push(event.text);
				});
				pi.on("before_agent_start", async (event) => {
					if (event.prompt === "first scheduled") {
						entered.resolve();
						await preflight.promise;
					}
				});
			},
		],
	});
	const initial = Promise.withResolvers<void>();
	const requests: string[] = [];
	ui.harness.setResponses([
		async () => {
			requests.push("start");
			await initial.promise;
			return fauxAssistantMessage("initial");
		},
		(context) => {
			const text = context.messages
				.filter((message) => message.role === "user")
				.map(getMessageText)
				.at(-1)!;
			requests.push(text);
			return fauxAssistantMessage(`answer ${text}`);
		},
		(context) => {
			const text = context.messages
				.filter((message) => message.role === "user")
				.map(getMessageText)
				.at(-1)!;
			requests.push(text);
			return fauxAssistantMessage(`answer ${text}`);
		},
		(context) => {
			const text = context.messages
				.filter((message) => message.role === "user")
				.map(getMessageText)
				.at(-1)!;
			requests.push(text);
			return fauxAssistantMessage(`answer ${text}`);
		},
	]);
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("start");
		await vi.waitFor(() => expect(requests).toEqual(["start"]));
		await ui.internal.handleScheduleCommand("\nfirst scheduled");
		await ui.internal.handleScheduleCommand("\nsecond scheduled");
		initial.resolve();
		await running;
		await entered.promise;
		await ui.harness.session.prompt("foreign run");
		await setImmediate();
		expect(inputs).toEqual(["start", "first scheduled", "foreign run"]);
		expect(requests).toEqual(["start", "foreign run"]);
		preflight.resolve();
		await vi.waitFor(() => expect(requests).toEqual(["start", "foreign run", "first scheduled", "second scheduled"]));
		await ui.harness.session.waitForIdle();
	} finally {
		initial.resolve();
		preflight.resolve();
		await running?.catch(() => {});
		await ui.cleanup();
	}
});

it("advances after a foreign-run fallback is handled without another run", async () => {
	const entered = Promise.withResolvers<void>();
	const preflight = Promise.withResolvers<void>();
	const fallback = Promise.withResolvers<void>();
	const fallbackRelease = Promise.withResolvers<void>();
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", async (event) => {
					if (event.prompt === "first scheduled") {
						entered.resolve();
						await preflight.promise;
					}
				});
				pi.on("input", async (event) => {
					if (event.text === "first scheduled" && event.streamingBehavior === "followUp") {
						fallback.resolve();
						await fallbackRelease.promise;
						return { action: "handled" };
					}
				});
			},
		],
	});
	const initial = Promise.withResolvers<void>();
	const foreign = Promise.withResolvers<void>();
	const requests: string[] = [];
	ui.harness.setResponses([
		async () => {
			requests.push("start");
			await initial.promise;
			return fauxAssistantMessage("initial");
		},
		async () => {
			requests.push("foreign run");
			await foreign.promise;
			return fauxAssistantMessage("foreign");
		},
		(context) => {
			const text = context.messages
				.filter((message) => message.role === "user")
				.map(getMessageText)
				.at(-1)!;
			requests.push(text);
			return fauxAssistantMessage("scheduled");
		},
	]);
	let initialRun: Promise<void> | undefined;
	let foreignRun: Promise<void> | undefined;
	try {
		await ui.mode.init();
		initialRun = ui.harness.session.prompt("start");
		await vi.waitFor(() => expect(requests).toEqual(["start"]));
		await ui.internal.handleScheduleCommand("\nfirst scheduled");
		await ui.internal.handleScheduleCommand("\nsecond scheduled");
		initial.resolve();
		await initialRun;
		await entered.promise;
		foreignRun = ui.harness.session.prompt("foreign run");
		await vi.waitFor(() => expect(requests).toEqual(["start", "foreign run"]));
		preflight.resolve();
		await fallback.promise;
		foreign.resolve();
		await foreignRun;
		await setImmediate();
		expect(requests).toEqual(["start", "foreign run"]);
		expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
		fallbackRelease.resolve();
		await vi.waitFor(() => expect(requests).toEqual(["start", "foreign run", "second scheduled"]));
		await ui.harness.session.waitForIdle();
	} finally {
		initial.resolve();
		preflight.resolve();
		fallbackRelease.resolve();
		foreign.resolve();
		await initialRun?.catch(() => {});
		await foreignRun?.catch(() => {});
		await ui.cleanup();
	}
});

it.each(["started", "handled"] as const)("retains compaction queue ownership through %s preflight", async (outcome) => {
	const entered = Promise.withResolvers<void>();
	const preflight = Promise.withResolvers<void>();
	const response = Promise.withResolvers<void>();
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("input", async (event) => {
					if (event.text === "queued ordinary" && outcome === "handled") {
						entered.resolve();
						await preflight.promise;
						return { action: "handled" };
					}
				});
				pi.on("before_agent_start", async (event) => {
					if (event.prompt === "queued ordinary" && outcome === "started") {
						entered.resolve();
						await preflight.promise;
					}
				});
			},
		],
	});
	const requests: string[] = [];
	ui.harness.setResponses([
		async (context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			await response.promise;
			return fauxAssistantMessage("queued response");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("scheduled response");
		},
	]);
	let delivery: Promise<void> | undefined;
	try {
		await ui.mode.init();
		ui.internal.queueCompactionMessage("queued ordinary", "followUp");
		delivery = ui.internal.flushCompactionQueue({ willRetry: false });
		await entered.promise;
		await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">scheduled edit</pi_edit>');
		ui.internal.fireDueScheduledMessages();
		await setImmediate();
		expect(requests).toEqual([]);
		expect(ui.harness.session.messages.map(getMessageText)).not.toContain("scheduled edit");
		preflight.resolve();
		await vi.waitFor(() => expect(requests).toEqual([outcome === "started" ? "queued ordinary" : "scheduled edit"]));
		response.resolve();
		await delivery;
		await vi.waitFor(() =>
			expect(requests).toEqual(outcome === "started" ? ["queued ordinary", "scheduled edit"] : ["scheduled edit"]),
		);
		await ui.harness.session.waitForIdle();
	} finally {
		preflight.resolve();
		response.resolve();
		await delivery?.catch(() => {});
		await ui.cleanup();
	}
});

it("drains input added during owned preflight before deferred schedules", async () => {
	const queuedEntered = Promise.withResolvers<void>();
	const queuedGate = Promise.withResolvers<void>();
	const response = Promise.withResolvers<void>();
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", async (event) => {
					if (event.prompt === "first queued") {
						queuedEntered.resolve();
						await queuedGate.promise;
					}
				});
			},
		],
	});
	const requests: string[] = [];
	let delivery: Promise<void> | undefined;
	try {
		await ui.mode.init();
		ui.harness.setResponses([fauxAssistantMessage("seed response")]);
		await ui.harness.session.prompt("seed request");
		ui.harness.setResponses([
			async (context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				await response.promise;
				return fauxAssistantMessage("first response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("second response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("scheduled response");
			},
		]);
		ui.internal.queueCompactionMessage("first queued", "followUp");
		delivery = ui.internal.flushCompactionQueue({ willRetry: false });
		await queuedEntered.promise;
		ui.internal.queueCompactionMessage("second queued", "followUp");
		await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after nested queue</pi_edit>');
		queuedGate.resolve();
		await vi.waitFor(() => expect(requests).toEqual(["first queued"]));
		response.resolve();
		await delivery;
		await vi.waitFor(() => expect(requests).toEqual(["first queued", "second queued", "after nested queue"]));
		await ui.harness.session.waitForIdle();
	} finally {
		queuedGate.resolve();
		response.resolve();
		await delivery?.catch(() => {});
		await ui.cleanup();
	}
});

it("retains a rejected queue batch ahead of newer input without dispatching its rest", async () => {
	const entered = Promise.withResolvers<void>();
	const gate = Promise.withResolvers<void>();
	const inputs: string[] = [];
	const ui = await createSchedulingMode({
		withConfiguredAuth: false,
		extensionFactories: [
			(pi) => {
				pi.on("input", async (event) => {
					inputs.push(event.text);
					if (event.text === "rejected first") {
						entered.resolve();
						await gate.promise;
					}
				});
			},
		],
	});
	let delivery: Promise<void> | undefined;
	const errors = vi.spyOn(ui.mode as unknown as { showError(text: string): void }, "showError");
	const auth = vi.spyOn(ui.harness.session.modelRuntime, "checkAuth");
	try {
		await ui.mode.init();
		ui.internal.queueCompactionMessage("rejected first", "followUp");
		ui.internal.queueCompactionMessage("original rest", "followUp");
		delivery = ui.internal.flushCompactionQueue();
		await entered.promise;
		ui.internal.queueCompactionMessage("newer input", "followUp");
		await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">must remain scheduled</pi_edit>');
		auth.mockRejectedValueOnce(new Error("injected queued authentication failure"));
		gate.resolve();
		await delivery;
		await setImmediate();
		expect(inputs).toEqual(["rejected first"]);
		expect(ui.internal.compactionQueuedMessages.map((entry) => entry.text)).toEqual([
			"rejected first",
			"original rest",
			"newer input",
		]);
		expect(errors.mock.calls.map(([text]) => text)).toEqual([
			expect.stringContaining("Failed to send queued messages: injected queued authentication failure"),
		]);
		ui.internal.fireDueScheduledMessages();
		await setImmediate();
		expect(ui.harness.session.messages.map(getMessageText)).not.toContain("must remain scheduled");
		expect(ui.harness.session.isIdle).toBe(true);
		auth.mockResolvedValue({ type: "api_key" });
		const requests: string[] = [];
		ui.harness.setResponses(
			Array.from({ length: 4 }, () => (context) => {
				const text = context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!;
				requests.push(text);
				return fauxAssistantMessage(`completed ${text}`);
			}),
		);
		await ui.internal.flushCompactionQueue();
		await vi.waitFor(() =>
			expect(requests).toEqual(["rejected first", "original rest", "newer input", "must remain scheduled"]),
		);
		await ui.harness.session.waitForIdle();
		expect(ui.internal.compactionQueuedMessages).toEqual([]);
	} finally {
		gate.resolve();
		await delivery?.catch(() => {});
		auth.mockRestore();
		errors.mockRestore();
		await ui.cleanup();
	}
});

it("preserves queued steering while a real agent run is active", async () => {
	const ui = await createSchedulingMode();
	const response = Promise.withResolvers<void>();
	const requests: string[] = [];
	ui.harness.setResponses([
		async () => {
			requests.push("start");
			await response.promise;
			return fauxAssistantMessage("initial");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("redirected");
		},
	]);
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("start");
		await vi.waitFor(() => expect(requests).toEqual(["start"]));
		ui.internal.queueCompactionMessage("change direction", "steer");
		await ui.internal.flushCompactionQueue({ willRetry: false });
		expect(ui.harness.session.getSteeringMessages()).toEqual(["change direction"]);
		expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
		response.resolve();
		await running;
		expect(requests).toEqual(["start", "change direction"]);
		expect(ui.harness.session.getLastAssistantText()).toBe("redirected");
	} finally {
		response.resolve();
		await running?.catch(() => {});
		await ui.cleanup();
	}
});

it("keeps a child queue delivery owned after its scheduled extension command returns handled", async () => {
	const entered = Promise.withResolvers<void>();
	const preflight = Promise.withResolvers<void>();
	const response = Promise.withResolvers<void>();
	const initial = Promise.withResolvers<void>();
	let startChild: () => void = () => {
		throw new Error("Child dispatcher not installed");
	};
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.registerCommand("flush-child", {
					handler: async () => {
						startChild();
					},
				});
				pi.on("before_agent_start", async (event) => {
					if (event.prompt === "child queued input") {
						entered.resolve();
						await preflight.promise;
					}
				});
			},
		],
	});
	let child: Promise<void> | undefined;
	startChild = () => {
		ui.internal.queueCompactionMessage("child queued input", "followUp");
		child = ui.internal.flushCompactionQueue();
	};
	const requests: string[] = [];
	ui.harness.setResponses([
		async () => {
			requests.push("seed parent run");
			await initial.promise;
			return fauxAssistantMessage("seed parent response");
		},
		async (context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			await response.promise;
			return fauxAssistantMessage("child response");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("next response");
		},
	]);
	let initialRun: Promise<void> | undefined;
	try {
		await ui.mode.init();
		initialRun = ui.harness.session.prompt("seed parent run");
		await vi.waitFor(() => expect(requests).toEqual(["seed parent run"]));
		await ui.internal.handleScheduleCommand("\n/flush-child");
		await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after child queue</pi_edit>');
		initial.resolve();
		await initialRun;
		await entered.promise;
		await setImmediate();
		ui.internal.fireDueScheduledMessages();
		await setImmediate();
		expect(requests).toEqual(["seed parent run"]);
		expect(ui.harness.session.messages.map(getMessageText)).not.toContain("after child queue");
		preflight.resolve();
		await vi.waitFor(() => expect(requests).toEqual(["seed parent run", "child queued input"]));
		response.resolve();
		await child;
		await vi.waitFor(() => expect(requests).toEqual(["seed parent run", "child queued input", "after child queue"]));
		await ui.harness.session.waitForIdle();
	} finally {
		initial.resolve();
		preflight.resolve();
		response.resolve();
		await child?.catch(() => {});
		await initialRun?.catch(() => {});
		await ui.cleanup();
	}
});

it("stops an outgoing queue batch after its command replaces the runtime", async () => {
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.registerCommand("replace-runtime", {
					handler: async (_args, context) => {
						await context.newSession();
					},
				});
			},
		],
	});
	const outgoingInputs: string[] = [];
	ui.harness.setResponses([
		(context) => {
			outgoingInputs.push(...context.messages.filter((message) => message.role === "user").map(getMessageText));
			return fauxAssistantMessage("unexpected outgoing response");
		},
	]);
	try {
		await ui.mode.init();
		const outgoing = ui.harness.session;
		ui.internal.queueCompactionMessage("/replace-runtime", "followUp");
		ui.internal.queueCompactionMessage("stale outgoing input", "followUp");
		await ui.internal.flushCompactionQueue();
		expect(ui.runtime.session).not.toBe(outgoing);
		expect(outgoingInputs).toEqual([]);
		expect(outgoing.messages.map(getMessageText)).not.toContain("stale outgoing input");
		expect(ui.runtime.session.messages.map(getMessageText)).not.toContain("stale outgoing input");
		expect(ui.internal.compactionQueuedMessages).toEqual([]);
	} finally {
		await ui.cleanup();
	}
});

it.each(
	(["interval", "daily"] as const).flatMap((schedule) =>
		(["started", "handled", "rejected"] as const).map((outcome) => ({ schedule, outcome })),
	),
)(
	"excludes settled work through $schedule heartbeat $outcome preflight after typing",
	async ({ schedule, outcome }) => {
		const entered = Promise.withResolvers<void>();
		const preflight = Promise.withResolvers<void>();
		const response = Promise.withResolvers<void>();
		const ui = await createSchedulingMode({
			withConfiguredAuth: outcome !== "rejected",
			extensionFactories: [
				(pi) => {
					pi.on("input", async (event) => {
						if (event.text === "owning heartbeat" && outcome !== "started") {
							entered.resolve();
							await preflight.promise;
							if (outcome === "handled") return { action: "handled" };
						}
					});
					pi.on("before_agent_start", async (event) => {
						if (event.prompt === "owning heartbeat" && outcome === "started") {
							entered.resolve();
							await preflight.promise;
						}
					});
				},
			],
		});
		const requests: string[] = [];
		ui.harness.setResponses([
			async (context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				await response.promise;
				return fauxAssistantMessage("first response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("scheduled response");
			},
		]);
		const auth = outcome === "rejected" ? vi.spyOn(ui.harness.session.modelRuntime, "checkAuth") : undefined;
		try {
			await ui.mode.init();
			await ui.internal.handleHeartbeatCommand(`${schedule === "interval" ? "5m" : "12:01"}\nowning heartbeat`);
			const heartbeat = ui.internal.heartbeats[0];
			if (schedule === "interval") {
				const now = Date.now();
				vi.useFakeTimers({ toFake: ["Date"] });
				vi.setSystemTime(now - 301_000);
				ui.internal.markActivity();
				vi.setSystemTime(now);
				ui.internal.tickHeartbeats();
				vi.useRealTimers();
			} else {
				ui.internal.fireHeartbeat(heartbeat.id);
				expect(heartbeat.nextFireAt).toBeGreaterThan(Date.now());
				const next = new Date(heartbeat.nextFireAt!);
				expect([next.getHours(), next.getMinutes(), next.getSeconds()]).toEqual([12, 1, 0]);
				expect(heartbeat.timer).toBeDefined();
			}
			await entered.promise;
			ui.terminal.sendInput("unsent draft");
			expect(ui.internal.editor.getText()).toBe("unsent draft");
			await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after heartbeat</pi_edit>');
			ui.internal.fireDueScheduledMessages();
			await setImmediate();
			expect(requests).toEqual([]);
			expect(ui.harness.session.messages.map(getMessageText)).not.toContain("after heartbeat");
			auth?.mockResolvedValue({ type: "api_key" }).mockRejectedValueOnce(new Error("heartbeat auth rejected"));
			preflight.resolve();
			await vi.waitFor(() =>
				expect(requests).toEqual([outcome === "started" ? "owning heartbeat" : "after heartbeat"]),
			);
			response.resolve();
			await vi.waitFor(() =>
				expect(requests).toEqual(
					outcome === "started" ? ["owning heartbeat", "after heartbeat"] : ["after heartbeat"],
				),
			);
			await ui.harness.session.waitForIdle();
		} finally {
			preflight.resolve();
			response.resolve();
			auth?.mockRestore();
			await ui.cleanup();
		}
	},
);

it.each(["started", "handled", "rejected"] as const)(
	"retains heartbeat exclusion while foreign-run fallback is held then %s",
	async (outcome) => {
		const entered = Promise.withResolvers<void>();
		const preflight = Promise.withResolvers<void>();
		const fallback = Promise.withResolvers<void>();
		const fallbackRelease = Promise.withResolvers<void>();
		const foreign = Promise.withResolvers<void>();
		const requests: string[] = [];
		const ui = await createSchedulingMode({
			withConfiguredAuth: outcome !== "rejected",
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", async (event) => {
						if (event.prompt === "reserved heartbeat") {
							entered.resolve();
							await preflight.promise;
						}
					});
					pi.on("input", async (event) => {
						if (event.text === "reserved heartbeat" && event.streamingBehavior === "followUp") {
							fallback.resolve();
							await fallbackRelease.promise;
							if (outcome === "handled") return { action: "handled" };
						}
					});
				},
			],
		});
		ui.harness.setResponses([
			async () => {
				requests.push("foreign user");
				await foreign.promise;
				return fauxAssistantMessage("foreign response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("heartbeat response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("scheduled response");
			},
		]);
		let running: Promise<void> | undefined;
		const auth = vi.spyOn(ui.harness.session.modelRuntime, "checkAuth").mockResolvedValue({ type: "api_key" });
		try {
			await ui.mode.init();
			await ui.internal.handleHeartbeatCommand("12:01\nreserved heartbeat");
			ui.internal.fireHeartbeat(ui.internal.heartbeats[0].id);
			await entered.promise;
			running = ui.harness.session.prompt("foreign user");
			await vi.waitFor(() => expect(requests).toEqual(["foreign user"]));
			preflight.resolve();
			await fallback.promise;
			await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after reserved heartbeat</pi_edit>');
			foreign.resolve();
			await running;
			await setImmediate();
			expect(requests).toEqual(["foreign user"]);
			expect(ui.harness.session.messages.map(getMessageText)).not.toContain("after reserved heartbeat");
			if (outcome === "rejected") auth.mockRejectedValueOnce(new Error("fallback authentication rejected"));
			fallbackRelease.resolve();
			await vi.waitFor(() =>
				expect(requests).toEqual(
					outcome !== "started"
						? ["foreign user", "after reserved heartbeat"]
						: ["foreign user", "reserved heartbeat", "after reserved heartbeat"],
				),
			);
			await ui.harness.session.waitForIdle();
		} finally {
			preflight.resolve();
			fallbackRelease.resolve();
			foreign.resolve();
			await running?.catch(() => {});
			auth.mockRestore();
			await ui.cleanup();
		}
	},
);

it("preserves other interval deadlines through a heartbeat-owned run and serves the most overdue next", async () => {
	const ui = await createSchedulingMode();
	const response = Promise.withResolvers<void>();
	const requests: string[] = [];
	ui.harness.setResponses([
		async (context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			await response.promise;
			return fauxAssistantMessage("short response");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("long response");
		},
	]);
	try {
		await ui.mode.init();
		await ui.internal.handleHeartbeatCommand("1m\nshort beat");
		await ui.internal.handleHeartbeatCommand("5m\nlong beat");
		const now = Date.now();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(now - 301_000);
		ui.internal.markActivity();
		vi.setSystemTime(now);
		ui.internal.tickHeartbeats();
		vi.useRealTimers();
		await vi.waitFor(() => expect(requests).toEqual(["short beat"]));
		const longDeadline = ui.internal.heartbeats[1].nextFireAt;
		ui.internal.tickHeartbeats();
		expect(ui.internal.heartbeats[1].nextFireAt).toBe(longDeadline);
		response.resolve();
		await ui.harness.session.waitForIdle();
		ui.internal.tickHeartbeats();
		await vi.waitFor(() => expect(requests).toEqual(["short beat", "long beat"]));
		await ui.harness.session.waitForIdle();
	} finally {
		response.resolve();
		await ui.cleanup();
	}
});

it.each(
	(["interval", "daily"] as const).flatMap((schedule) =>
		(["started", "no-op"] as const).map((outcome) => ({ schedule, outcome })),
	),
)("hands off a bare $schedule heartbeat with $outcome continuation", async ({ schedule, outcome }) => {
	const ui = await createSchedulingMode();
	const response = Promise.withResolvers<void>();
	const requests: string[] = [];
	if (outcome === "no-op") {
		ui.harness.sessionManager.appendMessage(fauxAssistantMessage("completed answer"));
		ui.harness.session.refreshContext();
	}
	ui.harness.setResponses([
		async (context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			await response.promise;
			return fauxAssistantMessage(outcome === "started" ? "heartbeat continued" : "scheduled after no-op");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("after bare response");
		},
	]);
	try {
		await ui.mode.init();
		await ui.internal.handleHeartbeatCommand(schedule === "interval" ? "5m" : "12:01");
		if (schedule === "interval") {
			const now = Date.now();
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(now - 301_000);
			ui.internal.markActivity();
			vi.setSystemTime(now);
			ui.internal.tickHeartbeats();
			vi.useRealTimers();
		} else {
			const heartbeat = ui.internal.heartbeats[0];
			ui.internal.fireHeartbeat(heartbeat.id);
			expect(heartbeat.nextFireAt).toBeGreaterThan(Date.now());
			expect(heartbeat.timer).toBeDefined();
		}
		await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after bare heartbeat</pi_edit>');
		if (outcome === "started") {
			await vi.waitFor(() => expect(requests).toEqual(["original context"]));
			ui.internal.fireDueScheduledMessages();
			await setImmediate();
			expect(ui.harness.session.messages.map(getMessageText)).not.toContain("after bare heartbeat");
			response.resolve();
			await vi.waitFor(() => expect(requests).toEqual(["original context", "after bare heartbeat"]));
		} else {
			await vi.waitFor(() => expect(requests).toEqual(["after bare heartbeat"]));
			response.resolve();
		}
		await ui.harness.session.waitForIdle();
		expect(ui.harness.session.getLastAssistantText()).toBe(
			outcome === "started" ? "after bare response" : "scheduled after no-op",
		);
	} finally {
		response.resolve();
		await ui.cleanup();
	}
});

it("chooses the most overdue interval rather than array or interval order", async () => {
	const ui = await createSchedulingMode();
	const response = Promise.withResolvers<void>();
	const requests: string[] = [];
	ui.harness.setResponses([
		async (context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			await response.promise;
			return fauxAssistantMessage("overdue response");
		},
	]);
	try {
		await ui.mode.init();
		await ui.internal.handleHeartbeatCommand("1m\nfirst array beat");
		await ui.internal.handleHeartbeatCommand("5m\nmost overdue beat");
		const now = Date.now();
		ui.internal.heartbeats[0].nextFireAt = now - 1000;
		ui.internal.heartbeats[1].nextFireAt = now - 2000;
		ui.internal.tickHeartbeats();
		await vi.waitFor(() => expect(requests).toEqual(["most overdue beat"]));
		response.resolve();
		await ui.harness.session.waitForIdle();
	} finally {
		response.resolve();
		await ui.cleanup();
	}
});

it("ignores a stopped heartbeat's late handled outcome", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("input", async (event) => {
					if (event.text === "outgoing heartbeat") {
						entered.resolve();
						await release.promise;
						return { action: "handled" };
					}
				});
			},
		],
	});
	try {
		await ui.mode.init();
		await ui.internal.handleHeartbeatCommand("12:01\noutgoing heartbeat");
		ui.internal.fireHeartbeat(ui.internal.heartbeats[0].id);
		await entered.promise;
		ui.mode.stop();
		release.resolve();
		await setImmediate();
		await setImmediate();
		expect(ui.internal.heartbeats).toEqual([]);
		expect(ui.harness.session.messages.filter((message) => message.role === "user").map(getMessageText)).toEqual([
			"original context",
		]);
		expect(ui.internal.scheduledMessages).toEqual([]);
	} finally {
		release.resolve();
		await ui.cleanup();
	}
});

it("releases heartbeat preflight when a settlement-deferred prompt later rejects", async () => {
	const settledEntered = Promise.withResolvers<void>();
	const settledRelease = Promise.withResolvers<void>();
	let heldOnce = false;
	const ui = await createSchedulingMode({
		withConfiguredAuth: false,
		extensionFactories: [
			(pi) => {
				pi.on("agent_settled", async () => {
					if (heldOnce) return;
					heldOnce = true;
					settledEntered.resolve();
					await settledRelease.promise;
				});
			},
		],
	});
	const auth = vi.spyOn(ui.harness.session.modelRuntime, "checkAuth").mockResolvedValue({ type: "api_key" });
	const requests: string[] = [];
	ui.harness.setResponses([
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("seed");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("after rejected heartbeat");
		},
	]);
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("seed request");
		const outcome = running.then(
			() => undefined,
			(error: unknown) => error,
		);
		await settledEntered.promise;
		await ui.internal.handleHeartbeatCommand("12:01\ndeferred heartbeat");
		ui.internal.fireHeartbeat(ui.internal.heartbeats[0].id);
		await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after deferred rejection</pi_edit>');
		auth.mockRejectedValueOnce(new Error("deferred heartbeat authentication failed"));
		settledRelease.resolve();
		expect(await outcome).toBeInstanceOf(Error);
		await setImmediate();
		await vi.waitFor(() => expect(requests).toEqual(["seed request", "after deferred rejection"]));
		await ui.harness.session.waitForIdle();
	} finally {
		settledRelease.resolve();
		await running?.catch(() => {});
		auth.mockRestore();
		await ui.cleanup();
	}
});

it.each(["time", "messages"] as const)(
	"orders direct %s deliveries behind an owning prompt preflight",
	async (trigger) => {
		const entered = Promise.withResolvers<void>();
		const preflight = Promise.withResolvers<void>();
		const response = Promise.withResolvers<void>();
		const editResponse = Promise.withResolvers<void>();
		const inputs: string[] = [];
		const ui = await createSchedulingMode({
			extensionFactories: [
				(pi) => {
					pi.on("input", (event) => {
						inputs.push(event.text);
					});
					pi.on("before_agent_start", async (event) => {
						if (event.prompt === "first direct") {
							entered.resolve();
							await preflight.promise;
						}
					});
				},
			],
		});
		const requests: string[] = [];
		ui.harness.setResponses([
			async (context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				await response.promise;
				return fauxAssistantMessage("first direct response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("second direct response");
			},
			async (context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				await editResponse.promise;
				return fauxAssistantMessage("edited response");
			},
		]);
		const makeDue = () => {
			if (trigger === "messages")
				ui.internal.countScheduledMessageEvent(fauxAssistantMessage("trigger contribution"));
			else {
				vi.setSystemTime(Date.now() + 1);
				for (const entry of [...ui.internal.scheduledMessages])
					if (entry.when.type === "time") ui.internal.fireScheduledMessage(entry.id);
			}
		};
		try {
			await ui.mode.init();
			vi.useFakeTimers({ toFake: ["Date"] });
			await ui.internal.handleScheduleCommand(`${trigger === "time" ? "0.001s" : "1"}\nfirst direct`);
			makeDue();
			vi.useRealTimers();
			await entered.promise;
			vi.useFakeTimers({ toFake: ["Date"] });
			await ui.internal.handleScheduleCommand(`${trigger === "time" ? "0.001s" : "1"}\nsecond direct`);
			await ui.internal.handleScheduleCommand(
				`${trigger === "time" ? "0.001s" : "1"}\n<pi_edit id="-1" role="user">direct edited context</pi_edit>`,
			);
			makeDue();
			vi.useRealTimers();
			await setImmediate();
			expect(requests).toEqual([]);
			expect(inputs).toEqual(["first direct"]);
			expect(ui.harness.session.messages.map(getMessageText)).not.toContain("direct edited context");
			preflight.resolve();
			await vi.waitFor(() => expect(requests).toEqual(["first direct"]));
			expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
			response.resolve();
			await vi.waitFor(() => expect(requests).toEqual(["first direct", "second direct", "direct edited context"]));
			ui.internal.fireDueScheduledMessages();
			await setImmediate();
			expect(ui.harness.session.isStreaming).toBe(true);
			editResponse.resolve();
			await ui.harness.session.waitForIdle();
			expect(ui.harness.session.getLastAssistantText()).toBe("edited response");
		} finally {
			preflight.resolve();
			response.resolve();
			editResponse.resolve();
			vi.useRealTimers();
			await ui.cleanup();
		}
	},
);

it("keeps a due ordinary message as follow-up during a genuinely active run", async () => {
	const ui = await createSchedulingMode();
	const response = Promise.withResolvers<void>();
	const requests: string[] = [];
	ui.harness.setResponses([
		async () => {
			requests.push("active seed");
			await response.promise;
			return fauxAssistantMessage("seed completed");
		},
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("ordinary follow-up completed");
		},
	]);
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("active seed");
		await vi.waitFor(() => expect(requests).toEqual(["active seed"]));
		await ui.internal.handleScheduleCommand("1\nordinary due message");
		ui.internal.countScheduledMessageEvent(fauxAssistantMessage("count trigger"));
		await vi.waitFor(() => expect(ui.harness.session.getFollowUpMessages()).toEqual(["ordinary due message"]));
		expect(ui.harness.session.getSteeringMessages()).toEqual([]);
		expect(requests).toEqual(["active seed"]);
		response.resolve();
		await running;
		expect(requests).toEqual(["active seed", "ordinary due message"]);
		expect(ui.harness.session.getLastAssistantText()).toBe("ordinary follow-up completed");
	} finally {
		response.resolve();
		await running?.catch(() => {});
		await ui.cleanup();
	}
});

it.each(
	(["selector", "extension"] as const).flatMap((navigation) =>
		(["success", "cancel", "failure"] as const).flatMap((outcome) =>
			(["continue", "edit"] as const).map((action) => ({ navigation, outcome, action })),
		),
	),
)("wakes due $action after $navigation navigation $outcome and UI cleanup", async ({ navigation, outcome, action }) => {
	const summaryEntered = Promise.withResolvers<void>();
	const summaryGate = Promise.withResolvers<void>();
	const responseGate = Promise.withResolvers<void>();
	const ui = await createSchedulingMode({
		fauxApi: "openai-completions",
		extensionFactories: [
			(pi) => {
				pi.registerCommand("visit", {
					handler: async (target, context) => {
						await context.navigateTree(target, { summarize: true });
					},
				});
				pi.on("session_before_tree", async () => {
					summaryEntered.resolve();
					await summaryGate.promise;
					if (outcome === "cancel") return { cancel: true };
					if (outcome === "success") return { summary: { summary: "departed branch summary" } };
				});
			},
		],
	});
	ui.harness.sessionManager.appendMessage(fauxAssistantMessage("root answer"));
	const target = ui.harness.sessionManager.getLeafId()!;
	ui.harness.sessionManager.appendMessage({ role: "user", content: "departed request", timestamp: 2 });
	ui.harness.sessionManager.appendMessage(fauxAssistantMessage("departed partial", { stopReason: "length" }));
	ui.harness.session.refreshContext();
	expect(target).not.toBe(ui.harness.sessionManager.getLeafId());
	const requests: string[][] = [];
	const atDispatch: Array<{ escape?: () => void; indicator?: string }> = [];
	let navigationRun: Promise<void> | undefined;
	let summaryChoice: ReturnType<typeof vi.spyOn> | undefined;
	let errors: MockInstance<(text: string) => void> | undefined;
	let extensionErrors: MockInstance<(path: string, text: string) => void> | undefined;
	try {
		await ui.mode.init();
		const originalEscape = ui.internal.defaultEditor.onEscape;
		errors = vi.spyOn(ui.mode as unknown as { showError(text: string): void }, "showError");
		extensionErrors = vi.spyOn(
			ui.mode as unknown as { showExtensionError(path: string, text: string): void },
			"showExtensionError",
		);
		summaryChoice = vi.spyOn(ui.internal, "showExtensionSelector").mockResolvedValue("Summarize");
		ui.harness.setResponses([
			...(outcome === "failure"
				? [fauxAssistantMessage("", { stopReason: "error", errorMessage: "summary provider failed" })]
				: []),
			async (context) => {
				requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
				atDispatch.push({
					escape: ui.internal.defaultEditor.onEscape,
					indicator: ui.internal.activeStatusIndicator?.kind,
				});
				await responseGate.promise;
				return fauxAssistantMessage(
					action === "continue" && outcome !== "success"
						? "departed partial continued"
						: "scheduled navigation response",
				);
			},
		]);
		if (navigation === "extension") navigationRun = ui.harness.session.prompt(`/visit ${target}`);
		else {
			ui.internal.showTreeSelector(target);
			const selector = ui.internal.editorContainer.children.find(
				(child) => typeof child === "object" && child !== null && "getTreeList" in child,
			) as TreeSelectorComponent | undefined;
			if (!selector) throw new Error("Expected mounted real tree selector");
			navigationRun = Promise.resolve(selector.getTreeList().onSelect!(target));
		}
		await summaryEntered.promise;
		expect(ui.harness.session.isCompacting).toBe(true);
		await ui.internal.handleScheduleCommand(
			`1\n${action === "edit" ? '<pi_edit id="-1" role="user">scheduled branch edit</pi_edit>' : ""}`,
		);
		ui.internal.countScheduledMessageEvent(fauxAssistantMessage("meaningful due contribution"));
		ui.internal.defaultEditor.setText("unsent navigation draft");
		expect(requests).toEqual([]);
		summaryGate.resolve();
		await navigationRun;
		if (outcome === "success") {
			expect(
				ui.harness.sessionManager
					.getBranch()
					.some((entry) => entry.type === "branch_summary" && entry.summary === "departed branch summary"),
			).toBe(true);
		} else {
			expect(ui.harness.session.messages.map(getMessageText)).toContain("departed request");
			expect(ui.harness.sessionManager.getBranch().some((entry) => entry.type === "branch_summary")).toBe(false);
			if (outcome === "failure") {
				const diagnostics = [
					...(errors?.mock.calls.map(([text]) => String(text)) ?? []),
					...(extensionErrors?.mock.calls.map(([, text]) => String(text)) ?? []),
				];
				expect(diagnostics.join("\n")).toContain("summary provider failed");
			}
		}
		await vi.waitFor(() => expect(requests).toHaveLength(1));
		expect(atDispatch[0].escape).toBe(originalEscape);
		expect(atDispatch[0].indicator).not.toBe("branchSummary");
		if (action === "continue" && outcome === "success") {
			expect(requests[0]).toContain("original context");
			expect(requests[0].at(-1)).toContain("departed branch summary");
			expect(requests[0]).not.toContain("scheduled branch edit");
		} else expect(requests[0].at(-1)).toBe(action === "edit" ? "scheduled branch edit" : "departed request");
		responseGate.resolve();
		await ui.harness.session.waitForIdle();
		expect(ui.internal.defaultEditor.getText()).toBe("unsent navigation draft");
	} finally {
		summaryGate.resolve();
		responseGate.resolve();
		await navigationRun?.catch(() => {});
		summaryChoice?.mockRestore();
		errors?.mockRestore();
		extensionErrors?.mockRestore();
		await ui.cleanup();
	}
});

it("does not flush another navigation's queued input when a second extension navigation is rejected", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const inputs: string[] = [];
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.registerCommand("visit-busy", {
					handler: async (target, context) => {
						await context.navigateTree(target, { summarize: true });
					},
				});
				pi.on("session_before_tree", async () => {
					entered.resolve();
					await release.promise;
					return { cancel: true };
				});
				pi.on("input", (event) => {
					inputs.push(event.text);
				});
			},
		],
	});
	ui.harness.sessionManager.appendMessage(fauxAssistantMessage("earlier target"));
	const target = ui.harness.sessionManager.getLeafId()!;
	ui.harness.sessionManager.appendMessage({ role: "user", content: "later branch", timestamp: 2 });
	ui.harness.session.refreshContext();
	const requests: string[] = [];
	ui.harness.setResponses([
		(context) => {
			requests.push(
				context.messages
					.filter((message) => message.role === "user")
					.map(getMessageText)
					.at(-1)!,
			);
			return fauxAssistantMessage("queued navigation result");
		},
	]);
	let first: Promise<void> | undefined;
	try {
		await ui.mode.init();
		first = ui.harness.session.prompt(`/visit-busy ${target}`);
		await entered.promise;
		ui.internal.queueCompactionMessage("queued under first navigation", "followUp");
		await ui.harness.session.prompt(`/visit-busy ${target}`);
		await setImmediate();
		expect(ui.harness.session.isCompacting).toBe(true);
		expect(inputs).toEqual([]);
		expect(requests).toEqual([]);
		expect(ui.internal.compactionQueuedMessages.map((entry) => entry.text)).toEqual([
			"queued under first navigation",
		]);
		release.resolve();
		await first;
		await vi.waitFor(() => expect(requests).toEqual(["queued under first navigation"]));
		await ui.harness.session.waitForIdle();
		expect(inputs).toEqual(["queued under first navigation"]);
	} finally {
		release.resolve();
		await first?.catch(() => {});
		await ui.cleanup();
	}
});

it.each(["external", "settlement handler"] as const)(
	"keeps queue delivery owned when %s defers its first prompt",
	async (origin) => {
		const settlementEntered = Promise.withResolvers<void>();
		const handlerEntered = Promise.withResolvers<void>();
		let flushReturned = false;
		const settlementRelease = Promise.withResolvers<void>();
		const preflightEntered = Promise.withResolvers<void>();
		const preflightRelease = Promise.withResolvers<void>();
		const response = Promise.withResolvers<void>();
		let settlementHeld = false;
		let flushFromHandler: (() => Promise<void>) | undefined;
		const ui = await createSchedulingMode({
			extensionFactories: [
				(pi) => {
					pi.on("agent_settled", async () => {
						if (settlementHeld) return;
						settlementHeld = true;
						handlerEntered.resolve();
						if (origin === "settlement handler") await flushFromHandler!();
						settlementEntered.resolve();
						await settlementRelease.promise;
					});
					pi.on("before_agent_start", async (event) => {
						if (event.prompt === "settlement queued input") {
							preflightEntered.resolve();
							await preflightRelease.promise;
						}
					});
				},
			],
		});
		const requests: string[] = [];
		ui.harness.setResponses([
			() => {
				requests.push("seed");
				return fauxAssistantMessage("seed response");
			},
			async (context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				await response.promise;
				return fauxAssistantMessage("queued response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("rest response");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("scheduled response");
			},
		]);
		let running: Promise<void> | undefined;
		let delivery: Promise<void> | undefined;
		try {
			await ui.mode.init();
			flushFromHandler = async () => {
				ui.internal.queueCompactionMessage("settlement queued input", "followUp");
				ui.internal.queueCompactionMessage("settlement batch rest", "followUp");
				delivery = ui.internal.flushCompactionQueue();
				await delivery;
				flushReturned = true;
			};
			running = ui.harness.session.prompt("seed");
			await handlerEntered.promise;
			if (origin === "settlement handler") await vi.waitFor(() => expect(flushReturned).toBe(true));
			await settlementEntered.promise;
			if (origin === "external") await flushFromHandler();
			await setImmediate();
			await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after settlement queue</pi_edit>');
			await setImmediate();
			expect(ui.harness.session.messages.map(getMessageText)).not.toContain("after settlement queue");
			settlementRelease.resolve();
			await preflightEntered.promise;
			ui.internal.fireDueScheduledMessages();
			await setImmediate();
			expect(requests).toEqual(["seed"]);
			expect(ui.harness.session.messages.map(getMessageText)).not.toContain("after settlement queue");
			expect(ui.harness.session.getFollowUpMessages()).toEqual([]);
			preflightRelease.resolve();
			await vi.waitFor(() => expect(requests).toEqual(["seed", "settlement queued input"]));
			await vi.waitFor(() => expect(ui.harness.session.getFollowUpMessages()).toEqual(["settlement batch rest"]));
			expect(requests).toEqual(["seed", "settlement queued input"]);
			response.resolve();
			await running;
			await delivery;
			await vi.waitFor(() =>
				expect(requests).toEqual([
					"seed",
					"settlement queued input",
					"settlement batch rest",
					"after settlement queue",
				]),
			);
			await ui.harness.session.waitForIdle();
		} finally {
			settlementRelease.resolve();
			preflightRelease.resolve();
			response.resolve();
			await running?.catch(() => {});
			await delivery?.catch(() => {});
			await ui.cleanup();
		}
	},
);

it("retains queue ownership through actual nested compaction and drains newer input before schedules", async () => {
	const compactEntered = Promise.withResolvers<void>();
	const compactRelease = Promise.withResolvers<void>();
	const response = Promise.withResolvers<void>();
	let compact: (() => Promise<void>) | undefined;
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("before_agent_start", async (event) => {
					if (event.prompt === "nested first input") await compact!();
				});
				pi.on("session_before_compact", async () => {
					compactEntered.resolve();
					await compactRelease.promise;
					return { cancel: true };
				});
			},
		],
	});
	let delivery: Promise<void> | undefined;
	const requests: string[] = [];
	try {
		await ui.mode.init();
		ui.harness.setResponses([fauxAssistantMessage("seed completed")]);
		await ui.harness.session.prompt("seed input");
		compact = async () => {
			await ui.harness.session.compact({ keepRecentMessages: 1 }).catch((error: unknown) => {
				if (!(error instanceof Error) || error.message !== "Compaction cancelled") throw error;
			});
		};
		ui.harness.setResponses([
			async (context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				await response.promise;
				return fauxAssistantMessage("first completed");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("second completed");
			},
			(context) => {
				requests.push(
					context.messages
						.filter((message) => message.role === "user")
						.map(getMessageText)
						.at(-1)!,
				);
				return fauxAssistantMessage("scheduled completed");
			},
		]);
		ui.internal.queueCompactionMessage("nested first input", "followUp");
		delivery = ui.internal.flushCompactionQueue();
		await compactEntered.promise;
		expect(ui.harness.session.isCompacting).toBe(true);
		ui.internal.queueCompactionMessage("nested second input", "followUp");
		await ui.internal.handleScheduleCommand('\n<pi_edit id="-1" role="user">after nested compaction</pi_edit>');
		compactRelease.resolve();
		await vi.waitFor(() => expect(requests).toEqual(["nested first input"]));
		expect(ui.harness.session.messages.map(getMessageText)).not.toContain("after nested compaction");
		response.resolve();
		await delivery;
		await vi.waitFor(() =>
			expect(requests).toEqual(["nested first input", "nested second input", "after nested compaction"]),
		);
		await ui.harness.session.waitForIdle();
		expect(ui.harness.eventsOfType("compaction_end").at(-1)?.aborted).toBe(true);
	} finally {
		compactRelease.resolve();
		response.resolve();
		await delivery?.catch(() => {});
		await ui.cleanup();
	}
});

it("restores a settlement-deferred rejected batch ahead of newer input", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let held = false;
	const inputs: string[] = [];
	const ui = await createSchedulingMode({
		withConfiguredAuth: false,
		extensionFactories: [
			(pi) => {
				pi.on("agent_settled", async () => {
					if (!held) {
						held = true;
						entered.resolve();
						await release.promise;
					}
				});
				pi.on("input", (event) => {
					inputs.push(event.text);
				});
			},
		],
	});
	const auth = vi.spyOn(ui.harness.session.modelRuntime, "checkAuth").mockResolvedValue({ type: "api_key" });
	const errors = vi.spyOn(ui.mode as unknown as { showError(text: string): void }, "showError");
	ui.harness.setResponses([fauxAssistantMessage("seed response")]);
	let running: Promise<void> | undefined;
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("seed input");
		const outcome = running.then(
			() => undefined,
			(error: unknown) => error,
		);
		await entered.promise;
		ui.internal.queueCompactionMessage("deferred rejected input", "followUp");
		ui.internal.queueCompactionMessage("original deferred rest", "followUp");
		await ui.internal.flushCompactionQueue();
		ui.internal.queueCompactionMessage("newer deferred input", "followUp");
		auth.mockRejectedValueOnce(new Error("deferred queue auth failed"));
		release.resolve();
		expect(await outcome).toBeInstanceOf(Error);
		await vi.waitFor(() =>
			expect(ui.internal.compactionQueuedMessages.map((entry) => entry.text)).toEqual([
				"deferred rejected input",
				"original deferred rest",
				"newer deferred input",
			]),
		);
		expect(inputs).toEqual(["seed input", "deferred rejected input"]);
		expect(errors.mock.calls.map(([text]) => text)).toEqual([
			"Failed to send queued messages: deferred queue auth failed",
		]);
		expect(ui.harness.session.isIdle).toBe(true);
	} finally {
		release.resolve();
		await running?.catch(() => {});
		auth.mockRestore();
		errors.mockRestore();
		await ui.cleanup();
	}
});

it("restores a deferred queue batch when an earlier deferred prompt aborts settlement", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let held = false;
	const ui = await createSchedulingMode({
		withConfiguredAuth: false,
		extensionFactories: [
			(pi) => {
				pi.on("agent_settled", async () => {
					if (!held) {
						held = true;
						entered.resolve();
						await release.promise;
					}
				});
			},
		],
	});
	const auth = vi.spyOn(ui.harness.session.modelRuntime, "checkAuth").mockResolvedValue({ type: "api_key" });
	const errors = vi.spyOn(ui.mode as unknown as { showError(text: string): void }, "showError");
	ui.harness.setResponses([fauxAssistantMessage("seed response")]);
	let running: Promise<void> | undefined;
	const original = new Error("earlier deferred auth failed");
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("seed input");
		const outcome = running.then(
			() => undefined,
			(error: unknown) => error,
		);
		await entered.promise;
		await ui.harness.session.prompt("earlier rejected deferred input");
		ui.internal.queueCompactionMessage("discarded deferred queue input", "followUp");
		await ui.internal.flushCompactionQueue();
		auth.mockRejectedValueOnce(original);
		release.resolve();
		expect(await outcome).toBe(original);
		await vi.waitFor(() =>
			expect(ui.internal.compactionQueuedMessages.map((entry) => entry.text)).toEqual([
				"discarded deferred queue input",
			]),
		);
		expect(errors.mock.calls.map(([text]) => text)).toEqual([
			"Failed to send queued message: earlier deferred auth failed",
		]);
		expect(ui.harness.session.messages.filter((message) => message.role === "user").map(getMessageText)).toEqual([
			"original context",
			"seed input",
		]);
	} finally {
		release.resolve();
		await running?.catch(() => {});
		auth.mockRestore();
		errors.mockRestore();
		await ui.cleanup();
	}
});

it("discards settlement-deferred ownership when a public subscriber throws", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let held = false;
	const ui = await createSchedulingMode({
		extensionFactories: [
			(pi) => {
				pi.on("agent_settled", async () => {
					if (held) return;
					held = true;
					entered.resolve();
					await release.promise;
				});
			},
		],
	});
	const original = new Error("public settlement subscriber failed");
	let fail = true;
	const unsubscribe = ui.harness.session.subscribe((event) => {
		if (event.type === "agent_settled" && fail) {
			fail = false;
			throw original;
		}
	});
	const errors = vi.spyOn(ui.mode as unknown as { showError(text: string): void }, "showError");
	let running: Promise<void> | undefined;
	let completion: Promise<void> | undefined;
	let idleResolved = false;
	let completionError: unknown;
	ui.harness.setResponses([fauxAssistantMessage("seed response")]);
	try {
		await ui.mode.init();
		running = ui.harness.session.prompt("seed input");
		const outcome = running.catch((error: unknown) => error);
		await entered.promise;
		const idle = ui.harness.session.waitForIdle().then(() => {
			idleResolved = true;
		});
		await ui.harness.session.prompt("discarded direct prompt", {
			onDeferred: (promise) => {
				completion = promise;
				void promise.catch((error: unknown) => {
					completionError = error;
				});
			},
		});
		expect(completion).toBeDefined();
		ui.internal.queueCompactionMessage("discarded queued first", "followUp");
		ui.internal.queueCompactionMessage("discarded queued rest", "followUp");
		await ui.internal.flushCompactionQueue();
		ui.internal.queueCompactionMessage("newer queued input", "followUp");
		release.resolve();
		expect(await outcome).toBe(original);
		await setImmediate();
		expect(completionError).toBe(original);
		expect(idleResolved).toBe(true);
		await idle;
		expect(ui.internal.compactionQueuedMessages.map((entry) => entry.text)).toEqual([
			"discarded queued first",
			"discarded queued rest",
			"newer queued input",
		]);
		expect(ui.harness.session.messages.filter((message) => message.role === "user").map(getMessageText)).toEqual([
			"original context",
			"seed input",
		]);
		ui.harness.setResponses([
			fauxAssistantMessage("first retried"),
			fauxAssistantMessage("rest retried"),
			fauxAssistantMessage("newer retried"),
		]);
		await ui.internal.flushCompactionQueue();
		await ui.harness.session.waitForIdle();
		expect(ui.internal.compactionQueuedMessages).toEqual([]);
		expect(ui.harness.session.getLastAssistantText()).toBe("newer retried");
	} finally {
		release.resolve();
		unsubscribe();
		errors.mockRestore();
		await running?.catch(() => {});
		await ui.cleanup();
	}
});
