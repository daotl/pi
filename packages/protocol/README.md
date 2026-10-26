# @earendil-works/pi-protocol

Runtime-neutral routed envelopes, CBOR encoding, and byte-stream framing for the experimental Pi protocol.

Protocol version `9` defines:

- a version handshake that identifies the logical `serverId`;
- explicit server and Session targets;
- native Chord frames tunneled as `{ type: "chord", target, frame }`;
- out-of-band attachment changes;
- non-empty opaque error codes and bounded transport messages.

A server target contains `{ serverId }`; a Session target contains `{ serverId, sessionId, attachmentId }`. The route fences each native Chord connection to one logical server, durable Session, and live presentation attachment. Management attach/detach methods return no routing identifiers; the server publishes the selected route through an out-of-band `attachment` message. Disconnecting releases only that presentation's attachment after admitted calls settle.

Chord owns contract negotiation, calls, cancellation, state updates and remote errors inside its frames. `pi-protocol` validates only the routed envelope and strict-JSON boundary; it does not export a second service/member grammar. Version-8 request/response/service-update envelopes are not accepted by this clean cutover.

Session-directory state, management results, transcripts, models and plugins are application-owned Chord contracts. Real `Session` and `AgentHarness` objects remain process-local.

Server and worker lifecycle is intentionally outside this public protocol. The experimental local coordinator is only an opaque message router; each replaceable server process owns the private lifecycle protocol.

Each wire frame consists of a four-byte unsigned big-endian payload length followed by one definite-length CBOR item. `encodeClientMessage()` and `encodeServerMessage()` validate and encode complete frames. `ClientMessageDecoder` and `ServerMessageDecoder` accept arbitrary stream fragmentation and coalescing.

```ts
import {
  PROTOCOL_VERSION,
  encodeClientMessage,
  ServerMessageDecoder,
  type ClientHello,
} from "@earendil-works/pi-protocol";

const hello: ClientHello = { type: "hello", version: PROTOCOL_VERSION };
transport.send(encodeClientMessage(hello));

const decoder = new ServerMessageDecoder({ maxFrameLength: 1024 * 1024 });
for (const message of decoder.push(incomingChunk)) handleServerMessage(message);
decoder.end();
```

All envelope schemas reject unknown object properties, and codecs recursively reject non-JSON opaque payloads, including non-finite numbers, byte arrays, `undefined`, prototypes, and cycles. Envelope violations, malformed CBOR, and invalid framing throw `ProtocolValidationError`. Payload-specific adapters must perform their own semantic validation after decoding. Transports must preserve byte order. Peer authentication and authenticated service contexts are not implemented by the experimental transport.

Default limits are 16 MiB per CBOR payload/frame, 1,000,000 array elements or map entries, and 64 nested item levels. The protocol is experimental and has no compatibility guarantees.
