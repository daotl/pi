import {
	createHost,
	type Frame,
	type Host,
	hostNamed,
	memoryLinkPair,
	method,
	PACK_THRESHOLD,
	type Ref,
	remote,
} from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, type SessionMetadata } from "@earendil-works/pi-agent-core";
import { encodeClientMessage } from "@earendil-works/pi-protocol";
import { Type } from "typebox";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Client, createClientChordLink } from "../../client/src/index.ts";
import type { ByteConnectionHandler } from "../src/connection.ts";
import { createRoutedLinkPair } from "../src/link.ts";
import { Server } from "../src/server.ts";
import { SessionRouter } from "../src/session-router.ts";
import {
	createTestServerServices,
	Deferred,
	TestServerHost,
	TestSessionContract,
	TestSessionManagement,
} from "../src/testing/host.ts";
import type { ServerHost } from "../src/types.ts";

const serverId = "00000000-0000-4000-8000-000000000001";
const servers = new Set<Server>();
const clients = new Set<Client>();
const hosts = new Set<Host>();

async function connectClient(server: Server): Promise<Client> {
	let handler: ByteConnectionHandler;
	let closed = false;
	const client = new Client({
		serverId,
		transportFactory: (handlers) => {
			handler = server.accept({
				get closed() {
					return closed;
				},
				async send(chunk) {
					handlers.onData(chunk);
				},
				close(finalChunk) {
					if (finalChunk) handlers.onData(finalChunk);
					closed = true;
					handlers.onClose();
				},
			});
			return {
				async send(chunk) {
					handler.onData(chunk);
				},
				close() {
					if (closed) return;
					closed = true;
					handler.onClose();
				},
			};
		},
	});
	clients.add(client);
	await client.connect();
	return client;
}

async function connect(server: Server) {
	const client = await connectClient(server);
	const host = createHost({ name: "presentation-server", self: null, kind: "client" });
	hosts.add(host);
	host.connect(
		createClientChordLink(client, () => ({ serverId })),
		{ principal: null },
	);
	const management = await host.get(TestSessionManagement, {});
	return {
		client,
		host,
		management,
		attach: (sessionId: string) => host.root((ctx) => management.attach(sessionId, ctx)),
		detach: () => host.root((ctx) => management.detach(ctx)),
		async session(): Promise<{ host: Host; ref: Ref<typeof TestSessionContract> }> {
			const sessionHost = createHost({ name: "presentation-session", self: null, kind: "client" });
			hosts.add(sessionHost);
			sessionHost.connect(
				createClientChordLink(client, () => client.attachment),
				{ principal: null },
			);
			return { host: sessionHost, ref: await sessionHost.get(TestSessionContract, {}) };
		},
	};
}

function createServer(host: ServerHost): Server {
	const server = new Server(host, { listeners: [], serverId });
	servers.add(server);
	return server;
}

afterEach(async () => {
	await Promise.all([...clients].map((client) => client.dispose()));
	clients.clear();
	await Promise.all([...hosts].map((host) => host.close()));
	hosts.clear();
	await Promise.all([...servers].map((server) => server.close()));
	servers.clear();
});

