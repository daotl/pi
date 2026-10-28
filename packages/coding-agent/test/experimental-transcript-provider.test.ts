import { copyJson, createHost, type Frame, type Link, memoryLinkPair } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	AgentHarness,
	type AgentLane,
	type EventListener,
	type HarnessEvent,
	type LaneSnapshot,
	type LaneTranscriptSnapshot,
	MemorySessionRepo,
	type WatchHandle,
} from "@earendil-works/pi-agent-core";
import {
	type AssistantMessageFrame,
	AssistantMessageFrameReducer,
	createModels,
	fauxAssistantMessage,
	fauxProvider,
} from "@earendil-works/pi-ai";
import { createRoutedLinkPair } from "@earendil-works/pi-server";
import { describe, expect, test, vi } from "vitest";
import { Transcript, TranscriptReplay, type TranscriptState } from "../src/experimental/services/transcript.ts";
import { createTranscriptServiceFacet } from "../src/experimental/services/transcript-provider.ts";

function laneSnapshot(tipId: string | null = null): LaneSnapshot {
	return {
		lane: "main",
		transcript: [],
		tipId,
		configuration: {
			model: { provider: "test", modelId: "model" },
			thinkingLevel: "off",
			activeToolNames: [],
		},
		stats: {
			messageCount: 0,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		},
		operation: null,
		queues: [],
		faulted: false,
	};
}

