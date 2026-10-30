import {
	type Context,
	type Ctx,
	type Draft,
	defineFacet,
	hostNamed,
	local,
	type MutableReplicatedState,
	method,
	opaque,
	type ReplicatedState,
	remote,
	replicatedState,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { Op, Path, Seg } from "@earendil-works/chord/delta";
import { ModelCostRatesSchema, ModelThinkingLevelSchema } from "@earendil-works/pi-ai/providers/model-schema";
import { Type } from "typebox";
import type { ConversationHandle, Harness } from "./harness.ts";
import type {
	ConversationSpec,
	ConversationView,
	Entry,
	EntryScan,
	Envelope,
	Id,
	JsonObject,
	JsonValue,
	NewEntry,
	SendInput,
	ViewEvent,
} from "./types.ts";
import { WATCH_CAPACITY, type Watch } from "./view.ts";

export type PublishedConversationView = ConversationView & {
	commit: { events: ViewEvent[] };
	/** A failed publication retains its last revision but is no longer a live view. Reacquire after repair. */
	publication: { status: "live" } | { status: "failed"; error: string };
};

export interface PicoConversationService {
	readonly view: ReplicatedState<PublishedConversationView>;
	send(input: SendInput, ctx: Context): Promise<Id>;
	write(entry: NewEntry, ctx: Context): Promise<Id>;
	inputAbort(id: Id, ctx: Context): Promise<"aborted" | "already_placed" | "not_found">;
	configSet(patch: JsonObject, ctx: Context): Promise<void>;
	abort(ctx: Context): Promise<void>;
	reset(handoff: string | null, ctx: Context): Promise<void>;
	collapse(instructions: string | null, ctx: Context): Promise<Id>;
	fork(at: Id | "start", spec: Omit<ConversationSpec, "parent">, ctx: Context): Promise<Id>;
	entries(scan: EntryScan, ctx: Context): Promise<Entry[]>;
}

/** Local registration/control plane and remote keyed conversation contract used by Chord facets. */
export const PicoHarnessService = local("pi.harness", {
	version: 1,
	input: Type.Object({}),
	members: { harness: opaque<Harness>("pi.harness@1") },
});

const IdSchema = Type.Integer({ minimum: 0 });
const JsonObjectSchema = Type.Unsafe<JsonObject>(Type.Record(Type.String(), Type.Unknown()));
// Chord's JSON links establish the durable JSON value domain before schema validation.
const JsonValueSchema = Type.Unsafe<JsonValue>(Type.Unknown());
const TextContentSchema = Type.Object({
	type: Type.Literal("text"),
	text: Type.String(),
	textSignature: Type.Optional(Type.String()),
});
const ImageContentSchema = Type.Object({
	type: Type.Literal("image"),
	data: Type.String(),
	mimeType: Type.String(),
});
const UserContentSchema = Type.Union([Type.String(), Type.Array(Type.Union([TextContentSchema, ImageContentSchema]))]);
const UsageSchema = Type.Object({
	input: Type.Number(),
	output: Type.Number(),
	cacheRead: Type.Number(),
	cacheWrite: Type.Number(),
	cacheWrite1h: Type.Optional(Type.Number()),
	reasoning: Type.Optional(Type.Number()),
	totalTokens: Type.Number(),
	cost: Type.Object({
		...ModelCostRatesSchema.properties,
		total: Type.Number(),
		totalFromProvider: Type.Optional(Type.Boolean()),
	}),
});
const StoredMessageSchema = Type.Union([
	Type.Object({
		role: Type.Literal("system"),
		content: Type.Union([Type.String(), Type.Array(TextContentSchema)]),
		sections: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]))),
		toolsAdded: Type.Optional(
			Type.Array(
				Type.Object({
					name: Type.String(),
					description: Type.String(),
					parameters: JsonObjectSchema,
					constrainedSampling: Type.Optional(
						Type.Union([
							Type.Literal(false),
							Type.Object({
								type: Type.Literal("json_schema"),
								strict: Type.Union([Type.Literal("prefer"), Type.Literal("require")]),
							}),
							Type.Object({
								type: Type.Literal("grammar"),
								variants: Type.Object({
									openai_lark: Type.Optional(Type.String()),
									openai_regex: Type.Optional(Type.String()),
								}),
							}),
						]),
					),
				}),
			),
		),
		toolsRemoved: Type.Optional(Type.Array(Type.Object({ name: Type.String() }))),
		timestamp: Type.Number(),
	}),
	Type.Object({ role: Type.Literal("user"), content: UserContentSchema, timestamp: Type.Number() }),
	Type.Object({
		role: Type.Literal("assistant"),
		content: Type.Array(
			Type.Union([
				TextContentSchema,
				Type.Object({
					type: Type.Literal("thinking"),
					thinking: Type.String(),
					thinkingSignature: Type.Optional(Type.String()),
					redacted: Type.Optional(Type.Boolean()),
				}),
				Type.Object({
					type: Type.Literal("toolCall"),
					id: Type.String(),
					name: Type.String(),
					arguments: JsonObjectSchema,
					thoughtSignature: Type.Optional(Type.String()),
					namespace: Type.Optional(Type.String()),
					raw: Type.Optional(Type.String()),
					argumentsError: Type.Optional(Type.String()),
				}),
			]),
		),
		api: Type.String(),
		provider: Type.String(),
		model: Type.String(),
		responseModel: Type.Optional(Type.String()),
		responseId: Type.Optional(Type.String()),
		providerThinkingLevel: Type.Optional(Type.String()),
		thinkingLevel: Type.Optional(ModelThinkingLevelSchema),
		diagnostics: Type.Optional(
			Type.Array(
				Type.Object({
					type: Type.String(),
					timestamp: Type.Number(),
					error: Type.Optional(
						Type.Object({
							name: Type.Optional(Type.String()),
							message: Type.String(),
							stack: Type.Optional(Type.String()),
							code: Type.Optional(Type.Union([Type.String(), Type.Number()])),
						}),
					),
					details: Type.Optional(JsonObjectSchema),
				}),
			),
		),
		usage: UsageSchema,
		stopReason: Type.Union([
			Type.Literal("pending"),
			Type.Literal("stop"),
			Type.Literal("length"),
			Type.Literal("toolUse"),
			Type.Literal("error"),
			Type.Literal("aborted"),
			Type.Literal("deferred"),
		]),
		deferred: Type.Optional(
			Type.Object({
				provider: Type.String(),
				modelId: Type.String(),
				api: Type.String(),
				id: Type.String(),
				expiresAt: Type.Optional(Type.Number()),
				pollAfterMs: Type.Optional(Type.Number()),
				data: Type.Optional(JsonValueSchema),
			}),
		),
		errorMessage: Type.Optional(Type.String()),
		rawStopReason: Type.Optional(Type.String()),
		endTurn: Type.Optional(Type.Boolean()),
		timestamp: Type.Number(),
		durationMs: Type.Optional(Type.Number()),
	}),
	Type.Object({
		role: Type.Literal("toolResult"),
		toolCallId: Type.String(),
		toolName: Type.String(),
		content: Type.Array(Type.Union([TextContentSchema, ImageContentSchema])),
		details: Type.Optional(JsonValueSchema),
		usage: Type.Optional(UsageSchema),
		nestedCalls: Type.Optional(
			Type.Object({
				calls: Type.Array(
					Type.Object({
						id: Type.String(),
						name: Type.String(),
						arguments: Type.Optional(JsonObjectSchema),
						argumentsBytes: Type.Optional(Type.Number()),
						status: Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("unfinished")]),
						durationMs: Type.Optional(Type.Number()),
						error: Type.Optional(Type.String()),
					}),
				),
				complete: Type.Boolean(),
			}),
		),
		isError: Type.Boolean(),
		timestamp: Type.Number(),
		durationMs: Type.Optional(Type.Number()),
	}),
]);
const ContextEditSchema = Type.Object({
	target: IdSchema,
	action: Type.Union([Type.Literal("omit"), Type.Literal("replace")]),
	messages: Type.Optional(Type.Array(StoredMessageSchema)),
});
const ConversationSpecSchema = Type.Unsafe<Omit<ConversationSpec, "parent">>(
	Type.Object({
		rewindable: Type.Optional(JsonObjectSchema),
		sticky: Type.Optional(JsonObjectSchema),
		sections: Type.Optional(
			Type.Array(
				Type.Union([
					Type.Object({ key: Type.String(), value: Type.Unknown() }),
					Type.Object({ key: Type.String(), remove: Type.Literal(true) }),
				]),
			),
		),
	}),
);

