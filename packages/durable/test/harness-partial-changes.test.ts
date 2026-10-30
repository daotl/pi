import { copyJson } from "@earendil-works/chord";
import { type Op, track } from "@earendil-works/chord/delta";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	normalizeContext,
	type ToolCall,
	ToolCallArgumentsStream,
} from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { stream as streamOpenAICompletions } from "../../ai/src/api/openai-completions.ts";
import type { LiveState } from "../src/harness/live.ts";
import { PartialChanges, type PartialMessage } from "../src/harness/partial-changes.ts";

// #9265: partial commits reassigned the growing strings of a streamed answer, and Chord compared each one whole.

type Live = { generation: NonNullable<LiveState["generation"]> };

/**
 * A response streaming one text block (started empty) and then one tool call, as a provider produces it: the partial
 * message it mutates and the events it emits. Partial commits go into a tracked document, as Durable's generation does.
 */
function setup() {
	const partial: AssistantMessage = {
		role: "assistant",
		content: [{ type: "text", text: "" }],
		api: "test",
		provider: "test",
		model: "test",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: 0,
	};
	const changes = new PartialChanges();
	const tracker = track<Live>({ generation: { attempt: 1 } });
	const args = new ToolCallArgumentsStream();
	const emit = (event: AssistantMessageEvent) => changes.observe(event);
	const ops: Op[][] = [];
	return {
		partial,
		tracker,
		ops,
		text(delta: string) {
			(partial.content[0] as { text: string }).text += delta;
			emit({ type: "text_delta", contentIndex: 0, delta, partial });
		},
		argument(delta: string) {
			if (partial.content[1] === undefined) {
				partial.content.push({ type: "toolCall", id: "c1", name: "write", arguments: {} });
				emit({ type: "toolcall_start", contentIndex: 1, partial });
			}
			(partial.content[1] as { arguments: Record<string, unknown> }).arguments = args.append(delta);
			emit({ type: "toolcall_delta", contentIndex: 1, delta, partial });
		},
		/** The provider ends both blocks. */
		endBlocks() {
			emit({ type: "text_end", contentIndex: 0, content: (partial.content[0] as { text: string }).text, partial });
			emit({ type: "toolcall_end", contentIndex: 1, toolCall: partial.content[1] as ToolCall, partial });
		},
		/** One partial commit, as the generation's throttle makes it; `fail` aborts it like a rejected commit. */
		commit(fail = false, afterTake?: () => void) {
			// As the generation copies it: `copyJson()` returns untyped JSON, here a message's JSON representation.
			const message = copyJson(partial) as PartialMessage;
			const taken = changes.take(message);
			afterTake?.();
			const change = tracker.beginChange();
			changes.commit(change.state.generation, message, taken);
			if (fail) {
				change.abort();
				changes.restore(taken);
				return;
			}
			const prepared = change.prepare();
			ops.push([...prepared.ops]);
			tracker.adopt(prepared);
		},
		committed() {
			const message = tracker.value.generation.message as { content: { text?: string; arguments?: unknown }[] };
			return { text: message.content[0]?.text, arguments: message.content[1]?.arguments };
		},
	};
}

function pieces(text: string, size: number): string[] {
	const result: string[] = [];
	for (let index = 0; index < text.length; index += size) result.push(text.slice(index, index + size));
	return result;
}

/** A suffix-shaped operation can still hide Chord comparing the whole previous string during preparation. */
function commitWithoutPrefixRead(stream: { commit(): void }, prefixLength: number): void {
	const prefixReads: number[] = [];
	const slice = String.prototype.slice;
	const spy = vi.spyOn(String.prototype, "slice").mockImplementation(function (
		this: string,
		start?: number,
		end?: number,
	) {
		if (this.length > prefixLength && start === 0 && end === prefixLength) prefixReads.push(this.length);
		return slice.call(this, start, end);
	});
	try {
		stream.commit();
	} finally {
		spy.mockRestore();
	}
	expect(prefixReads).toEqual([]);
}

const ARGUMENTS = {
	path: "src/a.ts",
	n: 1234,
	ok: true,
	content: 'line "one"\n\tline \\ two é 😀\n',
	edits: [
		{ oldText: "a", newText: "b\nc" },
		{ oldText: "", newText: "x".repeat(50) },
	],
	nested: { deep: { list: [1, [2, "three"], { four: null }] } },
};

