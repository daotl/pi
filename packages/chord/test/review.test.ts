// Regression tests for Sol's phase 1a review (findings #1-#11) and the requested race tests.
import assert from "node:assert/strict";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, it, onTestFinished, vi } from "vitest";
import { contractFromDescription } from "../src/contract.ts";
import {
	type Ctx,
	createHost,
	defineRegistry,
	type Facet,
	hostNamed,
	isChordError,
	local,
	memoryLinkPair,
	method,
	type Ref,
	remote,
} from "../src/index.ts";
import { fits } from "../src/schema.ts";
import { type Frame, isFrame } from "../src/wire.ts";
import { CountingLink } from "./fixtures/counting.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const ticks = async (n = 10) => {
	for (let i = 0; i < n; i++) await tick();
};

function latch() {
	let open = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

function emitter<E>(options: { failSubscribe?: boolean } = {}) {
	const listeners = new Set<(event: E) => void>();
	return {
		emit: (event: E) => {
			for (const fn of [...listeners]) fn(event);
		},
		subscribe: (fn: (event: E) => void) => {
			if (options.failSubscribe) throw new Error("subscribe fails");
			listeners.add(fn);
			return () => listeners.delete(fn);
		},
		get size() {
			return listeners.size;
		},
	};
}

const Item = local("t.item", {
	version: 1,
	input: Type.Object({ id: Type.String() }),
	members: { version: method(undefined, Type.String()) },
});

describe("review: reload commit", () => {
	it("#1 a failing listener subscription fails prepare; the code version and all objects stay unchanged", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const sources = { a: emitter<number>(), b: emitter<number>({ failSubscribe: true }), c: emitter<number>() };
		const facet = (version: string, listen: boolean): Facet => ({
			name: "item",
			setup: (api) =>
				api.serve(Item, ({ id }, _principal, self) => {
					if (listen) self.on("events", sources[id as "a"], () => {});
					return { version: () => version };
				}),
		});
		host.install(facet("v1", false));
		const refs = ["a", "b", "c"].map((id) => host.hold(Item, { id }));
		await Promise.all(refs.map((ref) => ref.ready));
		const codeVersion = host.codeVersion;
		await assert.rejects(host.reload([facet("v2", true)]), /subscribe fails/);
		assert.equal(host.codeVersion, codeVersion);
		assert.deepEqual(await Promise.all(refs.map((ref) => ref.version())), ["v1", "v1", "v1"]);
		assert.equal(sources.a.size, 0);
		assert.equal(sources.c.size, 0);
	});

	it("#2 migration is validated against the new remote schemas, not the obsolete ones (dev mode)", async () => {
		const host = createHost({ self: { kind: "host" }, dev: true, onError: () => {} });
		const V1 = remote("t.counted", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("host"),
			variants: { main: { state: { count: Type.Object({ n: Type.Number() }) } } },
		});
		const V2 = remote("t.counted", {
			version: 2,
			input: Type.Object({}),
			host: hostNamed("host"),
			variants: { main: { state: { count: Type.Object({ total: Type.Number() }) } } },
		});
		host.install({
			name: "counted",
			setup: (api) =>
				api.serve(
					V1,
					(_input, _principal, self) => ({
						variant: "main",
						count: self.state("count", Type.Object({ n: Type.Number() }), { n: 3 }),
					}),
					{ linger: 60_000 },
				),
		});
		const first = host.hold(V1, {});
		await first.ready;
		first.release();
		await host.reload([
			{
				name: "counted",
				setup: (api) =>
					api.serve(
						V2,
						(_input, _principal, self) => ({
							variant: "main",
							count: self.state(
								"count",
								Type.Object({ total: Type.Number() }),
								{ total: 0 },
								{ version: 2, migrate: (old) => ({ total: (old as { n: number }).n }) },
							),
						}),
						{ linger: 60_000 },
					),
			},
		]);
		const second = host.hold(V2, {});
		const values: unknown[] = [];
		second.count.subscribe((value) => values.push(value));
		await second.ready;
		await ticks();
		assert.deepEqual(second.count.value, { total: 3 });
	});

	it("#1 a commit that still fails midway fails the host terminally (no half-published code version serving work)", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		host.install({ name: "item", setup: (api) => api.serve(Item, () => ({ version: () => "v1" })) });
		const ref = host.hold(Item, { id: "a" });
		await ref.ready;
		// Everything fallible runs in prepare now, so break an install step directly (white box).
		const objects = (host as unknown as { objects: Map<string, { startTasks(): void }> }).objects;
		for (const object of objects.values()) {
			object.startTasks = () => {
				throw new Error("install step fails");
			};
		}
		await assert.rejects(
			host.reload([{ name: "item", setup: (api) => api.serve(Item, () => ({ version: () => "v2" })) }]),
			/install step fails/,
		);
		await assert.rejects(
			ref.version(),
			(error) => isChordError(error, "unavailable") && error.reason === "host_failed",
		);
	});

	it("reentrant observers calling another object during a commit see the whole new code version", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const Other = local("t.other", {
			version: 1,
			input: Type.Object({}),
			members: { version: method(undefined, Type.String()) },
		});
		const facet = (version: string): Facet => ({
			name: "pair",
			setup: (api) => {
				api.serve(Item, () => ({ version: () => version }));
				api.serve(Other, () => ({ version: () => version }));
			},
		});
		host.install(facet("v1"));
		const item = host.hold(Item, { id: "a" });
		const other = host.hold(Other, {});
		await Promise.all([item.ready, other.ready]);
		const seen: Promise<string>[] = [];
		item.onShape(() => seen.push(other.version()));
		await host.reload([facet("v2")]);
		assert.deepEqual(await Promise.all(seen), ["v2"]);
	});
});

