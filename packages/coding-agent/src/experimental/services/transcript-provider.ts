import {
	copyJson,
	defineFacet,
	type Facet,
	type JsonRepresentation,
	type JsonValue,
	local,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { appendText, type Draft } from "@earendil-works/chord/delta";
import {
	type AgentLane,
	type HarnessEvent,
	type LaneSnapshot,
	type LaneTranscriptSnapshot,
	type LaneWatchEvent,
	reduceLaneSnapshot,
} from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	type AssistantMessageFrame,
	AssistantMessageFrameReducer,
	type JsonChange,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Transcript, type TranscriptEvent, TranscriptStateSchema } from "./transcript.ts";

const TranscriptRuntime = local("pi.local.transcript-runtime", {
	version: 3,
	input: Type.Object({}),
	members: { state: TranscriptStateSchema },
});

const MAX_REPLAY_EVENTS = 256;
const MAX_REPLAY_BYTES = 1024 * 1024;

interface TranscriptStream {
	sequence: number;
	runId: string;
	messageId: string;
	reducer: AssistantMessageFrameReducer;
}

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
					let stream: TranscriptStream | undefined;
					const state = self.state("transcript", TranscriptStateSchema, {
						init: () => {
							stream = hydrateStream(watch.value.opened.snapshot);
							const snapshot = structuredClone(watch.value.opened.snapshot);
							const operation = snapshot.operation;
							const frameState = operation?.streamingFrameState;
							if (operation) delete operation.streamingFrameState;
							return {
								snapshot: snapshot as LaneTranscriptSnapshot,
								sequence: 0,
								stream: frameState && operation ? { ...frameState, runId: operation.id } : null,
								events: [],
							};
						},
					});
					let rebase: Promise<void> | undefined;
					const replaySizes: number[] = [];
					let replayBytes = 2;
					const retainReplay = (
						event: TranscriptEvent,
						sequence: number,
					): { retain: boolean; evicted: number } => {
						const size = Buffer.byteLength(JSON.stringify({ sequence, event })) + 1;
						replaySizes.push(size);
						replayBytes += size;
						let evicted = 0;
						while (replaySizes.length > MAX_REPLAY_EVENTS || replayBytes > MAX_REPLAY_BYTES) {
							replayBytes -= replaySizes.shift()!;
							evicted++;
						}
						return { retain: size <= MAX_REPLAY_BYTES - 2, evicted };
					};
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
							let forwarded: TranscriptEvent | undefined;
							if (
								(event.type === "message_start" || event.type === "message_update") &&
								event.frame !== undefined &&
								stream !== undefined &&
								stream.messageId === event.entryId &&
								event.frameSequence !== undefined &&
								event.frameSequence <= stream.sequence
							)
								return;
							if (
								event.type === "message_start" &&
								event.message.role === "assistant" &&
								event.message.stopReason === "pending"
							) {
								if (
									event.runId === undefined ||
									event.entryId === undefined ||
									event.frame?.type !== "start" ||
									event.frameSequence !== 1
								)
									throw new Error("Harness assistant start is missing response identity or start frame");
								stream = {
									runId: event.runId,
									messageId: event.entryId,
									sequence: event.frameSequence,
									reducer: new AssistantMessageFrameReducer(),
								};
								stream.reducer.apply(event.frame);
								forwarded = {
									type: "assistant_frame",
									phase: "start",
									lane: event.lane,
									runId: event.runId,
									messageId: event.entryId,
									frame: copyJson(event.frame, {
										omitUndefinedProperties: true,
									}) as JsonRepresentation<AssistantMessageFrame>,
									...(event.recovery ? { recovery: event.recovery } : {}),
								};
							} else if (event.type === "message_update") {
								if (event.frame !== undefined) {
									if (
										stream?.runId !== event.runId ||
										stream.messageId !== event.entryId ||
										event.frameSequence !== stream.sequence + 1
									)
										throw new Error("Harness assistant update does not match the watched response");
									stream.reducer.apply(event.frame);
									stream.sequence = event.frameSequence;
									forwarded = {
										type: "assistant_frame",
										phase: "update",
										lane: event.lane,
										runId: event.runId,
										messageId: stream.messageId,
										frame: copyJson(event.frame, {
											omitUndefinedProperties: true,
										}) as JsonRepresentation<AssistantMessageFrame>,
										...(event.recovery ? { recovery: event.recovery } : {}),
									};
								}
							} else {
								forwarded = toLaneWatchEvent(event);
								if (event.type === "message_end" || event.type === "run_end" || event.type === "run_suspend")
									stream = undefined;
							}
							if (forwarded === undefined && event.type !== "message_update") return;
							const sequence = state.value.sequence + (forwarded === undefined ? 0 : 1);
							const retention = forwarded === undefined ? undefined : retainReplay(forwarded, sequence);
							const checkpoint = stream?.reducer.checkpoint();
							const streamingMessage = stream?.reducer.message;
							let needsRebase = false;
							state.change(ctx, (draft) => {
								if (event.type !== "message_start" && event.type !== "message_update") {
									needsRebase =
										reduceLaneSnapshot(draft.snapshot as unknown as LaneSnapshot, event) === "rebase";
								} else if (forwarded?.type !== "assistant_frame" && event.type === "message_start") {
									needsRebase =
										reduceLaneSnapshot(draft.snapshot as unknown as LaneSnapshot, event) === "rebase";
								}
								const operation = draft.snapshot?.operation;
								if (
									operation &&
									stream &&
									operation.id === stream.runId &&
									streamingMessage !== undefined &&
									forwarded?.type === "assistant_frame"
								) {
									applyFrameMessage(
										operation,
										streamingMessage,
										forwarded.frame,
										stream.reducer.toolArgumentChanges,
									);
								}
								if (stream && checkpoint) {
									const current = draft.stream;
									if (current?.messageId === stream.messageId) {
										for (const block of checkpoint.blocks) {
											const previous = current.checkpoint.blocks.find(
												(entry) => entry.contentIndex === block.contentIndex,
											);
											if (previous === undefined) current.checkpoint.blocks.push(block);
											else if (
												previous.state.kind === "toolCall" &&
												block.state.kind === "toolCall" &&
												forwarded?.type === "assistant_frame" &&
												forwarded.frame.type === "toolcall_delta" &&
												previous.contentIndex === forwarded.frame.contentIndex
											) {
												appendText(previous.state, "json", forwarded.frame.delta);
												previous.state.ended = block.state.ended;
											} else Object.assign(previous.state, block.state);
										}
										for (let index = current.checkpoint.blocks.length - 1; index >= 0; index--) {
											if (
												!checkpoint.blocks.some(
													(block) => block.contentIndex === current.checkpoint.blocks[index]!.contentIndex,
												)
											)
												current.checkpoint.blocks.splice(index, 1);
										}
										current.sequence = stream.sequence;
									} else
										draft.stream = {
											runId: stream.runId,
											messageId: stream.messageId,
											sequence: stream.sequence,
											checkpoint,
										};
								} else draft.stream = null;
								if (forwarded !== undefined && retention !== undefined) {
									draft.sequence = sequence;
									if (retention.retain) draft.events.push({ sequence, event: forwarded });
									if (retention.evicted > 0)
										draft.events.splice(0, Math.min(retention.evicted, draft.events.length));
								}
							});
							if (needsRebase && rebase === undefined) {
								rebase = (async () => {
									const snapshot = await watch.value.opened.resnapshot(
										withAbortSignal(ctx.signal, BACKGROUND_CONTEXT),
									);
									stream = hydrateStream(snapshot);
									const operation = snapshot.operation;
									const frameState = operation?.streamingFrameState;
									const nextStream = frameState && operation ? { ...frameState, runId: operation.id } : null;
									const reset: TranscriptEvent = {
										type: "assistant_reset",
										stream: nextStream,
										message:
											operation?.streamingMessage === undefined
												? null
												: (copyJson(operation.streamingMessage, {
														omitUndefinedProperties: true,
													}) as JsonRepresentation<AssistantMessage>),
									};
									const sequence = state.value.sequence + 1;
									const retention = retainReplay(reset, sequence);
									state.change(ctx, (draft) => {
										const captured = structuredClone(snapshot);
										const operation = captured.operation;
										const frameState = operation?.streamingFrameState;
										if (operation) delete operation.streamingFrameState;
										draft.snapshot = captured as LaneTranscriptSnapshot;
										draft.stream = frameState && operation ? { ...frameState, runId: operation.id } : null;
										draft.sequence = sequence;
										if (retention.retain) draft.events.push({ sequence, event: reset });
										if (retention.evicted > 0)
											draft.events.splice(0, Math.min(retention.evicted, draft.events.length));
									});
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

function toLaneWatchEvent(event: HarnessEvent): Exclude<LaneWatchEvent, { type: "message_update" }> | undefined {
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
			return event as Exclude<LaneWatchEvent, { type: "message_update" }>;
		case "message_update":
			return undefined;
		default:
			return event as Exclude<LaneWatchEvent, { type: "message_update" }>;
	}
}

function hydrateStream(snapshot: LaneSnapshot): TranscriptStream | undefined {
	const operation = snapshot.operation;
	const state = operation?.streamingFrameState;
	return operation && state
		? {
				sequence: state.sequence,
				runId: operation.id,
				messageId: state.messageId,
				reducer: new AssistantMessageFrameReducer(operation.streamingMessage, state.checkpoint),
			}
		: undefined;
}

/** Apply touched paths for ordinary deltas; reconcile exceptional and authoritative previews exactly. */
function applyFrameMessage(
	operation: Draft<NonNullable<LaneTranscriptSnapshot["operation"]>>,
	message: AssistantMessage,
	frame: JsonRepresentation<AssistantMessageFrame>,
	argumentChanges: readonly JsonChange[] | undefined,
): void {
	if (frame.type === "start") {
		operation.streamingMessage = copyJson(message, {
			omitUndefinedProperties: true,
		}) as JsonRepresentation<AssistantMessage>;
		return;
	}
	const target = operation.streamingMessage;
	if (target === undefined) throw new Error("Transcript frame has no snapshot message");
	const block = target.content[frame.contentIndex];
	if (frame.type === "text_delta" && block?.type === "text") {
		appendText(block, "text", frame.delta);
		return;
	}
	if (frame.type === "thinking_delta" && block?.type === "thinking") {
		appendText(block, "thinking", frame.delta);
		return;
	}
	if (frame.type === "toolcall_delta" && block?.type === "toolCall" && argumentChanges !== undefined) {
		for (const change of argumentChanges) {
			if (change.path.length === 0) {
				if (change.kind === "set") {
					const value = copyJson(change.value);
					block.arguments = isJsonRecord(value) ? value : {};
				}
				continue;
			}
			let parent: JsonValue = block.arguments;
			for (const part of change.path.slice(0, -1)) {
				if (typeof parent !== "object" || parent === null || !Object.hasOwn(parent, part))
					throw new Error("Transcript argument delta has no parent");
				parent = (parent as Record<string | number, JsonValue>)[part]!;
			}
			if (typeof parent !== "object" || parent === null)
				throw new Error("Transcript argument delta has no container");
			const key = change.path[change.path.length - 1]!;
			if (change.kind === "append") {
				if (Array.isArray(parent)) {
					const current = parent[Number(key)];
					if (typeof current !== "string") throw new Error("Transcript argument append has no string");
					parent[Number(key)] = current + change.text;
				} else appendText(parent as Draft<Record<string, string>>, String(key), change.text);
			} else (parent as Record<string | number, JsonValue>)[key] = copyJson(change.value);
		}
		if (frame.rawDelta !== undefined) {
			if (block.raw === undefined) block.raw = frame.rawDelta;
			else appendText(block as Draft<{ raw: string }>, "raw", frame.rawDelta);
		}
		return;
	}
	const content = message.content[frame.contentIndex];
	if (content === undefined) throw new Error("Transcript frame has no decoded content block");
	assignJsonField(
		target.content as Draft<JsonValue[]>,
		frame.contentIndex,
		copyJson(content, { omitUndefinedProperties: true }),
	);
}

/** Reconcile a tool/block checkpoint leaf by leaf so unchanged prefixes are not sent as container sets. */
function assignJsonField(
	target: Draft<Record<string, JsonValue> | JsonValue[]>,
	key: string | number,
	value: JsonValue,
): void {
	const slots = target as Record<string | number, JsonValue>;
	const current = slots[key];
	if (isJsonRecord(current) && isJsonRecord(value)) {
		for (const name of Object.keys(current)) if (!Object.hasOwn(value, name)) delete current[name];
		for (const [name, child] of Object.entries(value)) assignJsonField(current, name, child);
	} else if (Array.isArray(current) && Array.isArray(value)) {
		if (current.length > value.length) current.splice(value.length);
		for (let index = 0; index < value.length; index++) {
			if (index < current.length) assignJsonField(current, index, value[index]!);
			else current.push(value[index]!);
		}
	} else if (
		!Array.isArray(target) &&
		typeof current === "string" &&
		typeof value === "string" &&
		value.startsWith(current)
	) {
		appendText(target as Draft<Record<string, string>>, String(key), value.slice(current.length));
	} else if (current !== value) slots[key] = value;
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