describe("PartialChanges", () => {
	it("preserves authoritative nonempty start arguments through later deltas", () => {
		const stream = setup();
		stream.partial.content.push({ type: "toolCall", id: "c1", name: "write", arguments: { path: "src/a" } });
		const changes = new PartialChanges();
		changes.observe({ type: "toolcall_start", contentIndex: 1, partial: stream.partial });
		const commit = () => {
			const message = copyJson(stream.partial) as PartialMessage;
			const taken = changes.take(message);
			const change = stream.tracker.beginChange();
			changes.commit(change.state.generation, message, taken);
			stream.tracker.adopt(change.prepare());
		};
		commit();
		expect(stream.committed().arguments).toEqual({ path: "src/a" });
		stream.partial.content[1] = { type: "toolCall", id: "c1", name: "write", arguments: { path: "src/a.ts" } };
		changes.observe({ type: "toolcall_delta", contentIndex: 1, delta: '.ts"}', partial: stream.partial });
		commit();
		expect(stream.committed().arguments).toEqual({ path: "src/a.ts" });
	});
	it("commits tool-call arguments equal to the final parse, at every piece size and commit rhythm", () => {
		const text = JSON.stringify(ARGUMENTS);
		for (const size of [1, 2, 3, 5, 7, 16]) {
			for (const every of [1, 3, 10]) {
				const stream = setup();
				pieces(text, size).forEach((piece, index) => {
					stream.argument(piece);
					if (index % every === every - 1) stream.commit();
				});
				stream.commit();
				expect(stream.committed().arguments, `size ${size}, every ${every}`).toEqual(ARGUMENTS);
			}
		}
	});

	it.each([
		['{"count":12', "3}", { count: 12 }, { count: 123 }],
		['{"flag":tr', "ue}", { flag: true }, { flag: true }],
	] as const)("preserves the provider snapshot before a scalar ends: %s", (prefix, suffix, preview, final) => {
		for (const existing of [false, true]) {
			const stream = setup();
			if (existing) {
				stream.argument("{");
				stream.commit();
				stream.argument(prefix.slice(1));
			} else stream.argument(prefix);
			stream.commit();
			expect(stream.committed().arguments).toEqual(preview);
			// A failed write must not discard the authoritative preview, either.
			stream.commit(true);
			stream.commit();
			expect(stream.committed().arguments).toEqual(preview);
			stream.argument(suffix);
			stream.commit();
			expect(stream.committed().arguments).toEqual(final);
		}
	});

	it("preserves open containers deeper than the parser's reported changes", () => {
		const stream = setup();
		stream.argument(`${'{"nested":'.repeat(34)}"partial`);
		stream.commit();
		let expected: unknown = "partial";
		for (let depth = 0; depth < 34; depth++) expected = { nested: expected };
		expect(stream.committed().arguments).toEqual(expected);
		stream.argument(` text"${"}".repeat(34)}`);
		stream.commit();
		let final: unknown = "partial text";
		for (let depth = 0; depth < 34; depth++) final = { nested: final };
		expect(stream.committed().arguments).toEqual(final);
	});

	it("handles a number ending and a string starting in one piece, and escapes split across pieces", () => {
		const stream = setup();
		for (const piece of [
			'{"n":1',
			'2,"s":"a',
			"b\\",
			'u00e9\\"',
			"q\\u",
			"00",
			"41",
			'","t":tr',
			"ue,",
			'"u":"\\ud83d',
			'\\ude00"}',
		]) {
			stream.argument(piece);
			stream.commit();
		}
		expect(stream.committed().arguments).toEqual({ n: 12, s: 'abé"qA', t: true, u: "😀" });
	});

	it("appends growing argument and text strings instead of reassigning them", () => {
		const stream = setup();
		stream.text("Hello");
		stream.argument('{"path":"a.ts","content":"x');
		stream.commit();
		for (let index = 0; index < 20; index++) {
			stream.text(" more");
			stream.argument("yz");
			stream.commit();
		}
		for (const ops of stream.ops.slice(1)) {
			expect(ops).toEqual([
				["a", ["generation", "message", "content", 0, "text"], " more"],
				["a", ["generation", "message", "content", 1, "arguments", "content"], "yz"],
			]);
		}
		expect(stream.committed()).toEqual({
			text: `Hello${" more".repeat(20)}`,
			arguments: { path: "a.ts", content: `x${"yz".repeat(20)}` },
		});
	});

	it.each(["completed", "pending", "failed"] as const)(
		"resumes suffix-only argument commits after %s scalar reconciliation",
		(scenario) => {
			const stream = setup();
			let command = "x".repeat(64 * 1024);
			if (scenario === "completed") stream.argument(`{"timeout":30,"command":"${command}`);
			else {
				stream.argument('{"timeout":3');
				stream.commit();
				stream.argument(`0,"command":"${command}`);
			}
			stream.commit(scenario === "failed");
			if (scenario === "failed") {
				stream.argument(" retry");
				command += " retry";
				stream.commit();
			}
			expect(stream.committed().arguments).toEqual({ timeout: 30, command });
			for (const suffix of [" first", " second", " third"]) {
				stream.argument(suffix);
				commitWithoutPrefixRead(stream, command.length);
				command += suffix;
				expect(stream.committed().arguments).toEqual({ timeout: 30, command });
				expect(stream.ops.at(-1)).toEqual([
					["a", ["generation", "message", "content", 1, "arguments", "command"], suffix],
				]);
			}
		},
	);

	it("preserves budget-lagged provider previews and resumes exact appends after they catch up", () => {
		const stream = setup();
		const fields = Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`field${index}`, ""]));
		stream.argument(`${JSON.stringify(fields).slice(0, -1)},"command":"`);
		stream.commit();
		let sawLag = false;
		for (let length = 1; length <= 400; length++) {
			stream.argument("x");
			const preview = (stream.partial.content[1] as ToolCall).arguments;
			if ((preview.command as string).length < length) sawLag = true;
			stream.commit();
			expect(stream.committed().arguments).toEqual(preview);
		}
		expect(sawLag).toBe(true);
		// A large delta pays for a fresh preview; the following deltas can use exact suffix edits again.
		const fresh = "y".repeat(64 * 1024);
		stream.argument(fresh);
		stream.commit();
		let command = "x".repeat(400) + fresh;
		expect(stream.committed().arguments).toEqual({ ...fields, command });
		for (const suffix of [" first", " second", " third"]) {
			stream.argument(suffix);
			commitWithoutPrefixRead(stream, command.length);
			command += suffix;
			expect(stream.committed().arguments).toEqual({ ...fields, command });
		}
	});

	it.each([false, true])(
		"commits actual OpenAI raw-only progress and interruption (fresh preview: %s)",
		async (fresh) => {
			const fields = Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`field${index}`, ""]));
			const prefix = `${JSON.stringify(fields).slice(0, -1)},"command":"`;
			const updates = [
				{ id: "call_1", function: { name: "write", arguments: "" } },
				{ function: { arguments: prefix } },
				...Array.from({ length: 400 }, () => ({ function: { arguments: "x" } })),
				...Array.from({ length: 16 }, () => ({ __raw: "<raw>" })),
				...Array.from({ length: 16 }, () => ({ function: { arguments: "y" } })),
				...(fresh
					? [{ function: { arguments: "z".repeat(64 * 1024) } }, { function: { arguments: " tail" } }]
					: []),
			];
			const gates = Array.from({ length: updates.length + 1 }, () => Promise.withResolvers<void>());
			const fetch: typeof globalThis.fetch = async () => {
				let index = 0;
				const encoder = new TextEncoder();
				return new Response(
					new ReadableStream<Uint8Array>({
						async pull(controller) {
							await gates[index]!.promise;
							if (index === updates.length) {
								controller.error(new Error("Connection interrupted"));
								return;
							}
							const chunk = {
								id: "chatcmpl-preview",
								choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...updates[index++] }] } }],
							};
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
						},
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } },
				);
			};
			const response = streamOpenAICompletions(
				{
					id: "preview-test",
					name: "Preview test",
					api: "openai-completions",
					provider: "openai",
					baseUrl: "https://example.test/v1",
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200_000,
					maxTokens: 64_000,
				},
				normalizeContext({ messages: [] }),
				{ apiKey: "test", fetch, maxRetries: 0 },
			);
			const changes = new PartialChanges();
			const tracker = track<Live>({ generation: { attempt: 1 } });
			let index = 0;
			let sawLag = false;
			let sawEnd = false;
			let lastOps: readonly Op[] = [];
			let lastPreview: ToolCall["arguments"] | undefined;
			const commit = (partial: AssistantMessage) => {
				const message = copyJson(partial) as PartialMessage;
				const taken = changes.take(message);
				const change = tracker.beginChange();
				changes.commit(change.state.generation, message, taken);
				const prepared = change.prepare();
				lastOps = [...prepared.ops];
				tracker.adopt(prepared);
				expect(tracker.value.generation.message).toEqual(partial);
			};
			gates[0]!.resolve();
			try {
				for await (const event of response) {
					changes.observe(event);
					if (event.type === "toolcall_end") sawEnd = true;
					if (event.type !== "toolcall_delta") continue;
					const call = event.partial.content[event.contentIndex];
					if (call?.type !== "toolCall") throw new Error("Missing streamed tool call");
					if (index > 1 && index <= 401 && (call.arguments.command as string).length < index - 1) sawLag = true;
					lastPreview = structuredClone(call.arguments);
					// Reconcile the exhausted preview first, then commit every raw-only event and resumed JSON delta.
					if (index >= 401) commit(event.partial);
					gates[++index]?.resolve();
				}
			} finally {
				for (const gate of gates) gate.resolve();
				await response.result();
			}
			expect(sawLag).toBe(true);
			expect(sawEnd).toBe(false);
			if (fresh) {
				expect(lastOps).toEqual([["a", ["generation", "message", "content", 0, "arguments", "command"], " tail"]]);
			}
			const interrupted = await response.result();
			expect(interrupted.stopReason).toBe("error");
			expect(interrupted.errorMessage).toContain("Connection interrupted");
			expect(interrupted.content[0]).toMatchObject({ arguments: lastPreview });
			commit(interrupted);
			expect(tracker.value.generation.message?.content[0]).toMatchObject({
				...(fresh
					? {
							arguments: {
								...fields,
								command: `${"x".repeat(400)}${"y".repeat(16)}${"z".repeat(64 * 1024)} tail`,
							},
						}
					: {}),
				raw: "<raw>".repeat(16),
			});
		},
	);

	it.each([false, true])("keeps scalar reconciliation local to its taken commit (failed: %s)", (fail) => {
		const stream = setup();
		stream.argument('{"timeout":3');
		stream.commit();
		stream.argument("0");
		const command = "x".repeat(64 * 1024);
		stream.commit(fail, () => stream.argument(`,"command":"${command}`));
		expect(stream.committed().arguments).toEqual({ timeout: fail ? 3 : 30 });
		stream.commit();
		expect(stream.committed().arguments).toEqual({ timeout: 30, command });
		stream.argument(" tail");
		commitWithoutPrefixRead(stream, command.length);
		expect(stream.committed().arguments).toEqual({ timeout: 30, command: `${command} tail` });
	});

	it.each([false, true])("does not pull a later scalar preview into an earlier commit (failed: %s)", (fail) => {
		const stream = setup();
		stream.argument('{"command":"x');
		stream.commit();
		stream.argument('y"');
		stream.commit(fail, () => stream.argument(',"timeout":3'));
		expect(stream.committed().arguments).toEqual({ command: fail ? "x" : "xy" });
		stream.commit();
		expect(stream.committed().arguments).toEqual({ command: "xy", timeout: 3 });
		stream.argument("0}");
		stream.commit();
		expect(stream.committed().arguments).toEqual({ command: "xy", timeout: 30 });
	});

	it("applies the changes of a failed commit in the next one", () => {
		const stream = setup();
		stream.argument('{"a":"x');
		stream.commit();
		stream.argument('y","b":[1');
		stream.commit(true);
		stream.argument(',2],"c":"z"}');
		stream.commit();
		expect(stream.committed().arguments).toEqual({ a: "xy", b: [1, 2], c: "z" });
	});

	it("re-applies a failed commit's changes even when it would have added the call", () => {
		const stream = setup();
		stream.commit();
		stream.argument('{"a":"x');
		stream.commit(true);
		stream.argument('y"');
		stream.commit();
		expect(stream.committed().arguments).toEqual({ a: "xy" });
	});

	it("falls back to the snapshot when the committed message lost a call whose changes were committed", () => {
		const stream = setup();
		stream.argument('{"a":"x');
		stream.commit();
		// Another writer resets the generation's partial.
		const change = stream.tracker.beginChange();
		change.state.generation = { attempt: 1 };
		stream.tracker.adopt(change.prepare());
		stream.argument('y"');
		stream.commit();
		expect(stream.committed().arguments).toEqual({ a: "xy" });
		stream.argument(',"b":2}');
		stream.commit();
		expect(stream.committed().arguments).toEqual({ a: "xy", b: 2 });
	});

	it.each([false, true])("keeps captured arguments when the call ends before commit (existing: %s)", (existing) => {
		const stream = setup();
		stream.argument('{"a":"x');
		if (existing) stream.commit();
		stream.argument('y"}');
		stream.commit(false, () => {
			stream.endBlocks();
			// The queued commit owns its earlier snapshot, not a provider's final replacement.
			stream.partial.content[1] = { type: "toolCall", id: "c1", name: "write", arguments: { a: "final" } };
		});
		expect(stream.committed().arguments).toEqual({ a: "xy" });
		stream.commit();
		expect(stream.committed().arguments).toEqual({ a: "final" });
	});

	it("commits the final arguments after the call ends, and drops text appends when a block ends", () => {
		const stream = setup();
		stream.text("draft");
		stream.argument('{"a":"x');
		stream.commit();
		// Providers may replace a block's text and arguments as it ends; the last commit assigns what they ended with.
		stream.text(" more");
		(stream.partial.content[0] as { text: string }).text = "replaced";
		stream.partial.content[1] = { type: "toolCall", id: "c1", name: "write", arguments: { a: "final" } };
		stream.endBlocks();
		stream.commit();
		expect(stream.committed()).toEqual({ text: "replaced", arguments: { a: "final" } });
	});
});
