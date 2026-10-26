import { defineFacet, type Facet, local } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import {
	type AgentLane,
	type HarnessEvent,
	type LaneSnapshot,
	type LaneTranscriptSnapshot,
	type LaneWatchEvent,
	reduceLaneSnapshot,
} from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { Transcript, TranscriptStateSchema } from "./transcript.ts";

const TranscriptRuntime = local("pi.local.transcript-runtime", {
	version: 1,
	input: Type.Object({}),
	members: { state: TranscriptStateSchema },
});

export function createTranscriptServiceFacet(lane: AgentLane): Facet {
	return {
		name: "@pi/transcript",
		...defineFacet(({ serve }) => {
			serve(
				TranscriptRuntime,
				(_input, _principal, self) => {
					const watch = self.resource("lane-watch", {
						version: 1,
						open: async ({ signal }) => {
							const opened = await lane.watch(withAbortSignal(signal, BACKGROUND_CONTEXT));
							return { opened, listener: undefined as ((event: HarnessEvent) => void) | undefined };
						},
						close: (watch) => watch.opened.unsubscribe(),
					});
					const state = self.state("transcript", TranscriptStateSchema, {
						init: () => ({ snapshot: watch.value.opened.snapshot as LaneTranscriptSnapshot, event: null }),
					});
					let rebase: Promise<void> | undefined;
					self.on(
						"lane-events",
						watch,
						(resource) => ({
							subscribe(listener: (event: HarnessEvent) => void) {
								resource.listener = listener;
								resource.opened.start((event) => resource.listener?.(event));
								return () => {
									resource.listener = undefined;
								};
							},
						}),
						async (event, ctx) => {
							const forwarded = toLaneWatchEvent(event);
							if (forwarded === undefined) return;
							let needsRebase = false;
							state.change(ctx, (draft) => {
								needsRebase = reduceLaneSnapshot(draft.snapshot as unknown as LaneSnapshot, event) === "rebase";
								draft.event = forwarded;
							});
							if (needsRebase && rebase === undefined) {
								rebase = (async () => {
									const snapshot = await watch.value.opened.resnapshot(
										withAbortSignal(ctx.signal, BACKGROUND_CONTEXT),
									);
									state.replace(ctx, { snapshot: snapshot as LaneTranscriptSnapshot, event: null });
								})();
								try {
									await rebase;
								} finally {
									rebase = undefined;
								}
							}
						},
					);
					return { state };
				},
				{ lifetime: "host" },
			);
			serve(Transcript, (_input, _principal, self) => ({
				variant: "active",
				state: self.get(TranscriptRuntime, {}).state,
			}));
		}),
	};
}

function toLaneWatchEvent(event: HarnessEvent): LaneWatchEvent | undefined {
	switch (event.type) {
		case "handler_error":
		case "turn_start":
		case "turn_end":
		case "value_update":
		case "lane_created":
			return undefined;
		case "config_update":
			if (event.property !== "model" && event.property !== "thinkingLevel" && event.property !== "activeTools")
				return undefined;
			return event as LaneWatchEvent;
		case "message_update": {
			if (event.message.role !== "assistant")
				throw new TypeError("Harness message_update did not carry an assistant message");
			const { event: _providerEvent, ...update } = event;
			return update as LaneWatchEvent;
		}
		default:
			return event as LaneWatchEvent;
	}
}
