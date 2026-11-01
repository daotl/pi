import assert from "node:assert/strict";
import { Type } from "typebox";
import { onTestFinished, test } from "vitest";
import { HostImpl } from "../src/host.ts";
import {
	createHost,
	defineRegistry,
	type Facet,
	isChordError,
	local,
	memoryLinkPair,
	method,
	opaque,
	type Self,
} from "../src/index.ts";

const input = Type.Object({});
const flags = Type.Record(Type.String(), Type.Boolean());
const SwitchV1 = local("t.eager-switch", {
	version: 1,
	input,
	members: {
		enabled: Type.Boolean(),
		set: method(Type.Boolean()),
	},
});
const SwitchV2 = local("t.eager-switch", {
	version: 2,
	input,
	members: {
		enabled: flags,
		set: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
	},
});
const SwitchV3 = local("t.eager-switch", {
	version: 3,
	input,
	members: {
		enabled: flags,
		update: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() })),
	},
});
const Read = defineRegistry<() => unknown>("t.eager-switch-read");

function switchFacets(log: string[]) {
	const declareResource = (self: Self) =>
		self.resource("watch", {
			version: 1,
			open: () => {
				log.push("open");
				return null;
			},
			close: () => {
				log.push("close");
			},
		});
	const v1: Facet = {
		name: "switch",
		setup: (api) =>
			api.serve(
				SwitchV1,
				(_input, _principal, self) => {
					declareResource(self);
					const enabledState = self.state("enabled", Type.Boolean(), false);
					self.register(Read, { current: () => enabledState.value });
					return {
						enabled: enabledState,
						set: (enabled, ctx) => {
							enabledState.replace(ctx, enabled);
						},
					};
				},
				{ lifetime: "host" },
			),
	};
	const v2 = (valid: boolean): Facet => ({
		name: "switch",
		setup: (api) =>
			api.serve(
				SwitchV2,
				(_input, _principal, self) => {
					declareResource(self);
					const enabledState = self.state(
						"enabled",
						flags,
						{},
						{
							version: 2,
							migrate: (old, from) => {
								assert.equal(from, 1);
								return valid ? { 1: old as boolean } : ("invalid migration" as never);
							},
						},
					);
					self.register(Read, { current: () => enabledState.value });
					return {
						enabled: enabledState,
						set: ({ conversation, enabled }, ctx) => {
							enabledState.change(ctx, (draft) => {
								draft[conversation] = enabled;
							});
						},
					};
				},
				{ lifetime: "host" },
			),
	});
	const v3: Facet = {
		name: "switch",
		setup: (api) =>
			api.serve(
				SwitchV3,
				(_input, _principal, self) => {
					declareResource(self);
					const enabledState = self.state("enabled", flags, {}, { version: 2 });
					self.register(Read, { current: () => enabledState.value });
					return {
						enabled: enabledState,
						update: ({ conversation, enabled }, ctx) => {
							enabledState.change(ctx, (draft) => {
								draft[conversation] = enabled;
							});
						},
					};
				},
				{ lifetime: "host" },
			),
	};
	return { v1, v2, v3 };
}

test("the host's reference to a host object follows contract bumps at commit without reopening its object or resources; failures retain the old reference", async () => {
	const errors: unknown[] = [];
	const host = new HostImpl({ self: { kind: "host" }, dev: true, onError: (error) => errors.push(error) });
	onTestFinished(() => host.close());
	const log: string[] = [];
	const facets = switchFacets(log);
	await host.load([facets.v1]);
	const initial = host.hostObjects.get(SwitchV1.name)!;
	const object = initial.object;
	const original = host.hold(SwitchV1, {});
	await original.set(true);
	original.release();
	const codeVersion = host.codeVersion;
	await assert.rejects(host.reload([facets.v2(false)]), (error) => isChordError(error, "invalid"));
	assert.equal(host.codeVersion, codeVersion);
	assert.equal(host.hostObjects.get(SwitchV1.name), initial);
	assert.equal(initial.status, "live");
	assert.equal(host.registry(Read).get("current")!(), true);
	const report = await host.reload([facets.v2(true)]);
	assert.equal(report.gated.length, 1);
	const updated = host.hostObjects.get(SwitchV2.name)!;
	assert.equal(updated.contract, SwitchV2);
	assert.equal(updated.object, object);
	assert.equal(initial.status, "released");
	assert.equal(object?.refs.size, 1, "Attach the replacement before releasing the only old hold");
	assert.deepEqual(host.registry(Read).get("current")!(), { 1: true });
	const modern = host.hold(SwitchV2, {});
	await modern.set({ conversation: 2, enabled: true });
	modern.release();
	assert.deepEqual((await host.reload([facets.v3])).gated, []);
	assert.equal(host.hostObjects.get(SwitchV3.name)?.contract, SwitchV3);
	assert.equal(host.hostObjects.get(SwitchV3.name)?.object, object);
	assert.equal(updated.status, "released");
	assert.deepEqual(host.registry(Read).get("current")!(), { 1: true, 2: true });
	await host.ready();
	assert.deepEqual(log, ["open"]);
	assert.deepEqual(errors, []);
	await host.close();
	assert.deepEqual(log, ["open", "close"]);
});

