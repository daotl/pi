import {
	copyJson,
	createHost,
	type Frame,
	type JsonRepresentation,
	type Link,
	memoryLinkPair,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
	AgentHarness,
	type AgentLane,
	type EventListener,
	type HarnessEvent,
	type LaneSnapshot,
	type LaneTranscriptSnapshot,
	type LaneWatchEvent,
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
import { NodeExecutionEnv } from "../../agent/src/harness/env/nodejs.ts";
import { createBashTool } from "../../agent/src/harness/tools/bash.ts";
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

test("delivers actual bash progress and absent-details completions through routed replay", async () => {
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, BACKGROUND_CONTEXT);
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const { harness } = await AgentHarness.create(
		{
			session,
			models,
			model: faux.getModel(),
			tools: [createBashTool()],
			toolContext: { env: new NodeExecutionEnv({ cwd: process.cwd() }) },
		},
		BACKGROUND_CONTEXT,
	);
	const lane = await harness.lane("main", BACKGROUND_CONTEXT);
	const host = createHost({ name: "session", self: null });
	const [downstream, upstream] = createRoutedLinkPair();
	host.accept(downstream, { principal: null });
	const client = createHost({
		name: "viewer",
		self: null,
		kind: "client",
		upstream: { link: upstream, principal: null },
	});
	let stop: (() => void) | undefined;
	try {
		await host.load([createTranscriptServiceFacet(lane)]);
		const transcript = await client.get(Transcript, {});
		const replay = new TranscriptReplay();
		const events: LaneWatchEvent[] = [];
		stop = transcript.state.subscribe((state) => {
			events.push(...replay.read(state));
		});
		faux.setResponses([
			fauxAssistantMessage(
				[
					{ type: "toolCall", id: "bash-call", name: "bash", arguments: { command: "printf transcript-output" } },
					{ type: "toolCall", id: "missing-call", name: "unavailable", arguments: {} },
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		const result = await lane.prompt("run the tools", undefined, BACKGROUND_CONTEXT);
		if (!result.ok) throw result.error;
		await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({ type: "run_end" })));
		expect(events).toContainEqual(
			expect.objectContaining({ type: "tool_update", toolCallId: "bash-call", partialResult: { content: [] } }),
		);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "tool_end",
				toolCallId: "bash-call",
				result: { content: [{ type: "text", text: "transcript-output" }] },
				isError: false,
			}),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "tool_end", toolCallId: "missing-call", isError: true }),
		);
		for (const id of ["bash-call", "missing-call"]) {
			const completed = events.find((event) => event.type === "tool_end" && event.toolCallId === id);
			if (completed?.type !== "tool_end") throw new Error("Expected replayed completion");
			expect(completed.result).not.toHaveProperty("details");
		}
		const captured = await lane.watch(BACKGROUND_CONTEXT);
		try {
			expect(transcript.state.value.snapshot).toEqual(
				copyJson(captured.snapshot, { omitUndefinedProperties: true }),
			);
		} finally {
			captured.unsubscribe();
		}
	} finally {
		stop?.();
		await client.close();
		await host.close();
		await harness.close(BACKGROUND_CONTEXT);
		await session.close(BACKGROUND_CONTEXT);
		await repo.close(BACKGROUND_CONTEXT);
	}
});

