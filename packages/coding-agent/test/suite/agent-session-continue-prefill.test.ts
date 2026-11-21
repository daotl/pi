import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
	type Message,
} from "@earendil-works/pi-ai/compat";

function setOpenaiCompletions(harness: Harness): void {
	harness.session.agent.state.model = {
		...harness.session.agent.state.model,
		api: "openai-completions",
		compat: { supportsPrefillContinuation: true },
	};
}

function pushAbortedResult(
	stream: EventStream<AssistantMessageEvent, AssistantMessage>,
	partial: AssistantMessage,
): void {
	queueMicrotask(() => {
		stream.push({ type: "error", reason: "aborted", error: partial });
	});
}

import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

describe("AgentSession continue with prefill", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("deletes the prefill from the session and continues with returnPrefill", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// Initial prompt to get an assistant message in the session.
		harness.setResponses([fauxAssistantMessage("Partial response")]);
		await harness.session.prompt("Hello");

		// The session has [user, assistant].
		expect(harness.session.messages.filter((m) => m.role !== "system").map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		const prefill = harness.session.messages[2];
		expect(prefill?.role).toBe("assistant");

		// Switch to an openai-completions model and a mock stream that captures
		// returnPrefill and the LLM context messages.
		let capturedReturnPrefill: boolean | undefined;
		let capturedContextMessages: Message[] | undefined;
		const prefillText = getMessageText(prefill!);
		harness.session.agent.streamFunction = ((_model, context, options) => {
			capturedReturnPrefill = options?.returnPrefill;
			capturedContextMessages = context.messages;
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			queueMicrotask(() => {
				// With return_prefill the provider echoes the prefill before new tokens.
				stream.push({
					type: "done",
					reason: "stop",
					message: fauxAssistantMessage(`${prefillText} continued`),
				});
			});
			return stream;
		}) as StreamFn;
		setOpenaiCompletions(harness);

		// Delete the prefill (last assistant message) from the session log and agent state.
		const removed = harness.session.deleteLastMessages(1);
		expect(removed).toBe(1);
		expect(harness.session.messages.filter((m) => m.role !== "system").map((message) => message.role)).toEqual([
			"user",
		]);

		// Continue with the prefill.
		await harness.session.agent.continue(prefill!);

		// returnPrefill was forwarded to the stream function.
		expect(capturedReturnPrefill).toBe(true);
		// The prefill was the last assistant message in the LLM context (after the system message).
		expect(capturedContextMessages?.length).toBe(3);
		const contextLast = capturedContextMessages?.[2];
		expect(contextLast?.role).toBe("assistant");
		expect(getMessageText(contextLast)).toBe("Partial response");
		// The session has the echoed prefill plus newly generated tokens.
		expect(harness.session.messages.filter((m) => m.role !== "system").map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(getMessageText(harness.session.messages[2]!)).toBe("Partial response continued");
	});

	it("falls back to normal continue when the last message is a user message", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("First response"), fauxAssistantMessage("Second response")]);
		await harness.session.prompt("Hello");

		// Session has [user, assistant]. Continue normally (no prefill) from the
		// assistant message is not the path here — we test user-last continue by
		// deleting the assistant and continuing from the user message.
		harness.session.deleteLastMessages(1);
		expect(harness.session.messages.filter((m) => m.role !== "system").map((message) => message.role)).toEqual([
			"user",
		]);

		await harness.session.agent.continue();

		expect(harness.session.messages.filter((m) => m.role !== "system").map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(getMessageText(harness.session.messages[2]!)).toBe("Second response");
	});

	it("restores the original message when the continuation is aborted mid-echo", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// An interrupted message is the prefill candidate for continuation.
		harness.setResponses([fauxAssistantMessage("Partial response", { stopReason: "aborted" })]);
		await harness.session.prompt("Hello");
		const prefillText = getMessageText(harness.session.messages[2]!);
		expect(prefillText).toBe("Partial response");

		setOpenaiCompletions(harness);
		harness.session.agent.streamFunction = ((_model, _context, _options) => {
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			// The abort arrived before the echo completed: the streamed partial
			// contains only a prefix of the prefill.
			pushAbortedResult(stream, fauxAssistantMessage("Part", { stopReason: "aborted" }));
			return stream;
		}) as StreamFn;

		await harness.session.continue();

		// The original message is back; nothing was lost.
		expect(getMessageText(harness.session.messages[2]!)).toBe("Partial response");
	});

	it("keeps the streamed replacement when the abort arrives after the echo completed", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Partial response")]);
		await harness.session.prompt("Hello");

		setOpenaiCompletions(harness);
		harness.session.agent.streamFunction = ((_model, _context, _options) => {
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			// The abort arrived after the echo completed: the streamed partial
			// contains the full prefill plus new tokens, so it is kept.
			pushAbortedResult(stream, fauxAssistantMessage("Partial response continued", { stopReason: "aborted" }));
			return stream;
		}) as StreamFn;

		await harness.session.continue();

		// The streamed replacement with its new tokens is kept.
		expect(getMessageText(harness.session.messages[2]!)).toBe("Partial response continued");
	});

	it("restores the original message when the echoed content does not match the prefill", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// An interrupted message is the prefill candidate for continuation.
		harness.setResponses([fauxAssistantMessage("Partial response", { stopReason: "aborted" })]);
		await harness.session.prompt("Hello");

		setOpenaiCompletions(harness);
		harness.session.agent.streamFunction = ((_model, _context, _options) => {
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			queueMicrotask(() => {
				// The model did not reproduce the prefill; the echo mismatches.
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("Different text") });
			});
			return stream;
		}) as StreamFn;

		await expect(harness.session.continue()).rejects.toThrow(/echo mismatch/i);

		// The original message is restored; the mismatched echo is not kept.
		expect(getMessageText(harness.session.messages[2]!)).toBe("Partial response");
	});

	it("does not re-send the prefill on later turns of a multi-turn continuation", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		// An interrupted message: text plus one tool call, aborted mid-run.
		harness.setResponses([
			fauxAssistantMessage([fauxText("partial "), fauxToolCall("doesnotexist", {}, { id: "tc1" })], {
				stopReason: "aborted",
			}),
		]);
		await harness.session.prompt("Hello");

		setOpenaiCompletions(harness);
		const turnCaptures: Array<{ returnPrefill: boolean | undefined; lastRole: string }> = [];
		harness.session.agent.streamFunction = ((_model, context, options) => {
			turnCaptures.push({
				returnPrefill: options?.returnPrefill,
				lastRole: context.messages[context.messages.length - 1]?.role ?? "none",
			});
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			queueMicrotask(() => {
				if (turnCaptures.length === 1) {
					// Turn 1 of the continuation: echo the prefill and finish the tool call.
					stream.push({
						type: "done",
						reason: "toolUse",
						message: fauxAssistantMessage(
							[fauxText("partial "), fauxToolCall("doesnotexist", {}, { id: "tc1" })],
							{ stopReason: "toolUse" },
						),
					});
				} else {
					stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("answer") });
				}
			});
			return stream;
		}) as StreamFn;

		await harness.session.continue();

		expect(turnCaptures.length).toBe(2);
		// Turn 1 carries the prefill continuation request.
		expect(turnCaptures[0].returnPrefill).toBe(true);
		expect(turnCaptures[0].lastRole).toBe("assistant");
		// Turn 2 must not carry returnPrefill, and the request must not end with
		// the stale prefill assistant message re-appended after the tool result.
		// With both bugs the provider kept re-echoing the old partial on every
		// turn of the continued run instead of answering the tool result.
		expect(turnCaptures[1].returnPrefill).toBeFalsy();
		expect(turnCaptures[1].lastRole).toBe("toolResult");
		expect(getMessageText(harness.session.messages.at(-1)!)).toBe("answer");
	});

	it("continues a trailing edited assistant message via prefill", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("original answer")]);
		await harness.session.prompt("question");

		// A trailing edited message marked aborted=true via the edit tag is resumed
		// from the edit point via prefill continuation instead of regenerating.
		harness.session.applyMessageEdits(
			'<pi_edit id="0" role="assistant" aborted="true"><pi_content>edited answer</pi_content></pi_edit>',
		);

		setOpenaiCompletions(harness);
		let capturedReturnPrefill: boolean | undefined;
		harness.session.agent.streamFunction = ((_model, _context, options) => {
			capturedReturnPrefill = options?.returnPrefill;
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("edited answer continued") });
			});
			return stream;
		}) as StreamFn;

		await harness.session.continue();
		expect(capturedReturnPrefill).toBe(true);
		expect(getMessageText(harness.session.messages.at(-1)!)).toBe("edited answer continued");
	});

	it("regenerates instead of prefilling a partial that another model produced", async () => {
		const compat = { supportsPrefillContinuation: true };
		const harness = await createHarness({
			fauxApi: "openai-completions",
			compat,
			models: [{ id: "first" }, { id: "second" }],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Partial response", { stopReason: "aborted" })]);
		await harness.session.prompt("Hello");
		expect(harness.session.messages.at(-1)).toMatchObject({ role: "assistant", model: "first" });

		// The selected model also supports prefill continuation, but it did not produce the partial,
		// so its echo of another model's reasoning and text cannot be assumed byte-identical.
		harness.session.agent.state.model = { ...harness.getModel("second")!, compat };
		let capturedReturnPrefill: boolean | undefined;
		let capturedLastRole: string | undefined;
		harness.setResponses([
			(context, options) => {
				capturedReturnPrefill = options?.returnPrefill;
				capturedLastRole = context.messages.at(-1)?.role;
				return fauxAssistantMessage("Fresh response");
			},
		]);

		await harness.session.continue();

		expect(capturedReturnPrefill).toBeFalsy();
		expect(capturedLastRole).toBe("user");
		expect(getMessageText(harness.session.messages.at(-1)!)).toBe("Fresh response");
	});

	it("regenerates on an endpoint without prefill support, keeping the partial as an earlier version", async () => {
		// An ordinary OpenAI-compatible gateway: same model, no supportsPrefillContinuation.
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Partial response", { stopReason: "aborted" })]);
		await harness.session.prompt("Hello");

		let capturedReturnPrefill: boolean | undefined;
		let capturedLastRole: string | undefined;
		harness.setResponses([
			(context, options) => {
				capturedReturnPrefill = options?.returnPrefill;
				capturedLastRole = context.messages.at(-1)?.role;
				return fauxAssistantMessage("Fresh response");
			},
		]);

		await harness.session.continue();

		expect(capturedReturnPrefill).toBeFalsy();
		expect(capturedLastRole).toBe("user");
		const chat = harness.session.messages.filter((m) => m.role === "user" || m.role === "assistant");
		expect(chat.map(getMessageText)).toEqual(["Hello", "Fresh response"]);
		// The partial is not erased: it stays in the file as an earlier version of the response.
		const partial = harness.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && getMessageText(entry.message) === "Partial response");
		expect(partial).toBeDefined();
		expect(harness.sessionManager.getBranch().some((entry) => entry.id === partial!.id)).toBe(false);
		const group = harness.session.getSwipeGroup()!;
		expect(group.versions.map((entry) => getMessageText(entry.message))).toEqual([
			"Partial response",
			"Fresh response",
		]);
		expect(group.currentIndex).toBe(1);
	});

	it("regenerates a partial that followed an empty aborted response without prefill support", async () => {
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);

		// Aborted before any output (a harness message), then continued into a partial that was aborted too.
		harness.setResponses([
			fauxAssistantMessage("", { stopReason: "aborted" }),
			fauxAssistantMessage("Partial response", { stopReason: "aborted" }),
			fauxAssistantMessage("Fresh response"),
		]);
		await harness.session.prompt("Hello");
		await harness.session.continue();

		await expect(harness.session.continue()).resolves.toBeUndefined();

		const chat = harness.session.messages.filter((m) => m.role === "user" || m.role === "assistant");
		expect(chat.map(getMessageText)).toEqual(["Hello", "Fresh response"]);
	});

	it("announces the transcript change before regenerating, so the UI drops the set-aside partial", async () => {
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Partial response", { stopReason: "aborted" })]);
		await harness.session.prompt("Hello");
		const order: string[] = [];
		harness.session.subscribe((event) => {
			if (event.type === "transcript_changed" || event.type === "agent_start") order.push(event.type);
		});
		harness.setResponses([fauxAssistantMessage("Fresh response")]);

		await harness.session.continue();

		expect(order).toEqual(["transcript_changed", "agent_start"]);
	});

	it("leaves a partial that follows a completed response in place when it cannot be regenerated", async () => {
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);

		// After a compaction the kept range can start at a completed response, directly before the partial.
		harness.sessionManager.appendMessage({ role: "user", content: "Hello", timestamp: Date.now() });
		harness.sessionManager.appendMessage(fauxAssistantMessage("Complete response"));
		harness.sessionManager.appendMessage(fauxAssistantMessage("Partial response", { stopReason: "length" }));
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;

		await expect(harness.session.continue()).rejects.toThrow("Cannot continue from message role: assistant");

		// Nothing to regenerate from: the partial stays where it was, not set aside.
		const partial = harness.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && getMessageText(entry.message) === "Partial response");
		expect(partial).toBeDefined();
		expect(partial).not.toHaveProperty("deletedAt");
		expect(getMessageText(harness.session.messages.at(-1)!)).toBe("Partial response");
	});

	it("sets aside a partial that follows a completed response when a follow-up is queued", async () => {
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);

		harness.sessionManager.appendMessage({ role: "user", content: "Hello", timestamp: Date.now() });
		harness.sessionManager.appendMessage(fauxAssistantMessage("Complete response"));
		harness.sessionManager.appendMessage(fauxAssistantMessage("Partial response", { stopReason: "length" }));
		harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
		// The queued follow-up is delivered after the completed response, without the partial in its context.
		harness.session.agent.followUp({ role: "user", content: "Next question", timestamp: Date.now() });
		let sent: string[] = [];
		harness.setResponses([
			(context) => {
				sent = context.messages
					.filter((m) => m.role === "user" || m.role === "assistant")
					.map((m) => getMessageText(m));
				return fauxAssistantMessage("Answer");
			},
		]);

		await harness.session.continue();

		expect(sent).toEqual(["Hello", "Complete response", "Next question"]);
	});

	it("keeps a model switch made after the partial when regenerating it", async () => {
		const harness = await createHarness({
			fauxApi: "openai-completions",
			models: [{ id: "first" }, { id: "second" }],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Partial response", { stopReason: "aborted" })]);
		await harness.session.prompt("Hello");
		// Interrupted, then the user switches models before continuing.
		await harness.session.setModel(harness.getModel("second")!);
		let requestedModel: string | undefined;
		harness.setResponses([
			(_context, _options, _state, model) => {
				requestedModel = model.id;
				return fauxAssistantMessage("Fresh response");
			},
		]);

		await harness.session.continue();

		expect(requestedModel).toBe("second");
		const branch = harness.sessionManager.getBranch();
		expect(branch.some((entry) => entry.type === "model_change" && entry.modelId === "second")).toBe(true);
		const chat = harness.session.messages.filter((m) => m.role === "user" || m.role === "assistant");
		expect(chat.map(getMessageText)).toEqual(["Hello", "Fresh response"]);
		// The partial is soft-deleted: /restore brings it back.
		const partial = harness.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && getMessageText(entry.message) === "Partial response");
		expect(partial).toMatchObject({ deletedAt: expect.any(String) });
	});

	it("keeps earlier swipe versions when regenerating an interrupted version without prefill support", async () => {
		const harness = await createHarness({ fauxApi: "openai-completions" });
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("answer v1")]);
		await harness.session.prompt("question");
		harness.appendResponses([fauxAssistantMessage("partial v2", { stopReason: "aborted" })]);
		await harness.session.regenerateSwipe(harness.session.getSwipeGroup()!);
		harness.appendResponses([fauxAssistantMessage("answer v3")]);

		await harness.session.continue();

		const group = harness.session.getSwipeGroup()!;
		expect(group.versions.map((entry) => getMessageText(entry.message))).toEqual([
			"answer v1",
			"partial v2",
			"answer v3",
		]);
		expect(group.currentIndex).toBe(2);
	});

	it("continues the partial via prefill when the model that produced it is selected", async () => {
		const harness = await createHarness({
			fauxApi: "openai-completions",
			compat: { supportsPrefillContinuation: true },
			models: [{ id: "first" }, { id: "second" }],
		});
		harnesses.push(harness);

		harness.setResponses([fauxAssistantMessage("Partial response", { stopReason: "aborted" })]);
		await harness.session.prompt("Hello");

		let capturedReturnPrefill: boolean | undefined;
		let capturedLastRole: string | undefined;
		harness.setResponses([
			(context, options) => {
				capturedReturnPrefill = options?.returnPrefill;
				capturedLastRole = context.messages.at(-1)?.role;
				return fauxAssistantMessage("Partial response continued");
			},
		]);

		await harness.session.continue();

		expect(capturedReturnPrefill).toBe(true);
		expect(capturedLastRole).toBe("assistant");
		expect(getMessageText(harness.session.messages.at(-1)!)).toBe("Partial response continued");
	});

	it("continues successfully after a previous run was aborted", async () => {
		const harness = await createHarness();
		harnesses.push(harness);

		setOpenaiCompletions(harness);

		// First run: the stream stays open until aborted, simulating Esc
		// mid-stream. The aborted partial becomes the prefill candidate, and the
		// abort request flag must not leak into the continuation below.
		harness.session.agent.streamFunction = ((_model, _context, options) => {
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			options?.signal?.addEventListener("abort", () => {
				stream.push({
					type: "error",
					reason: "aborted",
					error: fauxAssistantMessage("Partial response", { stopReason: "aborted" }),
				});
			});
			queueMicrotask(() => {
				void harness.session.abort();
			});
			return stream;
		}) as StreamFn;
		await harness.session.prompt("Hello");
		expect(getMessageText(harness.session.messages.at(-1)!)).toBe("Partial response");

		// A stale abort request from the aborted run would kill this continuation
		// at agent_start, leaving an aborted message instead of the echoed
		// prefill plus new tokens. The abort lands before the stream function is
		// invoked, so the stream sees an already-aborted signal rather than an
		// abort event (which never re-fires on an already-aborted signal).
		harness.session.agent.streamFunction = ((_model, _context, options) => {
			const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
				(event) => event.type === "done" || event.type === "error",
				(event) => {
					if (event.type === "done") return event.message;
					if (event.type === "error") return event.error;
					throw new Error("Unexpected event type");
				},
			);
			queueMicrotask(() => {
				if (options?.signal?.aborted) {
					stream.push({
						type: "error",
						reason: "aborted",
						error: fauxAssistantMessage("", { stopReason: "aborted" }),
					});
					return;
				}
				stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("Partial response continued") });
			});
			return stream;
		}) as StreamFn;
		await harness.session.continue();

		const last = harness.session.messages.at(-1)! as AssistantMessage;
		expect(getMessageText(last)).toBe("Partial response continued");
		expect(last.stopReason).toBe("stop");
	});
});
