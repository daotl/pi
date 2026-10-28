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
	it("null guest roots and self.get references stay distinct from owner state and methods", async () => {
		const host = createHost<string | null>({ self: "host", name: "server" });
		const Access = remote("t.null-access-local", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				owner: { state: { secret: Type.String() }, methods: { owner: method(undefined, Type.String()) } },
				guest: { state: { public: Type.String() }, methods: { who: method(undefined, Type.Null()) } },
			},
		});
		host.serve(Access, (_input, principal, self) => {
			if (principal === "host")
				return {
					variant: "owner",
					secret: self.state("secret", Type.String(), "owner-secret"),
					owner: () => "owner",
				};
			if (principal !== null) throw new Error("expected the null guest principal");
			return { variant: "guest", public: self.state("public", Type.String(), "guest-state"), who: () => principal };
		});
		const Panel = local("t.null-panel", {
			version: 1,
			input: Type.Object({}),
			members: { who: method(undefined, Type.Null()) },
		});
		host.serve(Panel, (_input, _principal, self) => {
			self.get(Access, {});
			const guest = self.get(Access, {}, { principal: null });
			return {
				who: async (ctx) => {
					assert.equal(guest.variant, "guest");
					if (guest.variant !== "guest") throw new Error("guest acquired owner privileges");
					return guest.who(ctx);
				},
			};
		});
		try {
			const owner = await host.get(Access, {});
			assert.equal(owner.variant, "owner");
			assert.equal(await host.root((ctx) => ctx.principal, { principal: null }), null);
			await host.root(
				async (ctx) => {
					const guest = await ctx.get(Access, {});
					assert.equal(guest.variant, "guest");
					if (guest.variant !== "guest") throw new Error("guest acquired owner privileges");
					assert.equal(guest.public.value, "guest-state");
					assert.deepEqual([...guest.shape!.members].sort(), ["public", "who"]);
					assert.equal(await guest.who(ctx), null);
				},
				{ principal: null },
			);
			assert.equal(await (await host.get(Panel, {})).who(), null);
		} finally {
			await host.close();
		}
	});

	it("null remote bindings authorize and forward the guest separately from the host, including relays", async () => {
		const Access = remote("t.null-access-remote", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("worker"),
			variants: {
				owner: { state: { secret: Type.String() }, methods: { owner: method(undefined, Type.String()) } },
				guest: { state: { public: Type.String() }, methods: { who: method(undefined, Type.Null()) } },
			},
		});
		const server = createHost<string | null>({ self: "host", name: "server" });
		const [down, up] = memoryLinkPair();
		const worker = createHost<string | null>({
			self: "host",
			name: "worker",
			upstream: { link: up, principal: "host" },
		});
		worker.serve(Access, (_input, principal, self) => {
			if (principal === "host")
				return {
					variant: "owner",
					secret: self.state("secret", Type.String(), "owner-secret"),
					owner: () => "owner",
				};
			if (principal !== null) throw new Error("expected the null guest principal");
			return { variant: "guest", public: self.state("public", Type.String(), "guest-state"), who: () => principal };
		});
		const authorized: (string | null)[] = [];
		server.route("worker", {
			principal: () => "host",
			authorize: (principal) => {
				authorized.push(principal);
				return true;
			},
			resolve: async () => down,
		});
		const [browserDown, browserUp] = memoryLinkPair();
		server.accept(browserDown, { principal: null });
		const browser = createHost<string | null>({
			self: "host",
			kind: "client",
			name: "browser",
			upstream: { link: browserUp, principal: "host" },
		});
		const Panel = local("t.null-remote-panel", {
			version: 1,
			input: Type.Object({}),
			members: { who: method(undefined, Type.Null()) },
		});
		server.serve(Panel, (_input, _principal, self) => {
			self.get(Access, {});
			const guest = self.get(Access, {}, { principal: null });
			return {
				who: async (ctx) => {
					if (guest.variant !== "guest") throw new Error("guest acquired owner privileges");
					return guest.who(ctx);
				},
			};
		});
		try {
			// Start the null route before a child connection exists: authorization must not use self.
			const guest = await server.get(Access, {}, { principal: null });
			assert.deepEqual(authorized, [null, null]);
			const owner = await server.get(Access, {});
			assert.equal(owner.variant, "owner");
			if (owner.variant !== "owner") throw new Error("host lost owner variant");
			assert.equal(owner.secret.value, "owner-secret");
			assert.equal(await owner.owner(), "owner");
			for (const ref of [guest, await browser.get(Access, {})]) {
				assert.equal(ref.variant, "guest");
				if (ref.variant !== "guest") throw new Error("guest acquired owner privileges");
				assert.equal(ref.public.value, "guest-state");
				assert.deepEqual([...ref.shape!.members].sort(), ["public", "who"]);
				assert.equal(await ref.who(), null);
			}
			assert.deepEqual(authorized, [null, null, null, null]);
			assert.equal(await (await server.get(Panel, {})).who(), null);
		} finally {
			await browser.close();
			await server.close();
			await worker.close();
		}
	});

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