export const PicoConversationService = remote("pi.conversation", {
	version: 2,
	input: Type.Object({ conversationId: IdSchema }),
	host: hostNamed("harness"),
	variants: {
		conversation: {
			state: {
				view: Type.Unsafe<PublishedConversationView>(
					Type.Object({
						conversation: Type.Object({ id: IdSchema }),
						entries: Type.Array(Type.Unknown()),
						config: JsonObjectSchema,
						inbox: Type.Array(Type.Unknown()),
						turn: Type.Optional(Type.Object({})),
						compaction: Type.Optional(Type.Object({})),
						tasks: JsonObjectSchema,
						plugins: JsonObjectSchema,
						commit: Type.Object({ events: Type.Array(Type.Unknown()) }),
						publication: Type.Union([
							Type.Object({ status: Type.Literal("live") }),
							Type.Object({ status: Type.Literal("failed"), error: Type.String() }),
						]),
					}),
				),
			},
			methods: {
				send: method(
					Type.Object({
						content: UserContentSchema,
						requestId: Type.Optional(Type.String()),
						whenBusy: Type.Optional(
							Type.Union([Type.Literal("steer"), Type.Literal("followUp"), Type.Literal("reject")]),
						),
					}),
					IdSchema,
				),
				write: method(
					Type.Object({
						kind: Type.String(),
						model: Type.Optional(Type.Array(StoredMessageSchema)),
						data: Type.Optional(JsonObjectSchema),
						head: Type.Optional(Type.Union([IdSchema, Type.Literal("self")])),
						edits: Type.Optional(Type.Array(ContextEditSchema)),
					}),
					IdSchema,
				),
				inputAbort: method(
					IdSchema,
					Type.Union([Type.Literal("aborted"), Type.Literal("already_placed"), Type.Literal("not_found")]),
				),
				configSet: method(JsonObjectSchema),
				abort: method(),
				reset: method(Type.Union([Type.String(), Type.Null()])),
				collapse: method(Type.Union([Type.String(), Type.Null()]), IdSchema),
				fork: method(
					Type.Object({ at: Type.Union([IdSchema, Type.Literal("start")]), spec: ConversationSpecSchema }),
					IdSchema,
				),
				entries: method(
					Type.Unsafe<EntryScan>(
						Type.Object({
							conversationId: IdSchema,
							kind: Type.Optional(Type.String()),
							withHead: Type.Optional(Type.Boolean()),
							before: Type.Optional(IdSchema),
							limit: Type.Integer({ minimum: 0 }),
						}),
					),
					Type.Unsafe<Entry[]>(
						Type.Array(Type.Object({ id: IdSchema, conversationId: IdSchema, kind: Type.String() })),
					),
				),
			},
		},
	},
});