describe("native routed Chord sessions", () => {
	test("shares a hosted Session across independent presentation attachments", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		const server = createServer(backing);
		const first = await connect(server);
		const second = await connect(server);
		expect(first.client.hello).toMatchObject({ serverId });
		expect(backing.harnesses.size).toBe(0);
		await first.attach("one");
		await first.attach("one");
		await second.attach("one");
		expect(backing.harnesses.get("one")).toHaveLength(1);
		expect(backing.latestHarness("one").attachedClients).toBe(2);
		await first.client.dispose();
		await expect.poll(() => backing.latestHarness("one").attachedClients).toBe(1);
		await second.detach();
		expect(second.client.attachment).toBeUndefined();
		expect(backing.latestHarness("one").attachedClients).toBe(0);
	});

	test("routes calls, subscriptions, and cancellation over the same native link", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		const presentation = await connect(createServer(backing));
		await presentation.attach("one");
		const { host, ref } = await presentation.session();
		const revisions: number[] = [];
		const stop = ref.revision.subscribe((revision) => revisions.push(revision));
		await expect(host.root((ctx) => ref.run("hello", ctx))).resolves.toBe("hello");
		await host.root((ctx) => ref.increment(ctx));
		await expect.poll(() => revisions).toEqual([0, 1]);
		const controller = new AbortController();
		const pending = host.root((ctx) => ref.wait(ctx), { signal: controller.signal });
		await backing.latestHarness("one").waitEntered.promise;
		controller.abort();
		await expect(pending).rejects.toMatchObject({ code: "aborted" });
		await backing.latestHarness("one").waitCancelled.promise;
		await expect(host.root((ctx) => ref.run("after-cancel", ctx))).resolves.toBe("after-cancel");
		expect(backing.latestHarness("one").calls).toEqual(["hello", "after-cancel"]);
		stop();
		ref.release();
	});

	test("preserves native payloads beyond Chord's compression threshold", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		const presentation = await connect(createServer(backing));
		await presentation.attach("one");
		const { host, ref } = await presentation.session();
		const payload = "message".repeat(20_000);
		await expect(host.root((ctx) => ref.run(payload, ctx))).resolves.toBe(payload);
		expect(backing.latestHarness("one").calls).toEqual([payload]);
	});

	test("replaces attachment capabilities without admitting stale calls", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		await backing.seed("two");
		const presentation = await connect(createServer(backing));
		await presentation.attach("one");
		const old = await presentation.session();
		await presentation.attach("two");
		expect(presentation.client.attachment).toMatchObject({ sessionId: "two" });
		expect(old.ref.status).toBe("loading");
		expect(old.ref.revision.value).toBe(0);
		expect(backing.latestHarness("one").calls).toEqual([]);
		const fresh = await presentation.session();
		await expect(fresh.host.root((ctx) => fresh.ref.run("fresh", ctx))).resolves.toBe("fresh");
		expect(backing.latestHarness("two").calls).toEqual(["fresh"]);
	});

	test("clears a terminated worker attachment and allows reopening", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		const presentation = await connect(createServer(backing));
		await presentation.attach("one");
		const first = backing.latestHarness("one");
		await first.terminate(new Error("worker crashed"));
		await expect.poll(() => presentation.client.attachment).toBeUndefined();
		expect(first.attachmentReleaseCount).toBe(1);
		await presentation.attach("one");
		expect(backing.harnesses.get("one")).toHaveLength(2);
	});

	test("releases a connection lease while shutdown closes the retained worker", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		const server = createServer(backing);
		const presentation = await connect(server);
		await presentation.attach("one");
		const harness = backing.latestHarness("one");
		await presentation.client.dispose();
		await expect.poll(() => harness.attachedClients).toBe(0);
		expect(harness.closeCount).toBe(0);
		await server.close();
		expect(harness.closeCount).toBe(1);
	});
});