const ReadV1 = local("t.eager-read", {
	version: 1,
	input: Type.Object({}),
	members: { read: method(undefined, Type.String()) },
});
const ReadV2 = local("t.eager-read", {
	version: 2,
	input: Type.Object({}),
	members: { fetch: method(undefined, Type.String()) },
});
const readerV1: Facet = {
	name: "read",
	setup: (api) => api.serve(ReadV1, () => ({ read: () => "one" }), { lifetime: "host" }),
};
const readerV2 = (adapt = false): Facet => ({
	name: "read",
	setup: (api) =>
		api.serve(ReadV2, () => ({ fetch: () => "two" }), {
			lifetime: "host",
			...(adapt ? { accepts: { 1: (current: Record<string, unknown>) => ({ read: current.fetch }) } } : {}),
		}),
});

test("external old-version consumers still refuse a host object's upgrade without accepts, and keep their adapter when it is provided", async () => {
	const host = new HostImpl({
		self: { kind: "host" },
		onError: (error) => {
			throw error;
		},
	});
	onTestFinished(() => host.close());
	await host.load([readerV1]);
	const own = host.hostObjects.get(ReadV1.name)!;
	const consumer = host.hold(ReadV1, {});
	assert.equal(await consumer.read(), "one");
	await assert.rejects(host.reload([readerV2()]), (error) => isChordError(error, "contract_mismatch"));
	assert.equal(host.hostObjects.get(ReadV1.name), own);
	assert.equal(await consumer.read(), "one");
	await host.reload([readerV2(true)]);
	assert.equal(host.hostObjects.get(ReadV2.name)?.contract, ReadV2);
	assert.equal(await consumer.read(), "two");
	assert.equal(consumer.contract, ReadV1, "Only the bootstrap hold is retokened");
	assert.equal(await host.hold(ReadV2, {}).fetch(), "two");
});

test("object-owned old-version references still block a host object's upgrade unless their consumer is replaced in the same batch", async () => {
	const host = new HostImpl({ self: { kind: "host" }, onError: () => {} });
	onTestFinished(() => host.close());
	const Consumer = local("t.eager-consumer", {
		version: 1,
		input: Type.Object({}),
		members: { read: method(undefined, Type.String()) },
	});
	const oldConsumer: Facet = {
		name: "consumer",
		setup: (api) =>
			api.serve(Consumer, (_input, _principal, self) => {
				const reader = self.get(ReadV1, {});
				return { read: (ctx) => reader.read(ctx) };
			}),
	};
	const newConsumer: Facet = {
		name: "consumer",
		setup: (api) =>
			api.serve(Consumer, (_input, _principal, self) => {
				const reader = self.get(ReadV2, {});
				return { read: (ctx) => reader.fetch(ctx) };
			}),
	};
	await host.load([readerV1, oldConsumer]);
	const consumer = host.hold(Consumer, {});
	assert.equal(await consumer.read(), "one");
	await assert.rejects(host.reload([readerV2()]), (error) => isChordError(error, "contract_mismatch"));
	assert.equal(await consumer.read(), "one");
	await host.reload([readerV2(), newConsumer]);
	assert.equal(await consumer.read(), "two");
	assert.equal(host.hostObjects.get(ReadV2.name)?.contract, ReadV2);
});

test("a forgotten contract bump remains refused even when the only consumer is the host's own reference", async () => {
	const host = new HostImpl({ self: { kind: "host" }, onError: () => {} });
	onTestFinished(() => host.close());
	await host.load([readerV1]);
	const incompatible = local(ReadV1.name, {
		version: 1,
		input: Type.Object({}),
		members: { fetch: method(undefined, Type.String()) },
	});
	await assert.rejects(
		host.reload([
			{
				name: "read",
				setup: (api) => api.serve(incompatible, () => ({ fetch: () => "bad" }), { lifetime: "host" }),
			},
		]),
		(error) => isChordError(error, "contract_mismatch") && /without a version bump/.test(error.message),
	);
	assert.equal(host.hostObjects.get(ReadV1.name)?.contract, ReadV1);
});

