import { applyImmutable, type Prepared, track } from "@earendil-works/chord/delta";
import {
	type AssistantMessage,
	type AssistantMessageFrame,
	fauxAssistantMessage,
	reduceAssistantMessageFrames,
} from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { applyFrame } from "../../../src/harness/pico3/kinds/frames.ts";
import { Membrane } from "../../../src/harness/pico3/membrane.ts";

it.each([undefined, "", "<final>"])(
	"keeps raw progress and authoritative final raw %j in the tracked frame consumer",
	(raw) => {
		const frames: AssistantMessageFrame[] = [
			{ type: "start", partial: { ...fauxAssistantMessage(""), content: [], stopReason: "pending" } },
			{
				type: "toolcall_start",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: "call", name: "read", arguments: {}, raw: "<start>" },
			},
			{ type: "toolcall_delta", contentIndex: 0, delta: "", rawDelta: "<tail>" },
		];
		const tracked: { message?: AssistantMessage } = {};
		for (const frame of frames) applyFrame(tracked, structuredClone(frame));
		expect(tracked.message?.content).toEqual([
			{ type: "toolCall", id: "call", name: "read", arguments: {}, raw: "<start><tail>" },
		]);
		const checkpoint: AssistantMessageFrame = {
			type: "toolcall_checkpoint",
			contentIndex: 0,
			json: '{"path":"a"}',
			rawDelta: "<checkpoint>",
		};
		frames.push(checkpoint);
		applyFrame(tracked, structuredClone(checkpoint));
		expect(tracked.message).toEqual(reduceAssistantMessageFrames(frames));
		const end: AssistantMessageFrame = {
			type: "toolcall_end",
			contentIndex: 0,
			id: "call",
			name: "read",
			arguments: { path: "a" },
			...(raw === undefined ? {} : { raw }),
		};
		frames.push(end);
		applyFrame(tracked, structuredClone(end));
		expect(tracked.message?.content).toEqual([
			{
				type: "toolCall",
				id: "call",
				name: "read",
				arguments: { path: "a" },
				...(raw === undefined ? {} : { raw }),
			},
		]);
	},
);

// #13: terminal parser diagnostics are authoritative, including their removal.
it.each([undefined, "", "Tool arguments must be a JSON object\n\nReceived arguments:\n[1]"])(
	"applies terminal argument error %j without retaining a stale snapshot error",
	(argumentsError) => {
		const frames: AssistantMessageFrame[] = [
			{ type: "start", partial: { ...fauxAssistantMessage(""), content: [], stopReason: "pending" } },
			{
				type: "toolcall_start",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: "call", name: "read", arguments: {}, argumentsError: "stale" },
			},
			{
				type: "toolcall_end",
				contentIndex: 0,
				id: "call",
				name: "read",
				arguments: {},
				...(argumentsError === undefined ? {} : { argumentsError }),
			},
		];
		const tracked: { message?: AssistantMessage } = {};
		for (const frame of frames) applyFrame(tracked, structuredClone(frame));
		expect(tracked.message).toEqual(reduceAssistantMessageFrames(frames));
		expect(tracked.message?.content[0]).toEqual({
			type: "toolCall",
			id: "call",
			name: "read",
			arguments: {},
			...(argumentsError === undefined ? {} : { argumentsError }),
		});
	},
);

it("prepares suffix-only raw operations across tracked membrane transactions", () => {
	const tracker = track<{ message?: AssistantMessage }>({
		message: {
			...fauxAssistantMessage(""),
			content: [{ type: "toolCall", id: "call", name: "write", arguments: {} }],
		},
	});
	let replica = structuredClone(tracker.value);
	const chunks = ["first", "x".repeat(64 * 1024), "tail"];
	for (const [index, rawDelta] of chunks.entries()) {
		const change = tracker.beginChange();
		const membrane = new Membrane("raw-frame");
		const output = membrane.wrap(change.state);
		const frame: AssistantMessageFrame = { type: "toolcall_delta", contentIndex: 0, delta: "", rawDelta };
		applyFrame(output, frame);
		// A suffix-shaped op alone also passes the tracker's quadratic recovery path.
		// Observe preparation's prefix reads so this rejects ordinary whole-string assignment.
		const prefixReads: number[] = [];
		const slice = String.prototype.slice;
		const prefixLength = index === 2 ? chunks[0]!.length + chunks[1]!.length : undefined;
		const spy = vi.spyOn(String.prototype, "slice").mockImplementation(function (
			this: string,
			start?: number,
			end?: number,
		) {
			if (prefixLength !== undefined && this.length > prefixLength && start === 0 && end === prefixLength)
				prefixReads.push(this.length);
			return slice.call(this, start, end);
		});
		let prepared: Prepared<{ message?: AssistantMessage }>;
		try {
			prepared = change.prepare();
		} finally {
			spy.mockRestore();
		}
		expect(prefixReads).toEqual([]);
		if (index > 0) expect(prepared.ops).toEqual([["a", ["message", "content", 0, "raw"], rawDelta]]);
		replica = applyImmutable(replica, prepared.ops);
		tracker.adopt(prepared);
		membrane.revoke();
		expect(() => applyFrame(output, frame)).toThrow(/outside its transaction/);
	}
	expect(replica).toEqual(tracker.value);
	expect(tracker.value.message?.content[0]).toMatchObject({ raw: chunks.join("") });
	const change = tracker.beginChange();
	const membrane = new Membrane("raw-end");
	applyFrame(membrane.wrap(change.state), {
		type: "toolcall_end",
		contentIndex: 0,
		id: "call",
		name: "write",
		arguments: {},
		raw: "authoritative",
	});
	tracker.adopt(change.prepare());
	membrane.revoke();
	expect(tracker.value.message?.content[0]).toMatchObject({ raw: "authoritative" });
});
