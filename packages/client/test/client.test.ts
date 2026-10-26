import type { Frame } from "@earendil-works/chord";
import {
	encodeCbor,
	encodeFrame,
	encodeServerMessage,
	PROTOCOL_VERSION,
	ProtocolValidationError,
} from "@earendil-works/pi-protocol";
import { describe, expect, test } from "vitest";
import { type ByteTransportFactory, Client, ClientDisposedError, createClientChordLink } from "../src/index.ts";
import { MemoryByteServer } from "./support.ts";

const serverId = "00000000-0000-4000-8000-000000000001";
const target = { serverId };
async function connectClient(server: MemoryByteServer): Promise<Client> {
	return Client.connect({ serverId, transportFactory: (handlers) => server.connect(handlers) });
}

test("requires a canonical UUIDv4 server identity", () => {
	expect(() => new Client({ serverId: "invalid", transportFactory: () => Promise.reject() })).toThrow(/serverId/);
});

describe("native routed Chord links", () => {
	test("queues native frames until a link and receiver are installed", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		server.send({ type: "chord", target, frame: { t: "hello", name: "server", kind: "host", codeVersion: 1 } });
		const link = createClientChordLink(client, () => target);
		server.send({ type: "chord", target, frame: { t: "ping", n: 1 } });
		const frames: Frame[] = [];
		link.receive((frame) => frames.push(frame));
		expect(frames).toEqual([
			{ t: "hello", name: "server", kind: "host", codeVersion: 1 },
			{ t: "ping", n: 1 },
		]);
		link.send({ t: "cancel", id: 3 });
		expect(server.messages.at(-1)).toEqual({ type: "chord", target, frame: { t: "cancel", id: 3 } });
		await client.dispose();
	});

	test("fences Session links across attachment changes and ignores stale frames", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const first = { serverId, sessionId: "one", attachmentId: "first" };
		const second = { serverId, sessionId: "two", attachmentId: "second" };
		const changes: Array<string | undefined> = [];
		client.onAttachmentChange((attachment) => changes.push(attachment?.sessionId));
		server.send({ type: "attachment", attachment: first });
		const link = createClientChordLink(client, () => client.attachment);
		const closed: string[] = [];
		link.onClose((reason) => closed.push(reason));
		server.send({ type: "attachment", attachment: second });
		server.send({ type: "chord", target: first, frame: { t: "ping", n: 1 } });
		const replacement = createClientChordLink(client, () => client.attachment);
		const frames: Frame[] = [];
		replacement.receive((frame) => frames.push(frame));
		expect(link.closed).toBe(true);
		expect(closed).toEqual(["attachment changed"]);
		expect(frames).toEqual([]);
		server.send({ type: "attachment", attachment: null });
		expect(replacement.closed).toBe(true);
		expect(changes).toEqual(["one", "two", undefined]);
		await client.dispose();
	});

	test("closes only the targeted native link on a provider bye", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const attachment = { serverId, sessionId: "one", attachmentId: "first" };
		server.send({ type: "attachment", attachment });
		const serverLink = createClientChordLink(client, () => target);
		const sessionLink = createClientChordLink(client, () => attachment);
		server.send({ type: "chord", target: attachment, frame: { t: "bye", reason: "gone" } });
		expect(sessionLink.closed).toBe(true);
		expect(serverLink.closed).toBe(false);
		expect(client.connected).toBe(true);
		await client.dispose();
	});

	test("reconnects with fresh links and discards the former connection's queued frames", async () => {
		const first = new MemoryByteServer();
		const second = new MemoryByteServer();
		let connection = 0;
		const client = new Client({
			serverId,
			transportFactory: (handlers) => (connection++ === 0 ? first : second).connect(handlers),
		});
		await client.connect();
		const old = createClientChordLink(client, () => target);
		first.disconnect();
		expect(old.closed).toBe(true);
		await client.reconnect();
		const fresh = createClientChordLink(client, () => target);
		fresh.send({ t: "ping", n: 2 });
		expect(second.messages.at(-1)).toEqual({ type: "chord", target, frame: { t: "ping", n: 2 } });
		await client.dispose();
		expect(fresh.closed).toBe(true);
		expect(() => createClientChordLink(client, () => target)).toThrow(ClientDisposedError);
	});
});

describe("Client connection lifecycle", () => {
	test("connects only to the expected logical server", async () => {
		const wrong = new MemoryByteServer("00000000-0000-4000-8000-000000000002");
		await expect(connectClient(wrong)).rejects.toBeInstanceOf(ProtocolValidationError);
	});

	test("rejects data before hello is sent and closes the late transport", async () => {
		let closeCount = 0;
		let sendCount = 0;
		const client = new Client({
			serverId,
			transportFactory: (handlers) => {
				handlers.onData(encodeServerMessage({ type: "hello", version: PROTOCOL_VERSION, serverId }));
				return {
					async send() {
						sendCount++;
					},
					close() {
						closeCount++;
					},
				};
			},
		});
		await expect(client.connect()).rejects.toMatchObject({ name: "ProtocolValidationError" });
		expect(sendCount).toBe(0);
		expect(closeCount).toBe(1);
	});

	test("rejects bounded handshake errors", async () => {
		let handlers: Parameters<ByteTransportFactory>[0];
		const client = new Client({
			serverId,
			transportFactory: (value) => {
				handlers = value;
				return {
					async send() {
						handlers.onData(
							encodeServerMessage({ type: "hello_error", error: { code: "version", message: "Unsupported" } }),
						);
					},
					close() {},
				};
			},
		});
		await expect(client.connect()).rejects.toMatchObject({ name: "ServerError", code: "version" });
	});

	test("closes native links on transport failures and invalid framing", async () => {
		const server = new MemoryByteServer();
		const client = await connectClient(server);
		const link = createClientChordLink(client, () => target);
		server.error(new Error("read failed"));
		expect(link.closed).toBe(true);
		expect(client.connected).toBe(false);
		const malformed = new MemoryByteServer();
		const invalid = await connectClient(malformed);
		malformed.sendRaw(encodeFrame(encodeCbor({ type: "unknown" })));
		expect(invalid.connected).toBe(false);
		const truncated = new MemoryByteServer();
		const partial = await connectClient(truncated);
		const changes: unknown[] = [];
		partial.onConnectionStateChange((change) => changes.push(change));
		truncated.sendRaw(new Uint8Array([0, 0, 0, 2, 1]));
		truncated.disconnect();
		expect(changes).toEqual([
			expect.objectContaining({ error: expect.objectContaining({ message: expect.stringMatching(/truncated/i) }) }),
		]);
	});
});
