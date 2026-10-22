import { expect, it } from "vitest";
import {
	type AssistantMessageEvent,
	type AssistantMessageFrame,
	AssistantMessageFrameEncoder,
	fauxAssistantMessage,
	reduceAssistantMessageFrames,
	type ToolCall,
} from "../src/index.ts";

function recording(calls: ToolCall[]) {
	const partial = fauxAssistantMessage(calls, { stopReason: "pending" });
	const encoder = new AssistantMessageFrameEncoder();
	const frames: AssistantMessageFrame[] = [];
	const emit = (event: AssistantMessageEvent) => {
		const frame = encoder.encode(event);
		if (frame) frames.push(frame);
	};
	const delta = (contentIndex: number, json: string, rawDelta?: string) => {
		emit({ type: "toolcall_delta", contentIndex, delta: json, rawDelta, partial });
	};
	const replay = () => reduceAssistantMessageFrames(JSON.parse(JSON.stringify(frames)));
	emit({ type: "start", partial });
	for (let contentIndex = 0; contentIndex < calls.length; contentIndex++) {
		emit({ type: "toolcall_start", contentIndex, partial });
	}
	return { partial, frames, emit, delta, replay };
}

it.each(["interrupted", "error"] as const)(
	"replays uncovered raw-only deltas exactly once after a queued start snapshot (%s)",
	(termination) => {
		const call: ToolCall = {
			type: "toolCall",
			id: "call",
			name: "read",
			arguments: { path: "/tmp" },
			raw: "<start><queued>",
		};
		const stream = recording([call]);
		stream.delta(0, '{"path":"/tm', "<start>");
		stream.delta(0, "", "<queued>");
		expect(stream.replay()?.content).toEqual([call]);

		call.raw += "<new>";
		stream.delta(0, "", "<new>");
		if (termination === "error") {
			stream.partial.stopReason = "error";
			stream.emit({ type: "error", reason: "error", error: stream.partial });
		}
		expect(stream.replay()?.content).toEqual([call]);
		expect(stream.replay()?.content[0]).toMatchObject({ raw: "<start><queued><new>" });
	},
);

it("appends raw while JSON catch-up is blocked and on the eventual JSON checkpoint", () => {
	const call: ToolCall = {
		type: "toolCall",
		id: "call",
		name: "read",
		arguments: { path: "/tmp" },
		raw: "<start>",
	};
	const stream = recording([call]);
	stream.delta(0, '{"path":"/t', "<start>");
	call.raw += "<waiting>";
	stream.delta(0, "", "<waiting>");
	expect(stream.replay()?.content).toEqual([call]);

	call.arguments = { path: "/tmp", label: "s" };
	call.raw += "<checkpoint>";
	stream.delta(0, 'mp","label":"s', "<checkpoint>");
	expect(stream.replay()?.content).toEqual([call]);

	call.arguments = { path: "/tmp", label: "suffix" };
	call.raw += "<end>";
	stream.delta(0, 'uffix"}', "<end>");
	expect(stream.replay()?.content).toEqual([call]);
});

it.each([undefined, "", "<authoritative>"])("uses authoritative final raw %j instead of accumulated raw", (raw) => {
	const call: ToolCall = {
		type: "toolCall",
		id: "initial",
		name: "read",
		arguments: {},
		raw: "<stale>",
		thoughtSignature: "initial-signature",
		namespace: "initial-namespace",
	};
	const stream = recording([call]);
	stream.delta(0, '{"path":"stale"}', "<stale>");
	const final: ToolCall = {
		type: "toolCall",
		id: "final",
		name: "read_file",
		arguments: { path: "/final" },
		...(raw === undefined ? {} : { raw }),
	};
	stream.emit({ type: "toolcall_end", contentIndex: 0, toolCall: final, partial: stream.partial });
	expect(stream.replay()?.content).toEqual([final]);
});

it("tracks raw snapshot coverage independently for interleaved tool calls", () => {
	const first: ToolCall = {
		type: "toolCall",
		id: "first",
		name: "read",
		arguments: { path: "/one" },
		raw: "<first>",
	};
	const second: ToolCall = {
		type: "toolCall",
		id: "second",
		name: "read",
		arguments: {},
		raw: "<second>",
	};
	const stream = recording([first, second]);
	stream.delta(0, '{"path":"/', "<fi");
	stream.delta(1, "", "<second>");
	first.raw += "<one>";
	stream.delta(0, "", "rst><one>");
	second.arguments = { path: "/two" };
	second.raw += "<two>";
	stream.delta(1, '{"path":"/two"}', "<two>");
	expect(stream.replay()?.content).toEqual([first, second]);

	first.arguments = { path: "/one" };
	first.raw += "<complete>";
	stream.delta(0, 'one"}', "<complete>");
	expect(stream.replay()?.content).toEqual([first, second]);
});

it("keeps persisted start snapshots independent of live and replayed mutations", () => {
	const initial: ToolCall = {
		type: "toolCall",
		id: "call",
		name: "read",
		arguments: { options: { path: "/initial" } },
		raw: "<initial>",
	};
	const expected = structuredClone(initial);
	const stream = recording([initial]);
	initial.arguments.options = { path: "/live" };
	initial.raw = "<live>";
	expect(stream.replay()?.content).toEqual([expected]);

	const replayed = reduceAssistantMessageFrames(stream.frames);
	const replayedCall = replayed?.content[0];
	if (replayedCall?.type !== "toolCall") throw new Error("Missing replayed tool call");
	replayedCall.arguments.changed = true;
	replayedCall.raw = "<changed>";
	expect(reduceAssistantMessageFrames(stream.frames)?.content).toEqual([expected]);
});

it("persists long raw streams with linear storage rather than repeated raw snapshots", () => {
	const call: ToolCall = { type: "toolCall", id: "call", name: "read", arguments: {} };
	const stream = recording([call]);
	const chunks = Array.from({ length: 128 }, (_, index) => `<${index}>${"x".repeat(256)}`);
	for (const chunk of chunks) {
		call.raw = (call.raw ?? "") + chunk;
		stream.delta(0, "", chunk);
	}
	const persisted = JSON.stringify(stream.frames);
	expect(reduceAssistantMessageFrames(JSON.parse(persisted))?.content).toEqual([call]);
	expect(persisted.length).toBeLessThan(chunks.join("").length * 3);
});
