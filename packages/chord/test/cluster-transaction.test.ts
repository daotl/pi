import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it, onTestFinished } from "vitest";
import type { HostImpl } from "../src/host.ts";
import {
	createHost,
	defineRegistry,
	type Facet,
	type Frame,
	hostNamed,
	isChordError,
	type Link,
	local,
	memoryLinkPair,
	method,
	PROTOCOL_VERSION,
	remote,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const latch = () => Promise.withResolvers<void>();

function tap(link: Link, receive: (frame: Frame) => void): Link {
	return {
		get closed() {
			return link.closed;
		},
		send(frame) {
			receive(frame);
			return link.send(frame);
		},
		receive: (handler) => link.receive(handler),
		onClose: (handler) => link.onClose(handler),
		close: (reason) => link.close(reason),
	};
}

function setup(providerAt: "server" | "provider", consumerAt: "server" | "consumer") {
	const modules = new Map<string, Facet>();
	const frames: Frame[] = [];
	const errors: unknown[] = [];
	const server = createHost({ self: {}, name: "server", onError: (error) => errors.push(error) });
	const hosts = new Map([["server", server]]);
	for (const name of new Set([providerAt, consumerAt])) {
		if (name === "server") continue;
		const [down, up] = memoryLinkPair();
		const accepted = tap(down, (frame) => frames.push(frame));
		server.accept(accepted, { kind: "host", name, principal: {} });
		hosts.set(
			name,
			createHost({
				self: {},
				name,
				upstream: { link: tap(up, (frame) => frames.push(frame)), principal: {} },
				loader: async (names) => names.map((name) => modules.get(String(name))!),
				onError: (error) => errors.push(error),
			}),
		);
		server.route(name, { authorize: () => true, resolve: async () => accepted, principal: () => ({}) });
	}
	const V1 = remote("transaction.provider", {
		version: 1,
		input: Type.Object({}),
		host: hostNamed(providerAt),
		variants: { main: { state: { value: Type.Number() }, methods: { old: method(undefined, Type.Number()) } } },
	});
	const V2 = remote("transaction.provider", {
		version: 2,
		input: Type.Object({}),
		host: hostNamed(providerAt),
		variants: { main: { state: { value: Type.String() }, methods: { next: method(undefined, Type.String()) } } },
	});
	const Panel = local("transaction.panel", {
		version: 1,
		input: Type.Object({}),
		members: { read: method(undefined, Type.String()) },
	});
	const provider = hosts.get(providerAt)!;
	const consumer = hosts.get(consumerAt)!;
	const opened = latch();
	const resume = latch();
	let delay = false;
	let fail = false;
	let invalidDerived = false;
	const oldProvider: Facet = {
		name: "provider-facet",
		setup: ({ serve }) =>
			serve(V1, (_input, _principal, self) => {
				const value = self.state("value", Type.Number(), 7);
				return { variant: "main", value, old: () => value.value };
			}),
	};
	const nextProvider: Facet = {
		name: "provider-facet",
		setup: ({ serve }) =>
			serve(V2, (_input, _principal, self) => {
				const value = self.state("value", Type.String(), "unused", { version: 2, migrate: (old) => `new:${old}` });
				self.resource("prepare", {
					version: 1,
					open: async () => {
						opened.resolve();
						if (delay) await resume.promise;
						if (fail) throw new Error("candidate resource failed");
					},
				});
				return { variant: "main", value: self.derive([value], (text) => `${text}!`), next: () => value.value };
			}),
	};
	const oldConsumer: Facet = {
		name: "consumer-facet",
		setup: ({ serve }) =>
			serve(
				Panel,
				(_input, _principal, self) => {
					const ref = self.get(V1, {});
					return { read: async (ctx) => `old:${await ref.old(ctx)}` };
				},
				{ lifetime: "host" },
			),
	};
	const nextConsumer: Facet = {
		name: "consumer-facet",
		setup: ({ serve }) =>
			serve(
				Panel,
				(_input, _principal, self) => {
					const ref = self.get(V2, {});
					const title = self.derive([ref.value], (value) => {
						if (invalidDerived) throw new Error("consumer rejects candidate state");
						return value.toUpperCase();
					});
					return { read: async (ctx) => `${title.value}/${await ref.next(ctx)}` };
				},
				{ lifetime: "host" },
			),
	};
	modules.set("provider", nextProvider);
	modules.set("consumer", nextConsumer);
	modules.set("consumer-old", oldConsumer);
	const reload = () =>
		server.reload(
			[...(providerAt === "server" ? [nextProvider] : []), ...(consumerAt === "server" ? [nextConsumer] : [])],
			{
				remote: {
					...(providerAt === "server" ? {} : { [providerAt]: ["provider"] }),
					...(consumerAt === "server" ? {} : { [consumerAt]: ["consumer"] }),
				},
				voteDeadline: 2000,
			},
		);
	onTestFinished(async () => {
		resume.resolve();
		await Promise.all([...hosts.values()].reverse().map((host) => host.close()));
	});
	return {
		server,
		provider,
		consumer,
		hosts,
		modules,
		frames,
		errors,
		V1,
		V2,
		Panel,
		oldProvider,
		oldConsumer,
		reload,
		opened,
		resume,
		delay: () => {
			delay = true;
		},
		fail: () => {
			fail = true;
		},
		invalid: () => {
			invalidDerived = true;
		},
	};
}

describe("cluster candidate transactions (#24)", () => {
	it("fresh unchanged objects retain installed dependency state across a transaction abort", async () => {
		const [down, up] = memoryLinkPair();
		const entered = latch();
		const resume = latch();
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		let consumerFacet: Facet;
		server.accept(down, { kind: "host", name: "worker", principal: {} });
		const worker = createHost({
			self: {},
			name: "worker",
			upstream: { link: up, principal: {} },
			loader: async () => [consumerFacet],
			onError: () => {},
		});
		onTestFinished(async () => {
			resume.resolve();
			await worker.close();
			await server.close();
		});
		const Provider = remote("transaction.unchanged-provider", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { state: { value: Type.Number() } } },
		});
		const Unchanged = local("transaction.unchanged", {
			version: 1,
			input: Type.Object({}),
			members: { value: Type.Number(), read: method(undefined, Type.Number()) },
		});
		const Panel = local("transaction.unchanged-panel", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.Number()) },
		});
		const provider = (version: number): Facet => ({
			name: "provider",
			setup: ({ serve }) =>
				serve(Provider, (_i, _p, self) => ({
					variant: "main",
					value: self.state("value", Type.Number(), 7, { version, migrate: () => 99 }),
				})),
		});
		await server.install(provider(1));
		const installed = await server.get(Provider, {});
		await worker.install({
			name: "unchanged",
			setup: ({ serve }) =>
				serve(Unchanged, (_i, _p, self) => {
					const ref = self.get(Provider, {});
					return { value: ref.value, read: () => ref.value.value };
				}),
		});
		await worker.install({
			name: "panel",
			setup: ({ serve }) => serve(Panel, () => ({ read: () => 0 }), { lifetime: "host" }),
		});
		consumerFacet = {
			name: "panel",
			setup: ({ serve }) =>
				serve(
					Panel,
					(_i, _p, self) => {
						const ref = self.get(Unchanged, {});
						self.resource("pause", {
							version: 1,
							deps: [ref],
							open: async () => {
								entered.resolve();
								await resume.promise;
								throw new Error("fresh abort");
							},
						});
						return { read: () => ref.value.value };
					},
					{ lifetime: "host" },
				),
		};
		await tick();
		const reloading = server.reload([provider(2)], { remote: { worker: ["panel"] }, voteDeadline: 2000 });
		const rejected = assert.rejects(reloading, /fresh abort/);
		try {
			await Promise.race([entered.promise, reloading]);
			const ordinary = await worker.get(Unchanged, {});
			assert.equal(ordinary.value.value, 7);
			assert.equal(await ordinary.read(), 7);
			resume.resolve();
			await rejected;
			assert.equal(installed.value.value, 7);
			assert.equal(await ordinary.read(), 7);
		} finally {
			resume.resolve();
			await reloading.catch(() => {});
		}
	});

	it("commits registrations from a fresh pending provider after its asynchronous activation", async () => {
		const [down, up] = memoryLinkPair();
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		let nextConsumer: Facet;
		server.accept(down, { kind: "host", name: "worker", principal: {} });
		const worker = createHost({
			self: {},
			name: "worker",
			upstream: { link: up, principal: {} },
			loader: async () => [nextConsumer],
			onError: () => {},
		});
		onTestFinished(async () => {
			await worker.close();
			await server.close();
		});
		const Entries = defineRegistry<string>("transaction.fresh-entries");
		const Before = local("transaction.registry-provider", {
			version: 1,
			input: Type.Object({}),
			members: { old: method(undefined, Type.String()) },
		});
		const After = local("transaction.registry-provider", {
			version: 2,
			input: Type.Object({}),
			members: { next: method(undefined, Type.String()) },
		});
		const Panel = local("transaction.registry-panel", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		await server.install({ name: "provider", setup: ({ serve }) => serve(Before, () => ({ old: () => "old" })) });
		await server.install({
			name: "panel",
			setup: ({ serve }) => serve(Panel, () => ({ read: () => "old" }), { lifetime: "host" }),
		});
		nextConsumer = {
			name: "panel",
			setup: ({ serve }) =>
				serve(
					Panel,
					(_i, _p, self) => {
						const ref = self.get(After, {});
						return { read: (ctx) => ref.next(ctx) };
					},
					{ lifetime: "host" },
				),
		};
		await tick();
		const panel = await server.get(Panel, {});
		await server.reload(
			[
				{
					name: "provider",
					setup: ({ serve }) =>
						serve(
							After,
							(_i, _p, self) => {
								self.resource("async", {
									version: 1,
									open: async () => {
										await tick();
									},
								});
								self.register(Entries, { current: "registered" });
								return { next: () => "new" };
							},
							{ lifetime: "host" },
						),
				},
				nextConsumer,
			],
			{ voteDeadline: 2000 },
		);
		assert.equal(await panel.read(), "new");
		assert.equal(server.registry(Entries).get("current"), "registered");
	});

	for (const [providerAt, consumerAt] of [
		["server", "consumer"],
		["provider", "server"],
		["provider", "consumer"],
	] as const) {
		it(`atomically reloads a breaking method and migrated state from ${providerAt} to ${consumerAt}`, async () => {
			const s = setup(providerAt, consumerAt);
			await s.provider.install(s.oldProvider);
			await s.consumer.install(s.oldConsumer);
			await tick();
			const panel = await s.consumer.get(s.Panel, {});
			assert.equal(await panel.read(), "old:7");
			const report = await s.reload();
			assert.equal(await panel.read(), "NEW:7!/new:7");
			assert.ok([...s.hosts.values()].every((host) => host.codeVersion === report.codeVersion));
			assert.deepEqual(s.errors, []);
		});
	}

	it("rolls back private state and replacement intents, and old methods still work after failure", async () => {
		const s = setup("provider", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		const panel = await s.consumer.get(s.Panel, {});
		s.fail();
		await assert.rejects(s.reload(), /candidate resource failed/);
		for (let n = 0; n < 100 && [...s.hosts.values()].some((host) => (host as HostImpl).reloading); n++) await tick();
		assert.equal(await panel.read(), "old:7");
		assert.ok([...s.hosts.values()].every((host) => host.codeVersion === 1));
		const direct = await s.consumer.get(s.V1, {});
		assert.equal(await direct.old(), 7);
		assert.equal(direct.value.value, 7);
	});

	it("does not exempt an ordinary view sharing the old object-owned binding", async () => {
		const s = setup("server", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		const ordinary = await s.consumer.get(s.V1, {});
		await assert.rejects(s.reload(), (error) => isChordError(error, "contract_mismatch"));
		assert.equal(await ordinary.old(), 7);
		assert.equal(ordinary.value.value, 7);
	});

	it("never binds an ordinary or client hold to a delayed candidate, including a matching V2 fingerprint", async () => {
		const s = setup("server", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		s.delay();
		const reloading = s.reload();
		reloading.catch(() => {});
		await s.opened.promise;
		// Independent server resources may open before the worker even loads its facet. Before that phase an
		// ordinary V1 claim remains legal and revokes replacement intent; this assertion targets the prepared guard.
		for (
			let n = 0;
			n < 100 && !s.frames.some((frame) => frame.t === "prepared" && frame.phase === "materialized");
			n++
		)
			await tick();
		assert.ok(s.frames.some((frame) => frame.t === "prepared" && frame.phase === "materialized"));
		await assert.rejects(s.consumer.get(s.V1, {}), (error) => isChordError(error, "upgrade_conflict"));
		await assert.rejects(s.consumer.get(s.V2, {}), (error) => isChordError(error, "contract_mismatch"));
		const [down, up] = memoryLinkPair();
		s.server.accept(down, { principal: {} });
		const client = createHost({ self: {}, kind: "client", name: "browser", upstream: { link: up, principal: {} } });
		onTestFinished(() => client.close());
		await assert.rejects(client.get(s.V2, {}), (error) => isChordError(error, "upgrade_required"));
		const old = await client.get(s.V1, {});
		assert.equal(old.value.value, 7);
		s.resume.resolve();
		await reloading;
		assert.equal(old.status, "gone");
		assert.equal((await s.consumer.get(s.Panel, {})).status, "live");
		assert.equal(await (await s.consumer.get(s.V2, {})).next(), "new:7");
	});

	it("rejects forged candidate access from a client even with a live transaction id", async () => {
		const s = setup("server", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		s.delay();
		const reloading = s.reload();
		reloading.catch(() => {});
		await s.opened.promise;
		const prepare = s.frames.find((frame) => frame.t === "prepare");
		assert.ok(prepare?.t === "prepare");
		const [down, up] = memoryLinkPair();
		const replies: Frame[] = [];
		s.server.accept(down, { principal: {} });
		up.receive((frame) => replies.push(frame));
		up.send({ t: "hello", protocol: PROTOCOL_VERSION, name: "browser", kind: "client", codeVersion: 1 });
		up.send({ t: "hold", id: 1, at: "server", token: s.V2.description, input: {}, transaction: prepare.transaction });
		await tick();
		assert.ok(up.closed || replies.some((frame) => frame.t === "gone" && frame.id === 1));
		assert.ok(!replies.some((frame) => frame.t === "shape" && frame.id === 1));
		s.resume.resolve();
		await reloading;
	});

	it("rolls back when a consumer refuses a private migrated/derived snapshot", async () => {
		const s = setup("server", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		const panel = await s.consumer.get(s.Panel, {});
		s.invalid();
		await assert.rejects(s.reload(), /consumer rejects candidate state/);
		assert.equal(await panel.read(), "old:7");
		const direct = await s.consumer.get(s.V1, {});
		assert.equal(direct.value.value, 7);
		assert.equal(await direct.old(), 7);
	});

	it("disconnect aborts private holds without replacing the provider's committed state", async () => {
		const s = setup("server", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		s.delay();
		const reloading = s.reload();
		const rejected = assert.rejects(reloading);
		await s.opened.promise;
		const server = s.server as HostImpl;
		for (const connection of server.connections)
			if (connection.name === "consumer") connection.link.close("lost candidate");
		s.resume.resolve();
		await rejected;
		const old = await s.server.get(s.V1, {});
		assert.equal(old.value.value, 7);
		assert.equal(await old.old(), 7);
		assert.equal(s.server.codeVersion, 1);
	});

	it("reconciles a behind consumer through a synchronized sibling's installed provider", async () => {
		const s = setup("provider", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		const panel = await s.consumer.get(s.Panel, {});
		const consumer = s.consumer as HostImpl;
		for (const connection of consumer.connections)
			if (connection.role === "upstream") connection.link.close("reconnect behind");
		await tick();
		await s.server.reload([]);
		const server = s.server as HostImpl;
		server.rememberRemoteModules({ consumer: ["consumer-old"] }, undefined, []);
		const [down, up] = memoryLinkPair();
		s.server.accept(down, { kind: "host", name: "consumer", principal: {} });
		s.consumer.connect(up, { principal: {} });
		for (let n = 0; n < 100 && s.consumer.codeVersion !== s.server.codeVersion; n++) await tick();
		assert.equal(s.consumer.codeVersion, s.server.codeVersion);
		assert.equal(await panel.read(), "old:7");
		assert.equal(up.closed, false);
	});

	it("prepares a fresh address of a changed provider without demoting the private candidate shape", async () => {
		const server = createHost({ name: "server", self: {}, onError: () => {} });
		const V1 = remote("transaction.fresh", {
			version: 1,
			input: Type.Object({ id: Type.String() }),
			host: hostNamed("server"),
			variants: { before: { state: { value: Type.Number() } } },
		});
		const V2 = remote("transaction.fresh", {
			version: 2,
			input: Type.Object({ id: Type.String() }),
			host: hostNamed("server"),
			variants: { after: { state: { title: Type.String() }, methods: { next: method(undefined, Type.String()) } } },
		});
		const Panel = local("transaction.fresh-panel", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const next: Facet = {
			name: "panel",
			setup: ({ serve }) =>
				serve(
					Panel,
					(_input, _principal, self) => {
						const ref = self.get(V2, { id: "new-address" });
						const title = self.derive([ref.title], (value) => value.toUpperCase());
						return { read: async (ctx) => `${title.value}/${await ref.next(ctx)}` };
					},
					{ lifetime: "host" },
				),
		};
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: {} });
		const worker = createHost({
			name: "worker",
			self: {},
			upstream: { link: up, principal: {} },
			loader: async () => [next],
			onError: () => {},
		});
		onTestFinished(async () => {
			await worker.close();
			await server.close();
		});
		await server.install({
			name: "provider",
			setup: ({ serve }) =>
				serve(V1, (_input, _principal, self) => ({
					variant: "before",
					value: self.state("value", Type.Number(), 1),
				})),
		});
		await worker.install({
			name: "panel",
			setup: ({ serve }) => serve(Panel, () => ({ read: () => "old" }), { lifetime: "host" }),
		});
		await tick();
		const panel = await worker.get(Panel, {});
		await server.reload(
			[
				{
					name: "provider",
					setup: ({ serve }) =>
						serve(V2, (_input, _principal, self) => ({
							variant: "after",
							title: self.state("title", Type.String(), "fresh"),
							next: () => "new",
						})),
				},
			],
			{ remote: { worker: ["panel"] }, voteDeadline: 2000 },
		);
		assert.equal(await panel.read(), "FRESH/new");
		const fresh = await server.get(V2, { id: "new-address" });
		assert.equal(fresh.variant, "after");
		assert.equal(fresh.title.value, "fresh");
	});

	it("a disconnected replacement receipt does not poison the next reload after reconnect", async () => {
		const s = setup("server", "consumer");
		await s.provider.install(s.oldProvider);
		await s.consumer.install(s.oldConsumer);
		await tick();
		const panel = await s.consumer.get(s.Panel, {});
		const consumer = s.consumer as HostImpl;
		const server = s.server as HostImpl;
		const [down, up] = memoryLinkPair();
		let sever = true;
		s.server.accept(
			tap(down, (frame) => {
				if (sever && frame.t === "replaced_hold") {
					sever = false;
					down.close("lost intent receipt");
				}
			}),
			{ kind: "host", name: "consumer", principal: {} },
		);
		s.consumer.connect(up, { principal: {} });
		await tick();
		await assert.rejects(s.reload());
		for (let n = 0; n < 100 && consumer.reloading; n++) await tick();
		const [nextDown, nextUp] = memoryLinkPair();
		s.server.accept(nextDown, { kind: "host", name: "consumer", principal: {} });
		s.consumer.connect(nextUp, { principal: {} });
		for (
			let n = 0;
			n < 100 && ![...server.connections].some((connection) => connection.name === "consumer" && connection.synced);
			n++
		)
			await tick();
		assert.equal(await panel.read(), "old:7");
		await s.reload();
		assert.equal(await panel.read(), "NEW:7!/new:7");
	});
});
