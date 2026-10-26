import { createHost, type Host, type Ref } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, type SessionMetadata } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, test } from "vitest";
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

async function connect(server: Server) {
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
