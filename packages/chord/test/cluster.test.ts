import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it, onTestFinished, vi } from "vitest";
import {
	type Ctx,
	createHost,
	type Facet,
	type FacetLoader,
	type Frame,
	type Host,
	hostFamily,
	hostNamed,
	isChordError,
	type Link,
	local,
	memoryLinkPair,
	method,
	PROTOCOL_VERSION,
	remote,
	type Self,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function latch() {
	let open = () => {};
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

const Greeter = remote("t.greeter", {
	version: 1,
	input: Type.Object({ session: Type.String() }),
	host: hostFamily("session:", "session"),
	variants: {
		main: {
			state: { count: Type.Object({ n: Type.Number() }) },
			methods: { greet: method(Type.String(), Type.String()) },
		},
	},
});

const GreeterV2 = remote("t.greeter", {
	version: 2,
	input: Type.Object({ session: Type.String() }),
	host: hostFamily("session:", "session"),
	variants: { main: { methods: { hello: method(Type.String(), Type.String()) } } },
});

/** The server's own greeter: the greeter facet serves this one on the server, `Greeter` on session hosts. */
const ServerGreeter = remote("t.server-greeter", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: {
		main: {
			state: { count: Type.Object({ n: Type.Number() }) },
			methods: { greet: method(Type.String(), Type.String()) },
		},
	},
});

function greeterFacet(greeting: string, options: { fail?: boolean; stateVersion?: number } = {}): Facet {
	return {
		name: "greeter",
		setup: (api) => {
			const greeter = (self: Self) => {
				if (options.fail) throw new Error("worker factory fails");
				const count = self.state(
					"count",
					Type.Object({ n: Type.Number() }),
					{ n: 0 },
					{ version: options.stateVersion ?? 1 },
				);
				return {
					variant: "main" as const,
					count,
					greet: (name: string, ctx: Ctx) => {
						count.change(ctx, (draft) => {
							draft.n += 1;
						});
						return `${greeting} ${name}`;
					},
				};
			};
			if (api.name === "server") api.serve(ServerGreeter, (_input, _principal, self) => greeter(self));
			else api.serve(Greeter, (_input, _principal, self) => greeter(self));
		},
	};
}

/** Server + worker over a memory link; the worker loads facets by name from `modules`. */
/** `link`, except that frames `drop` selects are never sent (a frame lost when its link dies). */
function dropping(link: Link, drop: (frame: Frame) => boolean): Link {
	return {
		get closed() {
			return link.closed;
		},
		send: (frame) => (drop(frame) ? undefined : link.send(frame)),
		receive: (handler) => link.receive(handler),
		onClose: (handler) => link.onClose(handler),
		close: (reason) => link.close(reason),
	};
}

const Ping = remote("t.cluster-ping", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: { main: { methods: { ping: method(undefined, Type.String()) } } },
});

function setup() {
	const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
	const loader: FacetLoader = async (names) => names.map((name) => modules.get(String(name))!);
	const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
	const [down, up] = memoryLinkPair();
	server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
	const worker = createHost({
		self: { kind: "host" },
		name: "session:S1",
		upstream: { link: up, principal: { kind: "server" } },
		loader,
		onError: () => {},
	});
	worker.install(modules.get("greeter")!);
	return { server, worker, modules, down };
}

