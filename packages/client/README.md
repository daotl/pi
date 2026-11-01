# @earendil-works/pi-client

Transport-neutral client for the experimental routed Pi/Chord protocol.

```ts
import { createHost } from "@earendil-works/chord";
import { Client, createClientChordLink, type ByteTransportFactory } from "@earendil-works/pi-client";

const transportFactory: ByteTransportFactory = async (handlers) => {
  // Connect using WebSocket, Unix socket, or another ordered byte transport.
  return {
    async send(chunk) {
      // Deliver bytes in invocation order and honor backpressure.
    },
    close() {},
  };
};

const client = await Client.connect({
  serverId: "01234567-89ab-4def-8123-456789abcdef",
  transportFactory,
});
const host = createHost({ name: "tui", kind: "client", self: "tui" });
host.connect(createClientChordLink(client, () => ({ serverId: client.serverId })), {
  principal: "tui",
});
```

The client verifies that the physical endpoint reports the expected logical `serverId`. Server-wide requests carry that ID, and every Session request carries the full live target `{ serverId, sessionId, attachmentId }`. The combined durable address prevents cross-server or cross-session misrouting; the server-generated attachment ID rejects delayed frames after switching or reattaching.

Typed server and Session APIs use native Chord contracts through a local Host. `createClientChordLink(client, getTarget)` captures the current server or Session route as a native link; connect it with `host.connect()`, then acquire contract references through the Host. Chord owns calls, cancellation, hydration and state subscriptions. There is no legacy `request()`/`subscribeService()` or service-control adapter.

The client applies ordered out-of-band attachment changes but does not interpret application contracts. Recreate a route's link after attachment changes or reconnect; stale links close instead of crossing an attachment boundary.

On disconnect or disposal, pending requests reject locally, but accepted work may still complete remotely before the attachment is released. The client clears its live attachment route. It never reconnects or replays requests automatically. After disconnection, call `reconnect()`, attach through the application's management service again, and explicitly repeat only operations known to be safe.

`connect()` and `reconnect()` reject while already connecting or connected. These rejected attempts leave the current handshake, server identity and routed Chord links intact; disconnect first to start a new connection.

Closing the server-scoped Chord link (locally or by its provider) disconnects the physical client and invalidates all routes. Call `reconnect()` before creating a replacement server link; that handshake acquires a fresh native server attachment. Closing only a Session link does not disconnect the server route.

The experimental local coordinator only provides a stable endpoint and relays traffic. Replaceable server processes own Session and worker lifecycle outside the public client protocol.

Call transport handlers as follows:

- `handlers.onData(chunk)` for inbound bytes;
- `handlers.onClose()` for an orderly terminal close;
- `handlers.onError(error)` for transport failures.

A transport factory creates a fresh connection for each attempt. Native Chord owns correlated calls and remote errors; `ServerError` reports routed protocol/handshake failures. Peer authentication remains application policy.

## Unix-domain sockets

Node.js and Bun consumers can use the separate Unix transport:

```ts
import { Client } from "@earendil-works/pi-client";
import { createUnixTransportFactory } from "@earendil-works/pi-client/unix";

const client = new Client({
  serverId: "01234567-89ab-4def-8123-456789abcdef",
  transportFactory: createUnixTransportFactory({ path: "/tmp/pi.sock" }),
});
await client.connect();
```

Unix discovery scans an explicit physical-route directory, derives each expected server ID from its filename, and verifies it through the existing handshake:

```ts
import { discoverUnixServers } from "@earendil-works/pi-client/unix";

const routes = await discoverUnixServers({ directory: "/run/user/1000/pi" });
// [{ serverId: "...", path: "/run/user/1000/pi/<serverId>.sock" }]
```

Malformed entries, non-sockets, stale or unresponsive endpoints, and server-ID mismatches are ignored. Discovery is read-only and probes at most 16 sockets concurrently. Unexpected filesystem and socket errors reject discovery. Pass `timeoutMs` to override the default probe timeout.

`ClientOptions.maxFrameLength` bounds protocol payloads. `maxPendingBytes` bounds queued Unix transport output. Configure matching limits on both peers.
