import {
	type AssistantMessage,
	type AssistantMessageFrame,
	fauxAssistantMessage,
	reduceAssistantMessageFrames,
} from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { applyFrame } from "../../../src/harness/pico3/kinds/frames.ts";

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