describe("cross-host reload", () => {
	it("retains module identities learned by reconciliation before a later removal", async () => {
		const server = createHost({ self: "server", name: "server", onError: () => {} });
		const Token = local("t.reconcile-identity", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const facet: Facet = {
			name: "file:///facets/learned.ts",
			setup: ({ serve }) => serve(Token, () => ({ read: () => "loaded" })),
		};
		let removed = false;
		const loader: FacetLoader = async (names) =>
			names.map(() => {
				assert.equal(removed, false, "removed module cannot be loaded");
				return facet;
			});
		const children: Host[] = [];
		const connect = async (name: string) => {
			const [down, up] = memoryLinkPair();
			const child = createHost({ self: "worker", name, loader, onError: () => {} });
			children.push(child);
			server.accept(down, { principal: "worker", kind: "host", name });
			child.connect(up, { principal: "server" });
			for (let n = 0; n < 100 && child.codeVersion !== server.codeVersion; n++) await tick();
			return child;
		};
		try {
			await server.reload([], { remote: { "worker:": ["./learned.ts"] } });
			const first = await connect("worker:first");
			assert.equal(await (await first.get(Token, {})).read(), "loaded");
			await first.close();
			await tick();
			await server.reload([], { remoteRemove: { "worker:": [facet.name] } });
			removed = true;
			const second = await connect("worker:second");
			assert.equal(second.codeVersion, server.codeVersion);
			assert.throws(
				() => second.hold(Token, {}),
				(error) => isChordError(error, "unavailable"),
			);
		} finally {
			await Promise.all(children.map((child) => child.close()));
			await server.close();
		}
	});

	it.each([false, true])("reconciles resolved removals with mixed prefixes=%s", async (mixedPrefixes) => {
		const server = createHost({ self: "server", name: "server", onError: () => {} });
		const tokens = ["a", "b", "c"].map((name) =>
			local(`t.journal-${name}`, {
				version: 1,
				input: Type.Object({}),
				members: { read: method(undefined, Type.String()) },
			}),
		);
		const modules = new Map<string, Facet>(
			tokens.map((token, index) => [
				`./${index}.ts`,
				{
					name: `file:///facets/${index}.ts`,
					setup: ({ serve }) => {
						serve(token, () => ({ read: () => String(index) }));
					},
				},
			]),
		);
		const loader: FacetLoader = async (names) =>
			names.map((name) => {
				const facet = modules.get(String(name));
				assert.ok(facet, `removed module must not be loaded: ${name}`);
				return facet;
			});
		const connect = (worker: Host) => {
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal: "worker", kind: "host", name: worker.name });
			worker.connect(up, { principal: "server" });
		};
		const worker = createHost({ self: "worker", name: "worker:special-live", loader, onError: () => {} });
		connect(worker);
		await tick();
		try {
			await server.reload([], { remote: { "worker:": ["./0.ts"] } });
			await server.reload([], { remote: { [mixedPrefixes ? "worker:special" : "worker:"]: ["./1.ts"] } });
			await server.reload([], { remote: { "worker:": ["./2.ts"] } });
			for (const [index, token] of tokens.entries())
				assert.equal(await worker.hold(token, {}).read(), String(index));
			const cold = createHost({ self: "worker", name: "worker:special-cold", loader, onError: () => {} });
			connect(cold);
			try {
				for (let i = 0; i < 100 && cold.codeVersion !== server.codeVersion; i++) await tick();
				for (const [index, token] of tokens.entries())
					assert.equal(await cold.hold(token, {}).read(), String(index));
			} finally {
				await cold.close();
			}
			await server.reload([], { remoteRemove: { "worker:": ["file:///facets/0.ts"] } });
			modules.delete("./0.ts");
			const reconnect = createHost({ self: "worker", name: "worker:special-reconnect", loader, onError: () => {} });
			await reconnect.install({
				name: "file:///facets/0.ts",
				setup: ({ serve }) => {
					serve(tokens[0]!, () => ({ read: () => "stale" }));
				},
			});
			connect(reconnect);
			try {
				for (let i = 0; i < 100 && reconnect.codeVersion !== server.codeVersion; i++) await tick();
				assert.equal(reconnect.codeVersion, server.codeVersion);
				assert.throws(
					() => reconnect.hold(tokens[0]!, {}),
					(error) => isChordError(error, "unavailable"),
				);
				assert.equal(await reconnect.hold(tokens[1]!, {}).read(), "1");
			} finally {
				await reconnect.close();
			}
			modules.set("./0.ts", {
				name: "file:///facets/0.ts",
				setup: ({ serve }) => {
					serve(tokens[0]!, () => ({ read: () => "readded" }));
				},
			});
			await server.reload([], { remote: { "worker:": ["./0.ts"] } });
			const readded = createHost({ self: "worker", name: "worker:special-readded", loader, onError: () => {} });
			connect(readded);
			try {
				for (let i = 0; i < 100 && readded.codeVersion !== server.codeVersion; i++) await tick();
				assert.equal(await readded.hold(tokens[0]!, {}).read(), "readded");
			} finally {
				await readded.close();
			}
		} finally {
			await worker.close();
			await server.close();
		}
	});
	it("prepares every host, commits the server first, then the workers; code versions stay in step", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.hold(Greeter, { session: "S1" });
		assert.equal(await greeter.greet("a"), "v1 a");
		const go = latch();
		const pinned = server.root(async (ctx) => {
			await greeter.greet("p", ctx);
			await go.promise;
			return greeter.greet("p", ctx);
		});
		await tick();
		const shapes: string[] = [];
		greeter.onShape((shape) => shapes.push(shape.contract));
		modules.set("greeter", greeterFacet("v2"));
		const report = await server.reload([], { remote: { "session:": ["greeter"] } });
		// No waiting: the commit frame precedes this call on the FIFO link, so the worker has committed when it arrives.
		assert.equal(await greeter.greet("b"), "v2 b");
		assert.equal(server.codeVersion, report.codeVersion);
		assert.equal(worker.codeVersion, report.codeVersion);
		go.open();
		assert.equal(await pinned, "v1 p");
		assert.equal(shapes.length, 1, "one shape push at the commit");
		// The server retires the old code version once its last old root ended, then tells the worker.
		for (let i = 0; i < 20 && worker.previousCodeVersion !== undefined; i++) await tick();
		assert.equal(server.previousCodeVersion, undefined);
		assert.equal(worker.previousCodeVersion, undefined);
	});

	it("a failing vote aborts every host; the error keeps its code and names the host", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.hold(Greeter, { session: "S1" });
		await greeter.greet("a");
		const before = [server.codeVersion, worker.codeVersion];
		modules.set("greeter", greeterFacet("v2", { fail: true }));
		await assert.rejects(server.reload([], { remote: { "session:": ["greeter"] } }), (error) => {
			assert.ok(isChordError(error, "unavailable"));
			assert.match(error.message, /session:S1: .*worker factory fails/);
			return true;
		});
		assert.deepEqual([server.codeVersion, worker.codeVersion], before);
		assert.equal(await greeter.greet("x"), "v1 x");
	});

	for (const failure of ["rejection", "timeout"] as const) {
		it(`a child vote ${failure} cancels and joins a coordinator open before releasing its reload slot`, async () => {
			const started = latch();
			const cancelled = latch();
			const finishOpen = latch();
			const finishClose = latch();
			const closing = latch();
			const errors: unknown[] = [];
			const server = createHost({ self: {}, name: "server", onError: (error) => errors.push(error) });
			const [down, up] = memoryLinkPair();
			let loseVote = failure === "timeout";
			server.accept(down, { kind: "host", name: "worker", principal: {} });
			const worker = createHost({
				self: {},
				name: "worker",
				upstream: { link: dropping(up, (frame) => loseVote && frame.t === "vote"), principal: {} },
				loader: async (names) => {
					if (names.length > 0) {
						await started.promise;
						if (failure === "rejection") throw new Error("worker rejects preparation");
					}
					return names.map((name) => ({ name: String(name), setup: () => {} }));
				},
				onError: (error) => errors.push(error),
			});
			onTestFinished(async () => {
				finishOpen.open();
				finishClose.open();
				await worker.close();
				await server.close();
			});
			const Store = local(`t.vote-${failure}`, {
				version: 1,
				input: Type.Object({}),
				members: { read: method(undefined, Type.String()) },
			});
			const facet = (candidate: boolean): Facet => ({
				name: "store",
				setup: ({ serve }) =>
					serve(Store, (_input, _principal, self) => {
						if (candidate) {
							self.resource("candidate", {
								version: 1,
								open: async ({ signal }) => {
									started.open();
									signal.addEventListener("abort", cancelled.open, { once: true });
									await cancelled.promise;
									await finishOpen.promise;
									return "candidate";
								},
								close: async () => {
									closing.open();
									await finishClose.promise;
								},
							});
						}
						return { read: () => (candidate ? "new" : "old") };
					}),
			});
			await server.install(facet(false));
			const ref = await server.get(Store, {});
			await tick();
			const before = [server.codeVersion, worker.codeVersion];
			const reloading = server.reload([facet(true)], { remote: { worker: ["candidate"] }, voteDeadline: 100 });
			let settled = false;
			const rejected = assert
				.rejects(reloading, (error) => {
					if (failure === "timeout") return isChordError(error, "aborted") && error.reason === "vote_deadline";
					return isChordError(error, "unavailable") && /worker: .*worker rejects preparation/.test(error.message);
				})
				.then(() => {
					settled = true;
				});
			rejected.catch(() => {});
			await cancelled.promise;
			assert.equal(settled, false);
			assert.equal(await ref.read(), "old");
			await assert.rejects(
				server.reload([]),
				(error) => isChordError(error, "unavailable") && error.reason === "reload_running",
			);
			finishOpen.open();
			await closing.promise;
			assert.equal(settled, false, "late resource cleanup must finish before returning the vote error");
			finishClose.open();
			await rejected;
			assert.deepEqual([server.codeVersion, worker.codeVersion], before);
			loseVote = false;
			await server.reload([facet(false)]);
			assert.equal(await ref.read(), "old");
			assert.deepEqual(errors, []);
		});
	}

	it("a rejected vote waits for an old exclusive close before rollback restores it", async () => {
		const closing = latch();
		const finishClose = latch();
		const aborted = latch();
		const effects: string[] = [];
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: {} });
		const worker = createHost({
			self: {},
			name: "worker",
			upstream: { link: up, principal: {} },
			loader: async () => {
				await closing.promise;
				throw new Error("worker rejects during close");
			},
			onError: () => {},
		});
		onTestFinished(async () => {
			finishClose.open();
			await worker.close();
			await server.close();
		});
		const Store = local("t.rollback-close-race", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const facet = (version: number): Facet => ({
			name: "store",
			setup: ({ serve, signal }) => {
				if (version === 2) signal.addEventListener("abort", aborted.open, { once: true });
				serve(Store, (_input, _principal, self) => {
					const resource = self.resource("exclusive", {
						version,
						exclusive: true,
						open: () => {
							effects.push(`open ${version}`);
							return `value ${version}`;
						},
						close: async () => {
							effects.push(`closing ${version}`);
							closing.open();
							await finishClose.promise;
							effects.push(`closed ${version}`);
						},
					});
					return { read: () => resource.value };
				});
			},
		});
		await server.install(facet(1));
		const ref = await server.get(Store, {});
		await tick();
		const rejected = assert.rejects(
			server.reload([facet(2)], { remote: { worker: ["candidate"] } }),
			/worker rejects during close/,
		);
		rejected.catch(() => {});
		await aborted.promise;
		assert.deepEqual(effects, ["open 1", "closing 1"]);
		await assert.rejects(ref.read(), (error) => isChordError(error, "upgrade_conflict"));
		finishClose.open();
		await rejected;
		assert.equal(
			await ref.read(),
			"value 1",
			"rollback must restore the resource and release its gate before rejecting",
		);
		assert.deepEqual(effects, ["open 1", "closing 1", "closed 1", "open 1"]);
	});

	it("a worker gate blocked past its deadline aborts the whole reload", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.hold(Greeter, { session: "S1" });
		const go = latch();
		const blocker = server.root(async (ctx) => {
			await greeter.greet("g", ctx);
			await go.promise;
		});
		await tick();
		const before = [server.codeVersion, worker.codeVersion];
		const bumped = greeterFacet("v2", { stateVersion: 2 });
		modules.set("greeter", bumped);
		await assert.rejects(server.reload([], { remote: { "session:": ["greeter"] }, gateDeadline: 30 }), (error) => {
			assert.ok(isChordError(error, "aborted") && error.reason === "gate_deadline");
			assert.match(error.message, /session:S1: .*blocking roots: server#\w+:\d+/);
			return true;
		});
		assert.deepEqual([server.codeVersion, worker.codeVersion], before);
		go.open();
		await blocker;
		assert.equal(await greeter.greet("x"), "v1 x");
	});

	it("removes facets from server and workers, reconciles removal tombstones, and clears them on re-add", async () => {
		const { server, worker, modules } = setup();
		onTestFinished(async () => {
			await worker.close();
			await server.close();
		});
		await server.install(greeterFacet("v1"));
		await tick();
		const local = server.hold(ServerGreeter, {});
		const child = server.hold(Greeter, { session: "S1" });
		assert.equal(await local.greet("a"), "v1 a");
		assert.equal(await child.greet("a"), "v1 a");
		await server.reload([], { remove: ["greeter"], remoteRemove: { "session:": ["greeter"] } });
		for (let i = 0; i < 20 && child.status !== "gone"; i++) await tick();
		assert.equal(local.status, "gone");
		assert.equal(child.status, "gone");

		// A child starting with the old set must remove it without trying to import its removed module.
		const cold = createHost({
			self: { kind: "host" },
			name: "session:cold",
			loader: async () => {
				assert.fail("Removed modules must not be imported");
			},
			onError: () => {},
		});
		onTestFinished(() => cold.close());
		await cold.install(greeterFacet("v1"));
		const old = cold.hold(Greeter, { session: "cold" });
		await old.ready;
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { worker: "cold" }, kind: "host", name: "session:cold" });
		cold.connect(up, { principal: { kind: "server" } });
		for (let i = 0; i < 20 && old.status !== "gone"; i++) await tick();
		assert.equal(old.status, "gone");
		assert.equal(cold.codeVersion, server.codeVersion);
		// Close this loader-less child before the addition; it tested only the removal reconciliation.
		await cold.close();
		modules.set("greeter", greeterFacet("v2"));
		await server.reload([greeterFacet("v2")], { remote: { "session:": ["greeter"] } });
		assert.equal(await server.hold(Greeter, { session: "S1" }).greet("b"), "v2 b");
		const fresh = createHost({
			self: { kind: "host" },
			name: "session:fresh",
			loader: async (names) => names.map((name) => modules.get(String(name))!),
			onError: () => {},
		});
		onTestFinished(() => fresh.close());
		await fresh.install(greeterFacet("v1"));
		const [freshDown, freshUp] = memoryLinkPair();
		server.accept(freshDown, { principal: { worker: "fresh" }, kind: "host", name: "session:fresh" });
		fresh.connect(freshUp, { principal: { kind: "server" } });
		assert.equal(await server.hold(Greeter, { session: "fresh" }).greet("c"), "v2 c");
	});

	it("only the server coordinates reloads", async () => {
		const { worker } = setup();
		await tick();
		await assert.rejects(worker.reload([]), (error) => isChordError(error, "unavailable"));
	});

	it("routed native clients reload only local facets and reconnect across independent provider code versions", async () => {
		const errors: unknown[] = [];
		const provider = createHost({ name: "server", self: "server", onError: (error) => errors.push(error) });
		const presentation = createHost({
			name: "presentation",
			kind: "client",
			self: "presentation",
			onError: (error) => errors.push(error),
		});
		onTestFinished(async () => {
			await presentation.close();
			await provider.close();
		});
		const View = local("t.native-client-view", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const viewFacet = (label: string): Facet => ({
			name: "view",
			setup: ({ serve }) => serve(View, () => ({ read: () => label })),
		});
		const providerFacet = (answer: string): Facet => ({
			name: "ping",
			setup: ({ serve }) => serve(Ping, () => ({ variant: "main", ping: () => answer })),
		});
		await provider.install(providerFacet("pong"));
		await presentation.install(viewFacet("before"));
		let [down, up] = memoryLinkPair();
		provider.accept(down, { principal: "presentation", kind: "client" });
		presentation.route("server", {
			authorize: () => true,
			principal: () => "server",
			resolve: async () => up,
		});
		const view = await presentation.get(View, {});
		let ping = await presentation.get(Ping, {});
		assert.equal(await presentation.root((ctx) => view.read(ctx)), "before");
		assert.equal(await presentation.root((ctx) => ping.ping(ctx)), "pong");
		const report = await presentation.reload([viewFacet("after")], { voteDeadline: 100 });
		assert.equal(report.children, undefined, "native providers are not reload participants");
		assert.equal(presentation.codeVersion, 2);
		assert.equal(provider.codeVersion, 1);
		assert.equal(await presentation.root((ctx) => view.read(ctx)), "after");
		assert.equal(await presentation.root((ctx) => ping.ping(ctx)), "pong");
		assert.equal(up.closed, false, "local retirement must not send cluster control to the provider");

		// The provider is behind the client's local code version. Reconnecting must not reconcile it.
		ping.release();
		up.close("reconnect after local reload");
		[down, up] = memoryLinkPair();
		provider.accept(down, { principal: "presentation", kind: "client" });
		ping = await presentation.get(Ping, {});
		assert.equal(await presentation.root((ctx) => ping.ping(ctx)), "pong");
		assert.equal(provider.codeVersion, 1);

		// The provider can also move ahead independently; its hello is not a child's version claim.
		await provider.reload([providerFacet("new pong")]);
		await provider.reload([providerFacet("newest pong")]);
		assert.equal(presentation.codeVersion, 2);
		assert.equal(provider.codeVersion, 3);
		ping.release();
		up.close("reconnect after provider reload");
		[down, up] = memoryLinkPair();
		provider.accept(down, { principal: "presentation", kind: "client" });
		ping = await presentation.get(Ping, {});
		assert.equal(await presentation.root((ctx) => ping.ping(ctx)), "newest pong");
		assert.equal(await presentation.root((ctx) => view.read(ctx)), "after");
		assert.deepEqual(errors, []);
		ping.release();
		view.release();
	});

	it("browsers are not participants: they see shape and reset pushes, or upgrade_required", async () => {
		const { server, modules, down: workerLink } = setup();
		// The route resolves to the already connected worker.
		server.route("session:", {
			authorize: () => true,
			resolve: async () => workerLink,
			principal: (name) => ({ host: name }),
		});
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { guest: "g" } });
		const browser = createHost({
			self: { kind: "host" },
			name: "browser",
			kind: "client",
			upstream: { link: up, principal: { kind: "server" } },
			onError: () => {},
		});
		const viewer = browser.hold(Greeter, { session: "S1" });
		assert.equal(await viewer.greet("a"), "v1 a");
		const shapes: string[] = [];
		viewer.onShape((shape) => shapes.push(shape.contract));
		modules.set("greeter", greeterFacet("v2"));
		await server.reload([], { remote: { "session:": ["greeter"] } });
		for (let i = 0; i < 20 && shapes.length === 0; i++) await tick();
		assert.equal(shapes.length, 1, "one shape push at the commit");
		assert.equal(await viewer.greet("b"), "v2 b");

		modules.set("greeter", {
			name: "greeter",
			setup: (api) => api.serve(GreeterV2, () => ({ variant: "main", hello: (name: string) => `hi ${name}` })),
		});
		await server.reload([], { remote: { "session:": ["greeter"] } });
		for (let i = 0; i < 20 && viewer.status !== "gone"; i++) await tick();
		assert.equal(viewer.status, "gone");
		assert.ok(isChordError(viewer.error, "upgrade_required"));
	});

	it("an abort while a worker is still preparing: a late open closes itself and the worker can reload again", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.hold(Greeter, { session: "S1" });
		await greeter.greet("a");
		const log: string[] = [];
		const go = latch();
		const slow: Facet = {
			name: "greeter",
			setup: (api) =>
				api.serve(Greeter, (_input, _principal, self) => {
					self.resource("late", {
						version: 1,
						open: async () => {
							await go.promise;
							log.push("opened");
						},
						close: () => void log.push("closed"),
					});
					const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
					return { variant: "main", count, greet: (name: string) => `slow ${name}` };
				}),
		};
		modules.set("greeter", slow);
		const codeVersion = worker.codeVersion;
		await assert.rejects(server.reload([], { remote: { "session:": ["greeter"] }, voteDeadline: 50 }), (error) =>
			isChordError(error, "aborted"),
		);
		go.open();
		for (let i = 0; i < 50 && !log.includes("closed"); i++) await tick();
		assert.deepEqual(log, ["opened", "closed"]);
		assert.equal(worker.codeVersion, codeVersion);
		modules.set("greeter", greeterFacet("v3"));
		await server.reload([], { remote: { "session:": ["greeter"] } });
		assert.equal(await greeter.greet("b"), "v3 b");
	});

	it("a child that says hello while a reload runs is reconciled after it, never left in step with the old code", async () => {
		const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
		const loading = latch();
		const server = createHost({
			self: { kind: "host" },
			name: "server",
			onError: () => {},
			loader: async (names) => {
				await loading.promise;
				return names.map((name) => ({ name: String(name), setup: () => {} }));
			},
		});
		onTestFinished(() => server.close());
		const reloading = server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } });
		// The worker connects while the reload loads its modules: it announces the server's current code version.
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
		const worker = createHost({
			self: { kind: "host" },
			name: "session:S1",
			upstream: { link: up, principal: { kind: "server" } },
			loader: async (names) => names.map((name) => modules.get(String(name))!),
			onError: () => {},
		});
		onTestFinished(() => worker.close());
		worker.install(modules.get("greeter")!);
		await tick();
		modules.set("greeter", greeterFacet("v2"));
		loading.open();
		const report = await reloading;
		assert.deepEqual(Object.keys(report.children ?? {}), [], "it was not a participant");
		const greeter = server.hold(Greeter, { session: "S1" });
		assert.equal(await greeter.greet("a"), "v2 a");
		assert.equal(worker.codeVersion, server.codeVersion);
	});

	it("a child keeps the previous code version until its parent retired it (spec 12)", async () => {
		const { server, worker, modules } = setup();
		await tick();
		const greeter = server.hold(Greeter, { session: "S1" });
		assert.equal(await greeter.greet("a"), "v1 a");
		const first = server.codeVersion;
		const go = latch();
		// A server root of the first code version that calls the worker only after the next two reloads started.
		const pinned = server.root(async (ctx) => {
			await go.promise;
			return greeter.greet("p", ctx);
		});
		modules.set("greeter", greeterFacet("v2"));
		await server.reload([], { remote: { "session:": ["greeter"] } });
		assert.equal(worker.previousCodeVersion, first);
		const second = server.reload([], { remote: { "session:": [] }, retireDeadline: 2000 });
		await tick();
		await tick();
		// The server still waits for its root, so the worker must not have retired that code version.
		assert.equal(worker.previousCodeVersion, first);
		go.open();
		assert.equal(await pinned, "v1 p");
		await second;
		assert.equal(server.previousCodeVersion, undefined);
	});

	it("a child reconciled after its parent retired old code versions may retire its own previous one at once", async () => {
		const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		onTestFinished(() => server.close());
		const plugin = (): Facet => ({ name: "server-plugin", setup: () => {} });
		server.install(plugin());
		await server.reload([plugin()]);
		await server.reload([plugin()]);
		assert.equal(server.previousCodeVersion, undefined);
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
		const worker = createHost({
			self: { kind: "host" },
			name: "session:S1",
			upstream: { link: up, principal: { kind: "server" } },
			loader: async (names) => names.map((name) => modules.get(String(name))!),
			onError: () => {},
		});
		onTestFinished(() => worker.close());
		worker.install(modules.get("greeter")!);
		for (let i = 0; i < 50 && worker.codeVersion !== server.codeVersion; i++) await tick();
		assert.equal(worker.codeVersion, server.codeVersion);
		// Without the parent's retire watermark it would keep code version 1 until the parent's next retirement.
		for (let i = 0; i < 20 && worker.previousCodeVersion !== undefined; i++) await tick();
		assert.equal(worker.previousCodeVersion, undefined);
		// And the next cluster reload does not wait for a retirement the parent will never announce.
		const started = Date.now();
		await server.reload([], { remote: { "session:": ["greeter"] }, retireDeadline: 10_000 });
		assert.ok(Date.now() - started < 2000);
	});

	for (const parentFirst of [false, true]) {
		it(`a reconciliation overlapping a reload converges when the ${parentFirst ? "parent" : "child"} finishes first`, async () => {
			const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
			const serverLoading = latch();
			let blockServer = false;
			const server = createHost({
				self: { kind: "host" },
				name: "server",
				onError: () => {},
				loader: async (names) => {
					if (blockServer) await serverLoading.promise;
					return names.map((name) => ({ name: String(name), setup: () => {} }));
				},
			});
			onTestFinished(() => server.close());
			server.install({ name: "server-plugin", setup: () => {} });
			await server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } });
			// The worker connects behind: its reconciliation to code version 2 waits in the worker's module loading.
			const workerLoading = latch();
			let blockWorker = true;
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
			const worker = createHost({
				self: { kind: "host" },
				name: "session:S1",
				upstream: { link: up, principal: { kind: "server" } },
				loader: async (names) => {
					if (blockWorker) await workerLoading.promise;
					return names.map((name) => modules.get(String(name))!);
				},
				onError: () => {},
			});
			onTestFinished(() => worker.close());
			worker.install(modules.get("greeter")!);
			await tick();
			// A reload starts before the reconciliation committed; the worker is not one of its participants.
			blockServer = true;
			modules.set("greeter", greeterFacet("v2"));
			const reloading = server.reload(["server-plugin"], { remote: { "session:": ["greeter"] } });
			if (parentFirst) {
				serverLoading.open();
				await reloading;
				assert.equal(worker.codeVersion, 1);
				blockWorker = false;
				workerLoading.open();
			} else {
				blockWorker = false;
				workerLoading.open();
				for (let i = 0; i < 50 && worker.codeVersion !== 2; i++) await tick();
				assert.equal(worker.codeVersion, 2);
				serverLoading.open();
			}
			const report = await reloading;
			assert.deepEqual(Object.keys(report.children ?? {}), []);
			assert.equal(report.codeVersion, 3);
			const greeter = server.hold(Greeter, { session: "S1" });
			assert.equal(await greeter.greet("a"), "v2 a");
			assert.equal(worker.codeVersion, server.codeVersion);
			assert.equal(up.closed, false);
		});
	}

	it("a child behind whose hello waits for a running reload is fenced at once: its calls up are admitted (spec 9)", async () => {
		const pingFacet: Facet = {
			name: "ping",
			setup: (api) => api.serve(Ping, () => ({ variant: "main", ping: () => "pong" })),
		};
		const loading = latch();
		const server = createHost({
			self: { kind: "host" },
			name: "server",
			onError: () => {},
			loader: async (names) => {
				await loading.promise;
				return names.map((name) => ({ name: String(name), setup: () => {} }));
			},
		});
		onTestFinished(() => server.close());
		server.install(pingFacet);
		await server.reload([pingFacet]);
		assert.equal(server.previousCodeVersion, undefined, "code version 1 is retired");
		const reloading = server.reload(["server-plugin"], { remote: { "session:": [] } });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
		const worker = createHost({
			self: { kind: "host" },
			name: "session:S1",
			upstream: { link: up, principal: { kind: "server" } },
			onError: () => {},
		});
		onTestFinished(() => worker.close());
		// While the server's reload still loads its modules, a worker root (code version 1) calls the server.
		const answer = await worker.root(async (ctx) => (await ctx.get(Ping, {})).ping(ctx));
		assert.equal(answer, "pong");
		loading.open();
		await reloading;
		for (let i = 0; i < 50 && worker.codeVersion !== server.codeVersion; i++) await tick();
		assert.equal(worker.codeVersion, server.codeVersion);
	});

	it("a reconnecting child behind its parent, still retaining its previous code version, reconciles without waiting out the retire deadline", async () => {
		const modules = new Map<string, Facet>([["greeter", greeterFacet("v1")]]);
		const loader: FacetLoader = async (names) => names.map((name) => modules.get(String(name))!);
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		onTestFinished(() => server.close());
		const [down, up] = memoryLinkPair();
		// The `retire` frame is lost: the worker keeps code version 1, not permitted to retire it.
		server.accept(
			dropping(down, (frame) => frame.t === "retire"),
			{ principal: { worker: "w" }, kind: "host", name: "session:S1" },
		);
		const worker = createHost({
			self: { kind: "host" },
			name: "session:S1",
			upstream: { link: up, principal: { kind: "server" } },
			loader,
			onError: () => {},
		});
		onTestFinished(() => worker.close());
		worker.install(modules.get("greeter")!);
		await tick();
		modules.set("greeter", greeterFacet("v2"));
		await server.reload([], { remote: { "session:": ["greeter"] } });
		await tick();
		assert.equal(worker.previousCodeVersion, 1);
		up.close("gone");
		await tick();
		// The server moves on while the worker is away, then the worker reconnects behind it.
		modules.set("greeter", greeterFacet("v3"));
		await server.reload([{ name: "server-plugin", setup: () => {} }]);
		const [down2, up2] = memoryLinkPair();
		server.accept(down2, { principal: { worker: "w" }, kind: "host", name: "session:S1" });
		const started = Date.now();
		worker.connect(up2, { principal: { kind: "server" } });
		for (let i = 0; i < 400 && worker.codeVersion !== server.codeVersion; i++)
			await new Promise((resolve) => setTimeout(resolve, 5));
		assert.equal(worker.codeVersion, server.codeVersion);
		assert.ok(Date.now() - started < 2000, `reconciled after ${Date.now() - started} ms`);
	});

	it("forced retirement cancels a browser call relayed to a worker before the server closes the old code's resources", async () => {
		const log: string[] = [];
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		onTestFinished(() => server.close());
		const [down, up] = memoryLinkPair();
		const worker = createHost({
			self: { kind: "host" },
			name: "session:S1",
			upstream: { link: up, principal: { kind: "server" } },
			onError: () => {},
		});
		onTestFinished(() => worker.close());
		const never = latch();
		const Slow = remote("t.cluster-slow", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("session:S1"),
			variants: { main: { methods: { wait: method() } } },
		});
		worker.serve(Slow, () => ({
			variant: "main",
			wait: async (ctx: Ctx) => {
				ctx.signal.addEventListener("abort", () => log.push("worker aborted"));
				await never.promise;
			},
		}));
		// Records the cancel the server sends down: the guarantee is that it leaves before the old resources close.
		const watched = dropping(down, (frame) => {
			if (frame.t === "cancel") log.push("cancel sent");
			return false;
		});
		server.route("session:", {
			authorize: () => true,
			resolve: async () => watched,
			principal: (name) => ({ host: name }),
		});
		const Store = local("t.cluster-store", { version: 1, input: Type.Object({}) });
		const storeFacet = (version: number): Facet => ({
			name: "store",
			setup: (api) =>
				api.serve(
					Store,
					(_input, _principal, self) => {
						self.resource("conn", {
							version,
							open: () => ({}),
							close: () => void log.push(`server closes ${version}`),
						});
						return {};
					},
					{ lifetime: "host" },
				),
		});
		await server.install(storeFacet(1));
		const [browserDown, browserUp] = memoryLinkPair();
		server.accept(browserDown, { principal: { guest: "g" } });
		const browser = createHost({
			self: { kind: "host" },
			name: "browser",
			kind: "client",
			upstream: { link: browserUp, principal: { kind: "server" } },
			onError: () => {},
		});
		onTestFinished(() => browser.close());
		// The relayed call's root runs on the server's code version 1.
		const call = browser.hold(Slow, {}).wait();
		call.catch(() => {});
		for (let i = 0; i < 50 && log.length === 0 && !worker.codeVersion; i++) await tick();
		await new Promise((resolve) => setTimeout(resolve, 10));
		await server.reload([storeFacet(2)]);
		await server.reload([storeFacet(3)], { retireDeadline: 20 });
		const settled = await Promise.race([
			call.then(
				() => "resolved",
				() => "rejected",
			),
			new Promise((resolve) => setTimeout(() => resolve("pending"), 2000)),
		]);
		assert.equal(settled, "rejected", "the browser's call is cancelled with its root");
		for (let i = 0; i < 50 && !log.includes("worker aborted"); i++) await tick();
		assert.deepEqual(
			log.filter((entry) => entry === "cancel sent" || entry === "server closes 1"),
			["cancel sent", "server closes 1"],
		);
		assert.ok(log.includes("worker aborted"));
		never.open();
	});
});

