import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
	while (harnesses.length) harnesses.pop()?.cleanup();
});

it.each(["reject", "followUp", "steer"] as const)(
	"retains the active run when foreign preflight resumes (%s)",
	async (behavior) => {
		const preflightGate = Promise.withResolvers<void>();
		const preflightEntered = Promise.withResolvers<void>();
		const responseGate = Promise.withResolvers<void>();
		const responseEntered = Promise.withResolvers<void>();
		const harness = await createHarness({
			settings: { compaction: { enabled: false }, retry: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("before_agent_start", async (event) => {
						if (event.prompt === "delayed A") {
							preflightEntered.resolve();
							await preflightGate.promise;
							return { systemPrompt: "A must not replace the active run prompt" };
						}
						return { systemPrompt: "B owns the active run prompt" };
					});
				},
			],
		});
		harnesses.push(harness);
		const requests: string[][] = [];
		harness.setResponses([
			async (context) => {
				requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
				responseEntered.resolve();
				await responseGate.promise;
				return fauxAssistantMessage("B completed");
			},
			(context) => {
				requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
				return fauxAssistantMessage("A queued answer");
			},
		]);
		const dispositions: string[] = [];
		const delayed = harness.session
			.prompt("delayed A", {
				streamingBehavior: behavior === "reject" ? undefined : behavior,
				preflightResult: (disposition) => {
					dispositions.push(disposition);
				},
			})
			.then(
				() => undefined,
				(error: unknown) => error,
			);
		let active: Promise<void> | undefined;
		try {
			await preflightEntered.promise;
			active = harness.session.prompt("active B");
			await responseEntered.promise;
			let idleResolved = false;
			const idle = harness.session.waitForIdle().then(() => {
				idleResolved = true;
			});
			preflightGate.resolve();
			const result = await delayed;
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (behavior === "reject") {
				expect(result).toBeInstanceOf(Error);
				expect(dispositions).toEqual([]);
				expect(harness.session.getFollowUpMessages()).toEqual([]);
			} else {
				expect(result).toBeUndefined();
				expect(dispositions).toEqual(["queued"]);
				expect(
					behavior === "followUp" ? harness.session.getFollowUpMessages() : harness.session.getSteeringMessages(),
				).toEqual(["delayed A"]);
			}
			expect(harness.session.isStreaming).toBe(true);
			expect(harness.session.isIdle).toBe(false);
			expect(idleResolved).toBe(false);
			expect(harness.eventsOfType("agent_settled")).toEqual([]);
			expect(harness.session.systemPrompt).toBe("B owns the active run prompt");
			expect(harness.session.messages.filter((message) => message.role === "user").map(getMessageText)).toEqual([
				"active B",
			]);
			responseGate.resolve();
			await active;
			await idle;
			expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
			expect(harness.session.getLastAssistantText()).toBe(behavior === "reject" ? "B completed" : "A queued answer");
			expect(requests).toEqual(behavior === "reject" ? [["active B"]] : [["active B"], ["active B", "delayed A"]]);
		} finally {
			preflightGate.resolve();
			responseGate.resolve();
			await delayed;
			await harness.session.abort();
			await active?.catch(() => {});
		}
	},
);

it.each(["followUp", "steer"] as const)(
	"queues public %s input while the active run compacts",
	async (streamingBehavior) => {
		const entered = Promise.withResolvers<void>();
		const gate = Promise.withResolvers<void>();
		const harness = await createHarness({
			models: [{ id: "faux-1", contextWindow: 10_000, maxTokens: 100 }],
			settings: {
				retry: { enabled: false },
				compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 1000 },
			},
			extensionFactories: [
				(pi) => {
					pi.on("message_end", (event) => {
						if (
							event.message.role === "assistant" &&
							getMessageText(event.message) === "completed initial request"
						) {
							event.message.usage.input = 9500;
							event.message.usage.totalTokens = 9500 + event.message.usage.output;
						}
					});
					pi.on("session_before_compact", async (event) => {
						entered.resolve();
						await gate.promise;
						return {
							compaction: {
								summary: "compacted active run",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					});
				},
			],
		});
		harnesses.push(harness);
		const requests: string[][] = [];
		harness.setResponses([
			fauxAssistantMessage("completed initial request"),
			(context) => {
				requests.push(context.messages.filter((message) => message.role === "user").map(getMessageText));
				return fauxAssistantMessage("completed queued request");
			},
		]);
		const run = harness.session.prompt("starting context for threshold compaction");
		try {
			await entered.promise;
			expect(harness.eventsOfType("compaction_start").at(-1)?.reason).toBe("threshold");
			expect(harness.session.isStreaming).toBe(true);
			expect(harness.session.isCompacting).toBe(true);
			const dispositions: string[] = [];
			await harness.session.prompt("queued while compacting", {
				streamingBehavior,
				preflightResult: (value) => {
					dispositions.push(value);
				},
			});
			expect(dispositions).toEqual(["queued"]);
			expect(
				streamingBehavior === "followUp"
					? harness.session.getFollowUpMessages()
					: harness.session.getSteeringMessages(),
			).toEqual(["queued while compacting"]);
			expect(harness.eventsOfType("agent_settled")).toEqual([]);
			gate.resolve();
			await run;
			expect(requests).toHaveLength(1);
			expect(requests[0].at(-1)).toBe("queued while compacting");
			expect(
				harness.session.messages.filter(
					(message) => message.role === "user" && getMessageText(message) === "queued while compacting",
				),
			).toHaveLength(1);
			expect(harness.eventsOfType("agent_settled")).toHaveLength(1);
		} finally {
			gate.resolve();
			await harness.session.abort();
			await run.catch(() => {});
		}
	},
);

it("preserves a settlement-deferred prompt error when its observer also throws", async () => {
	const entered = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const harness = await createHarness({
		withConfiguredAuth: false,
		settings: { compaction: { enabled: false }, retry: { enabled: false } },
		extensionFactories: [
			(pi) => {
				pi.on("agent_settled", async () => {
					entered.resolve();
					await release.promise;
				});
			},
		],
	});
	harnesses.push(harness);
	const original = new Error("original deferred authentication failure");
	const auth = vi.spyOn(harness.session.modelRuntime, "checkAuth").mockResolvedValue({ type: "api_key" });
	const observed: unknown[] = [];
	harness.setResponses([fauxAssistantMessage("seed answer")]);
	const running = harness.session.prompt("seed request");
	const outcome = running.then(
		() => undefined,
		(error: unknown) => error,
	);
	try {
		await entered.promise;
		await harness.session.prompt("deferred input", {
			onDeferredError: (error) => {
				observed.push(error);
				throw new Error("observer failure must not win");
			},
		});
		auth.mockRejectedValueOnce(original);
		release.resolve();
		expect(await outcome).toBe(original);
		expect(observed).toEqual([original]);
		expect(harness.session.messages.filter((message) => message.role === "user").map(getMessageText)).toEqual([
			"seed request",
		]);
	} finally {
		release.resolve();
		await outcome;
		auth.mockRestore();
		await harness.session.abort();
	}
});