describe("packed payloads across routed JSON bridges", () => {
	const PackedContract = remote("test.packed-bridge", {
		version: 1,
		input: Type.Object({}),
		host: hostNamed("worker:packed"),
		variants: {
			live: {
				state: { snapshot: Type.String() },
				methods: { store: method(Type.String(), Type.String()), ping: method() },
			},
		},
	});

	test.each(["routed pair", "client requests", "client responses"] as const)(
		"preserves packed calls, results, and snapshots through %s",
		async (bridge) => {
			const payload = `request:${"x".repeat(PACK_THRESHOLD + 1)}`;
			const snapshot = `snapshot:${"s".repeat(PACK_THRESHOLD + 1)}`;
			const result = `result:${"r".repeat(PACK_THRESHOLD + 1)}`;
			const calls: string[] = [];
			const provider = createHost({ name: "worker:packed", self: null, readyTimeout: 1_000 });
			const consumer = createHost({ name: "presentation", self: null, kind: "client", readyTimeout: 1_000 });
			for (const host of [provider, consumer]) hosts.add(host);
			provider.serve(PackedContract, (_input, _principal, self) => ({
				variant: "live",
				snapshot: self.state("snapshot", Type.String(), snapshot),
				store: (value) => {
					calls.push(value);
					return result;
				},
				ping: () => {},
			}));
			const [providerLink, providerRelay] = memoryLinkPair();
			provider.accept(providerLink, { principal: null });
			const [consumerLink, consumerRelay] = memoryLinkPair();
			consumer.connect(consumerLink, { principal: null });
			const [routed, native] = createRoutedLinkPair();
			let down = routed;
			let up = native;
			if (bridge !== "routed pair") {
				const server = createServer({
					serverServices: {
						attachClient: () => ({ link: routed, release: () => routed.close() }),
					},
					resolveSession: async () => {
						throw new Error("No Session route");
					},
					openSession: async () => {
						throw new Error("No Session route");
					},
				});
				const client = await connectClient(server);
				const clientLink = createClientChordLink(client, () => ({ serverId }));
				down = bridge === "client requests" ? native : clientLink;
				up = bridge === "client requests" ? clientLink : native;
			}
			// Relays retain Packed values until they reach the JSON bridge.
			providerRelay.receive((frame) => down.send(frame));
			down.receive((frame) => providerRelay.send(frame));
			consumerRelay.receive((frame) => up.send(frame));
			up.receive((frame) => consumerRelay.send(frame));
			providerRelay.onClose((reason) => down.close(reason));
			down.onClose((reason) => providerRelay.close(reason));
			consumerRelay.onClose((reason) => up.close(reason));
			up.onClose((reason) => consumerRelay.close(reason));
			const ref = await consumer.get(PackedContract, {});
			expect(ref.snapshot.value).toBe(snapshot);
			await expect(consumer.root((ctx) => ref.store(payload, ctx))).resolves.toBe(result);
			expect(calls).toEqual([payload]);
			await expect(consumer.root((ctx) => ref.ping(ctx))).resolves.toBeUndefined();
			ref.release();
		},
	);

	test.each(["server", "Session"] as const)(
		"preserves packed snapshots, results, and void results from a native %s attachment",
		async (route) => {
			const snapshot = `snapshot:${"s".repeat(PACK_THRESHOLD + 1)}`;
			const payload = `request:${"q".repeat(PACK_THRESHOLD + 1)}`;
			const result = `result:${"r".repeat(PACK_THRESHOLD + 1)}`;
			const provider = createHost({ name: "worker:packed", self: null, readyTimeout: 1_000 });
			const consumer = createHost({ name: "native-presentation", self: null, kind: "client", readyTimeout: 1_000 });
			for (const host of [provider, consumer]) hosts.add(host);
			provider.serve(PackedContract, (_input, _principal, self) => ({
				variant: "live",
				snapshot: self.state("snapshot", Type.String(), snapshot),
				store: (value) => {
					expect(value).toBe(payload);
					return result;
				},
				ping: () => {},
			}));
			const [link, providerLink] = memoryLinkPair();
			provider.accept(providerLink, { principal: null });
			const attachment = { link, release: () => link.close() };
			const services = createTestServerServices();
			const server = createServer({
				serverServices: route === "server" ? { attachClient: () => attachment } : services,
				resolveSession: async () => ({ id: "packed", createdAt: 1, storageVersion: 1 }),
				openSession: async () => ({ attachClient: () => attachment, close: async () => {} }),
			});
			const client = await connectClient(server);
			if (route === "Session") {
				const managementHost = createHost({ name: "native-management", self: null, kind: "client" });
				hosts.add(managementHost);
				managementHost.connect(
					createClientChordLink(client, () => ({ serverId })),
					{ principal: null },
				);
				const management = await managementHost.get(TestSessionManagement, {});
				await managementHost.root((ctx) => management.attach("packed", ctx));
				management.release();
			}
			consumer.connect(
				createClientChordLink(client, () => (route === "server" ? { serverId } : client.attachment)),
				{ principal: null },
			);
			const ref = await consumer.get(PackedContract, {});
			expect(ref.snapshot.value).toBe(snapshot);
			await expect(consumer.root((ctx) => ref.store(payload, ctx))).resolves.toBe(result);
			await expect(consumer.root((ctx) => ref.ping(ctx))).resolves.toBeUndefined();
			expect(client.connected).toBe(true);
			ref.release();
		},
	);

	test("rejects invalid native application data instead of coercing it at the server boundary", async () => {
		const [link, provider] = memoryLinkPair();
		const errors: Error[] = [];
		const server = new Server(
			{
				serverServices: { attachClient: () => ({ link, release: () => link.close() }) },
				resolveSession: async () => {
					throw new Error("No Session route");
				},
				openSession: async () => {
					throw new Error("No Session route");
				},
			},
			{ listeners: [], serverId, onError: (error) => errors.push(error) },
		);
		servers.add(server);
		// Memory transport's own JSON round trip cannot carry invalid data. Inject it at its receiver,
		// where an application-owned Link can hand arbitrary native frames to the server.
		const receive = link.receive.bind(link);
		const invalid = vi.spyOn(link, "receive").mockImplementation((handler) => {
			receive((frame) => {
				if (frame.t === "result") handler({ ...frame, value: { missing: undefined } });
				else handler(frame);
			});
		});
		try {
			const client = await connectClient(server);
			provider.send({ t: "result", id: 1, value: "valid before native receiver" });
			await expect.poll(() => client.connected).toBe(false);
			expect(errors).toHaveLength(1);
			expect(errors[0]).toBeInstanceOf(TypeError);
		} finally {
			invalid.mockRestore();
			provider.close();
		}
	});

	test("counts normalized JSON characters and routed encoded bytes for packed frames", async () => {
		const [sender, receiver] = memoryLinkPair();
		const [routed, native] = createRoutedLinkPair();
		const server = createServer(new TestServerHost());
		const client = await connectClient(server);
		const clientLink = createClientChordLink(client, () => ({ serverId }));
		const frame: Frame = { t: "result", id: 1, value: "é".repeat(PACK_THRESHOLD + 1) };
		const packed = new Deferred<Frame>();
		receiver.receive((received) => packed.resolve(received));
		try {
			sender.send(frame);
			const received = await packed.promise;
			const delivered = new Deferred<Frame>();
			native.receive((copy) => delivered.resolve(copy));
			expect(routed.send(received)).toBe(JSON.stringify(frame).length);
			await expect(delivered.promise).resolves.toEqual(frame);
			expect(clientLink.send(received)).toBe(
				encodeClientMessage({ type: "chord", target: { serverId }, frame }).byteLength,
			);
		} finally {
			sender.close();
			routed.close();
		}
	});

	test("omits optional frame fields without coercing undefined inside application payloads", async () => {
		const [routed, native] = createRoutedLinkPair();
		try {
			const received = new Deferred<unknown>();
			native.receive((frame) => received.resolve(frame));
			const size = routed.send({ t: "result", id: 1, value: undefined, error: undefined });
			await expect(received.promise).resolves.toEqual({ t: "result", id: 1 });
			expect(size).toBe(JSON.stringify({ t: "result", id: 1 }).length);
			const metadata = new Deferred<Frame>();
			native.receive((frame) => metadata.resolve(frame));
			routed.send({
				t: "prepare",
				reload: 1,
				transaction: "reload:1",
				participants: ["worker:packed"],
				codeVersion: 2,
				plugins: [],
				options: { remove: undefined, gateDeadline: undefined, retireDeadline: undefined },
			});
			await expect(metadata.promise).resolves.toEqual({
				t: "prepare",
				reload: 1,
				transaction: "reload:1",
				participants: ["worker:packed"],
				codeVersion: 2,
				plugins: [],
				options: {},
			});
			expect(() => routed.send({ t: "result", id: 2, value: { missing: undefined } })).toThrow(TypeError);
			expect(() => routed.send({ t: "call", id: 3, hold: 1, member: "store", args: [undefined] })).toThrow(
				TypeError,
			);
		} finally {
			routed.close();
		}
		const server = createServer(new TestServerHost());
		const client = await connectClient(server);
		const link = createClientChordLink(client, () => ({ serverId }));
		expect(() => link.send({ t: "result", id: 1, value: { missing: undefined } })).toThrow(TypeError);
	});
});

