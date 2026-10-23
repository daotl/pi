import { setImmediate } from "node:timers/promises";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { isPadLinesToWidth, isWrapLinesToWidth, setPadLinesToWidth, setWrapLinesToWidth } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal.ts";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { type AgentSessionServices, createAgentSessionFromServices } from "../../src/core/agent-session-services.ts";
import { InteractiveMode, type ScheduledMessage } from "../../src/modes/interactive/interactive-mode.ts";
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
		deferOrRunScheduledAction(entry: ScheduledMessage): void;
		clearScheduledMessages(): void;
		scheduledMessages: ScheduledMessage[];
		deferredScheduledActions: ScheduledMessage[];
	};
	return {
		harness,
		mode,
		internal,
		terminal,
		cleanup: async () => {
			internal.clearScheduledMessages();
			await harness.session.abort();
			await harness.session.waitForIdle();
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
