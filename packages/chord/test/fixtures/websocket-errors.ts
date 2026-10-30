import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { Type } from "typebox";
import { WebSocketServer } from "ws";
import {
	acceptWebSockets,
	createHost,
	hostNamed,
	method,
	remote,
	type WebSocketLike,
	webSocketLink,
} from "../../src/index.ts";

const Board = remote("test.websocket.errors", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: { main: { methods: { who: method(undefined, Type.String()) } } },
});
const host = createHost({ self: "server", name: "server" });
host.serve(Board, () => ({ variant: "main", who: () => "survivor" }));
const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
await new Promise<void>((resolve) => server.once("listening", resolve));
const authentication = Promise.withResolvers<string>();
acceptWebSockets(server, host, {
	principal: (request) => (request.url === "/pending" ? authentication.promise : "guest"),
});
const address = server.address();
assert(address !== null && typeof address === "object");
const socket = createConnection({ port: address.port, host: "127.0.0.1" });
socket.on("error", () => {});
const ended = new Promise<void>((resolve) => socket.once("close", resolve));
socket.once("connect", () =>
	socket.write(
		"GET /pending HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
	),
);
socket.once("data", () => socket.write(Buffer.from([0x81, 0x01, 0x78])));
await ended;
authentication.resolve("late");
const client = createHost({
	self: "client",
	kind: "client",
	upstream: {
		link: webSocketLink(new WebSocket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocketLike),
		principal: "server",
	},
});
assert.equal(await (await client.get(Board, {})).who(), "survivor");
await client.close();
await host.close();
await new Promise<void>((resolve) => server.close(() => resolve()));

const refused = createServer((_request, response) => {
	response.writeHead(403);
	response.end();
});
await new Promise<void>((resolve) => refused.listen(0, "127.0.0.1", resolve));
const refusedAddress = refused.address();
assert(refusedAddress !== null && typeof refusedAddress === "object");
const failed = webSocketLink(new WebSocket(`ws://127.0.0.1:${refusedAddress.port}`) as unknown as WebSocketLike);
await new Promise<void>((resolve) => failed.onClose(() => resolve()));
assert.equal(failed.closed, true);
await new Promise<void>((resolve) => refused.close(() => resolve()));
console.log("preauth-survived; next-client-called; failed-outbound-closed");