/** Host the durable harness and its keyed conversations through native Chord objects. */
export function createPicoHarnessFacet(harness: Harness) {
	return {
		name: "pi.harness",
		...defineFacet(({ serve }) => {
			serve(PicoHarnessService, () => ({ harness }), { lifetime: "host" });
			serve(PicoConversationService, ({ conversationId }, _principal, self) => {
				const source = self.resource("conversation", {
					version: 2,
					async open({ signal }) {
						const context = withAbortSignal(signal, BACKGROUND_CONTEXT);
						const conversation = await harness.conversation(conversationId, context);
						if (conversation === undefined) throw new Error(`conversation ${conversationId} not found`);
						return attachChordView(conversation, replicatedState, context);
					},
					close: (bridge) => bridge.close(),
				});
				const view = self.state("view", PicoConversationService.def.variants.conversation.state.view, {
					init: () => source.value.view.value,
				});
				self.on(
					"view",
					source,
					(bridge) => bridge.view,
					(value, ctx) => view.replace(ctx, value),
				);
				const conversation = async (ctx: Ctx) => {
					const context = withAbortSignal(ctx.signal, BACKGROUND_CONTEXT);
					const handle = await harness.conversation(conversationId, context);
					if (handle === undefined) throw new Error(`conversation ${conversationId} not found`);
					return { service: createPicoConversationService(harness, handle, source.value.view), context };
				};
				return {
					variant: "conversation",
					view,
					async send(input, ctx) {
						const active = await conversation(ctx);
						return active.service.send(input, active.context);
					},
					async write(entry, ctx) {
						const active = await conversation(ctx);
						return active.service.write(entry, active.context);
					},
					async inputAbort(id, ctx) {
						const active = await conversation(ctx);
						return active.service.inputAbort(id, active.context);
					},
					async configSet(patch, ctx) {
						const active = await conversation(ctx);
						await active.service.configSet(patch, active.context);
					},
					async abort(ctx) {
						const active = await conversation(ctx);
						await active.service.abort(active.context);
					},
					async reset(handoff, ctx) {
						const active = await conversation(ctx);
						await active.service.reset(handoff, active.context);
					},
					async collapse(instructions, ctx) {
						const active = await conversation(ctx);
						return active.service.collapse(instructions, active.context);
					},
					async fork({ at, spec }, ctx) {
						const active = await conversation(ctx);
						return active.service.fork(at, spec, active.context);
					},
					async entries(scan, ctx) {
						const active = await conversation(ctx);
						return active.service.entries(scan, active.context);
					},
				};
			});
		}),
	};
}

