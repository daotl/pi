import { describe, expect, test } from "vitest";
import {
	type ClientHello,
	type ClientMessage,
	ClientMessageDecoder,
	decodeCbor,
	encodeCbor,
	encodeClientMessage,
	encodeFrame,
	encodeServerMessage,
	FrameDecoder,
	isSupportedProtocolVersion,
	PROTOCOL_VERSION,
	ProtocolValidationError,
	parseClientMessage,
	parseServerMessage,
	type ServerHello,
	type ServerMessage,
	ServerMessageDecoder,
} from "../src/index.ts";

const serverId = "00000000-0000-4000-8000-000000000001";
const clientHello: ClientHello = { type: "hello", version: PROTOCOL_VERSION };
const serverHello: ServerHello = { type: "hello", version: PROTOCOL_VERSION, serverId };
const chord: ClientMessage = { type: "chord", target: { serverId }, frame: { t: "cancel", id: 1 } };

describe("routed native Chord protocol", () => {
	test("rejects previous protocol versions", () => {
		expect(isSupportedProtocolVersion(PROTOCOL_VERSION)).toBe(true);
		expect(isSupportedProtocolVersion(PROTOCOL_VERSION - 1)).toBe(false);
	});
	test.each([0, PROTOCOL_VERSION, PROTOCOL_VERSION + 1])("admits integer hello %s for negotiation", (version) => {
		expect(parseClientMessage({ ...clientHello, version })).toEqual({ ...clientHello, version });
	});
	test.each(["", "server-1", "00000000-0000-7000-8000-000000000001", "00000000-0000-4000-8000-00000000000A"])(
		"rejects noncanonical route %j",
		(invalid) => {
			expect(() => parseClientMessage({ ...chord, target: { serverId: invalid } })).toThrow(ProtocolValidationError);
		},
	);
	test("keeps native frames opaque while validating routed capabilities", () => {
		const frame = { t: "future-native-frame", application: { arbitrary: [true, null, 2] } };
		const envelope = { type: "chord", target: { serverId, sessionId: "s", attachmentId: "a" }, frame };
		expect(parseClientMessage(envelope)).toEqual(envelope);
		expect(parseServerMessage(envelope)).toEqual(envelope);
		for (const target of [
			{ serverId, sessionId: "s" },
			{ serverId, sessionId: "s", attachmentId: "" },
			{ serverId, extra: true },
		]) {
			expect(() => parseClientMessage({ ...envelope, target })).toThrow(ProtocolValidationError);
		}
	});
	test("rejects non-JSON native payloads", () => {
		const cycle: { self?: unknown } = {};
		cycle.self = cycle;
		for (const value of [new Uint8Array([1]), Number.NaN, { value: undefined }, cycle]) {
			const message = { ...chord, frame: { t: "call", args: value } };
			expect(() => parseClientMessage(message)).toThrow(ProtocolValidationError);
			expect(() => parseServerMessage(message)).toThrow(ProtocolValidationError);
		}
	});
	test("validates attachment replacement and detachment", () => {
		const attached: ServerMessage = {
			type: "attachment",
			attachment: { serverId, sessionId: "s", attachmentId: "a" },
		};
		expect(parseServerMessage(attached)).toEqual(attached);
		expect(parseServerMessage({ type: "attachment", attachment: null })).toEqual({
			type: "attachment",
			attachment: null,
		});
		expect(() => parseServerMessage({ ...attached, attachment: { sessionId: "s" } })).toThrow(
			ProtocolValidationError,
		);
	});
	test.each([
		{ ...chord, extra: true },
		{ ...chord, frame: {} },
		{ type: "request", id: "old", target: { serverId }, call: {} },
		{ type: "hello", version: String(PROTOCOL_VERSION) },
		{ type: "hello", version: 1, extra: true },
	])("rejects malformed or removed envelopes", (message) => {
		expect(() => parseClientMessage(message)).toThrow(ProtocolValidationError);
	});
	test("does not parse strings or accept unsolicited envelope fields", () => {
		expect(() => parseClientMessage(JSON.stringify(clientHello))).toThrow(ProtocolValidationError);
		expect(() => parseServerMessage({ ...serverHello, snapshot: {} })).toThrow(ProtocolValidationError);
	});
});

describe("validated framed protocol", () => {
	test("encodes complete client and server frames", () => {
		expect(parseClientMessage(decodeCbor(new FrameDecoder().push(encodeClientMessage(clientHello))[0]!))).toEqual(
			clientHello,
		);
		expect(parseServerMessage(decodeCbor(new FrameDecoder().push(encodeServerMessage(serverHello))[0]!))).toEqual(
			serverHello,
		);
	});
	test("enforces outbound limits", () => {
		expect(() => encodeClientMessage(clientHello, { maxFrameLength: 8 })).toThrow(ProtocolValidationError);
		expect(() => encodeServerMessage(serverHello, { maxFrameLength: 8 })).toThrow(ProtocolValidationError);
	});
	test("preserves coalesced and fragmented native envelopes at every split", () => {
		const first = encodeClientMessage(clientHello);
		const second = encodeClientMessage(chord);
		const wire = new Uint8Array(first.byteLength + second.byteLength);
		wire.set(first);
		wire.set(second, first.byteLength);
		for (let split = 0; split <= wire.byteLength; split++) {
			const decoder = new ClientMessageDecoder();
			expect([...decoder.push(wire.subarray(0, split)), ...decoder.push(wire.subarray(split))]).toEqual([
				clientHello,
				chord,
			]);
			decoder.end();
		}
	});
	test("decodes server frames incrementally", () => {
		const first = encodeServerMessage(serverHello);
		const second = encodeServerMessage(chord);
		const wire = new Uint8Array(first.byteLength + second.byteLength);
		wire.set(first);
		wire.set(second, first.byteLength);
		const split = first.byteLength + Math.floor(second.byteLength / 2);
		const decoder = new ServerMessageDecoder();
		expect(decoder.push(wire.subarray(0, split))).toEqual([serverHello]);
		expect(decoder.push(wire.subarray(split))).toEqual([chord]);
		decoder.end();
	});
	test.each([
		encodeFrame(new Uint8Array()),
		encodeFrame(Uint8Array.of(0xff)),
		encodeFrame(encodeCbor({ type: "unknown" })),
	])("fails closed after invalid input", (wire) => {
		const decoder = new ClientMessageDecoder();
		expect(() => decoder.push(wire)).toThrow(ProtocolValidationError);
		expect(() => decoder.push(encodeClientMessage(clientHello))).toThrow(/failed/i);
	});
	test("rejects truncated and oversized framing", () => {
		const truncated = new ServerMessageDecoder();
		truncated.push(new Uint8Array([0, 0, 0, 2, 1]));
		expect(() => truncated.end()).toThrow(ProtocolValidationError);
		expect(() => new ClientMessageDecoder({ maxFrameLength: 3 }).push(new Uint8Array([0, 0, 0, 4]))).toThrow(
			ProtocolValidationError,
		);
	});
});
