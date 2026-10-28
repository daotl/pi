import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { deflateRawSync } from "node:zlib";
import { Type } from "typebox";
import { describe, it } from "vitest";
import { WebSocketServer } from "ws";
import {
	acceptWebSockets,
	createHost,
	hostNamed,
	inflateMessage,
	isChordError,
	memoryLinkPair,
	method,
	remote,
	type WebSocketLike,
	webSocketLink,
} from "../src/index.ts";

const Board = remote("t.board", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: {
		main: {
			state: { notes: Type.Array(Type.String()) },
			methods: { add: method(Type.String()), who: method(undefined, Type.Unknown()) },
		},
	},
});

describe("WebSocket links", () => {
	for (const relayed of [false, true]) {
		it(`null-authenticated WebSocket guests cannot read or call owner privileges ${relayed ? "through a relay" : "locally"}`, async () => {
			const Access = remote("t.websocket-null", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed(relayed ? "worker" : "server"),
				variants: {
					owner: { state: { secret: Type.String() }, methods: { owner: method(undefined, Type.String()) } },
					guest: { state: { public: Type.String() }, methods: { who: method(undefined, Type.Null()) } },
				},
			});
			const server = createHost<string | null>({ self: "host", name: "server" });
			const worker = createHost<string | null>({ self: "host", name: "worker" });
			const provider = relayed ? worker : server;
			provider.serve(Access, (_input, principal, self) => {
				if (principal === "host")
					return {
						variant: "owner",
						secret: self.state("secret", Type.String(), "owner-secret"),
						owner: () => "owner",
					};
				if (principal !== null) throw new Error("expected the null guest principal");
				return {
					variant: "guest",
					public: self.state("public", Type.String(), "guest-state"),
					who: () => principal,
				};
			});
			if (relayed) {
				const [down, up] = memoryLinkPair();
				worker.connect(up, { principal: "host" });
				server.route("worker", { principal: () => "host", authorize: () => true, resolve: async () => down });
			}
			const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
			await new Promise<void>((resolve) => wss.once("listening", resolve));
			acceptWebSockets(wss as never, server, { principal: () => null });
			const address = wss.address();
			assert.ok(address !== null && typeof address === "object");
			const browser = createHost<string | null>({
				self: "host",
				kind: "client",
				name: "browser",
				upstream: {
					link: webSocketLink(new WebSocket(`ws://127.0.0.1:${address.port}`) as unknown as WebSocketLike),
					principal: "host",
				},
			});
			try {
				const owner = await provider.get(Access, {});
				assert.equal(owner.variant, "owner");
				const guest = await browser.get(Access, {});
				assert.equal(guest.variant, "guest");
				if (guest.variant !== "guest") throw new Error("guest acquired owner privileges");
				assert.equal(guest.public.value, "guest-state");
				assert.equal(await guest.who(), null);
				assert.deepEqual([...guest.shape!.members].sort(), ["public", "who"]);
				const secret = Reflect.get(guest, "secret") as { readonly value: string };
				assert.throws(
					() => secret.value,
					(error) => isChordError(error, "not_in_variant"),
				);
				const ownerCall = Reflect.get(guest, "owner") as () => Promise<string>;
				await assert.rejects(ownerCall(), (error) => isChordError(error, "not_in_variant"));
			} finally {
				await browser.close();
				await server.close();
				await worker.close();
				await new Promise<void>((resolve) => wss.close(() => resolve()));
			}
		});
	}

	it("serves a browser-style client over a real socket, stamped by the authenticator", async () => {
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		server.serve(Board, (_input, principal, self) => {
			const notes = self.state("notes", Type.Array(Type.String()), []);
			return {
				variant: "main",
				notes,
				add: (text, ctx) => {
					notes.change(ctx, (draft) => {
						draft.push(text);
					});
				},
				who: () => principal,
			};
		});
		const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
		await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
		acceptWebSockets(wss as never, server, {
			principal: (request: IncomingMessage) => {
				const token = new URL(request.url ?? "/", "http://x").searchParams.get("token");
				return token === "ok" ? { guest: "web" } : undefined;
			},
		});
		const port = (wss.address() as { port: number }).port;
		const open = (token: string) =>
			createHost({
				self: { kind: "host" },
				name: "browser",
				kind: "client",
				upstream: {
					link: webSocketLink(new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`) as unknown as WebSocketLike),
					principal: { kind: "server" },
				},
				onError: () => {},
			});
		try {
			const browser = open("ok");
			const board = browser.hold(Board, {});
			const seen: unknown[] = [];
			board.notes.subscribe((value) => seen.push(value));
			await board.add("hello");
			assert.deepEqual(await board.who(), { guest: "web" });
			for (let i = 0; i < 50 && board.notes.value?.length !== 1; i++) await new Promise((r) => setTimeout(r, 5));
			assert.deepEqual(board.notes.value, ["hello"]);
			assert.deepEqual(seen.at(-1), ["hello"]);
			await browser.close();

			// WebSocket peers are always clients: one announcing itself as a host is cut off.
			const impostor = createHost({
				self: { kind: "host" },
				name: "session:S1",
				upstream: {
					link: webSocketLink(new WebSocket(`ws://127.0.0.1:${port}/?token=ok`) as unknown as WebSocketLike),
					principal: { kind: "server" },
				},
				onError: () => {},
			});
			await assert.rejects(
				impostor.root((ctx) => impostor.hold(Board, {}).add("x", ctx), {
					signal: AbortSignal.timeout(150),
				}),
				(error) => isChordError(error, "aborted"),
			);
			await impostor.close();

			const refused = open("bad");
			const denied = refused.hold(Board, {});
			// The server closes unauthenticated sockets; calls wait for a reconnect until their ctx gives up.
			await assert.rejects(
				refused.root((ctx) => denied.add("x", ctx), { signal: AbortSignal.timeout(100) }),
				(error) => isChordError(error, "aborted"),
			);
			await refused.close();
		} finally {
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		}
	});

	it("a synchronous authenticator throw closes only the rejected socket; the next client can call", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		server.serve(Board, (_input, principal, self) => ({
			variant: "main",
			notes: self.state("notes", Type.Array(Type.String()), []),
			add: () => {},
			who: () => principal,
		}));
		const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
		const listening = Promise.withResolvers<void>();
		wss.once("listening", listening.resolve);
		await listening.promise;
		acceptWebSockets(wss as never, server, {
			principal(request: IncomingMessage) {
				if (request.url === "/throw") throw new Error("invalid credentials");
				return { guest: "survivor" };
			},
		});
		const address = wss.address();
		assert.ok(address !== null && typeof address === "object");
		const url = `ws://127.0.0.1:${address.port}`;
		try {
			const refused = new WebSocket(`${url}/throw`);
			const closed = Promise.withResolvers<CloseEvent>();
			refused.addEventListener("close", closed.resolve);
			await closed.promise;
			assert.equal(refused.readyState, WebSocket.CLOSED);
			const client = createHost({
				self: {},
				kind: "client",
				onError: () => {},
				upstream: { link: webSocketLink(new WebSocket(`${url}/ok`) as unknown as WebSocketLike), principal: {} },
			});
			try {
				assert.deepEqual(await client.hold(Board, {}).who(), { guest: "survivor" });
			} finally {
				await client.close();
			}
		} finally {
			await server.close();
			const closed = Promise.withResolvers<void>();
			wss.close(() => closed.resolve());
			await closed.promise;
		}
	});
});