describe("cluster commit boundaries", () => {
	it("back-to-back remote-only reloads release the child reload slot synchronously", async () => {
		const { server, worker, modules } = setup();
		onTestFinished(async () => {
			await worker.close();
			await server.close();
		});
		await tick();
		const ref = server.hold(Greeter, { session: "S1" });
		assert.equal(await ref.greet("start"), "v1 start");
		modules.set("greeter", greeterFacet("v2"));
		await server.reload([], { remote: { "session:": ["greeter"] } });
		modules.set("greeter", greeterFacet("v3"));
		await server.reload([], { remote: { "session:": ["greeter"] } });
		assert.equal(await ref.greet("end"), "v3 end");
		assert.equal(worker.codeVersion, server.codeVersion);
	});

	it("a terminal coordinator install failure never sends abort after commit", async () => {
		const frames: Frame[] = [];
		const server = createHost({ self: {}, name: "server", onError: () => {} });
		const [down, up] = memoryLinkPair();
		server.accept(
			dropping(down, (frame) => {
				frames.push(frame);
				return false;
			}),
			{ kind: "host", name: "worker", principal: {} },
		);
		const worker = createHost({ self: {}, name: "worker", upstream: { link: up, principal: {} }, onError: () => {} });
		onTestFinished(async () => {
			await worker.close();
			await server.close();
		});
		const own = local("commit.terminal", {
			version: 1,
			input: Type.Object({}),
			members: { ping: method(undefined, Type.String()) },
		});
		const facet: Facet = {
			name: "terminal",
			setup(api) {
				api.serve(own, () => ({ ping: () => "ok" }));
			},
		};
		await server.install(facet);
		const ref = await server.get(own, {});
		await tick();
		const internal = server as unknown as { objects: Map<string, { startTasks(): void }> };
		for (const object of internal.objects.values())
			object.startTasks = () => {
				throw new Error("post-commit start failure");
			};
		await assert.rejects(server.reload([facet]), /post-commit start failure/);
		await tick();
		assert.deepEqual(
			frames.filter((frame) => frame.t === "commit" || frame.t === "abort").map((frame) => frame.t),
			["commit"],
		);
		assert.equal(worker.codeVersion, server.codeVersion);
		await assert.rejects(ref.ping(), (error) => isChordError(error, "unavailable") && error.reason === "host_failed");
	});

	for (const fail of [false, true]) {
		it(`child commit ${fail ? "fails closed on invalid" : "refreshes valid"} state changed after its vote`, async () => {
			const server = createHost({ self: {}, name: "server", onError: () => {} });
			const effects: string[] = [];
			const gated = local("commit.gated", { version: 1, input: Type.Object({}) });
			const changed = remote("commit.changed", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("worker"),
				variants: {
					main: { state: { doubled: Type.Number() }, methods: { set: method(Type.Number()) } },
				},
			});
			const childFacet = (candidate: boolean): Facet => ({
				name: "changed",
				setup(api) {
					api.serve(changed, (_input, _principal, self) => {
						const n = self.state("n", Type.Number(), 1);
						return {
							variant: "main",
							doubled: self.derive([n], (value) => {
								if (candidate && fail && value === 2) throw new Error("child commit preflight failed");
								return value * 2;
							}),
							set(value, ctx) {
								n.replace(ctx, value);
							},
						};
					});
					api.serve(gated, (_input, _principal, self) => {
						self.resource("exclusive", {
							version: candidate ? 2 : 1,
							exclusive: true,
							open: () => {
								effects.push(candidate ? "open-new" : "open-old");
							},
							close: () => {
								effects.push(candidate ? "close-new" : "close-old");
							},
						});
						self.task(async () => {
							effects.push(candidate ? "task-new" : "task-old");
						});
						return {};
					});
				},
			});
			const voted = Promise.withResolvers<void>(),
				resume = Promise.withResolvers<void>();
			const errors: unknown[] = [];
			const [down, up] = memoryLinkPair();
			server.accept(down, { kind: "host", name: "worker", principal: {} });
			const worker = createHost({
				self: {},
				name: "worker",
				loader: async () => [childFacet(true)],
				upstream: {
					link: dropping(up, (frame) => {
						if (frame.t === "vote") voted.resolve();
						return false;
					}),
					principal: {},
				},
				onError: (error) => {
					errors.push(error);
				},
			});
			onTestFinished(async () => {
				resume.resolve();
				await worker.close();
				await server.close();
			});
			const blocked = local("commit.blocked", { version: 1, input: Type.Object({}) });
			const parentFacet = (candidate: boolean): Facet => ({
				name: "blocked",
				setup(api) {
					api.serve(blocked, (_input, _principal, self) => {
						if (candidate) self.resource("wait", { version: 1, open: () => resume.promise });
						return {};
					});
				},
			});
			await worker.install(childFacet(false));
			await server.install(parentFacet(false));
			const ref = await worker.get(changed, {});
			await worker.get(gated, {});
			await server.get(blocked, {});
			await tick();
			const reloading = server.reload([parentFacet(true)], { remote: { worker: ["changed"] } });
			await voted.promise;
			await ref.set(2);
			const atVote = effects.length;
			resume.resolve();
			await reloading;
			await tick();
			if (fail) {
				assert.equal(up.closed, true);
				assert.ok(errors.some((error) => String(error).includes("child commit preflight failed")));
				await worker.close();
				assert.deepEqual(effects.slice(atVote), ["close-new"]);
				await assert.rejects(ref.set(3), (error) => isChordError(error, "gone"));
			} else {
				assert.equal(ref.doubled.value, 4);
				assert.equal(worker.codeVersion, server.codeVersion);
				assert.deepEqual(errors, []);
			}
		});
	}
});

