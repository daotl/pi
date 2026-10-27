import { createHost, type Frame, type Link, memoryLinkPair } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AgentLane, EventListener, HarnessEvent, LaneSnapshot, WatchHandle } from "@earendil-works/pi-agent-core";
import { describe, expect, test, vi } from "vitest";
import { Transcript, type TranscriptState } from "../src/experimental/services/transcript.ts";
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

	test("publishes coherent state and rebases after navigation", async () => {
		let listener: EventListener | undefined;
		const replacement = laneSnapshot("replacement-tip");
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
			const states: TranscriptState[] = [];
			transcript.state.subscribe((value) => {
				if (value.snapshot !== null) states.push(value);
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

			transcript.release();
		} finally {
			await host.close();
		}
		expect(unsubscribe).toHaveBeenCalledOnce();
	});
});
