import { describe, expect, test, vi } from "vitest";
import {
	InteractiveMode,
	parseScheduleWhen,
	type ScheduledMessage,
} from "../src/modes/interactive/interactive-mode.ts";

describe("parseScheduleWhen", () => {
	test("empty spec schedules for when the current task completes", () => {
		expect(parseScheduleWhen("")).toEqual({ type: "settled" });
		expect(parseScheduleWhen("   ")).toEqual({ type: "settled" });
	});

	test("positive integer schedules a message count", () => {
		expect(parseScheduleWhen("3")).toEqual({ type: "messages", remaining: 3 });
		expect(parseScheduleWhen("1")).toEqual({ type: "messages", remaining: 1 });
	});

	test("zero or negative counts are invalid", () => {
		expect(parseScheduleWhen("0")).toBeUndefined();
		expect(parseScheduleWhen("-1")).toBeUndefined();
	});

	test("sleep-style durations schedule a relative time", () => {
		const before = Date.now();
		const hour = parseScheduleWhen("1h");
		const after = Date.now();
		expect(hour?.type).toBe("time");
		if (hour?.type === "time") {
			expect(hour.at).toBeGreaterThanOrEqual(before + 3_600_000);
			expect(hour.at).toBeLessThanOrEqual(after + 3_600_000);
		}

		const minutes = parseScheduleWhen("5.5m");
		expect(minutes?.type).toBe("time");
		if (minutes?.type === "time") {
			expect(minutes.at).toBeGreaterThanOrEqual(before + 330_000);
		}

		expect(parseScheduleWhen("30s")?.type).toBe("time");
		expect(parseScheduleWhen("2d")?.type).toBe("time");
	});

	test("multiple duration tokens are summed like sleep(1)", () => {
		const before = Date.now();
		const result = parseScheduleWhen("1h 30m");
		expect(result?.type).toBe("time");
		if (result?.type === "time") {
			expect(result.at).toBeGreaterThanOrEqual(before + 5_400_000);
		}
	});

	test("zero durations are invalid", () => {
		expect(parseScheduleWhen("0s")).toBeUndefined();
	});

	test("absolute datetime schedules a time", () => {
		const result = parseScheduleWhen("2999-01-01 00:34");
		expect(result?.type).toBe("time");
		if (result?.type === "time") {
			expect(result.at).toBe(new Date(2999, 0, 1, 0, 34, 0).getTime());
		}
	});

	test("absolute datetime with seconds", () => {
		const result = parseScheduleWhen("2999-01-01 10:14:30");
		expect(result?.type).toBe("time");
		if (result?.type === "time") {
			expect(result.at).toBe(new Date(2999, 0, 1, 10, 14, 30).getTime());
		}
	});

	test("past datetime is invalid", () => {
		expect(parseScheduleWhen("2000-01-01 00:00")).toBeUndefined();
	});

	test.each(["2999-02-30 10:00", "2999-13-01 10:00", "2999-01-00 10:00", "24:00", "12:60", "12:00:60"])(
		"rejects normalized invalid local date/time %s",
		(spec) => {
			expect(parseScheduleWhen(spec)).toBeUndefined();
		},
	);

	test("accepts a leap-century day but rejects a non-leap-century day", () => {
		expect(parseScheduleWhen("2400-02-29 10:00")).toEqual({
			type: "time",
			at: new Date(2400, 1, 29, 10, 0, 0).getTime(),
		});
		expect(parseScheduleWhen("2300-02-29 10:00")).toBeUndefined();
	});

	test("date-less time in the future today schedules for today", ({ onTestFinished }) => {
		vi.useFakeTimers({ toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		vi.setSystemTime(new Date(2026, 9, 24, 12, 0, 15));
		const now = new Date();
		const future = new Date(now.getTime() + 60_000);
		const spec = `${String(future.getHours()).padStart(2, "0")}:${String(future.getMinutes()).padStart(2, "0")}`;
		const result = parseScheduleWhen(spec);
		expect(result?.type).toBe("time");
		if (result?.type === "time") {
			const at = new Date(result.at);
			expect(at.getFullYear()).toBe(now.getFullYear());
			expect(at.getMonth()).toBe(now.getMonth());
			expect(at.getDate()).toBe(now.getDate());
			expect(at.getHours()).toBe(future.getHours());
			expect(at.getMinutes()).toBe(future.getMinutes());
		}
	});

	test("date-less time already passed today schedules for the next day", ({ onTestFinished }) => {
		vi.useFakeTimers({ toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		vi.setSystemTime(new Date(2026, 9, 24, 12, 0, 15));
		const now = new Date();
		// Use a time two minutes in the past.
		const past = new Date(now.getTime() - 120_000);
		const spec = `${String(past.getHours()).padStart(2, "0")}:${String(past.getMinutes()).padStart(2, "0")}`;
		const result = parseScheduleWhen(spec);
		expect(result?.type).toBe("time");
		if (result?.type === "time") {
			const at = new Date(result.at);
			if (past.getDate() === now.getDate()) {
				// past is earlier today, so the time already passed -> next day.
				const expected = new Date(
					now.getFullYear(),
					now.getMonth(),
					now.getDate() + 1,
					past.getHours(),
					past.getMinutes(),
					0,
				);
				expect(at.getTime()).toBe(expected.getTime());
			} else {
				// Crossed midnight: the spec time is still in the future today.
				const expected = new Date(
					now.getFullYear(),
					now.getMonth(),
					now.getDate(),
					past.getHours(),
					past.getMinutes(),
					0,
				);
				expect(at.getTime()).toBe(expected.getTime());
			}
		}
	});

	test("date-less time with seconds schedules a time", ({ onTestFinished }) => {
		vi.useFakeTimers({ toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		vi.setSystemTime(new Date(2026, 9, 24, 12, 0, 15));
		const now = new Date();
		const future = new Date(now.getTime() + 120_000);
		const spec = `${String(future.getHours()).padStart(2, "0")}:${String(future.getMinutes()).padStart(2, "0")}:${String(future.getSeconds()).padStart(2, "0")}`;
		const result = parseScheduleWhen(spec);
		expect(result?.type).toBe("time");
		if (result?.type === "time") {
			const at = new Date(result.at);
			expect(at.getFullYear()).toBe(now.getFullYear());
			expect(at.getMonth()).toBe(now.getMonth());
			expect(at.getDate()).toBe(now.getDate());
			expect(at.getHours()).toBe(future.getHours());
			expect(at.getMinutes()).toBe(future.getMinutes());
			expect(at.getSeconds()).toBe(future.getSeconds());
		}
	});

	test("garbage specifications are invalid", () => {
		expect(parseScheduleWhen("tomorrow")).toBeUndefined();
		expect(parseScheduleWhen("5x")).toBeUndefined();
		expect(parseScheduleWhen("1h tomorrow")).toBeUndefined();
		expect(parseScheduleWhen("hello world")).toBeUndefined();
	});
});

type ScheduleCommandContext = {
	showStatus: (message: string) => void;
	scheduledMessages: ScheduledMessage[];
	nextScheduleId: number;
	session: { isIdle: boolean };
	cancelScheduledMessages: (count: number) => void;
	cancelScheduledMessageById: (id: number) => void;
	listScheduledMessages: () => void;
	scheduledMessageDescription: (entry: ScheduledMessage) => string;
	quotedListText: (text: string) => string;
	deliverScheduledEntry: (entry: ScheduledMessage) => void;
};

const schedulePrototype = InteractiveMode.prototype as unknown as {
	handleScheduleCommand: (this: ScheduleCommandContext, arg: string) => Promise<void>;
	listScheduledMessages: (this: ScheduleCommandContext) => void;
	cancelScheduledMessageById: (this: ScheduleCommandContext, id: number) => void;
	scheduledMessageDescription: (this: ScheduleCommandContext, entry: ScheduledMessage) => string;
	quotedListText: (this: ScheduleCommandContext, text: string) => string;
};

describe("InteractiveMode /schedule command dispatch", () => {
	test("cancels the last N scheduled messages for a -N spec", async () => {
		const cancelScheduledMessages = vi.fn();
		const context: ScheduleCommandContext = {
			showStatus: vi.fn(),
			scheduledMessages: [],
			nextScheduleId: 1,
			session: { isIdle: true },
			cancelScheduledMessages,
			cancelScheduledMessageById: vi.fn(),
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription as (
				entry: ScheduledMessage,
			) => string,
			quotedListText: schedulePrototype.quotedListText as (text: string) => string,
			deliverScheduledEntry: vi.fn(),
		};
		await schedulePrototype.handleScheduleCommand.call(context, "-2");
		expect(cancelScheduledMessages).toHaveBeenCalledWith(2);
	});

	test("lists scheduled messages for the list and l specs", async () => {
		for (const spec of ["list", "l", "LIST"]) {
			const listScheduledMessages = vi.fn();
			const context: ScheduleCommandContext = {
				showStatus: vi.fn(),
				scheduledMessages: [],
				nextScheduleId: 1,
				session: { isIdle: true },
				cancelScheduledMessages: vi.fn(),
				cancelScheduledMessageById: vi.fn(),
				listScheduledMessages,
				scheduledMessageDescription: schedulePrototype.scheduledMessageDescription as (
					entry: ScheduledMessage,
				) => string,
				quotedListText: schedulePrototype.quotedListText as (text: string) => string,
				deliverScheduledEntry: vi.fn(),
			};
			await schedulePrototype.handleScheduleCommand.call(context, spec);
			expect(listScheduledMessages).toHaveBeenCalled();
		}
	});

	test("cancels a scheduled message by id for a cancel <id> spec", async () => {
		const cancelScheduledMessageById = vi.fn();
		const context: ScheduleCommandContext = {
			showStatus: vi.fn(),
			scheduledMessages: [],
			nextScheduleId: 1,
			session: { isIdle: true },
			cancelScheduledMessages: vi.fn(),
			cancelScheduledMessageById,
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription as (
				entry: ScheduledMessage,
			) => string,
			quotedListText: schedulePrototype.quotedListText as (text: string) => string,
			deliverScheduledEntry: vi.fn(),
		};
		await schedulePrototype.handleScheduleCommand.call(context, "cancel 3");
		expect(cancelScheduledMessageById).toHaveBeenCalledWith(3);
	});

	test("does not arm a timer or accept an impossible calendar date", async () => {
		const context: ScheduleCommandContext = {
			showStatus: vi.fn(),
			scheduledMessages: [],
			nextScheduleId: 1,
			session: { isIdle: true },
			cancelScheduledMessages: vi.fn(),
			cancelScheduledMessageById: vi.fn(),
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription,
			quotedListText: schedulePrototype.quotedListText,
			deliverScheduledEntry: vi.fn(),
		};
		const timer = vi.spyOn(globalThis, "setTimeout");
		try {
			await schedulePrototype.handleScheduleCommand.call(context, "2999-02-30 10:00\nnever deliver");
			expect(context.scheduledMessages).toEqual([]);
			expect(context.nextScheduleId).toBe(1);
			expect(timer).not.toHaveBeenCalled();
			expect(context.deliverScheduledEntry).not.toHaveBeenCalled();
		} finally {
			timer.mockRestore();
		}
	});
});

describe("InteractiveMode scheduled message listing and id cancellation", () => {
	test("lists no scheduled messages", () => {
		const showStatus = vi.fn();
		const context: ScheduleCommandContext = {
			showStatus,
			scheduledMessages: [],
			nextScheduleId: 1,
			session: { isIdle: true },
			cancelScheduledMessages: vi.fn(),
			cancelScheduledMessageById: vi.fn(),
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription as (
				entry: ScheduledMessage,
			) => string,
			quotedListText: schedulePrototype.quotedListText as (text: string) => string,
			deliverScheduledEntry: vi.fn(),
		};
		schedulePrototype.listScheduledMessages.call(context);
		expect(showStatus).toHaveBeenCalledWith("No scheduled messages");
	});

	test("lists scheduled messages with id, action, and trigger", () => {
		const showStatus = vi.fn();
		const context: ScheduleCommandContext = {
			showStatus,
			scheduledMessages: [
				{ id: 1, text: "", when: { type: "settled" }, isContinue: true },
				{ id: 2, text: "check", when: { type: "time", at: Date.now() + 60_000 } },
			],
			nextScheduleId: 3,
			session: { isIdle: true },
			cancelScheduledMessages: vi.fn(),
			cancelScheduledMessageById: vi.fn(),
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription as (
				entry: ScheduledMessage,
			) => string,
			quotedListText: schedulePrototype.quotedListText as (text: string) => string,
			deliverScheduledEntry: vi.fn(),
		};
		schedulePrototype.listScheduledMessages.call(context);
		expect(showStatus).toHaveBeenCalled();
		const message = showStatus.mock.calls[0][0] as string;
		expect(message).toContain("Scheduled messages:");
		expect(message).toContain("1: continue when the current task completes");
		expect(message).toContain('2: message "check" for ');
	});

	test("cancels a scheduled message by id", () => {
		const showStatus = vi.fn();
		const entry: ScheduledMessage = { id: 1, text: "", when: { type: "settled" }, isContinue: true };
		const context: ScheduleCommandContext = {
			showStatus,
			scheduledMessages: [entry],
			nextScheduleId: 2,
			session: { isIdle: true },
			cancelScheduledMessages: vi.fn(),
			cancelScheduledMessageById: vi.fn(),
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription as (
				entry: ScheduledMessage,
			) => string,
			quotedListText: schedulePrototype.quotedListText as (text: string) => string,
			deliverScheduledEntry: vi.fn(),
		};
		schedulePrototype.cancelScheduledMessageById.call(context, 1);
		expect(context.scheduledMessages).toHaveLength(0);
		expect(showStatus).toHaveBeenCalledWith("Cancelled scheduled message 1");
	});

	test("shows status when cancelling an unknown scheduled message id", () => {
		const showStatus = vi.fn();
		const context: ScheduleCommandContext = {
			showStatus,
			scheduledMessages: [],
			nextScheduleId: 1,
			session: { isIdle: true },
			cancelScheduledMessages: vi.fn(),
			cancelScheduledMessageById: vi.fn(),
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription as (
				entry: ScheduledMessage,
			) => string,
			quotedListText: schedulePrototype.quotedListText as (text: string) => string,
			deliverScheduledEntry: vi.fn(),
		};
		schedulePrototype.cancelScheduledMessageById.call(context, 99);
		expect(context.scheduledMessages).toHaveLength(0);
		expect(showStatus).toHaveBeenCalledWith("No scheduled message with id 99");
	});
});

describe("InteractiveMode long scheduled deadlines", () => {
	test("re-arms bounded chunks without early delivery and preserves cancellation", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 9, 12, 12));
		const delivered: string[] = [];
		const context: ScheduleCommandContext & { fireScheduledMessage(id: number): void } = {
			scheduledMessages: [],
			nextScheduleId: 1,
			session: { isIdle: true },
			showStatus: vi.fn(),
			cancelScheduledMessages: vi.fn(),
			listScheduledMessages: vi.fn(),
			scheduledMessageDescription: schedulePrototype.scheduledMessageDescription,
			quotedListText: schedulePrototype.quotedListText,
			deliverScheduledEntry: (entry) => {
				delivered.push(entry.text);
			},
			fireScheduledMessage(id) {
				Reflect.get(InteractiveMode.prototype, "fireScheduledMessage").call(this, id);
			},
			cancelScheduledMessageById(id) {
				schedulePrototype.cancelScheduledMessageById.call(this, id);
			},
		};
		try {
			await schedulePrototype.handleScheduleCommand.call(context, "60d\nlong");
			await schedulePrototype.handleScheduleCommand.call(context, "30d\ncancelled");
			await schedulePrototype.handleScheduleCommand.call(context, "0.001s\nshort");
			await vi.advanceTimersByTimeAsync(1);
			expect(delivered).toEqual(["short"]);
			await vi.advanceTimersByTimeAsync(2_147_483_647);
			expect(delivered).toEqual(["short"]);
			context.cancelScheduledMessageById(2);
			await vi.advanceTimersByTimeAsync(2_147_483_647);
			expect(delivered).toEqual(["short"]);
			await vi.advanceTimersByTimeAsync(60 * 86_400_000 - 2 * 2_147_483_647 - 2);
			expect(delivered).toEqual(["short"]);
			await vi.advanceTimersByTimeAsync(1);
			expect(delivered).toEqual(["short", "long"]);
			expect(context.scheduledMessages).toEqual([]);
		} finally {
			vi.clearAllTimers();
			vi.useRealTimers();
		}
	});
});

describe("deferred scheduled actions remain cancellable", () => {
	function context() {
		return {
			scheduledMessages: [{ id: 2, text: "pending", when: { type: "settled" as const } }],
			deferredScheduledActions: [{ id: 3, text: "deferred", when: { type: "settled" as const }, isContinue: true }],
			showStatus: vi.fn(),
			scheduledMessageDescription: (entry: ScheduledMessage) => `${entry.id}:${entry.text}`,
		};
	}
	test("lists deferred and pending actions without losing their IDs", () => {
		const state = context();
		Reflect.get(InteractiveMode.prototype, "listScheduledMessages").call(state);
		const output = String(state.showStatus.mock.calls[0][0]);
		expect(output).toContain("2:pending");
		expect(output).toContain("3:deferred");
	});
	test("cancels a deferred action by ID", () => {
		const state = context();
		Reflect.get(InteractiveMode.prototype, "cancelScheduledMessageById").call(state, 3);
		expect(state.deferredScheduledActions).toEqual([]);
		expect(state.scheduledMessages.map((entry) => entry.id)).toEqual([2]);
	});
	test("cancels newest IDs across pending and deferred queues", () => {
		const state = context();
		Reflect.get(InteractiveMode.prototype, "cancelScheduledMessages").call(state, 1);
		expect(state.deferredScheduledActions).toEqual([]);
		expect(state.scheduledMessages.map((entry) => entry.id)).toEqual([2]);
	});
});