describe("Session router acquisition and cleanup", () => {
	function router<T extends SessionMetadata>(host: ServerHost<T>, closing = () => false) {
		return new SessionRouter({
			host,
			serverId,
			isClosing: closing,
			async publishAttachment() {},
			async publishFrame() {},
			reportError() {},
		});
	}

	test("rejects wrong-client and stale attachment routes before touching a native endpoint", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		await backing.seed("two");
		let target: { serverId: string; sessionId: string; attachmentId: string } | undefined;
		const routing = new SessionRouter({
			host: backing,
			serverId,
			isClosing: () => false,
			async publishAttachment(_client, attachment) {
				target = attachment;
			},
			async publishFrame() {},
			reportError() {},
		});
		const client = {};
		await routing.attachClient(client, "one", BACKGROUND_CONTEXT);
		const stale = target!;
		await expect(routing.forwardFrame({ t: "ping", n: 1 }, stale, {})).rejects.toMatchObject({
			code: "session_not_attached",
		});
		await routing.attachClient(client, "two", BACKGROUND_CONTEXT);
		await expect(routing.forwardFrame({ t: "ping", n: 2 }, stale, client)).rejects.toMatchObject({
			code: "session_not_attached",
		});
		expect(backing.latestHarness("one").calls).toEqual([]);
		await routing.close(BACKGROUND_CONTEXT);
	});

	test("clears attachment ownership even when capability release fails", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		let target: { serverId: string; sessionId: string; attachmentId: string } | undefined;
		const routing = new SessionRouter({
			host: backing,
			serverId,
			isClosing: () => false,
			async publishAttachment(_client, attachment) {
				target = attachment;
			},
			async publishFrame() {},
			reportError() {},
		});
		const client = {};
		await routing.attachClient(client, "one", BACKGROUND_CONTEXT);
		const stale = target!;
		const failure = new Error("release failed");
		backing.latestHarness("one").failAttachmentRelease = failure;
		await expect(routing.detachClient(client, BACKGROUND_CONTEXT)).rejects.toBe(failure);
		expect(target).toBeUndefined();
		await expect(routing.forwardFrame({ t: "ping", n: 1 }, stale, client)).rejects.toMatchObject({
			code: "session_not_attached",
		});
		await routing.close(BACKGROUND_CONTEXT);
	});

	test("passes repository-specific metadata without reconstructing it", async () => {
		type Metadata = SessionMetadata & { path: string };
		const metadata: Metadata = { id: "one", createdAt: 1, storageVersion: 1, path: "/sessions/one" };
		let received: Metadata | undefined;
		const hosted: ServerHost<Metadata> = {
			serverServices: createTestServerServices(),
			resolveSession: async () => metadata,
			openSession: async (candidate) => {
				received = candidate;
				return {
					attachClient: () => ({ link: createRoutedLinkPair()[0], release() {} }),
					close: async () => {},
				};
			},
		};
		const routing = router(hosted);
		await routing.attachClient({}, "one", BACKGROUND_CONTEXT);
		expect(received).toBe(metadata);
		await routing.close(BACKGROUND_CONTEXT);
	});

	test("releases a lease acquired concurrently with worker termination", async () => {
		const entered = new Deferred<void>();
		const resume = new Deferred<void>();
		const terminated = new Deferred<Error | undefined>();
		let releases = 0;
		const routing = router({
			serverServices: createTestServerServices(),
			resolveSession: async () => ({ id: "one", createdAt: 1, storageVersion: 1 }),
			openSession: async () => ({
				terminated: terminated.promise,
				close: async () => {},
				attachClient: async () => {
					entered.resolve(undefined);
					await resume.promise;
					return {
						link: createRoutedLinkPair()[0],
						release() {
							releases++;
						},
					};
				},
			}),
		});
		const attaching = routing.attachClient({}, "one", BACKGROUND_CONTEXT);
		await entered.promise;
		terminated.resolve(new Error("terminated"));
		resume.resolve(undefined);
		await expect(attaching).rejects.toMatchObject({ code: "server_draining" });
		expect(releases).toBe(1);
		await routing.close(BACKGROUND_CONTEXT);
	});

	test("shares acquisition failures and retries without leaking the Session", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		backing.nextOpenSessionError = new Error("failed to create");
		const routing = router(backing);
		const gate = backing.gateNextOpenSession();
		const first = routing.attachClient({}, "one", BACKGROUND_CONTEXT);
		await gate.entered.promise;
		const second = routing.attachClient({}, "one", BACKGROUND_CONTEXT);
		await Promise.resolve();
		await Promise.resolve();
		gate.release.resolve(undefined);
		await expect(Promise.allSettled([first, second])).resolves.toMatchObject([
			{ status: "rejected" },
			{ status: "rejected" },
		]);
		expect(backing.openSessionCount).toBe(1);
		await routing.attachClient({}, "one", BACKGROUND_CONTEXT);
		expect(backing.openSessionCount).toBe(2);
		await routing.close(BACKGROUND_CONTEXT);
	});

	test("closes workers acquired while draining and propagates cleanup failures", async () => {
		const backing = new TestServerHost();
		await backing.seed("one");
		backing.nextHarnessCloseError = new Error("close failed");
		let closing = false;
		const routing = router(backing, () => closing);
		const gate = backing.gateNextOpenSession();
		const attaching = routing.attachClient({}, "one", BACKGROUND_CONTEXT);
		await gate.entered.promise;
		closing = true;
		const cleanup = routing.close(BACKGROUND_CONTEXT);
		gate.release.resolve(undefined);
		await expect(attaching).rejects.toThrow(/acquired while draining/);
		await expect(cleanup).rejects.toThrow(/Failed to close routed Sessions/);
		expect(backing.latestHarness("one").closeCount).toBe(1);
		await backing.latestHarness("one").close(BACKGROUND_CONTEXT);
	});
});
