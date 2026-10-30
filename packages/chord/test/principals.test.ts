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
	isChordError,
	local,
	memoryLinkPair,
	method,
	type Readable,
	type Ref,
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

	it("invalidation fences host-originated holds while their route is unresolved", async () => {
		const Access = remote("t.pending-revocation", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("worker"),
			variants: { main: { methods: { who: method(undefined, Type.String()) } } },
		});
		const server = createHost({ self: "host", name: "server" });
		const [down, up] = memoryLinkPair();
		const worker = createHost({ self: "host", name: "worker", upstream: { link: up, principal: "host" } });
		const resolving = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const created: unknown[] = [];
		worker.serve(Access, (_input, principal) => {
			created.push(principal);
			return { variant: "main", who: () => String(principal) };
		});
		server.route("worker", {
			authorize: () => true,
			principal: () => "host",
			resolve: async () => {
				resolving.resolve();
				await finish.promise;
				return down;
			},
		});
		const old = server.hold(Access, {}, { principal: "guest-v1" });
		try {
			await resolving.promise;
			await server.invalidatePrincipal((principal) => principal === "guest-v1");
			assert.equal(old.status, "gone");
			await assert.rejects(old.ready, /principal invalidated/);
			finish.resolve();
			await tick();
			assert.deepEqual(created, []);
			const fresh = await server.get(Access, {}, { principal: "guest-v2" });
			assert.equal(await fresh.who(), "guest-v2");
			const own = await server.get(Access, {});
			await server.invalidatePrincipal((principal) => principal === "guest-v2");
			assert.equal(own.status, "live");
		} finally {
			finish.resolve();
			await server.close();
			await worker.close();
		}
	});

	it("predicate invalidation cancels active remote calls without cancelling released or unrelated holds", async () => {
		const Access = remote("t.active-remote-revocation", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("worker"),
			variants: {
				main: { methods: { wait: method(undefined, Type.String()), who: method(undefined, Type.String()) } },
			},
		});
		const server = createHost({ self: "host", name: "server" });
		const [down, up] = memoryLinkPair();
		const worker = createHost({ self: "host", name: "worker", upstream: { link: up, principal: "host" } });
		const started: Record<string, PromiseWithResolvers<void>> = {
			guest: Promise.withResolvers<void>(),
			other: Promise.withResolvers<void>(),
		};
		const finish = Promise.withResolvers<void>();
		const aborted = Promise.withResolvers<void>();
		const cancelled = new Set<unknown>();
		worker.serve(Access, (_input, principal) => ({
			variant: "main",
			who: () => String(principal),
			wait: async (ctx) => {
				started[String(principal)]?.resolve();
				const result = await Promise.race([
					finish.promise.then(() => "finished"),
					new Promise<string>((resolve) =>
						ctx.signal.addEventListener("abort", () => resolve("cancelled"), { once: true }),
					),
				]);
				if (result === "cancelled") {
					cancelled.add(principal);
					if (principal === "guest") aborted.resolve();
				}
				return result;
			},
		}));
		server.route("worker", { authorize: () => true, principal: () => "host", resolve: async () => down });
		try {
			const guest = await server.get(Access, {}, { principal: "guest" });
			const other = await server.get(Access, {}, { principal: "other" });
			const own = await server.get(Access, {});
			const waiting = guest.wait();
			let recovered: Ref<typeof Access> | undefined;
			let recoveryStatus: string | undefined;
			guest.onStatus((status) => {
				if (status !== "gone") return;
				recovered = server.hold(Access, {}, { principal: "guest" });
				recoveryStatus = recovered.status;
			});
			const rejected = assert.rejects(waiting, (error) => {
				assert.ok(isChordError(error, "aborted"));
				return true;
			});
			const releasedCall = other.wait();
			await Promise.all(Object.values(started).map((entry) => entry.promise));
			other.release();
			await server.invalidatePrincipal((principal) => principal === "guest");
			await rejected;
			await aborted.promise;
			assert.equal(guest.status, "gone");
			await assert.rejects(guest.wait(), /principal invalidated/);
			assert.equal(recoveryStatus, "gone");
			assert.ok(recovered);
			await assert.rejects(recovered.who(), /principal invalidated/);
			assert.deepEqual([...cancelled], ["guest"]);
			assert.equal(up.closed, false);
			assert.equal(await own.who(), "host");
			finish.resolve();
			assert.equal(await releasedCall, "finished");
			assert.equal(other.status, "released");
			const fresh = await server.get(Access, {}, { principal: "fresh" });
			assert.equal(await fresh.who(), "fresh");
			const regranted = await server.get(Access, {}, { principal: "guest" });
			assert.equal(await regranted.who(), "guest");
		} finally {
			finish.resolve();
			await server.close();
			await worker.close();
		}
	});

	it("gone observers can reacquire without extending the principal revocation traversal", async () => {
		const host = createHost({ self: "host" });
		const Other = local("t.reentrant-revocation-other", {
			version: 1,
			input: Type.Object({}),
			members: { who: method(undefined, Type.String()) },
		});
		const Fresh = local("t.reentrant-revocation-fresh", {
			version: 1,
			input: Type.Object({}),
			members: { who: method(undefined, Type.String()) },
		});
		let factories = 0;
		let methods = 0;
		host.serve(Fresh, () => {
			factories++;
			return {
				who: () => {
					methods++;
					return "regranted";
				},
			};
		});
		let fresh: Ref<typeof Fresh> | undefined;
		let freshStatus: string | undefined;
		host.serve(Who, () => ({ who: () => "guest" }));
		host.serve(Other, () => ({ who: () => "other" }));
		const replacements: Ref<typeof Who>[] = [];
		const acquiredStatuses: string[] = [];
		const watch = (ref: Ref<typeof Who>): void => {
			ref.onStatus((status) => {
				if (status !== "gone" || replacements.length > 0) return;
				const replacement = host.hold(Who, {}, { principal: "guest" });
				acquiredStatuses.push(replacement.status);
				replacements.push(replacement);
				watch(replacement);
				fresh = host.hold(Fresh, {}, { principal: "guest" });
				freshStatus = fresh.status;
			});
		};
		try {
			const first = await host.get(Who, {}, { principal: "guest" });
			const other = await host.get(Other, {}, { principal: "guest" });
			watch(first);
			await host.invalidatePrincipal((principal) => principal === "guest");
			assert.equal(first.status, "gone");
			assert.equal(other.status, "gone");
			assert.equal(replacements.length, 1);
			assert.deepEqual(acquiredStatuses, ["gone"]);
			assert.equal(replacements[0]!.status, "gone");
			await assert.rejects(replacements[0]!.who(), /principal invalidated/);
			await assert.rejects(other.who(), /principal invalidated/);
			assert.equal(freshStatus, "gone");
			assert.ok(fresh);
			await assert.rejects(fresh.ready, /principal invalidated/);
			await assert.rejects(fresh.who(), /principal invalidated/);
			assert.equal(factories, 0);
			assert.equal(methods, 0);
			const regranted = await host.get(Fresh, {}, { principal: "guest" });
			assert.equal(await regranted.who(), "regranted");
			assert.equal(factories, 1);
			assert.equal(methods, 1);
		} finally {
			await host.close();
		}
	});

	it("abort observers cannot dispatch fresh calls through a reference being revoked", async () => {
		const host = createHost({ self: "host" });
		const Access = local("t.abort-observer-revocation", {
			version: 1,
			input: Type.Object({}),
			members: { wait: method(), touch: method() },
		});
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		let touches = 0;
		let freshCall: Promise<void> | undefined;
		host.serve(Access, () => ({
			wait: async (ctx) => {
				started.resolve();
				await Promise.race([
					finish.promise,
					new Promise<void>((resolve) =>
						ctx.signal.addEventListener(
							"abort",
							() => {
								freshCall = ref.touch();
								void freshCall.catch(() => {});
								resolve();
							},
							{ once: true },
						),
					),
				]);
			},
			touch: () => {
				touches++;
			},
		}));
		const ref = await host.get(Access, {}, { principal: "guest" });
		try {
			const waiting = ref.wait();
			await started.promise;
			await host.invalidatePrincipal((principal) => principal === "guest");
			await waiting;
			assert.ok(freshCall);
			await assert.rejects(freshCall, /principal invalidated/);
			assert.equal(touches, 0);
		} finally {
			finish.resolve();
			await host.close();
		}
	});

	it("throwing readable cleanup cannot stop call cancellation, later references, links or disposal", async () => {
		const unsubscribeFailure = new Error("readable unsubscribe failed");
		const closeFailure = new Error("readable resource close failed");
		const host = createHost({ self: "host", name: "server" });
		const Access = remote("t.readable-revocation", {
			version: 1,
			input: Type.Object({ id: Type.String() }),
			host: hostNamed("server"),
			variants: {
				main: { state: { x: Type.Number(), y: Type.Number() }, methods: { wait: method() } },
			},
		});
		const started = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const log: string[] = [];
		let calls = 0;
		let aborted = 0;
		host.serve(Access, ({ id }, _principal, self) => {
			const source = (name: string): Readable<number> => ({
				value: 1,
				subscribe: (listener) => {
					listener(1);
					return () => {};
				},
				events: (listener) => {
					listener({ type: "snap", value: 1 });
					return () => {
						log.push(`unsubscribe ${id} ${name}`);
						if (id === "a" && name === "x") throw unsubscribeFailure;
					};
				},
			});
			self.resource("native", {
				version: 1,
				open: () => id,
				close: () => {
					log.push(`close ${id}`);
					if (id === "a") throw closeFailure;
				},
			});
			return {
				variant: "main",
				x: source("x"),
				y: source("y"),
				wait: async (ctx) => {
					if (++calls === 2) started.resolve();
					await Promise.race([
						finish.promise,
						new Promise<void>((resolve) =>
							ctx.signal.addEventListener(
								"abort",
								() => {
									aborted++;
									resolve();
								},
								{ once: true },
							),
						),
					]);
				},
			};
		});
		const Ping = remote("t.readable-revocation-ping", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { methods: { who: method(undefined, Type.String()) } } },
		});
		host.serve(Ping, () => ({ variant: "main", who: () => "guest" }));
		const [down, up] = memoryLinkPair();
		host.accept(down, { principal: "guest" });
		const client = createHost({
			self: "host",
			name: "client",
			kind: "client",
			upstream: { link: up, principal: "server" },
		});
		try {
			const first = await host.get(Access, { id: "a" }, { principal: "guest" });
			const second = await host.get(Access, { id: "b" }, { principal: "guest" });
			for (const ref of [first, second]) {
				if (ref.variant !== "main") throw new Error("expected main variant");
				ref.x.subscribe(() => {});
				ref.y.subscribe(() => {});
			}
			const linked = await client.get(Ping, {});
			const statuses: string[] = [];
			first.onStatus((status) => statuses.push(`a ${status}`));
			second.onStatus((status) => statuses.push(`b ${status}`));
			const waiting = [first.wait(), second.wait()];
			await started.promise;
			await assert.rejects(
				host.invalidatePrincipal((principal) => principal === "guest"),
				(error) => {
					assert.ok(error instanceof AggregateError);
					assert.deepEqual(error.errors, [unsubscribeFailure, closeFailure]);
					return true;
				},
			);
			await Promise.all(waiting);
			await tick();
			assert.equal(first.status, "gone");
			assert.equal(second.status, "gone");
			assert.deepEqual(statuses, ["a gone", "b gone"]);
			assert.equal(aborted, 2);
			assert.equal(linked.status, "gone");
			assert.equal(up.closed, true);
			assert.deepEqual(log.sort(), [
				"close a",
				"close b",
				"unsubscribe a x",
				"unsubscribe a y",
				"unsubscribe b x",
				"unsubscribe b y",
			]);
			await host.invalidatePrincipal((principal) => principal === "guest");
		} finally {
			finish.resolve();
			await client.close();
			await host.close();
		}
	});

	it("revokes a separately held dependency before awaiting its holder's cleanup", async () => {
		const host = createHost({ self: "host" });
		const Holder = local("t.revoked-holder", { version: 1, input: Type.Object({}) });
		const closing = Promise.withResolvers<void>();
		const finish = Promise.withResolvers<void>();
		const started = Promise.withResolvers<void>();
		const aborted = Promise.withResolvers<void>();
		const log: string[] = [];
		host.serve(Who, (_input, _principal, self) => {
			self.resource("dependency", {
				version: 1,
				open: () => "dependency",
				close: () => {
					log.push("dependency");
				},
			});
			return {
				who: async (ctx) => {
					started.resolve();
					await new Promise<void>((resolve) =>
						ctx.signal.addEventListener(
							"abort",
							() => {
								aborted.resolve();
								resolve();
							},
							{ once: true },
						),
					);
					return "aborted";
				},
			};
		});
		host.serve(Holder, (_input, _principal, self) => {
			self.get(Who, {}, { principal: "guest" });
			self.resource("holder", {
				version: 1,
				open: () => "holder",
				close: async () => {
					closing.resolve();
					await finish.promise;
					log.push("holder");
				},
			});
			return {};
		});
		const holder = await host.get(Holder, {}, { principal: "guest" });
		const dependency = await host.get(Who, {}, { principal: "guest" });
		const call = dependency.who();
		await started.promise;
		const invalidated = host.invalidatePrincipal((principal) => principal === "guest");
		try {
			await closing.promise;
			assert.equal(holder.status, "gone");
			assert.equal(dependency.status, "gone");
			await aborted.promise;
			assert.equal(await call, "aborted");
			await assert.rejects(dependency.who(), /principal invalidated/);
			const reacquired = host.hold(Who, {}, { principal: "guest" });
			assert.equal(reacquired.status, "gone");
			await assert.rejects(reacquired.who(), /principal invalidated/);
			assert.deepEqual(log, []);
			finish.resolve();
			await invalidated;
			assert.deepEqual(log, ["holder", "dependency"]);
		} finally {
			finish.resolve();
			await invalidated;
			await host.close();
		}
	});

	it("revokes every authority before fallible listener cleanup and aggregates all cleanup errors", async () => {
		const unsubscribeFailure = new Error("unsubscribe failed");
		const closeFailure = new Error("resource close failed");
		const reports: unknown[] = [];
		const host = createHost({ name: "server", self: "host", onError: (error) => reports.push(error) });
		const Access = remote("t.revocation-unsubscribe", {
			version: 1,
			input: Type.Object({ id: Type.String() }),
			host: hostNamed("server"),
			variants: { main: { methods: { wait: method() } } },
		});
		const started = Promise.withResolvers<void>();
		const log: string[] = [];
		const callbacks: ((event: number) => void)[] = [];
		let calls = 0;
		let aborted = 0;
		let delivered = 0;
		host.serve(Access, ({ id }, _principal, self) => {
			for (const name of ["first", "second"]) {
				self.on(
					name,
					{
						subscribe: (listener: (event: number) => void) => {
							callbacks.push(listener);
							return () => {
								log.push(`unsubscribe ${id} ${name}`);
								if (id === "a" && name === "first") throw unsubscribeFailure;
							};
						},
					},
					() => {
						delivered++;
					},
				);
			}
			self.resource("native", {
				version: 1,
				open: () => id,
				close: () => {
					log.push(`close ${id}`);
					if (id === "a") throw closeFailure;
				},
			});
			return {
				variant: "main",
				wait: async (ctx) => {
					if (++calls === 2) started.resolve();
					await new Promise<void>((resolve) =>
						ctx.signal.addEventListener(
							"abort",
							() => {
								aborted++;
								resolve();
							},
							{ once: true },
						),
					);
				},
			};
		});
		const [down, up] = memoryLinkPair();
		host.accept(down, { principal: "guest" });
		const client = createHost({
			name: "client",
			kind: "client",
			self: "host",
			upstream: { link: up, principal: "server" },
		});
		try {
			const first = await client.get(Access, { id: "a" });
			const second = await client.get(Access, { id: "b" });
			const waiting = [first.wait(), second.wait()];
			for (const call of waiting) void call.catch(() => {});
			await started.promise;
			const invalidated = host.invalidatePrincipal((principal) => principal === "guest");
			const rejected = assert.rejects(invalidated, (error) => {
				assert.ok(error instanceof AggregateError);
				assert.deepEqual(error.errors, [unsubscribeFailure, closeFailure]);
				return true;
			});
			for (const callback of callbacks) callback(1);
			await rejected;
			await Promise.allSettled(waiting);
			await tick();
			assert.equal(first.status, "gone");
			assert.equal(second.status, "gone");
			assert.equal(up.closed, true);
			assert.equal(aborted, 2);
			assert.equal(delivered, 0);
			assert.deepEqual(log.sort(), [
				"close a",
				"close b",
				"unsubscribe a first",
				"unsubscribe a second",
				"unsubscribe b first",
				"unsubscribe b second",
			]);
			assert.equal(reports.length, 1);
			assert.ok(reports[0] instanceof AggregateError);
			assert.deepEqual(reports[0].errors, [unsubscribeFailure, closeFailure]);
		} finally {
			await client.close();
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
