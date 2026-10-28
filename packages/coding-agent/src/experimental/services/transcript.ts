import { copyJson, hostNamed, type JsonRepresentation, type Readable, remote } from "@earendil-works/chord";
import type { LaneSnapshot, LaneTranscriptSnapshot, LaneWatchEvent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type AssistantMessageFrame, AssistantMessageFrameReducer } from "@earendil-works/pi-ai";
import { Type } from "typebox";

/** Assistant progress carries only the existing frame codec, never a growing message prefix. */
export type TranscriptEvent =
	| Exclude<LaneWatchEvent, { type: "message_update" }>
	| {
			type: "assistant_frame";
			phase: "start" | "update";
			lane: string;
			runId: string;
			messageId: string;
			frame: JsonRepresentation<AssistantMessageFrame>;
			recovery?: true;
	  }
	| {
			type: "assistant_reset";
			stream: TranscriptState["stream"];
			message: JsonRepresentation<AssistantMessage> | null;
	  };

export interface TranscriptState {
	snapshot: LaneTranscriptSnapshot | null;
	/** Live decoder checkpoint is updated in place; it is not a replay record. */
	stream: (NonNullable<LaneSnapshot["operation"]>["streamingFrameState"] & { runId: string }) | null;
	/** High-water cursor survives eviction of every replay record, including an oversized event. */
	sequence: number;
	/** Byte- and count-bounded replay; gaps are errors rather than silently lost completion events. */
	events: Array<{ sequence: number; event: TranscriptEvent }>;
}

/** Fold compact records into the existing presentation event contract, starting after hydration. */
export class TranscriptReplay {
	private sequence: number | undefined;
	private stream: { runId: string; messageId: string; reducer: AssistantMessageFrameReducer } | undefined;

	read(state: TranscriptState): LaneWatchEvent[] {
		if (this.sequence === undefined) {
			this.sequence = state.sequence;
			const operation = state.snapshot?.operation;
			if (state.stream !== null) {
				this.stream = {
					runId: state.stream.runId,
					messageId: state.stream.messageId,
					reducer: new AssistantMessageFrameReducer(operation?.streamingMessage, state.stream.checkpoint),
				};
			}
			return [];
		}
		const events: LaneWatchEvent[] = [];
		for (const item of state.events) {
			if (item.sequence <= this.sequence) continue;
			if (item.sequence !== this.sequence + 1) throw replayOverrun();
			this.sequence = item.sequence;
			const event = item.event;
			if (event.type === "assistant_reset") {
				this.stream =
					event.stream === null
						? undefined
						: {
								runId: event.stream.runId,
								messageId: event.stream.messageId,
								reducer: new AssistantMessageFrameReducer(event.message ?? undefined, event.stream.checkpoint),
							};
				continue;
			}
			if (event.type === "assistant_frame") {
				if (event.phase === "start") {
					this.stream = {
						runId: event.runId,
						messageId: event.messageId,
						reducer: new AssistantMessageFrameReducer(),
					};
				}
				const stream = this.stream;
				if (stream?.runId !== event.runId || stream.messageId !== event.messageId) {
					throw new Error("Transcript assistant frame does not match the hydrated response");
				}
				stream.reducer.apply(event.frame);
				const message = stream.reducer.message;
				if (message === undefined) throw new Error("Transcript assistant frame has no start message");
				events.push({
					type: event.phase === "start" ? "message_start" : "message_update",
					lane: event.lane,
					runId: event.runId,
					entryId: event.messageId,
					message: copyJson(message, { omitUndefinedProperties: true }) as JsonRepresentation<AssistantMessage>,
					frame: event.frame,
					...(event.recovery === undefined ? {} : { recovery: event.recovery }),
				});
			} else {
				events.push(event);
				if (event.type === "message_end" || event.type === "run_end" || event.type === "run_suspend")
					this.stream = undefined;
			}
		}
		if (this.sequence !== state.sequence) throw replayOverrun();
		return events;
	}
}

function replayOverrun(): Error {
	return new Error("Transcript event replay window exceeded; reconnect before submitting again");
}

/** Coherent main-lane state replicated through Chord's operation stream. */
export interface Transcript {
	readonly state: Readable<TranscriptState>;
}

export const TranscriptStateSchema = Type.Unsafe<TranscriptState>(
	Type.Object({
		snapshot: Type.Union([Type.Object({}), Type.Null()]),
		sequence: Type.Integer(),
		stream: Type.Union([Type.Object({}), Type.Null()]),
		events: Type.Array(Type.Object({ sequence: Type.Integer(), event: Type.Object({}) })),
	}),
);
export const Transcript = remote("pi.transcript", {
	version: 3,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: { active: { state: { state: TranscriptStateSchema } } },
});
