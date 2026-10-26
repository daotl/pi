import type { Frame } from "@earendil-works/chord";
import Type, { type Static } from "typebox";
import { Check } from "typebox/value";

export const PROTOCOL_VERSION = 9 as const;

const IdSchema = Type.String({ minLength: 1 });
const StrictObject = <const T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const ServerIdSchema = Type.String({
	pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});
export type ServerId = Static<typeof ServerIdSchema>;
export function isServerId(value: unknown): value is ServerId {
	return Check(ServerIdSchema, value);
}

const ProtocolErrorSchema = StrictObject({ code: IdSchema, message: Type.String() });
export type ProtocolErrorCode = string;
export type ProtocolError = Static<typeof ProtocolErrorSchema>;
const ClientHelloSchema = StrictObject({ type: Type.Literal("hello"), version: Type.Integer({ minimum: 0 }) });
export type ClientHello = Static<typeof ClientHelloSchema>;
const ServerTargetSchema = StrictObject({ serverId: ServerIdSchema });
const SessionTargetSchema = StrictObject({ serverId: ServerIdSchema, sessionId: IdSchema, attachmentId: IdSchema });
export type SessionTarget = Static<typeof SessionTargetSchema>;
const RpcTargetSchema = Type.Union([ServerTargetSchema, SessionTargetSchema]);
export type RpcTarget = Static<typeof RpcTargetSchema>;

// Chord validates its own frames at the receiving host. This layer owns only the route and strict JSON boundary.
const FrameEnvelopeSchema = StrictObject({
	type: Type.Literal("chord"),
	target: RpcTargetSchema,
	frame: Type.Unsafe<Frame>(Type.Object({ t: IdSchema })),
});
export type FrameEnvelope = Static<typeof FrameEnvelopeSchema>;
export const ClientMessageSchema = Type.Union([ClientHelloSchema, FrameEnvelopeSchema]);
export type ClientMessage = Static<typeof ClientMessageSchema>;
const ServerHelloSchema = StrictObject({
	type: Type.Literal("hello"),
	version: Type.Literal(PROTOCOL_VERSION),
	serverId: ServerIdSchema,
});
const ServerHelloErrorSchema = StrictObject({ type: Type.Literal("hello_error"), error: ProtocolErrorSchema });
const AttachmentEnvelopeSchema = StrictObject({
	type: Type.Literal("attachment"),
	attachment: Type.Union([SessionTargetSchema, Type.Null()]),
});
export const ServerMessageSchema = Type.Union([
	ServerHelloSchema,
	ServerHelloErrorSchema,
	FrameEnvelopeSchema,
	AttachmentEnvelopeSchema,
]);
export type ServerHello = Static<typeof ServerHelloSchema>;
export type ServerHelloError = Static<typeof ServerHelloErrorSchema>;
export type AttachmentEnvelope = Static<typeof AttachmentEnvelopeSchema>;
export type ServerMessage = Static<typeof ServerMessageSchema>;