describe("Transcript service", () => {
	test("keeps hydrated multi-block messages aligned through corrections and nested tool arguments", async () => {
		let listener: EventListener | undefined;
		const initial = laneSnapshot();
		const host = createHost({ name: "session", self: null });
		try {
			await host.load([
				createTranscriptServiceFacet({
					watch: async () => ({
						snapshot: initial,
						start(next: EventListener) {
							listener = next;
						},
						unsubscribe() {},
						resnapshot: async () => initial,
					}),
				} as unknown as AgentLane),
			]);
			const transcript = await host.get(Transcript, {});
			const reducer = new AssistantMessageFrameReducer();
			await listener?.({ type: "run_start", lane: "main", runId: "run", startedAt: 1 }, BACKGROUND_CONTEXT);
			let sequence = 0;
			const frames: AssistantMessageFrame[] = [
				{ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending" }) },
				{ type: "text_start", contentIndex: 0, content: { type: "text", text: "draft" } },
				{ type: "text_end", contentIndex: 0, content: "corrected", textSignature: "signature" },
				{ type: "thinking_start", contentIndex: 1, content: { type: "thinking", thinking: "initial" } },
				{ type: "thinking_delta", contentIndex: 1, delta: " thought" },
				{ type: "thinking_end", contentIndex: 1, content: "replaced", redacted: true },
				{
					type: "toolcall_start",
					contentIndex: 2,
					toolCall: { type: "toolCall", id: "tool", name: "write", arguments: { stale: "remove" } },
				},
				{
					type: "toolcall_checkpoint",
					contentIndex: 2,
					json: '{"nested":{"values":[1,2]},"path":"a"}',
					rawDelta: "raw",
				},
				{ type: "toolcall_delta", contentIndex: 2, delta: " " },
				{
					type: "toolcall_end",
					contentIndex: 2,
					id: "tool",
					name: "write",
					arguments: { nested: { values: [3] }, path: "b" },
					raw: "final",
				},
			];
			for (const frame of frames) {
				reducer.apply(frame);
				const message = structuredClone(reducer.message!);
				await listener?.(
					frame.type === "start"
						? {
								type: "message_start",
								lane: "main",
								runId: "run",
								entryId: "response",
								frameSequence: ++sequence,
								frame,
								message,
							}
						: {
								type: "message_update",
								lane: "main",
								runId: "run",
								entryId: "response",
								frameSequence: ++sequence,
								frame,
								message,
								event: { type: "text_delta", contentIndex: 0, delta: "", partial: message },
							},
					BACKGROUND_CONTEXT,
				);
				await vi.waitFor(() => expect(transcript.state.value.stream?.sequence).toBe(sequence));
				expect(transcript.state.value.snapshot?.operation?.streamingMessage).toEqual(message);
				expect(transcript.state.value.stream?.checkpoint).toEqual(reducer.checkpoint());
				const hydrated = new TranscriptReplay();
				expect(hydrated.read(transcript.state.value)).toEqual([]);
			}
		} finally {
			await host.close();
		}
	});

	test("delivers reconstructed faux-provider progress and the final operation boundary", async () => {
		const repo = new MemorySessionRepo();
		const session = await repo.create({}, BACKGROUND_CONTEXT);
		const faux = fauxProvider({ tokenSize: { min: 128, max: 128 } });
		const models = createModels();
		models.setProvider(faux.provider);
		const { harness } = await AgentHarness.create({ session, models, model: faux.getModel() }, BACKGROUND_CONTEXT);
		const lane = await harness.lane("main", BACKGROUND_CONTEXT);
		const host = createHost({ name: "session", self: null });
		const [provider, upstream] = createRoutedLinkPair();
		let wireBytes = 0;
		const counted: Link = {
			get closed() {
				return provider.closed;
			},
			send(frame) {
				wireBytes += Buffer.byteLength(JSON.stringify(frame));
				return provider.send(frame);
			},
			receive: (receive) => provider.receive(receive),
			onClose: (close) => provider.onClose(close),
			close: (reason) => provider.close(reason),
		};
		host.accept(counted, { principal: null, window: 1024 * 1024 * 1024, pendingCap: 1024 * 1024 * 1024 });
		const client = createHost({
			name: "viewer",
			self: null,
			kind: "client",
			upstream: { link: upstream, principal: null },
		});
		try {
			await host.load([createTranscriptServiceFacet(lane)]);
			const transcript = await client.get(Transcript, {});
			const replay = new TranscriptReplay();
			const updates: string[] = [];
			const boundaries: string[] = [];
			const unsubscribe = transcript.state.subscribe((state) => {
				for (const event of replay.read(state)) {
					if (event.type === "message_update" && event.message.role === "assistant") {
						const block = event.message.content[0];
						if (block?.type === "text") updates.push(block.text);
					}
					if (event.type === "run_end") boundaries.push(event.runId);
				}
			});
			const answer = "streamed answer ".repeat(16384);
			faux.setResponses([fauxAssistantMessage(answer, { timestamp: 1 })]);
			const wireStart = wireBytes;
			const result = await lane.prompt("question", undefined, BACKGROUND_CONTEXT);
			if (!result.ok) throw result.error;
			await vi.waitFor(() => expect(boundaries).toEqual([result.value.operationId]));
			expect(updates.at(-1)).toBe(answer);
			expect(updates.every((text) => answer.startsWith(text))).toBe(true);
			expect(wireBytes - wireStart).toBeLessThan(20 * 1024 * 1024);
			expect(transcript.state.value.snapshot?.operation).toBeNull();
			expect(
				transcript.state.value.events
					.filter(({ event }) => event.type === "assistant_frame")
					.every(({ event }) => !("message" in event)),
			).toBe(true);
			unsubscribe();
		} finally {
			await client.close();
			await host.close();
			await harness.close(BACKGROUND_CONTEXT);
			await session.close(BACKGROUND_CONTEXT);
			await repo.close(BACKGROUND_CONTEXT);
		}
	});

	test("retains sequenced source events when native delivery coalesces or resets state", async () => {
		let listener: EventListener | undefined;
		const [downstream, upstream] = memoryLinkPair();
		let paused = false;
		let heldAck: Frame | undefined;
		const sized = (link: Link, holdAcks = false): Link => ({
			get closed() {
				return link.closed;
			},
			send(frame) {
				if (holdAcks && paused && frame.t === "ack") {
					heldAck = frame;
					return 0;
				}
				link.send(frame);
				return JSON.stringify(frame).length;
			},
			receive: (receive) => link.receive(receive),
			onClose: (close) => link.onClose(close),
			close: (reason) => link.close(reason),
		});
		const server = createHost({ name: "session", self: null });
		server.accept(sized(downstream), { principal: null, window: 1, pendingCap: 256 });
		const client = createHost({
			name: "viewer",
			self: null,
			kind: "client",
			upstream: { link: sized(upstream, true), principal: null },
		});
		const handle: WatchHandle<LaneSnapshot> = {
			snapshot: laneSnapshot(),
			start(next) {
				listener = next;
			},
			resnapshot: async () => laneSnapshot(),
			unsubscribe() {},
		};
		try {
			await server.load([createTranscriptServiceFacet({ watch: async () => handle } as unknown as AgentLane)]);
			const transcript = await client.get(Transcript, {});
			const reconnect = new TranscriptReplay();
			reconnect.read(transcript.state.value);
			paused = true;
			await listener?.({ type: "run_start", lane: "main", runId: "one", startedAt: 1 }, BACKGROUND_CONTEXT);
			await listener?.(
				{
					type: "message_end",
					lane: "main",
					runId: "one",
					message: { role: "user", content: "answer", timestamp: 1 },
				},
				BACKGROUND_CONTEXT,
			);
			await listener?.(
				{
					type: "run_suspend",
					lane: "main",
					runId: "one",
					reason: "deferred",
					deferred: { api: "test", provider: "test", modelId: "test", id: "deferred" },
					poll: 1,
				},
				BACKGROUND_CONTEXT,
			);
			paused = false;
			if (heldAck) upstream.send(heldAck);
			await vi.waitFor(() =>
				expect(transcript.state.value.events.map((item) => item.event.type)).toEqual([
					"run_start",
					"message_end",
					"run_suspend",
				]),
			);
			expect(reconnect.read(transcript.state.value).map((event) => event.type)).toEqual([
				"run_start",
				"message_end",
				"run_suspend",
			]);
			for (let index = 0; index < 260; index++) {
				await listener?.({ type: "queue_update", lane: "main", queues: [] }, BACKGROUND_CONTEXT);
			}
			await vi.waitFor(() => expect(transcript.state.value.events.at(-1)?.sequence).toBe(263));
			expect(transcript.state.value.events[0].sequence).toBe(8);
			expect(transcript.state.value.events).toHaveLength(256);
		} finally {
			await client.close();
			await server.close();
		}
	});

	test("replays compact progress and terminal events, hydrates at the current cursor, and reports byte overruns", async () => {
		let listener: EventListener | undefined;
		const handle: WatchHandle<LaneSnapshot> = {
			snapshot: laneSnapshot(),
			start(next) {
				listener = next;
			},
			resnapshot: async () => laneSnapshot(),
			unsubscribe() {},
		};
		const host = createHost({ name: "session", self: null });
		try {
			await host.load([createTranscriptServiceFacet({ watch: async () => handle } as unknown as AgentLane)]);
			const transcript = await host.get(Transcript, {});
			const replay = new TranscriptReplay();
			replay.read(transcript.state.value);
			const overrun = new TranscriptReplay();
			overrun.read(transcript.state.value);
			const decoded: string[] = [];
			const stop = transcript.state.subscribe((state) => {
				for (const event of replay.read(state)) {
					if (event.type === "message_update" && event.message.role === "assistant") {
						const text = event.message.content[0];
						if (text?.type === "text") decoded.push(text.text);
					}
				}
			});
			const message = fauxAssistantMessage([], { stopReason: "pending", timestamp: 1 });
			await listener?.({ type: "run_start", lane: "main", runId: "run", startedAt: 1 }, BACKGROUND_CONTEXT);
			await listener?.(
				{
					type: "message_start",
					lane: "main",
					runId: "run",
					entryId: "response",
					frameSequence: 1,
					message,
					frame: { type: "start", partial: message },
				},
				BACKGROUND_CONTEXT,
			);
			let frameSequence = 1;
			const send = async (frame: AssistantMessageFrame, text: string) => {
				const current = { ...message, content: [{ type: "text" as const, text }] };
				await listener?.(
					{
						type: "message_update",
						lane: "main",
						runId: "run",
						entryId: "response",
						frameSequence: ++frameSequence,
						message: current,
						frame,
						event: { type: "text_delta", contentIndex: 0, delta: "", partial: current },
					},
					BACKGROUND_CONTEXT,
				);
			};
			await send({ type: "text_start", contentIndex: 0, content: { type: "text", text: "" } }, "");
			await send({ type: "text_delta", contentIndex: 0, delta: "first" }, "firstfuture");
			await vi.waitFor(() =>
				expect(transcript.state.value.snapshot?.operation?.streamingMessage?.content[0]).toMatchObject({
					text: "first",
				}),
			);
			const aligned = new TranscriptReplay();
			aligned.read(transcript.state.value);
			await send({ type: "text_delta", contentIndex: 0, delta: "future" }, "firstfuture");
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(5));
			expect(aligned.read(transcript.state.value)).toMatchObject([
				{ type: "message_update", message: { content: [{ text: "firstfuture" }] } },
			]);
			let text = "firstfuture";
			for (let index = 0; index < 300; index++) {
				text += "x".repeat(128);
				await send({ type: "text_delta", contentIndex: 0, delta: "x".repeat(128) }, text);
			}
			await vi.waitFor(() => expect(decoded.at(-1)).toBe(text));
			expect(transcript.state.value.events).toHaveLength(256);
			expect(Buffer.byteLength(JSON.stringify(transcript.state.value.events))).toBeLessThan(128 * 1024);
			expect(() => overrun.read(transcript.state.value)).toThrow("replay window exceeded");
			const hydrated = new TranscriptReplay();
			expect(hydrated.read(transcript.state.value)).toEqual([]);
			await send({ type: "text_delta", contentIndex: 0, delta: "tail" }, `${text}tail`);
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(306));
			expect(hydrated.read(transcript.state.value)).toMatchObject([
				{ type: "message_update", message: { content: [{ text: `${text}tail` }] } },
			]);
			const bounded = new TranscriptReplay();
			bounded.read(transcript.state.value);
			stop();
			await send(
				{ type: "text_delta", contentIndex: 0, delta: "界".repeat(400_000) },
				`${text}tail${"界".repeat(400_000)}`,
			);
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(307));
			expect(transcript.state.value.events).toEqual([]);
			expect(() => bounded.read(transcript.state.value)).toThrow("replay window exceeded");
			const afterOverrun = new TranscriptReplay();
			afterOverrun.read(transcript.state.value);
			await listener?.(
				{
					type: "run_suspend",
					lane: "main",
					runId: "run",
					reason: "deferred",
					deferred: { api: "test", provider: "test", modelId: "test", id: "pending" },
					poll: 1,
				},
				BACKGROUND_CONTEXT,
			);
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(308));
			expect(afterOverrun.read(transcript.state.value)).toMatchObject([{ type: "run_suspend", runId: "run" }]);
		} finally {
			await host.close();
		}
	});

	test("hydrates an unfinished tool response without reparsing a fabricated JSON prefix", async () => {
		const reducer = new AssistantMessageFrameReducer();
		reducer.apply({ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending", timestamp: 1 }) });
		reducer.apply({
			type: "toolcall_start",
			contentIndex: 0,
			toolCall: { type: "toolCall", id: "call", name: "write", arguments: {} },
		});
		reducer.apply({ type: "toolcall_delta", contentIndex: 0, delta: '{"path":"line\\' });
		const snapshot = laneSnapshot();
		snapshot.operation = {
			id: "run",
			kind: "run",
			startedAt: 1,
			fromTipId: null,
			status: "open",
			runningTools: [],
			streamingMessage: reducer.message,
			streamingFrameState: { messageId: "response", sequence: 3, checkpoint: reducer.checkpoint() },
		};
		const serializedSnapshot = copyJson(snapshot, { omitUndefinedProperties: true }) as LaneTranscriptSnapshot;
		const replay = new TranscriptReplay();
		replay.read({
			snapshot: serializedSnapshot,
			stream: { ...snapshot.operation.streamingFrameState!, runId: "run" },
			sequence: 100,
			events: [],
		});
		const events = replay.read({
			snapshot: serializedSnapshot,
			stream: { ...snapshot.operation.streamingFrameState!, runId: "run" },
			sequence: 101,
			events: [
				{
					sequence: 101,
					event: {
						type: "assistant_frame",
						phase: "update",
						lane: "main",
						runId: "run",
						messageId: "response",
						frame: { type: "toolcall_delta", contentIndex: 0, delta: 'nnext"}' },
					},
				},
			],
		});
		expect(events).toMatchObject([
			{ type: "message_update", message: { content: [{ arguments: { path: "line\nnext" } }] } },
		]);
		let listener: EventListener | undefined;
		const host = createHost({ name: "session", self: null });
		try {
			await host.load([
				createTranscriptServiceFacet({
					watch: async () => ({
						snapshot,
						start(next: EventListener) {
							listener = next;
						},
						unsubscribe() {},
						resnapshot: async () => snapshot,
					}),
				} as unknown as AgentLane),
			]);
			const transcript = await host.get(Transcript, {});
			const hydrated = new TranscriptReplay();
			hydrated.read(transcript.state.value);
			const message = snapshot.operation.streamingMessage!;
			await listener?.(
				{
					type: "message_update",
					lane: "main",
					runId: "run",
					entryId: "response",
					frameSequence: 3,
					message,
					frame: { type: "toolcall_delta", contentIndex: 0, delta: '{"path":"line\\' },
					event: { type: "toolcall_delta", contentIndex: 0, delta: "", partial: message },
				},
				BACKGROUND_CONTEXT,
			);
			await listener?.(
				{
					type: "message_update",
					lane: "main",
					runId: "run",
					entryId: "response",
					frameSequence: 4,
					message,
					frame: { type: "toolcall_delta", contentIndex: 0, delta: 'nnext"}' },
					event: { type: "toolcall_delta", contentIndex: 0, delta: 'nnext"}', partial: message },
				},
				BACKGROUND_CONTEXT,
			);
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(1));
			expect(hydrated.read(transcript.state.value)).toMatchObject([
				{ type: "message_update", message: { content: [{ arguments: { path: "line\nnext" } }] } },
			]);
		} finally {
			await host.close();
		}
	});

	test("publishes coherent state and rebases after navigation", async () => {
		let listener: EventListener | undefined;
		const replacement = laneSnapshot("replacement-tip");
		const captured = new AssistantMessageFrameReducer();
		captured.apply({ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending", timestamp: 1 }) });
		captured.apply({ type: "text_start", contentIndex: 0, content: { type: "text", text: "new" } });
		replacement.operation = {
			id: "replacement-run",
			kind: "run",
			startedAt: 4,
			fromTipId: "replacement-tip",
			status: "open",
			runningTools: [],
			streamingMessage: captured.message,
			streamingFrameState: { messageId: "replacement-response", sequence: 2, checkpoint: captured.checkpoint() },
		};
		const resnapshot = vi.fn(async () => replacement);
		const unsubscribe = vi.fn();
		const handle: WatchHandle<LaneSnapshot> = {
			snapshot: laneSnapshot(),
			start(next) {
				listener = next;
			},
			resnapshot,
			unsubscribe,
		};
		const lane = { watch: async () => handle } as unknown as AgentLane;
		const host = createHost({ name: "session", self: null });
		try {
			await host.load([createTranscriptServiceFacet(lane)]);
			const transcript = await host.get(Transcript, {});
			const replay = new TranscriptReplay();
			const afterRebase: string[] = [];
			const states: TranscriptState[] = [];
			const stop = transcript.state.subscribe((value) => {
				if (value.snapshot !== null) states.push(value);
				for (const event of replay.read(value)) {
					if (event.type === "message_update" && event.message.role === "assistant") {
						const text = event.message.content[0];
						if (text?.type === "text") afterRebase.push(text.text);
					}
				}
			});

			expect(states[0]).toMatchObject({ snapshot: { lane: "main", operation: null }, events: [] });
			await listener?.({ type: "run_start", lane: "main", runId: "run-1", startedAt: 1 }, BACKGROUND_CONTEXT);
			await vi.waitFor(() =>
				expect(states.at(-1)?.events.at(-1)?.event).toMatchObject({ type: "run_start", runId: "run-1" }),
			);
			expect(states[1]).toMatchObject({
				snapshot: { operation: { id: "run-1" } },
				events: [{ sequence: 1, event: { type: "run_start", runId: "run-1" } }],
			});

			await listener?.(
				{
					type: "entry_added",
					lane: "main",
					entry: {
						id: "entry-1",
						parentId: null,
						seq: 1,
						timestamp: 2,
						type: "message",
						message: { role: "user", content: "hello", timestamp: 2 },
					},
				},
				BACKGROUND_CONTEXT,
			);
			await vi.waitFor(() =>
				expect(states.at(-1)).toMatchObject({
					snapshot: { tipId: "entry-1", transcript: [{ id: "entry-1" }] },
					events: [
						{ sequence: 1, event: { type: "run_start" } },
						{ sequence: 2, event: { type: "entry_added" } },
					],
				}),
			);

			const navigation: HarnessEvent = {
				type: "navigation_end",
				lane: "main",
				runId: "navigation-1",
				status: "completed",
				fromTipId: "entry-1",
				tipId: "replacement-tip",
				endedAt: 3,
			};
			await listener?.(navigation, BACKGROUND_CONTEXT);
			await vi.waitFor(() => expect(states.at(-1)).toMatchObject({ snapshot: { tipId: "replacement-tip" } }));
			expect(states.at(-2)).toMatchObject({
				snapshot: { tipId: "entry-1" },
				events: expect.arrayContaining([{ sequence: 3, event: navigation }]),
			});
			expect(states.at(-1)).toMatchObject({
				snapshot: { tipId: "replacement-tip" },
				events: expect.arrayContaining([{ sequence: 3, event: navigation }]),
			});
			expect(transcript.state.value).toMatchObject({ snapshot: { tipId: "replacement-tip" } });
			expect(resnapshot).toHaveBeenCalledOnce();
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(4));
			expect(transcript.state.value.events.at(-1)?.event).toMatchObject({
				type: "assistant_reset",
				stream: { runId: "replacement-run", messageId: "replacement-response" },
				message: { content: [{ text: "new" }] },
			});
			const message = fauxAssistantMessage("newfuture", { stopReason: "pending", timestamp: 1 });
			await listener?.(
				{
					type: "message_update",
					lane: "main",
					runId: "replacement-run",
					entryId: "replacement-response",
					frameSequence: 3,
					message,
					frame: { type: "text_delta", contentIndex: 0, delta: "future" },
					event: { type: "text_delta", contentIndex: 0, delta: "future", partial: message },
				},
				BACKGROUND_CONTEXT,
			);
			await vi.waitFor(() => expect(afterRebase).toEqual(["newfuture"]));
			stop();
			const lagging = new TranscriptReplay();
			lagging.read(transcript.state.value);
			const large = new AssistantMessageFrameReducer();
			large.apply({ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending", timestamp: 1 }) });
			large.apply({ type: "text_start", contentIndex: 0, content: { type: "text", text: "界".repeat(400_000) } });
			replacement.operation!.streamingMessage = large.message;
			replacement.operation!.streamingFrameState = {
				messageId: "large-response",
				sequence: 2,
				checkpoint: large.checkpoint(),
			};
			await listener?.(navigation, BACKGROUND_CONTEXT);
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(7));
			expect(transcript.state.value.events).toEqual([]);
			expect(() => lagging.read(transcript.state.value)).toThrow("replay window exceeded");
			const fresh = new TranscriptReplay();
			fresh.read(transcript.state.value);
			await listener?.(
				{
					type: "run_suspend",
					lane: "main",
					runId: "replacement-run",
					reason: "deferred",
					deferred: { api: "test", provider: "test", modelId: "test", id: "pending" },
					poll: 1,
				},
				BACKGROUND_CONTEXT,
			);
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(8));
			expect(fresh.read(transcript.state.value)).toMatchObject([{ type: "run_suspend", runId: "replacement-run" }]);

			transcript.release();
		} finally {
			await host.close();
		}
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