describe("review: leases, invocations, activation", () => {
	const Store = local("t.store", {
		version: 1,
		input: Type.Object({}),
		members: { count: Type.Unknown() },
	});

	it("#4 a running listener holds a lease: the gate waits for it before migrating", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const events = emitter<number>();
		const go = latch();
		const seen: unknown[] = [];
		host.install({
			name: "store",
			setup: (api) =>
				api.serve(Store, (_input, _principal, self) => {
					const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 1 });
					self.on("slow", events, async () => {
						await go.promise;
						seen.push(count.value);
					});
					return { count };
				}),
		});
		const ref = host.hold(Store, {});
		await ref.ready;
		events.emit(1);
		await tick();
		const codeVersion = host.codeVersion;
		const reload = host.reload(
			[
				{
					name: "store",
					setup: (api) =>
						api.serve(Store, (_input, _principal, self) => ({
							count: self.state(
								"count",
								Type.Object({ total: Type.Number() }),
								{ total: 0 },
								{ version: 2, migrate: (old) => ({ total: (old as { n: number }).n }) },
							),
						})),
				},
			],
			{ gateDeadline: 2000 },
		);
		await ticks(20);
		assert.equal(host.codeVersion, codeVersion, "the gate must wait for the listener");
		go.open();
		await reload;
		assert.deepEqual(seen, [{ n: 1 }]);
		assert.deepEqual(ref.count.value, { total: 1 });
	});

	it("#5 disposal waits for running methods before closing resources (released and forced)", async () => {
		const Worker = local("t.busy", {
			version: 1,
			input: Type.Object({ id: Type.String() }),
			members: { work: method(undefined, Type.Boolean()) },
		});
		const log: string[] = [];
		let go = latch();
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		host.serve(Worker, ({ id }, _principal, self) => {
			const connResource = self.resource("conn", {
				version: 1,
				open: () => ({ closed: false }),
				close: (conn) => {
					conn.closed = true;
					log.push(`close ${id}`);
				},
			});
			return {
				work: async () => {
					await go.promise;
					log.push(`done ${id}`);
					return connResource.value.closed;
				},
			};
		});
		const released = host.hold(Worker, { id: "r" });
		const call = released.work();
		await ticks();
		released.release();
		await ticks();
		go.open();
		assert.equal(await call, false);
		await ticks();
		assert.deepEqual(log, ["done r", "close r"]);

		go = latch();
		log.length = 0;
		const forced = host.hold(Worker, { id: "f" }, { principal: { user: "u" } });
		const forcedCall = forced.work();
		await ticks();
		const invalidated = host.invalidatePrincipal((principal) => (principal as { user?: string }).user === "u");
		await ticks();
		assert.equal(forced.status, "gone");
		assert.deepEqual(log, []);
		go.open();
		await invalidated;
		assert.equal(await forcedCall, false);
		assert.deepEqual(log, ["done f", "close f"]);
	});

	it("#6 a registry conflict found while finalizing activation unwinds the loser completely", async () => {
		const errors: unknown[] = [];
		const host = createHost({ self: { kind: "host" }, onError: (error) => errors.push(error) });
		const Routes = defineRegistry<string>("t.review-routes");
		const log: string[] = [];
		const types = ["t.eager-a", "t.eager-b"].map((name) => local(name, { version: 1, input: Type.Object({}) }));
		for (const type of types) {
			host.serve(
				type,
				(_input, _principal, self) => {
					self.resource("r", {
						version: 1,
						open: () => void log.push(`open ${type.name}`),
						close: () => void log.push(`close ${type.name}`),
					});
					self.register(Routes, { same: type.name });
					return {};
				},
				{ lifetime: "host" },
			);
		}
		await ticks(20);
		assert.equal(log.filter((entry) => entry.startsWith("open")).length, 2);
		assert.equal(log.filter((entry) => entry.startsWith("close")).length, 1);
		assert.equal(host.registry(Routes).table().size, 1);
		assert.ok(errors.some((error) => isChordError(error, "invalid") && error.reason === "registry_conflict"));
	});

	it("#6 releasing the last hold while listeners start up does not resurrect the object", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const log: string[] = [];
		let ref: Ref<typeof Store> | undefined;
		let runs = 0;
		host.serve(Store, (_input, _principal, self) => {
			runs++;
			const count = self.state("count", Type.Number(), 0);
			self.resource("r", {
				version: 1,
				open: () => void log.push("open"),
				close: () => void log.push("close"),
			});
			// A readable delivers its current value as the listener starts: release the only hold right then.
			self.on("drop", count, () => ref?.release());
			return { count };
		});
		ref = host.hold(Store, {});
		await ref.ready.catch(() => {});
		await ticks(20);
		assert.deepEqual(log, ["open", "close"]);
		const again = host.hold(Store, {});
		ref = undefined;
		await again.ready;
		assert.equal(runs, 2);
	});
});