describe("child rollback completion", () => {
	for (const phase of ["loading", "preparing", "prepared", "failed-prepare"] as const) {
		it(`acknowledges abort only after ${phase} work releases the reload slot`, async () => {
			const loading = latch();
			const entered = latch();
			const finishOpen = latch();
			const closing = latch();
			const finishClose = latch();
			const frames: Frame[] = [];
			const [parent, up] = memoryLinkPair();
			parent.receive((frame) => {
				frames.push(frame);
				if (frame.t === "prepared") parent.send({ t: "advance", reload: frame.reload, phase: frame.phase });
			});
			const Store = local(`t.abort-ack-${phase}`, {
				version: 1,
				input: Type.Object({}),
				members: { read: method(undefined, Type.String()) },
			});
			const candidate: Facet = {
				name: "store",
				setup: ({ serve }) =>
					serve(Store, (_input, _principal, self) => {
						self.resource("candidate", {
							version: 1,
							open: async () => {
								entered.open();
								if (phase === "preparing") await finishOpen.promise;
								if (phase === "failed-prepare") throw new Error("prepare failed");
								return "candidate";
							},
							close: async () => {
								closing.open();
								await finishClose.promise;
							},
						});
						return { read: () => "new" };
					}),
			};
			const worker = createHost({
				name: "worker",
				self: "host",
				upstream: { link: up, principal: "parent" },
				loader: async () => {
					if (phase === "loading") {
						entered.open();
						await loading.promise;
					}
					return [candidate];
				},
				onError: () => {},
			});
			onTestFinished(async () => {
				loading.open();
				finishOpen.open();
				finishClose.open();
				await worker.close();
			});
			parent.send({ t: "hello", protocol: PROTOCOL_VERSION, name: "parent", kind: "host", codeVersion: 1 });
			await worker.install({ name: "store", setup: ({ serve }) => serve(Store, () => ({ read: () => "old" })) });
			const ref = await worker.get(Store, {});
			parent.send({
				t: "prepare",
				reload: 100,
				transaction: "test:100",
				participants: ["parent", "worker"],
				codeVersion: 2,
				plugins: ["store"],
				options: {},
			});
			await entered.promise;
			if (phase === "prepared" || phase === "failed-prepare") {
				for (let i = 0; i < 50 && !frames.some((frame) => frame.t === "vote" && frame.reload === 100); i++)
					await tick();
				assert.ok(
					frames.some(
						(frame) =>
							frame.t === "vote" &&
							frame.reload === 100 &&
							(phase === "prepared" ? frame.error === undefined : frame.error !== undefined),
					),
				);
			}
			parent.send({ t: "abort", reload: 100 });
			if (phase !== "failed-prepare") {
				await tick();
				assert.equal(
					frames.some((frame) => frame.t === "aborted" && frame.reload === 100),
					false,
				);
			}
			loading.open();
			finishOpen.open();
			if (phase === "preparing" || phase === "prepared") {
				await closing.promise;
				assert.equal(
					frames.some((frame) => frame.t === "aborted" && frame.reload === 100),
					false,
				);
			}
			finishClose.open();
			for (let i = 0; i < 50 && !frames.some((frame) => frame.t === "aborted" && frame.reload === 100); i++)
				await tick();
			assert.ok(frames.some((frame) => frame.t === "aborted" && frame.reload === 100));
			assert.equal(await ref.read(), "old");
			parent.send({
				t: "prepare",
				reload: 101,
				transaction: "test:101",
				participants: ["parent", "worker"],
				codeVersion: 3,
				plugins: ["store"],
				options: {},
			});
			for (let i = 0; i < 50 && !frames.some((frame) => frame.t === "vote" && frame.reload === 101); i++)
				await tick();
			const next = frames.find((frame) => frame.t === "vote" && frame.reload === 101);
			assert.ok(next?.t === "vote");
			if (phase === "failed-prepare") assert.match(next.error?.message ?? "", /prepare failed/);
			else assert.equal(next.error, undefined);
			parent.send({ t: "abort", reload: 101 });
		});
	}

	it("rejects rollback acknowledgements from a client", async () => {
		const server = createHost({ name: "server", self: "host", onError: () => {} });
		const [down, client] = memoryLinkPair();
		server.accept(down, { principal: "guest" });
		client.receive(() => {});
		let reason = "";
		client.onClose((value) => {
			reason = value;
		});
		client.send({ t: "hello", protocol: PROTOCOL_VERSION, name: "client", kind: "client", codeVersion: 0 });
		client.send({ t: "aborted", reload: 1 });
		for (let i = 0; i < 50 && !client.closed; i++) await tick();
		assert.equal(reason, "protocol error: aborted from a non-participant");
		await server.close();
	});

	for (const failure of ["disconnect", "timeout"] as const) {
		it(`ends reconciliation on rollback acknowledgement ${failure} without retaining waiters`, async () => {
			if (failure === "timeout") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			const errors: unknown[] = [];
			const server = createHost({ name: "server", self: "host", onError: (error) => errors.push(error) });
			onTestFinished(async () => {
				vi.useRealTimers();
				await server.close();
			});
			await server.reload([{ name: "noop", setup: () => {} }]);
			const [down, child] = memoryLinkPair();
			const frames: Frame[] = [];
			child.receive((frame) => frames.push(frame));
			server.accept(down, { kind: "host", name: "worker", principal: "worker" });
			child.send({ t: "hello", protocol: PROTOCOL_VERSION, name: "worker", kind: "host", codeVersion: 1 });
			for (let i = 0; i < 50 && !frames.some((frame) => frame.t === "prepare"); i++) await tick();
			const first = frames.find((frame) => frame.t === "prepare");
			assert.ok(first?.t === "prepare");
			await server.reload([{ name: "noop", setup: () => {} }]);
			child.send({ t: "vote", reload: first.reload });
			child.send({ t: "prepared", reload: first.reload, phase: "declared" });
			child.send({ t: "prepared", reload: first.reload, phase: "materialized" });
			for (let i = 0; i < 50 && !frames.some((frame) => frame.t === "abort"); i++) await tick();
			assert.ok(frames.some((frame) => frame.t === "abort"));
			const internal = server as unknown as { connections: Set<{ abortions: Map<number, unknown> }> };
			const connection = [...internal.connections][0]!;
			assert.equal(connection.abortions.size, 1);
			if (failure === "disconnect") child.close("lost during rollback");
			else await vi.advanceTimersByTimeAsync(30_000);
			for (let i = 0; i < 50 && errors.length === 0; i++) await tick();
			assert.equal(connection.abortions.size, 0);
			assert.equal(child.closed, true);
			assert.ok(errors.some((error) => isChordError(error, failure === "timeout" ? "aborted" : "unavailable")));
			assert.equal(frames.filter((frame) => frame.t === "prepare").length, 1);
		});
	}
});
