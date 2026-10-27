import { hostNamed, type Readable, remote } from "@earendil-works/chord";
import type { LaneTranscriptSnapshot, LaneWatchEvent } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

export interface TranscriptState {
	snapshot: LaneTranscriptSnapshot | null;
	/** Bounded replay window; sequence numbers expose any consumer overrun instead of silently losing events. */
	events: Array<{ sequence: number; event: LaneWatchEvent }>;
}

/** Coherent main-lane state replicated through Chord's operation stream. */
export interface Transcript {
	readonly state: Readable<TranscriptState>;
}

export const TranscriptStateSchema = Type.Unsafe<TranscriptState>(
	Type.Object({
		snapshot: Type.Union([Type.Object({}), Type.Null()]),
		events: Type.Array(Type.Object({ sequence: Type.Integer(), event: Type.Object({}) })),
	}),
);
export const Transcript = remote("pi.transcript", {
	version: 2,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: { active: { state: { state: TranscriptStateSchema } } },
});