describe("WebSocket links: packed payloads", () => {
	it("rejects packed text envelopes before delivering a call", () => {
		const messages: ((event: { data: unknown }) => void)[] = [];
		let closed = false;
		let delivered = false;
		const socket: WebSocketLike = {
			readyState: 1,
			send: () => {},
			close: () => {
				closed = true;
			},
			addEventListener(type, listener) {
				if (type === "message") messages.push(listener);
			},
		};
		const link = webSocketLink(socket, { acceptPacked: false });
		link.receive(() => {
			delivered = true;
		});
		const packed = deflateRawSync(JSON.stringify("x".repeat(4096))).toString("base64");
		for (const receive of messages)
			receive({ data: JSON.stringify({ t: "call", id: 1, hold: 1, member: "m", z: ["args", packed] }) });
		assert.equal(closed, true);
		assert.equal(delivered, false);
	});

	it("large snapshots and results reach the client as binary messages; clients may not send them", async () => {
		const notes = Array.from({ length: 40 }, (_, i) => `${i}:${"x".repeat(4000)}`);
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		server.serve(Board, (_input, _principal, self) => {
			const state = self.state("notes", Type.Array(Type.String()), notes);
			return { variant: "main", notes: state, add: () => {}, who: () => notes };
		});
		const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
		await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
		acceptWebSockets(wss as never, server, { principal: () => ({ guest: "web" }) });
		const url = `ws://127.0.0.1:${(wss.address() as { port: number }).port}/`;
		try {
			const binary: Uint8Array[] = [];
			const socket = new WebSocket(url);
			socket.addEventListener("message", (event) => {
				if (typeof event.data !== "string") binary.push(new Uint8Array(event.data as ArrayBuffer));
			});
			const browser = createHost({
				self: { kind: "host" },
				name: "browser",
				kind: "client",
				upstream: { link: webSocketLink(socket as unknown as WebSocketLike), principal: { kind: "server" } },
				onError: () => {},
			});
			const board = browser.hold(Board, {});
			assert.deepEqual(await board.who(), notes);
			board.notes.subscribe(() => {});
			for (let i = 0; i < 100 && board.notes.value === undefined; i++) await new Promise((r) => setTimeout(r, 5));
			assert.deepEqual(board.notes.value, notes);
			assert(binary.length >= 2, "the result and the snapshot came as binary messages");
			// A text-only transport (the TUI launcher) turns a packed message back into its text frame.
			const frames = binary.map((message) => JSON.parse(inflateMessage(message)) as Record<string, unknown>);
			assert(frames.some((frame) => frame.t === "result" && JSON.stringify(frame.value) === JSON.stringify(notes)));
			assert(frames.some((frame) => frame.t === "state" && JSON.stringify(frame.value) === JSON.stringify(notes)));
			await browser.close();

			// A client's binary message is a protocol error: the server closes the socket.
			const raw = new WebSocket(url);
			raw.binaryType = "arraybuffer";
			await new Promise<void>((resolve) => raw.addEventListener("open", () => resolve()));
			const closed = new Promise<void>((resolve) => raw.addEventListener("close", () => resolve()));
			raw.send(new Uint8Array([0, 0, 0, 2, 123, 125]));
			await closed;
		} finally {
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		}
	});
});