test.each(["initial", "resnapshot"] as const)(
	"publishes %s outcome-ready tools without absent details over routed links",
	async (capture) => {
		const ready = laneSnapshot("ready-tip");
		ready.operation = {
			id: "run",
			kind: "run",
			startedAt: 1,
			fromTipId: null,
			status: "open",
			runningTools: [
				{
					status: "settled",
					toolCallId: "missing-call",
					toolName: "unavailable",
					args: {},
					result: { content: [{ type: "text", text: "unavailable" }], details: undefined },
					isError: true,
				},
			],
		};
		let listener: EventListener | undefined;
		const host = createHost({ name: "session", self: null });
		const [downstream, upstream] = createRoutedLinkPair();
		host.accept(downstream, { principal: null });
		const client = createHost({
			name: "viewer",
			self: null,
			kind: "client",
			upstream: { link: upstream, principal: null },
		});
		try {
			await host.load([
				createTranscriptServiceFacet({
					watch: async () => ({
						snapshot: capture === "initial" ? ready : laneSnapshot(),
						start(next: EventListener) {
							listener = next;
						},
						unsubscribe() {},
						resnapshot: async () => ready,
					}),
				} as unknown as AgentLane),
			]);
			const transcript = await client.get(Transcript, {});
			const replay = new TranscriptReplay();
			replay.read(transcript.state.value);
			if (capture === "resnapshot") {
				await listener!(
					{
						type: "navigation_end",
						lane: "main",
						runId: "navigation",
						status: "completed",
						fromTipId: null,
						tipId: "ready-tip",
						endedAt: 2,
					},
					BACKGROUND_CONTEXT,
				);
			}
			await vi.waitFor(() =>
				expect(transcript.state.value.snapshot).toEqual(copyJson(ready, { omitUndefinedProperties: true })),
			);
			expect(transcript.state.value.snapshot?.operation?.runningTools[0]?.result).not.toHaveProperty("details");
			await listener!({ type: "queue_update", lane: "main", queues: [] }, BACKGROUND_CONTEXT);
			await vi.waitFor(() => expect(transcript.state.value.events.at(-1)?.event.type).toBe("queue_update"));
			expect(replay.read(transcript.state.value)).toContainEqual({ type: "queue_update", lane: "main", queues: [] });
		} finally {
			await client.close();
			await host.close();
		}
	},
);

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
			const hydratedReplays: TranscriptReplay[] = [];
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
				for (const replay of hydratedReplays) {
					const events = replay.read(transcript.state.value);
					expect(events).toHaveLength(1);
					expect(events[0]).toMatchObject({ type: "message_update", runId: "run", entryId: "response" });
					if (events[0]?.type !== "message_update") throw new Error("Expected hydrated assistant update");
					expect(events[0].message).toEqual(copyJson(message, { omitUndefinedProperties: true }));
				}
				if (frame.type !== "toolcall_end") {
					const hydrated = new TranscriptReplay();
					hydrated.read(transcript.state.value);
					hydratedReplays.push(hydrated);
				}
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

	test("replays each tool JSON delta after hydration without parsing accumulated prefixes", () => {
		const reducer = new AssistantMessageFrameReducer();
		reducer.apply({ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending", timestamp: 1 }) });
		reducer.apply({
			type: "toolcall_start",
			contentIndex: 0,
			toolCall: { type: "toolCall", id: "call", name: "write", arguments: {} },
		});
		const prefix = '{"path":"line\\u00';
		reducer.apply({ type: "toolcall_delta", contentIndex: 0, delta: prefix });
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
		const state: TranscriptState = {
			snapshot: copyJson(snapshot, { omitUndefinedProperties: true }) as LaneTranscriptSnapshot,
			stream: { ...snapshot.operation.streamingFrameState!, runId: "run" },
			sequence: 100,
			events: [],
		};
		const replay = new TranscriptReplay();
		const parse = vi.spyOn(JSON, "parse");
		try {
			expect(replay.read(state)).toEqual([]);
			let inputLength = prefix.length;
			const read = (frame: AssistantMessageFrame) => {
				if (frame.type === "toolcall_delta") inputLength += frame.delta.length;
				if (frame.type === "toolcall_checkpoint") inputLength += frame.json.length;
				state.sequence++;
				state.events = [
					{
						sequence: state.sequence,
						event: {
							type: "assistant_frame",
							phase: "update",
							lane: "main",
							runId: "run",
							messageId: "response",
							frame: copyJson(frame, {
								omitUndefinedProperties: true,
							}) as JsonRepresentation<AssistantMessageFrame>,
						},
					},
				];
				const event = replay.read(state)[0];
				if (event?.type !== "message_update" || event.message.role !== "assistant") {
					throw new Error("Expected replayed assistant update");
				}
				return event.message.content[0];
			};
			const first = read({ type: "toolcall_delta", contentIndex: 0, delta: 'e9","content":"' });
			expect(first).toMatchObject({ arguments: { path: "lineé", content: "" } });
			let content = "";
			for (let index = 0; index < 400; index++) {
				const delta = `${index}:`.padEnd(128, "x");
				content += delta;
				expect(read({ type: "toolcall_delta", contentIndex: 0, delta })).toMatchObject({
					arguments: { path: "lineé", content },
				});
			}
			expect(read({ type: "toolcall_delta", contentIndex: 0, delta: '"}' })).toMatchObject({
				arguments: { path: "lineé", content },
			});
			expect(first).toMatchObject({ arguments: { path: "lineé", content: "" } });
			expect(read({ type: "toolcall_checkpoint", contentIndex: 0, json: '{"path":"replacement\\' })).toMatchObject({
				arguments: { path: "replacement" },
			});
			expect(read({ type: "toolcall_delta", contentIndex: 0, delta: 'nnext"}' })).toMatchObject({
				arguments: { path: "replacement\nnext" },
			});
			expect(
				read({
					type: "toolcall_end",
					contentIndex: 0,
					id: "call",
					name: "write",
					arguments: {},
					argumentsError: "malformed provider arguments",
					raw: "final raw",
				}),
			).toMatchObject({ arguments: {}, argumentsError: "malformed provider arguments", raw: "final raw" });
			const parsedBytes = parse.mock.calls.reduce((total, [text]) => total + text.length, 0);
			expect(parsedBytes).toBeLessThan(inputLength * 3);
		} finally {
			parse.mockRestore();
		}
	});

	test("commits a navigation reset before processing frames released by resnapshot", async () => {
		let listener: EventListener | undefined;
		const captured = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const replacement = laneSnapshot("new-tip");
		const host = createHost({ name: "session", self: null });
		const reducer = new AssistantMessageFrameReducer();
		const start: AssistantMessageFrame = {
			type: "start",
			partial: fauxAssistantMessage([], { stopReason: "pending" }),
		};
		reducer.apply(start);
		const initialMessage = structuredClone(reducer.message!);
		const text: AssistantMessageFrame = {
			type: "text_start",
			contentIndex: 0,
			content: { type: "text", text: "resumed" },
		};
		reducer.apply(text);
		const continuedMessage = structuredClone(reducer.message!);
		const handle: WatchHandle<LaneSnapshot> = {
			snapshot: laneSnapshot(),
			start(next) {
				listener = next;
			},
			async resnapshot() {
				captured.resolve();
				await release.promise;
				// A watch can release post-boundary events before its capture promise resolves.
				void listener!({ type: "run_start", lane: "main", runId: "continued", startedAt: 3 }, BACKGROUND_CONTEXT);
				void listener!(
					{
						type: "message_start",
						lane: "main",
						runId: "continued",
						entryId: "response",
						frameSequence: 1,
						frame: start,
						message: initialMessage,
					},
					BACKGROUND_CONTEXT,
				);
				void listener!(
					{
						type: "message_update",
						lane: "main",
						runId: "continued",
						entryId: "response",
						frameSequence: 2,
						frame: text,
						message: continuedMessage,
						event: { type: "text_delta", contentIndex: 0, delta: "resumed", partial: continuedMessage },
					},
					BACKGROUND_CONTEXT,
				);
				await new Promise<void>((resolve) => setImmediate(resolve));
				return replacement;
			},
			unsubscribe() {},
		};
		try {
			await host.load([createTranscriptServiceFacet({ watch: async () => handle } as unknown as AgentLane)]);
			const transcript = await host.get(Transcript, {});
			const replay = new TranscriptReplay();
			replay.read(transcript.state.value);
			await listener!(
				{
					type: "navigation_end",
					lane: "main",
					runId: "navigation",
					status: "completed",
					fromTipId: null,
					tipId: "new-tip",
					endedAt: 2,
				},
				BACKGROUND_CONTEXT,
			);
			await captured.promise;
			release.resolve();
			await vi.waitFor(() => expect(transcript.state.value.sequence).toBe(5));
			expect(transcript.state.value.snapshot).toMatchObject({
				tipId: "new-tip",
				operation: { id: "continued", streamingMessage: continuedMessage },
			});
			expect(transcript.state.value.stream).toMatchObject({
				runId: "continued",
				messageId: "response",
				sequence: 2,
			});
			expect(transcript.state.value.events.map(({ event }) => event.type)).toEqual([
				"navigation_end",
				"assistant_reset",
				"run_start",
				"assistant_frame",
				"assistant_frame",
			]);
			expect(replay.read(transcript.state.value)).toMatchObject([
				{ type: "navigation_end" },
				{ type: "run_start", runId: "continued" },
				{ type: "message_start", message: initialMessage },
				{ type: "message_update", message: continuedMessage },
			]);
		} finally {
			release.resolve();
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

test.each([50_000, 500_000])(
	"streams %i tool argument characters without comparing growing prefixes",
	async (size) => {
		let listener: EventListener | undefined;
		const host = createHost({ name: "session", self: null });
		const snapshot = laneSnapshot();
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
			const message = fauxAssistantMessage([], { stopReason: "pending" });
			await listener!({ type: "run_start", lane: "main", runId: "run", startedAt: 1 }, BACKGROUND_CONTEXT);
			let sequence = 0;
			const send = async (frame: AssistantMessageFrame) => {
				await listener!(
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
								event: { type: "toolcall_delta", contentIndex: 0, delta: "", partial: message },
							},
					BACKGROUND_CONTEXT,
				);
				await vi.waitFor(() => expect(transcript.state.value.stream?.sequence).toBe(sequence));
			};
			await send({ type: "start", partial: message });
			await send({
				type: "toolcall_start",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: "call", name: "write", arguments: {} },
			});
			const sibling = "completed sibling".repeat(4096);
			await send({
				type: "toolcall_delta",
				contentIndex: 0,
				delta: `{"sibling":${JSON.stringify({ content: sibling })},"content":"`,
			});
			const startsWith = String.prototype.startsWith;
			let compared = 0;
			const spy = vi.spyOn(String.prototype, "startsWith").mockImplementation(function (
				this: string,
				prefix: string,
				position?: number,
			) {
				if (prefix.length >= 32 && prefix[0] === "x" && this[0] === "x") compared += prefix.length;
				return startsWith.call(this, prefix, position);
			});
			try {
				for (let offset = 0; offset < size; offset += 32)
					await send({ type: "toolcall_delta", contentIndex: 0, delta: "x".repeat(Math.min(32, size - offset)) });
			} finally {
				spy.mockRestore();
			}
			expect(compared).toBeLessThan(size * 4);
			expect(transcript.state.value.snapshot?.operation?.streamingMessage?.content[0]).toMatchObject({
				arguments: { sibling: { content: sibling }, content: "x".repeat(size) },
			});
			await send({ type: "toolcall_checkpoint", contentIndex: 0, json: '{"corrected":"line\\' });
			await send({ type: "toolcall_delta", contentIndex: 0, delta: 'nnext"}' });
			expect(transcript.state.value.snapshot?.operation?.streamingMessage?.content[0]).toMatchObject({
				arguments: { corrected: "line\nnext" },
			});
			await send({ type: "toolcall_end", contentIndex: 0, id: "call", name: "write", arguments: { final: true } });
			expect(transcript.state.value.snapshot?.operation?.streamingMessage?.content[0]).toMatchObject({
				arguments: { final: true },
			});
		} finally {
			await host.close();
		}
	},
	120_000,
);

test("matches reducer previews for incomplete scalars, deep paths, and snapshot-credit lag", async () => {
	let listener: EventListener | undefined;
	const host = createHost({ name: "session", self: null });
	const snapshot = laneSnapshot();
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
		const reducer = new AssistantMessageFrameReducer();
		await listener!({ type: "run_start", lane: "main", runId: "run", startedAt: 1 }, BACKGROUND_CONTEXT);
		let sequence = 0;
		const send = async (frame: AssistantMessageFrame) => {
			reducer.apply(frame);
			const message = reducer.message!;
			await listener!(
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
							event: { type: "toolcall_delta", contentIndex: 0, delta: "", partial: message },
						},
				BACKGROUND_CONTEXT,
			);
			await vi.waitFor(() => expect(transcript.state.value.stream?.sequence).toBe(sequence));
			expect(transcript.state.value.snapshot?.operation?.streamingMessage).toEqual(message);
		};
		await send({ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending" }) });
		await send({
			type: "toolcall_start",
			contentIndex: 0,
			toolCall: { type: "toolCall", id: "call", name: "write", arguments: {} },
		});
		const cases = [
			['{"number":', "1", "2", "e", "+", "3", ',"literal":', "t", "r", "u", "e", "}"],
			['{"duplicate":"old","duplicate":', "1", "e", "+", "x", ',"next":"ok"}'],
			['{"literal":', "n", "u", "l", "l", ',"bad":', "f", "a", "x", "}"],
			[`${'{"nested":'.repeat(36)}"line\\`, "u00", "e9", `tail"${"}".repeat(36)}`],
			[`{"values":[${"0,".repeat(4096)}`, "1", "2", ",", '"', ...Array.from({ length: 64 }, () => "z"), '"]}'],
			['["', "not an object", '"]'],
			['{"array":["', "one", "two", '","three"]}'],
		];
		for (const chunks of cases) {
			await send({ type: "toolcall_checkpoint", contentIndex: 0, json: "" });
			for (const delta of chunks) await send({ type: "toolcall_delta", contentIndex: 0, delta });
			// The next ordinary string delta must not replay edits skipped during credit lag or fallback.
			await send({ type: "toolcall_checkpoint", contentIndex: 0, json: '{"fresh":"' });
			await send({ type: "toolcall_delta", contentIndex: 0, delta: 'tail"}' });
		}
	} finally {
		await host.close();
	}
});

test.each([4096, 16384])(
	"does not revisit %i array elements while the published tool preview lags",
	async (size) => {
		let listener: EventListener | undefined;
		const host = createHost({ name: "session", self: null });
		const snapshot = laneSnapshot();
		const reducer = new AssistantMessageFrameReducer();
		let sequence = 0;
		let measureLag = false;
		let laggedArrayVisits = 0;
		const descriptor = Object.getOwnPropertyDescriptor;
		const spy = vi.spyOn(Object, "getOwnPropertyDescriptor").mockImplementation((value, key) => {
			if (measureLag && Array.isArray(value) && value.length >= size && String(key) !== "length")
				laggedArrayVisits++;
			return descriptor(value, key);
		});
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
			await listener!({ type: "run_start", lane: "main", runId: "run", startedAt: 1 }, BACKGROUND_CONTEXT);
			let lagged = 0;
			let caughtUp = 0;
			const send = async (frame: AssistantMessageFrame) => {
				const previous = reducer.message?.content[0];
				const previousArgs = previous?.type === "toolCall" ? previous.arguments : undefined;
				reducer.apply(frame);
				const message = reducer.message!;
				const block = message.content[0];
				measureLag =
					frame.type === "toolcall_delta" && block?.type === "toolCall" && block.arguments === previousArgs;
				if (measureLag) lagged++;
				else if (frame.type === "toolcall_delta") caughtUp++;
				try {
					await listener!(
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
									event: { type: "toolcall_delta", contentIndex: 0, delta: "", partial: message },
								},
						BACKGROUND_CONTEXT,
					);
					await vi.waitFor(() => expect(transcript.state.value.stream?.sequence).toBe(sequence));
				} finally {
					measureLag = false;
				}
				expect(transcript.state.value.snapshot?.operation?.streamingMessage).toEqual(message);
			};
			await send({ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending" }) });
			await send({
				type: "toolcall_start",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: "call", name: "write", arguments: {} },
			});
			await send({ type: "toolcall_delta", contentIndex: 0, delta: `{"values":[${"0,".repeat(size)}"` });
			for (let index = 0; index < 512; index++) {
				await send({ type: "toolcall_delta", contentIndex: 0, delta: "z", rawDelta: "R" });
			}
			expect(lagged).toBeGreaterThan(256);
			expect(caughtUp).toBeGreaterThan(1);
			expect(laggedArrayVisits).toBeLessThan(size * 2);
			await send({ type: "toolcall_delta", contentIndex: 0, delta: '"]}' });
			expect(transcript.state.value.snapshot?.operation?.streamingMessage?.content[0]).toMatchObject({
				arguments: { values: [...Array.from({ length: size }, () => 0), "z".repeat(512)] },
				raw: "R".repeat(512),
			});
			await send({ type: "toolcall_checkpoint", contentIndex: 0, json: '{"replacement":true}' });
			await send({ type: "toolcall_end", contentIndex: 0, id: "call", name: "write", arguments: { final: true } });
			expect(transcript.state.value.snapshot?.operation?.streamingMessage?.content[0]).toMatchObject({
				arguments: { final: true },
			});
		} finally {
			spy.mockRestore();
			await host.close();
		}
	},
	120_000,
);

test("catches up a credit-limited tool preview on the first delta after hydration", async () => {
	const source = new AssistantMessageFrameReducer();
	source.apply({ type: "start", partial: fauxAssistantMessage([], { stopReason: "pending" }) });
	source.apply({
		type: "toolcall_start",
		contentIndex: 0,
		toolCall: { type: "toolCall", id: "call", name: "write", arguments: {} },
	});
	let sequence = 2;
	const apply = (delta: string) => {
		source.apply({ type: "toolcall_delta", contentIndex: 0, delta });
		sequence++;
	};
	apply(`{"values":[${"0,".repeat(4096)}"`);
	let text = "";
	let lagged = false;
	for (let index = 0; index < 512; index++) {
		text += "z";
		apply("z");
		const block = source.message!.content[0];
		if (block.type !== "toolCall") throw new Error("Expected streaming tool call");
		const values = block.arguments.values as unknown[];
		if (values[4096] !== text) {
			lagged = true;
			break;
		}
	}
	expect(lagged).toBe(true);
	const snapshot = laneSnapshot();
	snapshot.operation = {
		id: "run",
		kind: "run",
		startedAt: 1,
		fromTipId: null,
		status: "open",
		runningTools: [],
		streamingMessage: structuredClone(source.message!),
		streamingFrameState: { messageId: "response", sequence, checkpoint: source.checkpoint() },
	};
	const hydrated = new AssistantMessageFrameReducer(
		snapshot.operation.streamingMessage,
		snapshot.operation.streamingFrameState!.checkpoint,
	);
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
		for (const delta of ["tail", "more", '"]}']) {
			const frame: AssistantMessageFrame = { type: "toolcall_delta", contentIndex: 0, delta };
			hydrated.apply(frame);
			const message = hydrated.message!;
			await listener!(
				{
					type: "message_update",
					lane: "main",
					runId: "run",
					entryId: "response",
					frameSequence: ++sequence,
					frame,
					message,
					event: { type: "toolcall_delta", contentIndex: 0, delta, partial: message },
				},
				BACKGROUND_CONTEXT,
			);
			await vi.waitFor(() => expect(transcript.state.value.stream?.sequence).toBe(sequence));
			expect(transcript.state.value.snapshot?.operation?.streamingMessage).toEqual(message);
			const block = message.content[0];
			if (block.type !== "toolCall") throw new Error("Expected hydrated tool call");
			if (delta !== '"]}') text += delta;
			expect((block.arguments.values as unknown[])[4096]).toBe(text);
		}
	} finally {
		await host.close();
	}
});