test("a cluster contract upgrade retokens the server's and worker's references to host objects only after unanimous preparation", async () => {
	const log: string[] = [];
	const facets = switchFacets(log);
	let valid = false;
	const server = new HostImpl({ self: { kind: "host" }, onError: () => {} });
	const worker = new HostImpl({
		self: { kind: "host" },
		name: "worker",
		onError: () => {},
		loader: async () => [facets.v2(valid)],
	});
	onTestFinished(async () => {
		await worker.close();
		await server.close();
	});
	await server.load([facets.v1]);
	await worker.load([facets.v1]);
	const [down, up] = memoryLinkPair();
	server.accept(down, { kind: "host", name: "worker", principal: { worker: true } });
	worker.connect(up, { principal: { kind: "server" } });
	await new Promise((resolve) => setImmediate(resolve));
	const serverOwn = server.hostObjects.get(SwitchV1.name);
	const workerOwn = worker.hostObjects.get(SwitchV1.name);
	await assert.rejects(server.reload([facets.v2(true)], { remote: { worker: ["switch"] } }), (error) =>
		isChordError(error, "invalid"),
	);
	assert.equal(server.hostObjects.get(SwitchV1.name), serverOwn);
	assert.equal(worker.hostObjects.get(SwitchV1.name), workerOwn);
	valid = true;
	await server.reload([facets.v2(true)], { remote: { worker: ["switch"] } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(server.hostObjects.get(SwitchV2.name)?.contract, SwitchV2);
	assert.equal(worker.hostObjects.get(SwitchV2.name)?.contract, SwitchV2);
	assert.deepEqual(server.registry(Read).get("current")!(), { 1: false });
	assert.deepEqual(worker.registry(Read).get("current")!(), { 1: false });
	assert.equal(server.codeVersion, worker.codeVersion);
	assert.deepEqual(log, ["open", "open"]);
});

test("a reload that changes a type's lifetime creates its host object, or lets it go", async () => {
	const host = createHost({ self: { kind: "host" }, onError: () => {} });
	const Kept = local("t.lifetime-change", { version: 1, input: Type.Object({}) });
	const log: string[] = [];
	const facet = (lifetime: "host" | "referenced"): Facet => ({
		name: "kept",
		setup: (api) =>
			api.serve(
				Kept,
				(_input, _principal, self) => {
					self.resource("life", {
						version: 1,
						open: () => log.push(`open ${lifetime}`),
						close: () => {
							log.push("close");
						},
					});
					return {};
				},
				{ lifetime },
			),
	});
	try {
		await host.install(facet("referenced"));
		assert.deepEqual(log, [], "a referenced object waits for its first reference");
		await host.reload([facet("host")]);
		await host.ready();
		assert.deepEqual(log, ["open host"], "created by the reload that made it a host object");
		await host.reload([facet("referenced")]);
		for (let i = 0; i < 50 && log.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5));
		assert.deepEqual(log, ["open host", "close"], "nobody else references it: disposed");
	} finally {
		await host.close();
	}
});

for (const initial of ["referenced", "host"] as const) {
	test(`a surviving ${initial} object uses each candidate's lifetime for registrations and changes lifetime only at commit`, async () => {
		const errors: unknown[] = [];
		const host = new HostImpl({ self: "host", onError: (error) => errors.push(error) });
		onTestFinished(() => host.close());
		const Kept = local(`t.live-lifetime-${initial}`, {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const Entries = defineRegistry<string>(`t.live-lifetime-${initial}-entries`);
		const facet = (lifetime: "host" | "referenced", register: boolean, fail = false): Facet => ({
			name: "kept",
			setup: (api) =>
				api.serve(
					Kept,
					(_input, _principal, self) => {
						if (register) self.register(Entries, { current: lifetime });
						if (fail)
							self.resource("failure", {
								version: 1,
								open: () => {
									throw new Error("candidate open failed");
								},
							});
						return { read: () => lifetime };
					},
					{ lifetime },
				),
		});
		await host.install(facet(initial, initial === "host"));
		const ref = await host.get(Kept, {});
		const object = [...host.objects.values()][0]!;
		const next = initial === "host" ? "referenced" : "host";
		const codeVersion = host.codeVersion;
		await assert.rejects(host.reload([facet(next, true, next === "host")]), (error) =>
			next === "host"
				? isChordError(error, "unavailable") && /candidate open failed/.test(error.message)
				: isChordError(error, "invalid") && error.reason === "not_host_lifetime",
		);
		assert.equal(host.codeVersion, codeVersion);
		assert.equal(object.hostLifetime, initial === "host");
		assert.equal(await ref.read(), initial);
		assert.equal(host.registry(Entries).get("current"), initial === "host" ? "host" : undefined);
		await host.reload([facet(next, next === "host")]);
		await host.ready();
		assert.equal([...host.objects.values()][0], object);
		assert.equal(object.hostLifetime, next === "host");
		assert.equal(await ref.read(), next);
		assert.equal(host.registry(Entries).get("current"), next === "host" ? "host" : undefined);
		if (next === "referenced") {
			await assert.rejects(
				host.reload([facet(next, true)]),
				(error) => isChordError(error, "invalid") && error.reason === "not_host_lifetime",
			);
			assert.equal(host.hostObjects.has(Kept.name), false);
			ref.release();
			await object.dispose(false);
			assert.equal(object.status, "disposed");
		} else {
			ref.release();
			assert.equal(host.hostObjects.get(Kept.name)?.object, object);
			assert.equal(host.registry(Entries).get("current"), "host");
		}
		assert.deepEqual(errors, []);
	});
}

for (const identity of ["guest", "nondefault-input"] as const) {
	for (const status of ["live", "activating"] as const) {
		test(`referenced-to-host rejects a ${status} ${identity} object until it drains, then preserves the canonical singleton`, async () => {
			const errors: unknown[] = [];
			const host = new HostImpl({ self: "host", onError: (error) => errors.push(error) });
			const entered = Promise.withResolvers<void>();
			const resume = Promise.withResolvers<void>();
			onTestFinished(async () => {
				resume.resolve();
				await host.close();
			});
			type Seen = { principal: unknown; scope: string | undefined; lifetime: "referenced" | "host" };
			const Kept = local(`t.promote-${identity}-${status}`, {
				version: 1,
				input: Type.Object({ scope: Type.Optional(Type.String({ default: "all" })) }),
				members: { seen: opaque<Seen>("t.promotion-identity@1") },
			});
			const Entries = defineRegistry<Seen>(`t.promote-${identity}-${status}-entries`);
			let opened = 0;
			const facet = (lifetime: "referenced" | "host"): Facet => ({
				name: "kept",
				setup: ({ serve }) =>
					serve(
						Kept,
						(input, principal, self) => {
							const seen = { principal, scope: input.scope, lifetime };
							self.resource("life", {
								version: 1,
								open: async () => {
									opened++;
									if (status === "activating" && (principal === "guest" || input.scope === "other")) {
										entered.resolve();
										await resume.promise;
									}
								},
							});
							if (lifetime === "host") self.register(Entries, { current: seen });
							return { seen };
						},
						{ lifetime },
					),
			});
			await host.install(facet("referenced"));
			const canonical = await host.get(Kept, { scope: "all" });
			const canonicalObject = host.objects.get(host.addressOf(Kept, {}, host.principal))!;
			const noncanonical = host.hold(
				Kept,
				identity === "guest" ? {} : { scope: "other" },
				identity === "guest" ? { principal: "guest" } : undefined,
			);
			if (status === "activating") await entered.promise;
			else await noncanonical.ready;
			const noncanonicalObject = [...host.objects.values()].find((object) => object !== canonicalObject)!;
			assert.equal(noncanonicalObject.status, status);
			const codeVersion = host.codeVersion;
			const reloading = host.reload([facet("host")]);
			try {
				await assert.rejects(
					Promise.race([
						reloading,
						(async () => {
							for (let turn = 0; turn < 100; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
							throw new Error("lifetime conflict waited for activation");
						})(),
					]),
					(error) => isChordError(error, "upgrade_conflict"),
				);
			} finally {
				resume.resolve();
				await reloading.catch(() => {});
			}
			await noncanonical.ready;
			assert.equal(host.codeVersion, codeVersion);
			assert.equal(canonicalObject.hostLifetime, false);
			assert.equal(noncanonicalObject.hostLifetime, false);
			assert.equal(host.hostObjects.has(Kept.name), false);
			assert.equal(host.registry(Entries).get("current"), undefined);
			assert.deepEqual(noncanonical.seen, {
				principal: identity === "guest" ? "guest" : "host",
				scope: identity === "guest" ? "all" : "other",
				lifetime: "referenced",
			});
			assert.equal(canonical.seen?.lifetime, "referenced");
			noncanonical.release();
			await noncanonicalObject.dispose(false);
			await host.reload([facet("host")]);
			await host.ready();
			const guest = await host.get(Kept, {}, { principal: "guest" });
			assert.equal(host.hostObjects.get(Kept.name)?.object, canonicalObject);
			assert.deepEqual([...host.objects.values()], [canonicalObject]);
			assert.deepEqual(canonical.seen, { principal: "host", scope: "all", lifetime: "host" });
			assert.equal(guest.seen, canonical.seen);
			assert.equal(host.registry(Entries).get("current"), canonical.seen);
			assert.equal(opened, 2, "the canonical resource survives promotion without reopening");
			canonical.release();
			guest.release();
			assert.equal(canonicalObject.status, "live");
			assert.deepEqual(errors, []);
		});
	}
}