export function createPicoConversationService<Cfg extends object>(
	harness: Pick<Harness, "abortInput" | "entries">,
	conversation: ConversationHandle<Cfg>,
	view: ReplicatedState<PublishedConversationView>,
): PicoConversationService {
	return {
		view,
		send: (input, ctx) => conversation.send(input, ctx).then((handle) => handle.id),
		write: (entry, ctx) => conversation.write(entry, ctx),
		inputAbort: (id, ctx) => harness.abortInput(id, ctx, conversation.id),
		configSet: (patch, ctx) => conversation.config.set(patch as never, ctx),
		abort: (ctx) => conversation.abort(ctx),
		reset: (handoff, ctx) => conversation.reset(handoff ?? undefined, ctx),
		collapse: (instructions, ctx) => conversation.collapse(instructions ?? undefined, ctx),
		fork: (at, spec, ctx) => conversation.fork(at, spec, ctx).then((child) => child.id),
		entries: (scan, ctx) => harness.entries({ ...scan, conversationId: conversation.id }, ctx),
	};
}

export interface ChordViewBridge {
	readonly view: MutableReplicatedState<PublishedConversationView>;
	readonly closed: boolean;
	close(): void;
}

export interface ChordViewBridgeOptions {
	capacity?: number;
	/** Called after the raw watch is closed. The owner should close and respawn its keyed service instance. */
	onFailure?: (error: Error) => void;
}

/**
 * Adapt Pico's commit-granular envelopes to one Chord publication per commit.
 * The raw listener only enqueues. Applying ops and publishing happen together,
 * off the Session line, with no await between them.
 */
export async function attachChordView(
	conversation: Pick<ConversationHandle, "watch">,
	createState: (initial: PublishedConversationView) => MutableReplicatedState<PublishedConversationView>,
	ctx: Context,
	opts: ChordViewBridgeOptions = {},
): Promise<ChordViewBridge> {
	const watch = await conversation.watch(ctx);
	const view = createState({
		...structuredClone(watch.view),
		commit: { events: [] },
		publication: { status: "live" },
	});
	return bridgeWatch(watch, view, ctx, opts);
}