test("joins cancellation-aware navigation resnapshots when the host closes without publishing late state", async () => {
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, BACKGROUND_CONTEXT);
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const { harness } = await AgentHarness.create({ session, models, model: faux.getModel() }, BACKGROUND_CONTEXT);
	const lane = await harness.lane("main", BACKGROUND_CONTEXT);
	await lane.appendMessage({ role: "user", content: "before navigation", timestamp: 1 }, BACKGROUND_CONTEXT);
	const captured = Promise.withResolvers<AbortSignal | undefined>();
	const cancelled = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	let resnapshotFinished = false;
	const originalWatch = lane.watch.bind(lane);
	let unsubscribe: (() => void) | undefined;
	const watch = vi.spyOn(lane, "watch").mockImplementation(async (context) => {
		const handle = await originalWatch(context);
		unsubscribe = vi.spyOn(handle, "unsubscribe");
		vi.spyOn(handle, "resnapshot").mockImplementation(async (resnapshotContext) => {
			const signal = resnapshotContext.abortSignal;
			const onAbort = () => cancelled.resolve();
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
			captured.resolve(signal);
			try {
				await cancelled.promise;
				await release.promise;
				throw signal?.reason ?? new Error("resnapshot cancelled");
			} finally {
				signal?.removeEventListener("abort", onAbort);
				resnapshotFinished = true;
			}
		});
		return handle;
	});
	const host = createHost({ name: "session", self: null, onError: () => {} });
	const states: TranscriptState[] = [];
	let stop: (() => void) | undefined;
	let closing: Promise<void> | undefined;
	try {
		await host.load([createTranscriptServiceFacet(lane)]);
		const transcript = await host.get(Transcript, {});
		stop = transcript.state.subscribe((state) => states.push(state));
		const navigation = await lane.navigateTree(null, undefined, BACKGROUND_CONTEXT);
		if (!navigation.ok) throw navigation.error;
		const signal = await captured.promise;
		await vi.waitFor(() => expect(states.at(-1)?.events.at(-1)?.event.type).toBe("navigation_end"));
		const beforeClose = states.slice();
		let closed = false;
		closing = host.close().then(() => {
			closed = true;
		});
		await vi.waitFor(() => expect(signal?.aborted).toBe(true));
		expect(closed).toBe(false);
		await lane.appendMessage({ role: "user", content: "during close", timestamp: 2 }, BACKGROUND_CONTEXT);
		release.resolve();
		await closing;
		expect(resnapshotFinished).toBe(true);
		expect(unsubscribe).toHaveBeenCalledOnce();
		await lane.appendMessage({ role: "user", content: "after close", timestamp: 3 }, BACKGROUND_CONTEXT);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(states).toEqual(beforeClose);
	} finally {
		cancelled.resolve();
		release.resolve();
		await (closing ?? host.close());
		stop?.();
		watch.mockRestore();
		await harness.close(BACKGROUND_CONTEXT);
		await session.close(BACKGROUND_CONTEXT);
		await repo.close(BACKGROUND_CONTEXT);
	}
});