describe("review: prepare isolation and contracts", () => {
	const Db = local("t.db", {
		version: 1,
		input: Type.Object({}),
		members: { read: method(undefined, Type.Unknown()) },
	});

	it("#7 a prepare rerun cannot touch retained resources, even open ones", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const native = { mutated: false };
		const facet = (touch: boolean): Facet => ({
			name: "db",
			setup: (api) =>
				api.serve(Db, (_input, _principal, self) => {
					const db = self.resource("db", { version: 1, open: () => native });
					if (touch) db.value.mutated = true;
					return { read: () => db.value };
				}),
		});
		host.install(facet(false));
		const ref = host.hold(Db, {});
		await ref.ready;
		await assert.rejects(host.reload([facet(true)]), (error) => isChordError(error, "not_ready"));
		assert.equal(native.mutated, false);
		assert.deepEqual(await ref.read(), { mutated: false });
	});

	it("#7 objects of types a reload adds start listeners and tasks only at commit", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const log: string[] = [];
		const Fresh = local("t.fresh", { version: 1, input: Type.Object({}) });
		host.install({ name: "item", setup: (api) => api.serve(Item, () => ({ version: () => "v1" })) });
		await Promise.all(["a", "b"].map((id) => host.hold(Item, { id }).ready));
		const plugins = (fail: boolean): Facet[] => [
			{
				name: "fresh",
				setup: (api) =>
					api.serve(Fresh, (_input, _principal, self) => {
						self.task(async () => {
							log.push("task started");
						});
						return {};
					}),
			},
			{
				name: "item",
				setup: (api) =>
					api.serve(Item, ({ id }, _principal, self) => {
						self.get(Fresh, {});
						if (fail && id === "b") throw new Error("b fails");
						return { version: () => "v2" };
					}),
			},
		];
		await assert.rejects(host.reload(plugins(true)), /b fails/);
		await ticks();
		assert.deepEqual(log, []);
		await host.reload(plugins(false));
		await ticks();
		assert.deepEqual(log, ["task started"]);
	});

	it("#8 a breaking provider change and its updated consumer reload in one batch", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const P1 = remote("t.provider", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("host"),
			variants: { main: { methods: { get: method(undefined, Type.String()) } } },
		});
		const P2 = remote("t.provider", {
			version: 2,
			input: Type.Object({}),
			host: hostNamed("host"),
			variants: { main: { methods: { fetch: method(undefined, Type.String()) } } },
		});
		const Consumer = local("t.consumer", {
			version: 1,
			input: Type.Object({}),
			members: { ask: method(undefined, Type.String()) },
		});
		host.install({
			name: "both",
			setup: (api) => {
				api.serve(P1, () => ({ variant: "main", get: () => "old" }));
				api.serve(Consumer, (_input, _principal, self) => {
					const provider = self.get(P1, {});
					return { ask: (ctx: Ctx) => provider.get(ctx) };
				});
			},
		});
		const consumer = host.hold(Consumer, {});
		assert.equal(await consumer.ask(), "old");
		await host.reload([
			{
				name: "both",
				setup: (api) => {
					api.serve(P2, () => ({ variant: "main", fetch: () => "new" }));
					api.serve(Consumer, (_input, _principal, self) => {
						const provider = self.get(P2, {});
						return { ask: (ctx: Ctx) => provider.fetch(ctx) };
					});
				},
			},
		]);
		assert.equal(await consumer.ask(), "new");
	});

	it("#9 an exclusive resource whose close failed is restored on rollback, or marked unavailable", async () => {
		for (const reopen of ["works", "fails"] as const) {
			const host = createHost({ self: { kind: "host" }, onError: () => {} });
			const log: string[] = [];
			let opens = 0;
			const facet = (rev: number): Facet => ({
				name: "db",
				setup: (api) =>
					api.serve(Db, (_input, _principal, self) => {
						const port = self.resource("port", {
							version: rev,
							exclusive: true,
							open: () => {
								if (rev === 2) throw new Error("new port fails");
								if (++opens > 1 && reopen === "fails") throw new Error("reopen fails");
								log.push(`open ${rev}`);
								return { rev };
							},
							close: () => {
								log.push(`close ${rev}`);
								throw new Error("close fails");
							},
						});
						return { read: () => port.value };
					}),
			});
			host.install(facet(1));
			const ref = host.hold(Db, {});
			await ref.ready;
			// The failing close aborts the reload at the gate; the old resource must not stay closed.
			await assert.rejects(host.reload([facet(2)]), /close fails/);
			if (reopen === "works") {
				assert.deepEqual(log, ["open 1", "close 1", "open 1"]);
				assert.deepEqual(await ref.read(), { rev: 1 });
			} else {
				await assert.rejects(ref.read(), (error) => isChordError(error, "unavailable"));
			}
		}
	});

	it("#10 retirement closes dropped resources before releasing dropped holds", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const log: string[] = [];
		const Dep = local("t.dep", { version: 1, input: Type.Object({}) });
		const facet = (withDecls: boolean): Facet => ({
			name: "item",
			setup: (api) => {
				api.serve(Dep, (_input, _principal, self) => {
					self.resource("r", { version: 1, open: () => {}, close: () => void log.push("dep closed") });
					return {};
				});
				api.serve(Item, (_input, _principal, self) => {
					if (withDecls) {
						self.get(Dep, {});
						// Slow close: releasing the hold first would let the dependency close before it finishes.
						self.resource("own", {
							version: 1,
							open: () => {},
							close: async () => {
								await ticks(3);
								log.push("own closed");
							},
						});
					}
					return { version: () => (withDecls ? "v1" : "v2") };
				});
			},
		});
		host.install(facet(true));
		const ref = host.hold(Item, { id: "a" });
		await ref.ready;
		const go = latch();
		const pinned = host.root(async (ctx) => {
			await ref.version(ctx);
			await go.promise;
		});
		await tick();
		await host.reload([facet(false)]);
		assert.deepEqual(log, []);
		go.open();
		await pinned;
		await ticks(20);
		assert.deepEqual(log, ["own closed", "dep closed"]);
	});

	it("#11 fits has no false positives for unmodelled keywords; counterexamples checked with Value.Check", () => {
		const cases = [
			[Type.String(), Type.String({ not: { const: "x" } }), "x"],
			[Type.Array(Type.Number()), Type.Array(Type.Number(), { contains: Type.Literal(1) }), [2]],
			[
				Type.Object({ a: Type.String() }),
				Type.Object({ a: Type.String() }, { additionalProperties: Type.Number() }),
				{ a: "s", b: "t" },
			],
			[
				Type.Object({ x: Type.String() }),
				Type.Object({}, { patternProperties: { "^x$": Type.Number() } }),
				{ x: "s" },
			],
			[Type.Number(), Type.Intersect([Type.Number(), Type.Number({ minimum: 1 })]), 0],
			[
				Type.Object({ a: Type.String() }, { additionalProperties: Type.Number() }),
				Type.Object({ a: Type.String(), b: Type.Optional(Type.String()) }),
				{ a: "", b: 1 },
			],
		] as const;
		for (const [sub, sup, value] of cases) {
			assert.ok(Value.Check(sub, value) && !Value.Check(sup, value), `bad counterexample ${JSON.stringify(value)}`);
			assert.equal(fits(sub, sup), false, `fits(${JSON.stringify(sub)}, ${JSON.stringify(sup)})`);
		}
		// Additive changes still fit.
		assert.ok(
			fits(Type.Object({ a: Type.String() }), Type.Object({ a: Type.String(), b: Type.Optional(Type.Number()) })),
		);
		assert.ok(fits(Type.Object({ a: Type.String(), extra: Type.Number() }), Type.Object({ a: Type.String() })));
	});

	it("#11 arguments are stripped to what the consumer knows, then to what the provider knows", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const Strict = remote("t.strict", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("host"),
			variants: {
				main: {
					methods: {
						echo: method(Type.Object({ a: Type.String() }, { additionalProperties: false }), Type.Unknown()),
					},
				},
			},
		});
		host.serve(Strict, () => ({ variant: "main", echo: (args) => args }));
		const ref = host.hold(Strict, {});
		assert.deepEqual(await ref.echo({ a: "x", junk: 1 } as never), { a: "x" });
	});
});

