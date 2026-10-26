import { hostNamed, type Readable, remote } from "@earendil-works/chord";
import type { LaneTranscriptSnapshot, LaneWatchEvent } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

export interface TranscriptState {
	snapshot: LaneTranscriptSnapshot | null;
	/** The source event is retained for presentation side effects; hydration does not replay it. */
	event: LaneWatchEvent | null;
}

/** Coherent main-lane state replicated through Chord's operation stream. */
export interface Transcript {
	readonly state: Readable<TranscriptState>;
}

export const TranscriptStateSchema = Type.Unsafe<TranscriptState>(
	Type.Object({
		snapshot: Type.Union([Type.Object({}), Type.Null()]),
		event: Type.Union([Type.Object({}), Type.Null()]),
	}),
);
export const Transcript = remote("pi.transcript", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: { active: { state: { state: TranscriptStateSchema } } },
});