test("reports a rejected navigation resnapshot and resumes queued and subsequent provider progress", async () => {
	const repo = new MemorySessionRepo();
	const session = await repo.create({}, BACKGROUND_CONTEXT);
	const faux = fauxProvider({ tokenSize: { min: 4, max: 4 } });
	const models = createModels();
	models.setProvider(faux.provider);
	const { harness } = await AgentHarness.create({ session, models, model: faux.getModel() }, BACKGROUND_CONTEXT);
	const lane = await harness.lane("main", BACKGROUND_CONTEXT);
	await lane.appendMessage({ role: "user", content: "before navigation", timestamp: 1 }, BACKGROUND_CONTEXT);
	const captured = Promise.withResolvers<void>();
	const rejected = Promise.withResolvers<LaneSnapshot>();
	const failure = new Error("navigation capture failed");
	const originalWatch = lane.watch.bind(lane);
	const watch = vi.spyOn(lane, "watch").mockImplementation(async (context) => {
		const handle = await originalWatch(context);
		vi.spyOn(handle, "resnapshot").mockImplementationOnce(() => {
			captured.resolve();
			return rejected.promise;
		});
		return handle;
	});
	const errors: unknown[] = [];
	const host = createHost({ name: "session", self: null, onError: (error) => errors.push(error) });
	let stop: (() => void) | undefined;
	try {
		await host.load([createTranscriptServiceFacet(lane)]);
		const transcript = await host.get(Transcript, {});
		const replay = new TranscriptReplay();
		const boundaries: string[] = [];
		const updates: string[] = [];
		stop = transcript.state.subscribe((state) => {
			for (const event of replay.read(state)) {
				if (event.type === "run_end") boundaries.push(event.runId);
				if (event.type === "message_update" && event.message.role === "assistant") {
					const block = event.message.content[0];
					if (block?.type === "text") updates.push(block.text);
				}
			}
		});
		const navigation = await lane.navigateTree(null, undefined, BACKGROUND_CONTEXT);
		if (!navigation.ok) throw navigation.error;
		await captured.promise;
		const firstAnswer = "queued answer survives a failed capture";
		faux.setResponses([fauxAssistantMessage(firstAnswer, { timestamp: 2 })]);
		const first = await lane.prompt("queued question", undefined, BACKGROUND_CONTEXT);
		if (!first.ok) throw first.error;
		expect(boundaries).toEqual([]);
		rejected.reject(failure);
		await vi.waitFor(() => expect(errors).toEqual([failure]));
		await vi.waitFor(() => expect(boundaries).toEqual([first.value.operationId]));
		expect(updates.at(-1)).toBe(firstAnswer);
		expect(updates.every((text) => firstAnswer.startsWith(text))).toBe(true);
		expect(transcript.state.value.snapshot?.operation).toBeNull();
		expect(transcript.state.value.snapshot?.transcript.at(-1)).toMatchObject({
			message: { role: "assistant", content: [{ type: "text", text: firstAnswer }] },
		});
		updates.length = 0;
		const nextAnswer = "subsequent progress still streams";
		faux.setResponses([fauxAssistantMessage(nextAnswer, { timestamp: 3 })]);
		const next = await lane.prompt("next question", undefined, BACKGROUND_CONTEXT);
		if (!next.ok) throw next.error;
		await vi.waitFor(() => expect(boundaries).toEqual([first.value.operationId, next.value.operationId]));
		expect(updates.at(-1)).toBe(nextAnswer);
		expect(updates.every((text) => nextAnswer.startsWith(text))).toBe(true);
		expect(transcript.state.value.snapshot?.operation).toBeNull();
		const recovered = await lane.navigateTree(null, undefined, BACKGROUND_CONTEXT);
		if (!recovered.ok) throw recovered.error;
		await vi.waitFor(() => expect(transcript.state.value.events.at(-1)?.event.type).toBe("assistant_reset"));
		expect(transcript.state.value.snapshot).toMatchObject({ tipId: null, transcript: [], operation: null });
		expect(errors).toEqual([failure]);
	} finally {
		rejected.resolve(laneSnapshot());
		stop?.();
		await host.close();
		watch.mockRestore();
		await harness.close(BACKGROUND_CONTEXT);
		await session.close(BACKGROUND_CONTEXT);
		await repo.close(BACKGROUND_CONTEXT);
	}
});
