# @earendil-works/pi-server

Experimental local server for the new durable Session and Agent Harness interfaces.

The server tunnels native Chord frames over connection-scoped server and presentation-scoped Session links. `RoutedServerServiceHost.attachClient()` returns a server `Link`; `RoutedSessionHandle.attachClient()` returns a Session `Link` and release hook. The server validates each attachment route but does not interpret Chord contracts or business payloads.

- server contract frames use the connection's `RoutedServerServiceAttachment.link`;
- application-owned SessionDirectory and SessionManagement contracts expose catalog and attachment operations;
- attachment changes are published out of band after the router installs or clears the live route;
- Session contract frames use the presentation-scoped link, including state updates and cancellation;
- `createRoutedLinkPair()` connects an application Host to the routed byte transport without the removed service/member protocol.

Attachments may return native Chord links directly, including `memoryLinkPair()` and IPC links; `createRoutedLinkPair()` is optional. Before strict protocol encoding, the server normalizes outgoing frames on both server and Session routes with Chord's `stringifyFrame()`: packed snapshots and results are inflated, and undefined optional protocol fields (including void results) are omitted. Invalid application data is rejected rather than coerced.

The server-scoped endpoint belongs to one physical handshake. If it closes, the server closes the byte connection and releases its routes; the client must reconnect to obtain a fresh endpoint. It cannot reopen the closed endpoint on the old connection.

A Session may have multiple presentation attachments. Repeating `attach` from one connection is idempotent; every successful attachment has a server-generated `attachmentId` delivered only as routing control data. Session requests carry `{ serverId, sessionId, attachmentId }`, and the server rejects stale or mismatched routes. Losing a connection rejects its local responses but releases its attachment only after admitted service calls settle. The host decides when zero presentation demand and worker-local Harness activity permit worker retirement. Server shutdown closes every routed Session handle, releasing its worker and Session writer ownership.

```ts
import { randomUUID } from "node:crypto";
import { MemorySessionRepo, type Session } from "@earendil-works/pi-agent-core";
import {
  type RoutedServerServiceHost,
  type RoutedSessionHandle,
  type ServerHost,
  SessionAmbiguousError,
  SessionNotFoundError,
} from "@earendil-works/pi-server";
import { createUnixServer, getUnixSocketPath } from "@earendil-works/pi-server/unix";

async function startServer(
  serverServices: RoutedServerServiceHost,
  openRoutedSession: (session: Session) => Promise<RoutedSessionHandle>,
) {
  const sessions = new MemorySessionRepo();
  const host: ServerHost = {
    serverServices,
    async resolveSession(sessionId, context) {
      const matches = (await sessions.list(undefined, context))
        .filter((metadata) => metadata.id === sessionId);
      if (matches.length === 0) {
        throw new SessionNotFoundError(`Unknown session: ${sessionId}`);
      }
      if (matches.length > 1) throw new SessionAmbiguousError();
      return matches[0];
    },
    async openSession(metadata, context) {
      const session = await sessions.open(metadata, context);
      try {
        return await openRoutedSession(session);
      } catch (error) {
        try {
          await session.close(context);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Harness creation and Session cleanup failed",
          );
        }
        throw error;
      }
    },
  };

  const serverId = randomUUID();
  const server = createUnixServer(host, {
    serverId,
    path: getUnixSocketPath(serverId, "/run/user/1000/pi"),
  });
  await server.start();
  return server;
}
```

Applications supply a required server service host, a bounded Session resolver, and a routed Session factory. Session discovery and management are application-owned services; the protocol server only asks the resolver for metadata when routing an attachment. The host owns acquiring the worker-local Session and Harness. Failures are cleaned up in that worker. Neither an open JavaScript Session nor a Harness crosses the process boundary.

`serverId` is a logical identity supplied by the launcher, not a socket address. The Unix preset requires an explicit physical `path`; `getUnixSocketPath()` derives one from a caller-selected directory. Choose a short, private runtime directory rather than deriving the route from an unbounded home-directory path. A long-lived launcher can reuse the same ID and path when replacing a server process.

`Server` composes transports through `ServerListener`; peer authentication remains application policy and is not implemented by the experimental Unix transport. The Unix submodule provides `createUnixListener()` and `createUnixServer()`. Routed-envelope validation, CBOR and framing come from `@earendil-works/pi-protocol`; native Chord Hosts own contract negotiation, calls, remote errors and replicated-state subscriptions.

Server and worker lifecycle is managed outside the public Pi protocol. The replaceable application server converts connection attachments into private demand updates; the worker combines generation-tagged demand with authoritative Harness activity. The experimental coordinator only supplies stable routing and reports generic server-generation connection changes.