describe("review: ctx races", () => {
	const Target = local("t.target", {
		version: 1,
		input: Type.Object({}),
		members: { hit: method() },
	});

	it("an aborted task ctx cannot start fresh calls", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const Runner = local("t.runner", { version: 1, input: Type.Object({}) });
		let hits = 0;
		const go = latch();
		let outcome: unknown;
		host.serve(Target, () => ({
			hit: () => {
				hits++;
			},
		}));
		host.serve(Runner, (_input, _principal, self) => {
			const target = self.get(Target, {});
			self.task(async (ctx) => {
				await go.promise;
				outcome = await target.hit(ctx).catch((error: unknown) => error);
			});
			return {};
		});
		const runner = host.hold(Runner, {});
		await runner.ready;
		const target = host.hold(Target, {});
		await target.ready;
		runner.release();
		await ticks();
		go.open();
		await ticks(20);
		assert.equal(hits, 0);
		assert.ok(isChordError(outcome, "aborted"));
	});

	it("an expired ctx and a foreign ctx are refused", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const other = createHost({ self: { kind: "host" }, onError: () => {} });
		host.serve(Target, () => ({ hit: () => {} }));
		const target = host.hold(Target, {});
		await target.ready;
		const expired = await host.root((ctx) => ctx);
		await assert.rejects(
			target.hit(expired),
			(error) => isChordError(error, "aborted") && error.reason === "expired",
		);
		const foreign = await other.root(async (ctx) => {
			await assert.rejects(
				target.hit(ctx),
				(error) => isChordError(error, "invalid") && error.reason === "foreign_ctx",
			);
			return true;
		});
		assert.ok(foreign);
	});

	// #10959
	it("a remote reference refuses a foreign ctx and a ctx not made by Chord, without calling", async () => {
		const RemoteTarget = remote("t.remote-target", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { state: {}, methods: { hit: method() } } },
		});
		let hits = 0;
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		server.serve(RemoteTarget, () => ({
			variant: "main",
			hit: () => {
				hits++;
			},
		}));
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: { worker: true } });
		const link = new CountingLink(up);
		const worker = createHost({ self: { kind: "host" }, name: "worker", onError: () => {} });
		worker.connect(link, { principal: { kind: "server" } });
		const other = createHost({ self: { kind: "host" }, name: "other", onError: () => {} });
		const target = worker.hold(RemoteTarget, {});
		await target.ready;
		const foreign = await other.root((ctx) => target.hit(ctx).catch((error: unknown) => error));
		assert.ok(isChordError(foreign, "invalid") && foreign.reason === "foreign_ctx", String(foreign));
		const forged = { rootId: "forged", codeVersion: 1, signal: new AbortController().signal } as unknown as Ctx;
		await assert.rejects(
			target.hit(forged),
			(error) => isChordError(error, "invalid") && error.reason === "foreign_ctx",
		);
		await ticks();
		assert.equal(hits, 0);
		assert.equal(link.count("sent", "call"), 0);
		await worker.root((ctx) => target.hit(ctx));
		assert.equal(hits, 1);
	});
});

