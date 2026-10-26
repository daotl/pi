import assert from "node:assert/strict";
import { setImmediate as tick } from "node:timers/promises";
import { Type } from "typebox";
import { describe, it } from "vitest";
import {
	type Ctx,
	createHost,
	defineFacet,
	type FacetApi,
	type Host,
	hostNamed,
	local,
	memoryLinkPair,
	method,
	remote,
} from "../src/index.ts";

/** An app's principals: what TypeScript narrows on. */
type Principal =
	| { readonly kind: "owner" }
	| { readonly kind: "guest"; readonly id: string }
	| { readonly kind: "server" }
	| { readonly kind: "host" };

const principalKey = (principal: Principal): string =>
	principal.kind === "guest" ? `guest:${principal.id}` : principal.kind;

const Who = local("t.who", {
	version: 1,
	input: Type.Object({}),
	members: { who: method(undefined, Type.String()) },
});

describe("principals", () => {
	it("factories, methods and contexts see the app's principal type", async () => {
		const host = createHost<Principal>({ self: { kind: "host" }, principalKey });
		const facet = defineFacet<Principal>((api) => {
			const plain: FacetApi = api;
			void plain;
			api.serve(Who, (_input, principal, self) => {
				// Narrowing on `kind` needs no cast.
				const created = principal.kind === "guest" ? `guest ${principal.id}` : principal.kind;
				self.task(async (ctx) => {
					const kind: Principal["kind"] = ctx.principal.kind;
					void kind;
				});
				return { who: (ctx) => `${created}, called by ${ctx.principal.kind}` };
			});
		});
		await host.install({ name: "who", ...facet });
		const guest = host.hold(Who, {}, { principal: { kind: "guest", id: "g1" } });
		assert.equal(
			await host.root((ctx) => guest.who(ctx), { principal: { kind: "guest", id: "g1" } }),
			"guest g1, called by host",
		);
		// A typed host, facet API and context are usable where Chord's untyped ones are expected.
		const untyped: Host = host;
		void untyped;
		await host.root(async (ctx) => {
			const plain: Ctx = ctx;
			void plain;
		});
		// @ts-expect-error: not a principal of this app
		host.hold(Who, {}, { principal: { kind: "stranger" } });
		// @ts-expect-error: a pattern names fields of the app's principals
		void host.invalidatePrincipal({ kind: "guest", name: "g1" }).catch(() => {});
		await host.close();
	});

	it("the host's own principal is recognized by key: an equal object reaches the same objects", async () => {
		const host = createHost<Principal>({ self: { kind: "host" }, principalKey });
		let created = 0;
		host.serve(Who, () => {
			created++;
			return { who: () => "one" };
		});
		const own = host.hold(Who, {});
		const equal = host.hold(Who, {}, { principal: { kind: "host" } });
		await Promise.all([own.ready, equal.ready]);
		assert.equal(created, 1);
		// Never disposed as a matching principal: it is the host's own.
		await host.invalidatePrincipal({ kind: "host" });
		assert.equal(own.status, "live");
		await host.close();
	});

	it("a child's parent acts as the principal the child gave `connect`; relayed callers keep theirs", async () => {
		const Echo = remote("t.echo", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("worker"),
			variants: { main: { methods: { who: method(undefined, Type.String()) } } },
		});
		const server = createHost<Principal>({ name: "server", self: { kind: "host" }, principalKey });
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: { kind: "host" } });
		const worker = createHost<Principal>({
			name: "worker",
			self: { kind: "host" },
			principalKey,
			upstream: { link: up, principal: { kind: "server" } },
		});
		worker.serve(Echo, (_input, principal) => ({ variant: "main", who: () => principalKey(principal) }));
		const [browserDown, browserUp] = memoryLinkPair();
		server.accept(browserDown, { principal: { kind: "guest", id: "g1" } });
		const browser = createHost<Principal>({
			name: "browser",
			kind: "client",
			self: { kind: "host" },
			upstream: { link: browserUp, principal: { kind: "server" } },
		});
		assert.equal(await server.hold(Echo, {}).who(), "server");
		server.route("worker", {
			authorize: () => true,
			resolve: async () => down,
			principal: () => ({ kind: "host" }),
		});
		assert.equal(await browser.hold(Echo, {}).who(), "guest:g1");
		await browser.close();
		await worker.close();
		await server.close();
	});

	for (const released of [false, true]) {
		for (const fails of [false, true]) {
			it(`invalidation awaits async cleanup ${released ? "after link loss" : "when revoking a link"}${fails ? " and rejects with its error" : ""}`, async () => {
				const Cleanup = remote("t.principal-cleanup", {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("worker"),
					variants: { main: {} },
				});
				const errors: unknown[] = [];
				const failure = new Error("resource cleanup failed");
				const host = createHost<Principal>({
					name: "worker",
					self: { kind: "host" },
					principalKey,
					onError: (error) => errors.push(error),
				});
				const { promise: closing, resolve: finishClose } = Promise.withResolvers<void>();
				let closeStarted = false;
				let closed = false;
				host.serve(Cleanup, (_input, _principal, self) => {
					self.resource("native", {
						version: 1,
						open: () => ({}),
						close: async () => {
							closeStarted = true;
							await closing;
							closed = true;
							if (fails) throw failure;
						},
					});
					return { variant: "main" };
				});
				const [down, up] = memoryLinkPair();
				host.accept(down, { principal: { kind: "guest", id: "g1" } });
				const client = createHost<Principal>({
					kind: "client",
					self: { kind: "host" },
					upstream: { link: up, principal: { kind: "server" } },
				});
				await client.get(Cleanup, {});
				if (released) down.close("attachment released");
				let settled = false;
				const invalidated = host.invalidatePrincipal({ kind: "guest", id: "g1" }).then(
					() => {
						settled = true;
					},
					(error: unknown) => {
						settled = true;
						return error;
					},
				);
				try {
					await tick();
					assert.equal(closeStarted, true);
					assert.equal(closed, false);
					assert.equal(settled, false, "invalidation must await the released resource's cleanup");
					finishClose();
					assert.equal(await invalidated, fails ? failure : undefined);
					assert.equal(closed, true);
					assert.deepEqual(errors, fails ? [failure] : []);
					// Finished disposals are forgotten: later invalidations must not replay their errors.
					await host.invalidatePrincipal({ kind: "guest", id: "g1" });
				} finally {
					finishClose();
					await invalidated;
					await client.close();
					await host.close();
				}
			});
		}
	}

	it("invalidation joins cleanup errors even after another object at the address was abandoned", async () => {
		const errors: unknown[] = [];
		const host = createHost<Principal>({
			self: { kind: "host" },
			principalKey,
			onError: (error) => errors.push(error),
		});
		const failure = new Error("first resource cleanup failed");
		const { promise: closing, resolve: finishClose } = Promise.withResolvers<void>();
		host.serve(Who, (_input, _principal, self) => {
			self.resource("native", {
				version: 1,
				open: () => ({}),
				close: async () => {
					await closing;
					throw failure;
				},
			});
			return { who: () => "guest" };
		});
		const principal: Principal = { kind: "guest", id: "g1" };
		const first = await host.get(Who, {}, { principal });
		first.release();
		const abandoned = host.hold(Who, {}, { principal });
		abandoned.release();
		const invalidated = host.invalidatePrincipal({ kind: "guest", id: "g1" }).catch((error: unknown) => error);
		try {
			await tick();
			finishClose();
			assert.equal(await invalidated, failure, "an abandoned successor must not hide the first cleanup error");
			assert.deepEqual(errors, [failure]);
			await host.invalidatePrincipal({ kind: "guest", id: "g1" });
		} finally {
			finishClose();
			await invalidated;
			await host.close();
		}
	});

	it("refuses a host, a parent link or a route without its principal", () => {
		// @ts-expect-error: `self` is required
		assert.throws(() => createHost({ name: "x" }), /needs `self`/);
		const host = createHost({ self: "host" });
		const [, up] = memoryLinkPair();
		// @ts-expect-error: `principal` is required
		assert.throws(() => host.connect(up, {}), /connect needs `principal`/);
		assert.throws(
			// @ts-expect-error: `principal` is required
			() => host.route("w:", { authorize: () => true, resolve: async () => up }),
			/needs `principal`/,
		);
	});
});