function bridgeWatch(
	watch: Watch,
	view: MutableReplicatedState<PublishedConversationView>,
	ctx: Context,
	opts: ChordViewBridgeOptions,
): ChordViewBridge {
	const capacity = opts.capacity ?? WATCH_CAPACITY;
	if (!Number.isSafeInteger(capacity) || capacity < 1)
		throw new RangeError("Chord view queue capacity must be positive");
	const queue: Envelope[] = [];
	let scheduled = false;
	let closed = false;
	const fail = (cause: unknown) => {
		if (closed) return;
		closed = true;
		queue.length = 0;
		watch.stop();
		const error = cause instanceof Error ? cause : new Error(String(cause));
		try {
			view.change(ctx, (draft) => {
				draft.publication = { status: "failed", error: error.message };
				draft.commit.events = [];
			});
		} catch (publicationError) {
			// The failure callback still receives the publication failure when even the terminal update cannot publish.
			cause = publicationError;
		}
		try {
			opts.onFailure?.(cause instanceof Error ? cause : new Error(String(cause)));
		} catch {}
	};
	const drain = () => {
		scheduled = false;
		while (!closed && queue.length > 0) {
			const envelope = queue.shift()!;
			try {
				view.change(ctx, (draft) => {
					applyTracked(draft, envelope.ops);
					draft.commit.events = envelope.events as Draft<ViewEvent[]>;
				});
			} catch (error) {
				fail(error);
			}
		}
	};
	watch.start((envelope) => {
		if (closed) return;
		if (queue.length >= capacity) {
			fail(new Error(`Pico-to-Chord view queue exceeded ${capacity} envelopes`));
			return;
		}
		queue.push(envelope);
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(drain);
	});
	void watch.ended.then((end) => {
		if (end.reason === "failed") fail(end.error);
		else if (!closed) fail(new Error("Pico view watch stopped"));
	});
	return {
		view,
		get closed() {
			return closed;
		},
		close() {
			if (closed) return;
			closed = true;
			queue.length = 0;
			watch.stop();
		},
	};
}

function applyTracked(root: Draft<PublishedConversationView>, ops: readonly Op[]): void {
	for (const op of ops) {
		if (op[0] === "r") {
			// Tracker budget fallback replaces Pico's view, not the bridge's publication metadata.
			const replacement = op[1];
			if (replacement === null || typeof replacement !== "object" || Array.isArray(replacement))
				throw new Error("Pico view root must be an object");
			const record = root as unknown as Record<string, unknown>;
			for (const key of Object.keys(record)) {
				if (key !== "publication" && key !== "commit") delete record[key];
			}
			for (const [key, value] of Object.entries(replacement)) {
				if (key !== "publication" && key !== "commit") record[key] = value;
			}
			continue;
		}
		const path = op[1];
		if (op[0] === "p") {
			const target = resolve(root, path);
			if (!Array.isArray(target)) throw new Error(`Pico splice path is not an array: ${path.join(".")}`);
			(target as unknown[]).splice(op[2], op[3], ...op[4]);
			continue;
		}
		if (op[0] === "m") {
			const target = resolve(root, path);
			if (!Array.isArray(target) || target.length !== op[2].length) {
				throw new Error(`Pico permutation path is not a matching array: ${path.join(".")}`);
			}
			const array = target as unknown[];
			const previous = array.slice();
			const rank = new Map<unknown, number>();
			for (let index = 0; index < op[2].length; index++) {
				const value = previous[op[2][index]!]!;
				if (!rank.has(value)) rank.set(value, index);
			}
			array.sort((left, right) => rank.get(left)! - rank.get(right)!);
			continue;
		}
		const parent = resolve(root, path.slice(0, -1));
		if (parent === null || typeof parent !== "object")
			throw new Error(`Pico operation parent is not an object: ${path.join(".")}`);
		const key = path[path.length - 1]!;
		if (op[0] === "d") {
			if (Array.isArray(parent)) parent.splice(key as number, 1);
			else delete (parent as Record<PropertyKey, unknown>)[key];
			continue;
		}
		const record = parent as Record<PropertyKey, unknown>;
		if (op[0] === "s") record[key] = op[2];
		else if (op[0] === "a") record[key] = `${String(record[key])}${op[2]}`;
		else record[key] = String(record[key]).slice(op[2]);
	}
}

function resolve(root: unknown, path: Path): unknown {
	let value = root;
	for (const segment of path) {
		if (value === null || typeof value !== "object") return undefined;
		value = (value as Record<Seg, unknown>)[segment];
	}
	return value;
}