describe("review: contract and activation boundaries", () => {
	it("unknown wire contracts never normalize peer schemas, and bounded metadata is checked before binding", async () => {
		const host = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, raw] = memoryLinkPair();
		host.accept(down, { principal: { guest: true } });
		const gone = Promise.withResolvers<Extract<Frame, { t: "gone" }>>();
		raw.receive((frame) => {
			if (frame.t === "gone") gone.resolve(frame);
		});
		raw.send({
			t: "hold",
			id: 1,
			at: "server",
			input: `${"a".repeat(24)}!`,
			token: {
				name: "unknown",
				scope: "remote",
				version: 1,
				host: { name: "server" },
				input: { type: "string", pattern: "^(a+)+$" },
				variants: { main: {} },
			},
		});
		assert.equal((await gone.promise).error.reason, "unknown_type");
		const token = remote("bounded", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: {} },
		});
		let nested: object = {};
		for (let i = 0; i < 70; i++) nested = { items: nested };
		assert.throws(() => contractFromDescription({ ...token.description, input: nested }), /metadata limits/);
		await host.close();
	});

	it("received inputs use provider defaults and reject peer-only regexes before compatibility", async () => {
		const host = createHost({ self: {}, name: "server", onError: () => {} });
		const provider = remote("trusted-input", {
			version: 1,
			input: Type.Object({ id: Type.Optional(Type.String({ default: "provider" })) }),
			host: hostNamed("server"),
			variants: { main: { methods: { id: method(undefined, Type.String()) } } },
		});
		host.serve(provider, (input) => ({ variant: "main", id: () => input.id ?? "missing" }));
		const peer = contractFromDescription({
			...provider.description,
			input: Type.Object({ id: Type.Optional(Type.String({ default: "peer" })) }),
		});
		const ref = (await host.get(peer, {})) as unknown as { id(): Promise<string>; release(): void };
		assert.equal(await ref.id(), "provider");
		ref.release();
		const hostile = contractFromDescription({
			...provider.description,
			input: { type: "string", pattern: "^(a+)+$" },
		});
		assert.throws(() => host.hold(hostile, `${"a".repeat(24)}!`), /peer regular expressions/);
		await host.close();
	});

	it("ordinary pattern names and schema annotations do not become regex policies", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const client = createHost({ self: {}, kind: "client", upstream: { link: up, principal: {} }, onError: () => {} });
		const consumerArgs = Type.Object(
			{ pattern: Type.String(), patternProperties: Type.Optional(Type.String()) },
			{
				examples: [{ pattern: "consumer annotation" }],
			},
		);
		const providerArgs = Type.Object(
			{
				pattern: Type.String(),
				patternProperties: Type.Optional(Type.String()),
				added: Type.Optional(Type.Number()),
			},
			{
				examples: [{ pattern: "provider annotation" }],
			},
		);
		const consumer = remote("ordinary-pattern", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				main: { methods: { pattern: method(consumerArgs, Type.String()) } },
			},
		});
		const provider = remote("ordinary-pattern", {
			...consumer.def,
			variants: {
				main: { methods: { pattern: method(providerArgs, Type.String()) } },
			},
		});
		server.serve(provider, () => ({ variant: "main", pattern: (args) => args.pattern }));
		const ref = await client.get(consumer, {});
		assert.equal(await ref.pattern({ pattern: "accepted" }), "accepted");
		const hostile = contractFromDescription({
			...provider.description,
			input: Type.Object({ pattern: Type.String({ pattern: "^(a+)+$" }) }),
		});
		assert.throws(() => server.hold(hostile, { pattern: `${"a".repeat(24)}!` }), /peer regular expressions/);
		await client.close();
		await server.close();
	});

	it("remote arguments are cleaned with the consumer schema before JSON serialization", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const link = new CountingLink(up);
		const client = createHost({ self: {}, kind: "client", upstream: { link, principal: {} }, onError: () => {} });
		const consumer = remote("pre-serialization", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { methods: { echo: method(Type.Object({ text: Type.String() }), Type.Unknown()) } } },
		});
		const provider = remote("pre-serialization", {
			...consumer.def,
			variants: {
				main: {
					methods: {
						echo: method(
							Type.Object({ text: Type.String(), private: Type.Optional(Type.String()) }),
							Type.Unknown(),
						),
					},
				},
			},
		});
		try {
			server.serve(provider, () => ({ variant: "main", echo: (args) => args }));
			const ref = await client.get(consumer, {});
			assert.deepEqual(await ref.echo({ text: "clean", private: "must not leak", junk: 1n } as never), {
				text: "clean",
			});
			const call = link.sent.find((frame) => frame.t === "call");
			assert.ok(call?.t === "call");
			assert.deepEqual(call.args, { text: "clean" });
			const shape = link.received.find((frame) => frame.t === "shape");
			assert.ok(shape?.t === "shape");
			assert.equal(isFrame(JSON.parse(JSON.stringify(shape))), true);
			assert.equal(isFrame({ ...shape, callVariants: undefined }), false);
			assert.equal(isFrame({ ...shape, callVariants: [{ codeVersion: 0, variant: "main" }] }), false);
			assert.equal(isFrame({ ...shape, callVariants: Array(3).fill({ codeVersion: 1, variant: "main" }) }), false);
		} finally {
			await client.close();
			await server.close();
		}
	});

	for (const outcome of ["commit", "abort"] as const) {
		it(`a pending-only remote type keeps its link open through prepare and ${outcome}`, async () => {
			const server = createHost({ self: {}, name: "server", onError: () => {} });
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal: {} });
			const client = createHost({
				self: {},
				kind: "client",
				upstream: { link: up, principal: {} },
				onError: () => {},
			});
			const blocker = local("pending-projection-blocker", { version: 1, input: Type.Object({}) });
			const pending = remote("pending-projection", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("server"),
				variants: { main: { methods: { read: method(undefined, Type.String()) } } },
			});
			const entered = latch(),
				resume = latch();
			let calls = 0;
			const facet = (prepare: boolean): Facet => ({
				name: "pending",
				setup(api) {
					api.serve(blocker, (_input, _principal, self) => {
						if (prepare)
							self.resource("wait", {
								version: 1,
								open: async () => {
									entered.open();
									await resume.promise;
									if (outcome === "abort") throw new Error("stop pending prepare");
								},
							});
						return {};
					});
					if (prepare)
						api.serve(pending, () => ({
							variant: "main",
							read: () => {
								calls++;
								return "committed";
							},
						}));
				},
			});
			let reloading: Promise<unknown> | undefined;
			try {
				await server.install(facet(false));
				await server.get(blocker, {});
				reloading = server.reload([facet(true)]);
				reloading.catch(() => {});
				await entered.promise;
				let settled = false;
				const acquiring = client.get(pending, {});
				acquiring.then(
					() => {
						settled = true;
					},
					() => {
						settled = true;
					},
				);
				await ticks();
				assert.equal(up.closed, false);
				assert.equal(server.codeVersion, 1);
				assert.equal(settled, false, "pending-only references wait for a committed projection");
				assert.equal(calls, 0);
				resume.open();
				if (outcome === "commit") {
					await reloading;
					const ref = await acquiring;
					assert.equal(await ref.read(), "committed");
				} else {
					await assert.rejects(reloading, /stop pending prepare/);
					await assert.rejects(acquiring, (error) => isChordError(error, "gone"));
					assert.equal(calls, 0);
				}
				assert.equal(up.closed, false);
			} finally {
				resume.open();
				await reloading?.catch(() => {});
				await client.close();
				await server.close();
			}
		});
	}

	it("a fresh modern remote consumer hydrates while incompatible old code is retained", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: {} });
		const worker = createHost({ self: {}, name: "worker", upstream: { link: up, principal: {} }, onError: () => {} });
		const oldToken = remote("modern-consumer", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { methods: { read: method(undefined, Type.String()) } } },
		});
		const newToken = remote("modern-consumer", {
			version: 2,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { methods: { fetch: method(undefined, Type.String()) } } },
		});
		const entered = latch(),
			resume = latch();
		try {
			await server.install({
				name: "modern",
				setup(api) {
					api.serve(oldToken, () => ({ variant: "main", read: () => "old" }));
				},
			});
			const old = await worker.get(oldToken, {});
			const pinned = worker.root(async (ctx) => {
				assert.equal(await old.read(ctx), "old");
				entered.open();
				await resume.promise;
				assert.equal(await old.read(ctx), "old");
			});
			await entered.promise;
			await server.reload([
				{
					name: "modern",
					setup(api) {
						api.serve(newToken, () => ({ variant: "main", fetch: () => "new" }), {
							accepts: { 1: (current) => ({ variant: "main", read: current.fetch }) },
						});
					},
				},
			]);
			assert.equal(server.previousCodeVersion, 1);
			const modern = await worker.get(newToken, {});
			assert.equal(await modern.fetch(), "new");
			assert.equal(await old.read(), "new");
			resume.open();
			await pinned;
		} finally {
			resume.open();
			await worker.close();
			await server.close();
		}
	});

	it("fenced roots keep their first admitted projection through reconciliation and reload", async () => {
		const loading = latch(),
			entered = latch(),
			resume = latch();
		const token = remote("fenced-projection", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				old: { methods: { send: method(Type.Object({ text: Type.String() }), Type.String()) } },
				new: {
					methods: {
						send: method(
							Type.Object({ text: Type.String(), added: Type.Optional(Type.Number()) }),
							Type.String(),
						),
					},
				},
			},
		});
		const facet = (variant: "old" | "new"): Facet => ({
			name: "fenced",
			setup(api) {
				api.serve(token, () =>
					variant === "old"
						? { variant, send: (args) => `old:${args.text}` }
						: { variant, send: (args) => `new:${args.text}` },
				);
			},
		});
		const server = createHost({
			self: {},
			name: "server",
			onError: () => {},
			loader: async () => {
				await loading.promise;
				return [facet("new")];
			},
		});
		await server.install(facet("old"));
		await server.reload([facet("old")]);
		const reloading = server.reload(["fenced"]);
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: {} });
		const link = new CountingLink(up);
		const worker = createHost({ self: {}, name: "worker", upstream: { link, principal: {} }, onError: () => {} });
		try {
			const ref = await worker.get(token, {});
			const send = ref.send as (args: unknown, ctx?: Ctx) => Promise<string>;
			const pinned = worker.root(async (ctx) => {
				assert.equal(await send({ text: "before", junk: 1n }, ctx), "old:before");
				entered.open();
				await resume.promise;
				assert.equal(await send({ text: "after", junk: 2n }, ctx), "old:after");
			});
			await entered.promise;
			loading.open();
			await reloading;
			await ticks();
			resume.open();
			await pinned;
			assert.equal(await send({ text: "fresh", junk: 3n }), "new:fresh");
		} finally {
			loading.open();
			resume.open();
			await reloading;
			await worker.close();
			await server.close();
		}
	});

	for (const initial of ["first", "second"] as const) {
		for (const acquire of ["before", "after"] as const) {
			it(`projects a ${initial} old root with consumer-only fields stripped, acquired ${acquire} reload`, async () => {
				const server = createHost({ self: {}, name: "server", onError: () => {} });
				const [down, up] = memoryLinkPair();
				server.accept(down, { kind: "host", name: "worker", principal: {} });
				const link = new CountingLink(up);
				const worker = createHost({
					self: {},
					name: "worker",
					upstream: { link, principal: {} },
					onError: () => {},
				});
				const consumer = remote("pinned-projection", {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("server"),
					variants: {
						first: { methods: { send: method(undefined, Type.Unknown()) } },
						second: { methods: { send: method(Type.Object({ text: Type.String() }), Type.Unknown()) } },
					},
				});
				const provider = remote("pinned-projection", {
					...consumer.def,
					variants: {
						first: { methods: { send: method(undefined, Type.Unknown()) } },
						second: {
							methods: {
								send: method(
									Type.Object({ text: Type.String(), private: Type.Optional(Type.String()) }),
									Type.Unknown(),
								),
							},
						},
					},
				});
				const facet = (variant: "first" | "second"): Facet => ({
					name: "projection",
					setup(api) {
						api.serve(provider, () =>
							variant === "first" ? { variant, send: () => "empty" } : { variant, send: (args) => args },
						);
					},
				});
				const entered = latch(),
					resume = latch();
				try {
					await server.install(facet(initial));
					// Keep the provider object alive even when this worker has no pre-reload binding.
					await server.get(provider, {}, { principal: {} });
					let ref = acquire === "before" ? await worker.get(consumer, {}) : undefined;
					const pinned = server.root(() =>
						worker.root(async (ctx) => {
							entered.open();
							await resume.promise;
							ref ??= await worker.get(consumer, {});
							const send = ref.send as (value: unknown, ctx?: Ctx) => Promise<unknown>;
							const result =
								initial === "first"
									? await send(ctx)
									: await send({ text: "old", private: "hidden", junk: 1n }, ctx);
							assert.deepEqual(result, initial === "first" ? "empty" : { text: "old" });
						}),
					);
					await entered.promise;
					const next = initial === "first" ? "second" : "first";
					await server.reload([facet(next)]);
					await ticks();
					resume.open();
					await pinned;
					assert.ok(ref !== undefined);
					const send = ref.send as (value?: unknown) => Promise<unknown>;
					assert.deepEqual(
						next === "first" ? await send() : await send({ text: "new", private: "hidden", junk: 2n }),
						next === "first" ? "empty" : { text: "new" },
					);
					for (const frame of link.sent)
						if (frame.t === "call" && frame.args !== undefined)
							assert.deepEqual(Object.keys(frame.args as object), ["text"]);
				} finally {
					resume.open();
					await worker.close();
					await server.close();
				}
			});
		}
	}

	it("pins distinct argument schemas of the same method across reload", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: {} });
		const worker = createHost({ self: {}, name: "worker", upstream: { link: up, principal: {} }, onError: () => {} });
		const token = remote("distinct-args", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				old: { methods: { send: method(Type.Object({ old: Type.String() }), Type.Unknown()) } },
				new: { methods: { send: method(Type.Object({ fresh: Type.String() }), Type.Unknown()) } },
			},
		});
		const facet = (variant: "old" | "new"): Facet => ({
			name: "distinct",
			setup(api) {
				api.serve(token, () =>
					variant === "old" ? { variant, send: (args) => args } : { variant, send: (args) => args },
				);
			},
		});
		const entered = latch(),
			resume = latch();
		try {
			await server.install(facet("old"));
			const ref = await worker.get(token, {});
			const send = ref.send as (args: unknown, ctx?: Ctx) => Promise<unknown>;
			const pinned = server.root(() =>
				worker.root(async (ctx) => {
					entered.open();
					await resume.promise;
					assert.deepEqual(await send({ old: "kept", fresh: 1n }, ctx), { old: "kept" });
				}),
			);
			await entered.promise;
			await server.reload([facet("new")]);
			await ticks();
			resume.open();
			await pinned;
			assert.deepEqual(await send({ fresh: "kept", old: 1n }), { fresh: "kept" });
		} finally {
			resume.open();
			await worker.close();
			await server.close();
		}
	});

	for (const initial of ["first", "second"] as const) {
		it(`mixed arity keeps a pinned ${initial} implementation across reload`, async () => {
			const host = createHost({ self: {}, name: "server", onError: () => {} });
			const token = remote("pinned-arity", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("server"),
				variants: {
					first: { methods: { send: method(undefined, Type.String()) } },
					second: { methods: { send: method(Type.String(), Type.String()) } },
				},
			});
			const facet = (variant: "first" | "second"): Facet => ({
				name: "pinned",
				setup(api) {
					api.serve(token, () =>
						variant === "first"
							? { variant, send: (ctx: Ctx) => `${ctx.rootId}:empty` }
							: { variant, send: (text: string, ctx: Ctx) => `${ctx.rootId}:${text}` },
					);
				},
			});
			await host.install(facet(initial));
			const ref = await host.get(token, {});
			const send = ref.send as (value: string | Ctx, ctx?: Ctx) => Promise<string>;
			const entered = Promise.withResolvers<void>(),
				resume = Promise.withResolvers<void>();
			const pinned = host.root(async (ctx) => {
				const first = initial === "first" ? await send(ctx) : await send("text", ctx);
				entered.resolve();
				await resume.promise;
				const second = initial === "first" ? await send(ctx) : await send("text", ctx);
				assert.equal(second, first);
				assert.equal(second, `${ctx.rootId}:${initial === "first" ? "empty" : "text"}`);
			});
			await entered.promise;
			await host.reload([facet(initial === "first" ? "second" : "first")]);
			resume.resolve();
			await pinned;
			await host.close();
		});
	}

	for (const initial of ["first", "second"] as const) {
		for (const origin of ["worker", "provider"] as const) {
			it(`remote mixed arity preserves the pinned ${initial} ${origin} root across coordinated reload`, async () => {
				const server = createHost({ self: {}, name: "server", onError: () => {} });
				const [down, up] = memoryLinkPair();
				server.accept(down, { kind: "host", name: "worker", principal: {} });
				const worker = createHost({
					self: {},
					name: "worker",
					upstream: { link: up, principal: {} },
					onError: () => {},
				});
				const token = remote("remote-pinned-arity", {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("server"),
					variants: {
						first: { methods: { send: method(undefined, Type.String()) } },
						second: { methods: { send: method(Type.String(), Type.String()) } },
					},
				});
				const Callback = remote("pinned-worker-callback", {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("worker"),
					variants: { main: { methods: { run: method(undefined, Type.String()) } } },
				});
				const facet = (variant: "first" | "second"): Facet => ({
					name: "remote-pinned",
					setup(api) {
						api.serve(token, () =>
							variant === "first"
								? { variant, send: (ctx: Ctx) => `${ctx.rootId}:empty` }
								: { variant, send: (text: string, ctx: Ctx) => `${ctx.rootId}:${text}` },
						);
					},
				});
				const resume = latch();
				try {
					await server.install(facet(initial));
					const ref = await worker.get(token, {});
					const send = ref.send as (value: string | Ctx, ctx?: Ctx) => Promise<string>;
					const entered = latch();
					const run = async (ctx: Ctx): Promise<string> => {
						const expected = `${ctx.rootId}:${initial === "first" ? "empty" : "text"}`;
						assert.equal(initial === "first" ? await send(ctx) : await send("text", ctx), expected);
						entered.open();
						await resume.promise;
						const result = initial === "first" ? await send(ctx) : await send("text", ctx);
						assert.equal(result, expected);
						return result;
					};
					worker.serve(Callback, () => ({ variant: "main", run }));
					const callback = await server.get(Callback, {});
					const pinned = origin === "worker" ? worker.root(run) : server.root((ctx) => callback.run(ctx));
					await entered.promise;
					const next = initial === "first" ? "second" : "first";
					await server.reload([facet(next)]);
					await ticks();
					assert.equal(ref.variant, next);
					assert.equal(
						server.previousCodeVersion,
						1,
						"the remote root retains its provider implementation between calls",
					);
					resume.open();
					await pinned;
					await ticks();
					assert.equal(
						server.previousCodeVersion,
						undefined,
						"root_end releases the provider's idle foreign lease",
					);
					assert.equal(
						worker.previousCodeVersion,
						undefined,
						"provider retirement permits child retirement without a cycle",
					);
					await worker.root(async (ctx) => {
						assert.equal(
							next === "first" ? await send(ctx) : await send("fresh", ctx),
							`${ctx.rootId}:${next === "first" ? "empty" : "fresh"}`,
						);
					});
				} finally {
					resume.open();
					await worker.close();
					await server.close();
				}
			});
		}
	}

	for (const methodFirst of [false, true]) {
		it(`cross-kind members follow live variants and reload with ${methodFirst ? "method" : "state"} declared first`, async () => {
			const server = createHost({ self: {}, name: "server", onError: () => {} });
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal: {} });
			const client = createHost({
				self: {},
				kind: "client",
				upstream: { link: up, principal: {} },
				onError: () => {},
			});
			const state = { state: { value: Type.Number() } };
			const callable = { methods: { value: method(undefined, Type.String()) } };
			const token = remote("cross-kind", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("server"),
				variants: methodFirst ? { callable, state } : { state, callable },
			});
			const facet = (variant: "state" | "callable"): Facet => ({
				name: "cross-kind",
				setup(api) {
					api.serve(token, (_input, _principal, self) =>
						variant === "state"
							? { variant, value: self.state("value", Type.Number(), 42) }
							: { variant, value: () => "method answer" },
					);
				},
			});
			try {
				// Start with the second declaration to catch both old declaration-order failures.
				const initial = methodFirst ? "state" : "callable";
				await server.install(facet(initial));
				const localRef = await server.get(token, {});
				const remoteRef = await client.get(token, {});
				for (const variant of [initial, initial === "state" ? "callable" : "state", initial] as const) {
					if (localRef.variant !== variant) {
						await server.reload([facet(variant)]);
						await ticks();
					}
					for (const ref of [localRef, remoteRef]) {
						assert.equal(ref.variant, variant);
						if (ref.variant === "state") assert.equal(ref.value.value, 42);
						else if (ref.variant === "callable") assert.equal(await ref.value(), "method answer");
					}
				}
			} finally {
				await client.close();
				await server.close();
			}
		});
	}

	it("loading references reject expired and foreign contexts before readiness, and released reconnecting views reject", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const foreign = createHost({ self: {}, onError: () => {} });
		const pending = Promise.withResolvers<void>();
		const token = remote("loading-ctx", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { methods: { ping: method() } } },
		});
		server.serve(token, (_input, _principal, self) => {
			self.resource("wait", { version: 1, open: () => pending.promise });
			return { variant: "main", ping: () => {} };
		});
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const client = createHost({ self: {}, kind: "client", upstream: { link: up, principal: {} }, onError: () => {} });
		for (const host of [server, client]) {
			const ref = host.hold(token, {});
			const expired = await host.root((ctx) => ctx);
			await assert.rejects(
				ref.ping(expired),
				(error) => isChordError(error, "aborted") && error.reason === "expired",
			);
			await foreign.root(async (ctx) => {
				await assert.rejects(
					ref.ping(ctx),
					(error) => isChordError(error, "invalid") && error.reason === "foreign_ctx",
				);
			});
			ref.release();
		}
		pending.resolve();
		const released = await client.get(token, {});
		const retained = await client.get(token, {});
		up.close();
		await ticks();
		released.release();
		await assert.rejects(released.ping(), (error) => isChordError(error, "released"));
		retained.release();
		await client.close();
		await foreign.close();
		await server.close();
	});

	it("additive record results bind equally locally and over a link", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const client = createHost({ self: {}, kind: "client", upstream: { link: up, principal: {} }, onError: () => {} });
		const consumer = remote("record-result", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				main: {
					methods: { read: method(undefined, Type.Record(Type.String(), Type.Object({ id: Type.String() }))) },
				},
			},
		});
		const provider = remote("record-result", {
			...consumer.def,
			variants: {
				main: {
					methods: {
						read: method(
							undefined,
							Type.Record(Type.String(), Type.Object({ id: Type.String(), extra: Type.Number() })),
						),
					},
				},
			},
		});
		server.serve(provider, () => ({ variant: "main", read: () => ({ key: { id: "a", extra: 1 } }) }));
		assert.deepEqual(await server.hold(consumer, {}).read(), { key: { id: "a", extra: 1 } });
		assert.deepEqual(await client.hold(consumer, {}).read(), { key: { id: "a", extra: 1 } });
		await client.close();
		await server.close();
	});

	it("received schema DAGs and spoofed executable kinds require a trusted root, while registered unions work", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const token = remote("schema-dag", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { methods: { call: method(Type.Unknown()) } } },
		});
		let invoked = 0;
		server.serve(token, () => ({
			variant: "main",
			call: () => {
				invoked++;
			},
		}));
		const defs: Record<string, object> = { n0: {} };
		for (let i = 1; i <= 14; i++)
			defs[`n${i}`] = { allOf: [{ $ref: `#/$defs/n${i - 1}` }, { $ref: `#/$defs/n${i - 1}` }] };
		for (const args of [
			{ "~kind": "Union", anyOf: [{ $defs: defs, $ref: "#/$defs/n14" }] },
			{ "~kind": "Cyclic", $defs: defs },
		]) {
			const peer = contractFromDescription({
				...token.description,
				variants: { main: { call: { kind: "method", args } } },
			});
			assert.throws(() => server.hold(peer, {}), /peer executable schemas/);
		}
		assert.equal(invoked, 0);
		const trusted = remote("trusted-union", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				main: {
					methods: {
						echo: method(Type.Union([Type.String(), Type.Number()]), Type.Union([Type.String(), Type.Number()])),
					},
				},
			},
		});
		server.serve(trusted, () => ({ variant: "main", echo: (value) => value }));
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const client = createHost({ self: {}, kind: "client", upstream: { link: up, principal: {} }, onError: () => {} });
		assert.equal(await client.hold(trusted, {}).echo("registered"), "registered");
		assert.equal(await client.hold(trusted, {}).echo(7), 7);
		await client.close();
		await server.close();
	});

	it("resource dependencies time out and close unwinds activation without opening the resource", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const [up, peer] = memoryLinkPair();
		const host = createHost({
			self: {},
			name: "worker",
			readyTimeout: 20,
			upstream: { link: up, principal: {} },
			onError: () => {},
		});
		const missing = remote("missing", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: {} },
		});
		const own = local("waiting", { version: 1, input: Type.Object({}) });
		let opened = false;
		host.serve(own, (_input, _principal, self) => {
			const dep = self.get(missing, {});
			self.resource("r", {
				version: 1,
				deps: [dep],
				open: () => {
					opened = true;
				},
			});
			return {};
		});
		const ref = host.hold(own, {});
		const rejection = assert.rejects(
			ref.ready,
			(error) => isChordError(error, "unavailable") && error.reason === "ready_timeout",
		);
		await ticks();
		await vi.advanceTimersByTimeAsync(20);
		await rejection;
		await host.close();
		assert.equal(opened, false);
		assert.equal(up.closed, true);
		peer.close();
	});

	it("mixed arities follow the active variant locally, remotely, while loading, and after reload", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const client = createHost({
			self: {},
			name: "client",
			kind: "client",
			upstream: { link: up, principal: {} },
			onError: () => {},
		});
		const token = remote("mixed", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				first: { methods: { send: method(undefined, Type.String()) } },
				second: { methods: { send: method(Type.String(), Type.String()) } },
			},
		});
		const facet = (variant: "first" | "second"): Facet => ({
			name: "mixed",
			setup(api) {
				api.serve(token, () =>
					variant === "first" ? { variant, send: () => "empty" } : { variant, send: (text: string) => text },
				);
			},
		});
		await server.install(facet("second"));
		const localRef = server.hold(token, {}),
			remoteRef = client.hold(token, {});
		const localSend = localRef.send as (value?: string | Ctx) => Promise<string>;
		const remoteSend = remoteRef.send as (value?: string | Ctx) => Promise<string>;
		assert.deepEqual(await Promise.all([localSend("local"), remoteSend("remote")]), ["local", "remote"]);
		await server.reload([facet("first")]);
		await ticks();
		assert.equal(await server.root((ctx) => localSend(ctx)), "empty");
		assert.equal(await client.root((ctx) => remoteSend(ctx)), "empty");
		await server.reload([facet("second")]);
		await ticks();
		assert.equal(await localSend("again"), "again");
		assert.equal(await remoteSend("again"), "again");
		await client.close();
		await server.close();
	});

	it("void consumers discard additive provider results locally and across a link", async () => {
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const client = createHost({ self: {}, kind: "client", upstream: { link: up, principal: {} }, onError: () => {} });
		const consumer = remote("void", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { methods: { m: method() } } },
		});
		const provider = remote("void", {
			...consumer.def,
			variants: { main: { methods: { m: method(undefined, Type.Number()) } } },
		});
		server.serve(provider, () => ({ variant: "main", m: () => 7 }));
		assert.equal(await server.hold(consumer, {}).m(), undefined);
		assert.equal(await client.hold(consumer, {}).m(), undefined);
		await client.close();
		await server.close();
	});

	it("record values cannot violate named consumer fields during binding", () => {
		const sub = Type.Record(Type.String(), Type.Number());
		const sup = Type.Object({ b: Type.Optional(Type.String()) });
		assert.equal(Value.Check(sub, { b: 1 }), true);
		assert.equal(Value.Check(sup, { b: 1 }), false);
		assert.equal(fits(sub, sup), false);
		assert.equal(fits(Type.Record(Type.Literal("other"), Type.Number()), sup), true);
	});

	it("reload derivations read commit-time cells after another candidate waits", async () => {
		const host = createHost({ self: {}, onError: () => {} });
		const aType = local("derive-a", {
			version: 1,
			input: Type.Object({}),
			members: { n: Type.Number(), doubled: Type.Number(), set: method(Type.Number()) },
		});
		const bType = local("derive-b", { version: 1, input: Type.Object({}) });
		const opening = Promise.withResolvers<void>(),
			proceed = Promise.withResolvers<void>();
		const facet = (wait: boolean): Facet => ({
			name: "derive",
			setup(api) {
				api.serve(aType, (_input, _principal, self) => {
					const n = self.state("n", Type.Number(), 1);
					return {
						n,
						doubled: self.derive([n], (value) => value * 2),
						set(value, ctx) {
							n.replace(ctx, value);
						},
					};
				});
				api.serve(bType, (_input, _principal, self) => {
					if (wait)
						self.resource("wait", {
							version: 1,
							open: () => {
								opening.resolve();
								return proceed.promise;
							},
						});
					return {};
				});
			},
		});
		await host.install(facet(false));
		const a = await host.get(aType, {});
		await host.get(bType, {});
		const reload = host.reload([facet(true)]);
		await opening.promise;
		await a.set(2);
		proceed.resolve();
		await reload;
		assert.deepEqual([a.n.value, a.doubled.value], [2, 4]);
		await host.close();
	});

	it("a derivation invalidated while prepare waits aborts before publication", async () => {
		const host = createHost({ self: {}, name: "server", onError: () => {} });
		const token = remote("derive-failure", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				main: { state: { doubled: Type.Number() }, methods: { set: method(Type.Number()) } },
			},
		});
		const blocker = local("derive-blocker", { version: 1, input: Type.Object({}) });
		const opened = Promise.withResolvers<void>(),
			resume = Promise.withResolvers<void>();
		const facet = (candidate: boolean): Facet => ({
			name: "derive-failure",
			setup(api) {
				api.serve(token, (_input, _principal, self) => {
					const n = self.state("n", Type.Number(), 1);
					return {
						variant: "main",
						doubled: self.derive([n], (value) => {
							if (candidate && value === 2) throw new Error("commit-time derivation failure");
							return value * 2;
						}),
						set(value, ctx) {
							n.replace(ctx, value);
						},
					};
				});
				api.serve(blocker, (_input, _principal, self) => {
					if (candidate)
						self.resource("wait", {
							version: 1,
							open: () => {
								opened.resolve();
								return resume.promise;
							},
						});
					return {};
				});
			},
		});
		await host.install(facet(false));
		const ref = await host.get(token, {});
		await host.get(blocker, {});
		const version = host.codeVersion;
		const reload = host.reload([facet(true)]);
		await opened.promise;
		await ref.set(2);
		resume.resolve();
		await assert.rejects(reload, /commit-time derivation failure/);
		assert.equal(host.codeVersion, version);
		assert.equal(ref.doubled.value, 4);
		await ref.set(3);
		assert.equal(ref.doubled.value, 6);
		await host.close();
	});
});
