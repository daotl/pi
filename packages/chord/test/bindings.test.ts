// Entry 8: one shared binding per host and key; a hold implies the state of its variant (units: shape, then
// snapshots); method-only references; origins of client holds; versioned call projection metadata.
import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { HostImpl } from "../src/host.ts";
import {
	type Ctx,
	createHost,
	type FacetApi,
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
	type Ref,
	remote,
} from "../src/index.ts";
import { CountingLink, stateFrames } from "./fixtures/counting.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, attempts = 200): Promise<void> {
	for (let i = 0; i < attempts && !check(); i++) await sleep(2);
	assert.ok(check(), "condition not reached");
}

const NoteSchema = Type.Array(Type.String());
const Notes = remote("t.e8-notes", {
	version: 1,
	input: Type.Object({ list: Type.Optional(Type.String({ default: "main" })) }),
	host: hostNamed("server"),
	variants: {
		main: {
			state: { notes: NoteSchema, title: Type.String() },
			methods: { add: method(Type.String()), rename: method(Type.String()) },
		},
	},
});

function serveNotes(host: Host): void {
	host.serve(Notes, (_input, _principal, self) => {
		const notes = self.state("notes", NoteSchema, []);
		const title = self.state("title", Type.String(), "untitled");
		return {
			variant: "main",
			notes,
			title,
			add: (text: string, ctx: Ctx) => {
				notes.change(ctx, (draft) => {
					draft.push(text);
				});
			},
			rename: (text: string, ctx: Ctx) => {
				title.replace(ctx, text);
			},
		};
	});
}

/** A server serving `Notes`, and a browser whose end of the link counts what crosses it. */
function setup(
	options: { readonly window?: number; readonly linger?: { types?: Record<string, number>; cap?: number } } = {},
) {
	const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
	serveNotes(server);
	const [down, up] = memoryLinkPair();
	server.accept(down, {
		principal: { user: "u" },
		...(options.window === undefined ? {} : { window: options.window }),
	});
	const link = new CountingLink(up);
	const errors: unknown[] = [];
	const browser = createHost({
		self: { kind: "host" },
		name: "browser",
		kind: "client",
		upstream: { link, principal: { kind: "server" } },
		onError: (error) => errors.push(error),
		...(options.linger === undefined ? {} : { linger: options.linger }),
	});
	return { server, browser, link, errors };
}

describe("shared bindings: traffic", () => {
	it("N references to one object: one hold, one snapshot per member, one frame per change, one release", async () => {
		const { server, browser, link } = setup();
		const Panel = local("t.e8-panel", { version: 1, input: Type.Object({}), members: { count: Type.Number() } });
		browser.serve(Panel, (_input, _principal, self) => {
			const notes = self.get(Notes, {});
			return { count: self.derive([notes.notes], (list) => list.length) };
		});
		const a = browser.hold(Notes, {});
		const b = browser.hold(Notes, { list: "main" });
		const panel = browser.hold(Panel, {});
		await Promise.all([a.ready, b.ready, panel.ready]);
		const viaCtx = await browser.root(async (ctx) => {
			const ref = await ctx.get(Notes, {});
			return ref.title.value;
		});
		assert.equal(viaCtx, "untitled");
		assert.equal(link.count("sent", "hold"), 1, "one hold for every reference");
		const snaps = stateFrames(link.received).filter((frame) => frame.as === "snap");
		assert.deepEqual(snaps.map((frame) => frame.m).sort(), ["notes", "title"]);

		const before = stateFrames(link.received).length;
		await a.add("milk");
		await until(() => a.notes.value.length === 1 && b.notes.value.length === 1 && panel.count.value === 1);
		await tick();
		assert.equal(stateFrames(link.received).length - before, 1, "one delta frame for one change, whatever N");

		const sent = link.traffic("sent").length;
		a.release();
		panel.release();
		await sleep(5);
		assert.equal(link.traffic("sent").length, sent, "releasing all but one reference sends nothing");
		b.release();
		await until(() => link.count("sent", "release") === 1);
		await browser.close();
		await server.close();
	});

	it("a held reference stays subscribed without listeners; values are readable at once after ready", async () => {
		const { server, browser } = setup();
		const notes = browser.hold(Notes, {});
		await notes.ready;
		assert.deepEqual(notes.notes.value, []);
		await notes.add("bread");
		await until(() => notes.notes.value.length === 1);
		assert.equal(notes.title.value, "untitled");
		await browser.close();
		await server.close();
	});
});

describe("shared bindings: linger", () => {
	it("a lingering binding keeps its hold and state; a reference taken meanwhile costs nothing on the link", async () => {
		const { server, browser, link } = setup({ linger: { types: { [Notes.name]: 40 } } });
		const first = await browser.get(Notes, {});
		const frames = link.traffic("received").length;
		first.release();
		await sleep(10);
		assert.equal(link.count("sent", "release"), 0, "not released before the linger");
		// A hook mounting and unmounting: no frames either way.
		for (let i = 0; i < 3; i++) {
			const again = await browser.get(Notes, {});
			assert.deepEqual(again.notes.value, []);
			again.release();
		}
		assert.equal(link.count("sent", "hold"), 1);
		assert.equal(link.traffic("received").length, frames, "nothing new crossed the link");
		await until(() => link.count("sent", "release") === 1);
		await browser.close();
		await server.close();
	});

	it("at most `cap` bindings linger: the least recently released goes first", async () => {
		const { server, browser, link } = setup({ linger: { types: { [Notes.name]: 10_000 }, cap: 1 } });
		const a = await browser.get(Notes, { list: "a" });
		const b = await browser.get(Notes, { list: "b" });
		a.release();
		await sleep(5);
		assert.equal(link.count("sent", "release"), 0);
		b.release();
		await until(() => link.count("sent", "release") === 1);
		const release = link.sent.find((frame) => frame.t === "release");
		const holdOfA = link.sent.find((frame) => frame.t === "hold" && (frame.input as { list: string }).list === "a");
		assert.equal(release?.t === "release" ? release.id : 0, holdOfA?.t === "hold" ? holdOfA.id : -1);
		await browser.close();
		await server.close();
	});
});

describe("shared bindings: identity", () => {
	it("normalized-equal inputs and equal principal keys share; other principals and fingerprints do not", async () => {
		const server = createHost({
			self: { kind: "host" },
			name: "server",
			onError: () => {},
		});
		const NotesV2 = remote("t.e8-notes", {
			version: 2,
			input: Type.Object({ list: Type.Optional(Type.String({ default: "main" })) }),
			host: hostNamed("server"),
			variants: {
				main: {
					state: { notes: NoteSchema, title: Type.String() },
					methods: { add: method(Type.String()), rename: method(Type.String()), clear: method() },
				},
			},
		});
		server.serve(
			NotesV2,
			(_input, _principal, self) => {
				const notes = self.state("notes", NoteSchema, []);
				const title = self.state("title", Type.String(), "untitled");
				return { variant: "main", notes, title, add: () => {}, rename: () => {}, clear: () => {} };
			},
			{ accepts: { 1: (current) => current } },
		);
		// A worker holds the server's objects; the principals it forwards key its bindings.
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { worker: "w" }, kind: "host", name: "session:w" });
		const link = new CountingLink(up);
		const worker = createHost<unknown>({
			self: { kind: "host" },
			name: "session:w",
			upstream: { link, principal: { kind: "server" } },
			onError: () => {},
		});
		const refs = [
			worker.hold(Notes, {}),
			worker.hold(Notes, { list: "main" }),
			worker.hold(Notes, {}, { principal: { user: "a", grant: 1 } }),
			worker.hold(Notes, {}, { principal: { grant: 1, user: "a" } }),
			worker.hold(Notes, {}, { principal: { user: "a", grant: 2 } }),
			worker.hold(NotesV2, {}),
		];
		await Promise.all(refs.map((ref) => ref.ready));
		// host (shared by two inputs), user a grant 1 (shared by two key orders), user a grant 2, the v2 contract.
		assert.equal(link.count("sent", "hold"), 4);
		await worker.close();
		await server.close();
	});
});

describe("hydration over a link", () => {
	const Matrix = remote("t.e8-matrix", {
		version: 1,
		input: Type.Object({ variant: Type.String() }),
		host: hostNamed("server"),
		variants: {
			values: { state: { none: Type.Null(), empty: Type.Array(Type.String()), maybe: Type.Unknown() } },
			bare: { methods: { ping: method(undefined, Type.String()) } },
			broken: { state: { n: Type.Number() } },
		},
	});
	const disposedVariants: string[] = [];

	function serveMatrix(host: Host): void {
		host.serve(Matrix, ({ variant }, _principal, self) => {
			self.resource("cleanup", {
				version: 1,
				open: () => {},
				close: () => {
					disposedVariants.push(variant);
				},
			});
			if (variant === "bare") return { variant: "bare", ping: () => "pong" };
			if (variant === "broken") {
				const source = self.state("source", Type.String(), "not a number");
				// A derivation exposed under a number schema: its snapshot fails validation.
				return { variant: "broken", n: self.derive([source], (text) => text as unknown as number) };
			}
			const none = self.state("none", Type.Null(), null);
			const empty = self.state("empty", Type.Array(Type.String()), []);
			return { variant: "values", none, empty, maybe: self.derive([none], () => undefined as unknown) };
		});
	}

	it("null, empty and undefined values hydrate; a state-free variant is ready; a failed snapshot rejects", async () => {
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		serveMatrix(server);
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: { user: "u" } });
		const browser = createHost({
			self: { kind: "host" },
			name: "browser",
			kind: "client",
			upstream: { link: up, principal: { kind: "server" } },
			onError: () => {},
		});
		const values = await browser.get(Matrix, { variant: "values" });
		assert.ok(values.variant === "values");
		assert.equal(values.none.value, null);
		assert.deepEqual(values.empty.value, []);
		assert.equal(values.maybe.value, undefined);
		const bare = await browser.get(Matrix, { variant: "bare" });
		assert.ok(bare.variant === "bare");
		assert.equal(await bare.ping(), "pong");
		assert.throws(
			// @ts-expect-error `none` is not a member of the bare variant (a narrowed reference does not show it).
			() => bare.none.value,
			(error) => isChordError(error, "not_in_variant"),
		);
		const broken = browser.hold(Matrix, { variant: "broken" });
		await assert.rejects(broken.ready, (error) => isChordError(error, "invalid"));
		assert.equal(broken.status, "gone");
		await until(() => disposedVariants.includes("broken"));
		await browser.close();
		await server.close();
	});

	it("derived undefined transitions reset both local and remote streams without becoming null", async () => {
		const { server, browser, link } = setup();
		const Maybe = remote("t.derived-undefined", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { state: { value: Type.Unknown() }, methods: { set: method(Type.Number()) } } },
		});
		server.serve(Maybe, (_input, _principal, self) => {
			const source = self.state("source", Type.Number(), 1);
			return {
				variant: "main",
				value: self.derive([source], (value) => (value < 0 ? undefined : value)),
				set: (value, ctx) => source.replace(ctx, value),
			};
		});
		try {
			const localRef = await server.get(Maybe, {}, { principal: { user: "u" } });
			const remoteRef = await browser.get(Maybe, {});
			const localEvents: string[] = [],
				remoteEvents: string[] = [];
			const remoteValues: unknown[] = [];
			localRef.value.events((event) => localEvents.push(event.type));
			remoteRef.value.events((event) => remoteEvents.push(event.type));
			remoteRef.value.subscribe((value) => remoteValues.push(value));
			for (const value of [-1, -2, 2, 3]) {
				await remoteRef.set(value);
				await until(() => Object.is(remoteRef.value.value, value < 0 ? undefined : value));
				assert.equal(localRef.value.value, remoteRef.value.value);
			}
			await tick();
			assert.deepEqual(localEvents, ["snap", "reset", "reset", "ops"]);
			assert.deepEqual(remoteEvents, localEvents);
			assert.deepEqual(remoteValues, [1, undefined, 2, 3]);
			assert.deepEqual(
				stateFrames(link.received)
					.filter((frame) => frame.m === "value")
					.map((frame) => frame.as),
				["snap", "reset", "reset", "ops"],
			);
		} finally {
			await browser.close();
			await server.close();
		}
	});

	it("reading before the first hydration throws not_ready", async () => {
		const { server, browser } = setup();
		const notes = browser.hold(Notes, {});
		assert.throws(
			() => notes.notes.value,
			(error) => isChordError(error, "not_ready"),
		);
		await notes.ready;
		assert.deepEqual(notes.notes.value, []);
		await browser.close();
		await server.close();
	});
});

describe("method-only references (state: false)", () => {
	it("transfer no state alone; a full reference joining starts it once; its release stops it", async () => {
		const { server, browser, link } = setup();
		const caller = browser.hold(Notes, {}, { state: false });
		await caller.ready;
		await caller.add("x");
		const hold = link.sent.find((frame) => frame.t === "hold");
		assert.ok(hold?.t === "hold" && hold.state === false);
		assert.deepEqual(stateFrames(link.received), []);
		assert.throws(
			() => caller.notes.value,
			(error) => isChordError(error, "not_ready"),
		);

		const viewer = browser.hold(Notes, {});
		await viewer.ready;
		assert.deepEqual(viewer.notes.value, ["x"]);
		assert.equal(link.count("sent", "sub"), 1);
		assert.equal(link.count("sent", "hold"), 1, "the same hold");
		viewer.release();
		await until(() => link.count("sent", "unsub") === 1);
		const after = stateFrames(link.received).length;
		await caller.add("y");
		await sleep(5);
		assert.equal(stateFrames(link.received).length, after, "no state once only method-only references remain");
		await browser.close();
		await server.close();
	});

	it("object-owned views replace changed state requirements on reload and retire the previous view", async () => {
		const { server, browser, link } = setup();
		const Panel = local("t.e8-reload-panel", {
			version: 1,
			input: Type.Object({}),
			members: { title: Type.String(), add: method(Type.String()) },
		});
		const views: Ref<typeof Notes>[] = [];
		const facet = (state: boolean) => ({
			name: "panel",
			setup: (api: FacetApi) => {
				api.serve(Panel, (_input, _principal, self) => {
					const notes = self.get(Notes, {}, { state });
					views.push(notes);
					return {
						title: state
							? self.derive([notes.title], (title) => title.toUpperCase())
							: self.state("off", Type.String(), "off"),
						add: (text: string, ctx: Ctx) => notes.add(text, ctx),
					};
				});
			},
		});
		try {
			await browser.install(facet(false));
			const panel = await browser.get(Panel, {});
			assert.equal(panel.title.value, "off");
			assert.deepEqual(stateFrames(link.received), []);
			await panel.add("before");
			await browser.reload([facet(true)]);
			assert.equal(views.length, 2, "the consumer factory reran");
			assert.equal(panel.title.value, "UNTITLED", "the replacement hydrated before publication");
			assert.notEqual(views[0], views[1]);
			await until(() => views[0]!.status === "released");
			await views[1]!.rename("fresh");
			await until(() => panel.title.value === "FRESH");
			await browser.reload([facet(false)]);
			assert.equal(views.length, 3);
			assert.equal(panel.title.value, "off");
			assert.notEqual(views[1], views[2]);
			await until(() => views[1]!.status === "released" && link.count("sent", "unsub") === 1);
			const before = stateFrames(link.received).length;
			await panel.add("after");
			await tick();
			assert.equal(stateFrames(link.received).length, before);
			assert.throws(
				() => views[2]!.title.value,
				(error) => isChordError(error, "not_ready"),
			);
		} finally {
			await browser.close();
			await server.close();
		}
	});

	for (const initialState of [false, true]) {
		it(`an aborted state-option replacement preserves the ${initialState ? "full" : "method-only"} installed view`, async () => {
			const { server, browser, link } = setup();
			const Panel = local("t.e8-rollback-panel", {
				version: 1,
				input: Type.Object({}),
				members: { title: Type.String(), add: method(Type.String()) },
			});
			const views: Ref<typeof Notes>[] = [];
			const facet = (state: boolean, fail = false) => ({
				name: "panel",
				setup: (api: FacetApi) => {
					api.serve(Panel, (_input, _principal, self) => {
						const notes = self.get(Notes, {}, { state });
						views.push(notes);
						if (fail) {
							self.resource("failure", {
								version: 1,
								open: () => {
									throw new Error("abort state replacement");
								},
							});
						}
						return {
							title: state
								? self.derive([notes.title], (title) => title.toUpperCase())
								: self.state("off", Type.String(), "off"),
							add: (text: string, ctx: Ctx) => notes.add(text, ctx),
						};
					});
				},
			});
			try {
				await browser.install(facet(initialState));
				const panel = await browser.get(Panel, {});
				const version = browser.codeVersion;
				await assert.rejects(browser.reload([facet(!initialState, true)]), /abort state replacement/);
				assert.equal(browser.codeVersion, version);
				assert.equal(views.length, 2);
				assert.notEqual(views[0], views[1]);
				assert.equal(views[0]!.status, "live");
				assert.equal(views[1]!.status, "released");
				await panel.add("still callable");
				if (initialState) {
					await views[0]!.rename("retained");
					await until(() => panel.title.value === "RETAINED");
				} else {
					assert.equal(panel.title.value, "off");
					await until(() => link.count("sent", "unsub") === 1);
					assert.throws(
						() => views[0]!.title.value,
						(error) => isChordError(error, "not_ready"),
					);
				}
			} finally {
				await browser.close();
				await server.close();
			}
		});
	}

	it("same-run duplicate gets reject conflicting state options in either order", async () => {
		for (const state of [false, true]) {
			const { server, browser } = setup();
			const Panel = local("t.e8-duplicate-options", { version: 1, input: Type.Object({}) });
			browser.serve(Panel, (_input, _principal, self) => {
				const first = self.get(Notes, {}, { state });
				assert.equal(self.get(Notes, {}, { state }), first);
				self.get(Notes, {}, state ? { state: false } : undefined);
				return {};
			});
			try {
				await assert.rejects(
					browser.get(Panel, {}),
					(error) => isChordError(error, "invalid") && error.reason === "duplicate" && /state/.test(error.message),
				);
			} finally {
				await browser.close();
				await server.close();
			}
		}
	});
});

describe("origins of client holds", () => {
	const Counter = remote("t.e8-counter", {
		version: 1,
		input: Type.Object({ session: Type.String() }),
		host: hostFamily("session:", "session"),
		variants: { main: { state: { n: Type.Number() }, methods: { add: method(Type.Number()) } } },
	});

	function cluster() {
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		let worker: HostImpl | undefined;
		let toWorker: CountingLink | undefined;
		server.route("session:", {
			principal: (name) => ({ host: name }),
			authorize: () => true,
			resolve: async (name) => {
				if (toWorker !== undefined) return toWorker;
				const [down, up] = memoryLinkPair();
				const created = new HostImpl({
					self: { kind: "host" },
					name,
					upstream: { link: up, principal: { kind: "server" } },
					onError: () => {},
				});
				created.serve(Counter, (_input, _principal, self) => {
					const n = self.state("n", Type.Number(), 0);
					return {
						variant: "main",
						n,
						add: (delta: number, ctx: Ctx) => {
							n.replace(ctx, n.value + delta);
						},
					};
				});
				worker = created;
				toWorker = new CountingLink(down);
				return toWorker;
			},
		});
		const browser = () => {
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal: { guest: "g" } });
			const host = createHost({
				self: { kind: "host" },
				name: "browser",
				kind: "client",
				upstream: { link: up, principal: { kind: "server" } },
				onError: () => {},
			});
			return { host, up };
		};
		const origins = () =>
			[...(worker?.upstream?.served.values() ?? [])].map((served) =>
				served.kind === "local" ? served.origin : undefined,
			);
		return { server, browser, origins, sentToWorker: () => toWorker?.sent ?? [] };
	}

	it("a relayed hold carries its client connection's id; the server's own holds carry none", async () => {
		const c = cluster();
		const one = c.browser();
		const two = c.browser();
		await one.host.hold(Counter, { session: "S1" }).ready;
		await two.host.hold(Counter, { session: "S1" }).ready;
		const own = c.server.hold(Counter, { session: "S1" });
		await own.ready;
		const holds = c.sentToWorker().filter((frame): frame is Extract<Frame, { t: "hold" }> => frame.t === "hold");
		assert.equal(holds.length, 3);
		const relayed = holds.filter((frame) => frame.origin !== undefined);
		assert.equal(relayed.length, 2);
		assert.notEqual(relayed[0]!.origin, relayed[1]!.origin, "two tabs, two origins");
		assert.equal(holds.filter((frame) => frame.origin === undefined).length, 1);

		// Disconnect is departure: the worker loses that origin at once; a reconnect holds under a new id.
		const before = new Set(c.origins());
		one.up.close();
		await until(() => c.origins().filter((origin) => origin !== undefined).length === 1);
		const three = c.browser();
		await three.host.hold(Counter, { session: "S1" }).ready;
		const after = c.origins().filter((origin) => origin !== undefined);
		assert.equal(after.length, 2);
		assert.ok(
			after.some((origin) => !before.has(origin)),
			"a new connection gets a new id",
		);
		await c.server.close();
	});

	it("an origin a client sends is ignored: the server stamps its own", async () => {
		const c = cluster();
		const [down, raw] = memoryLinkPair();
		c.server.accept(down, { principal: { guest: "g" } });
		raw.receive(() => {});
		raw.send({ t: "hello", protocol: PROTOCOL_VERSION, name: "raw", kind: "client", codeVersion: 0 });
		raw.send({
			t: "hold",
			id: 1,
			at: "session:S1",
			token: Counter.description,
			input: { session: "S1" },
			origin: "spoofed",
		});
		await until(() => c.sentToWorker().some((frame) => frame.t === "hold"));
		const hold = c.sentToWorker().find((frame) => frame.t === "hold");
		assert.ok(hold?.t === "hold" && hold.origin !== undefined && hold.origin !== "spoofed");
		await c.server.close();
	});
});

describe("versioned call projections", () => {
	it("permissive provider outputs cannot promise optional named result or state fields", async () => {
		for (const member of ["result", "state"] as const) {
			for (const additionalProperties of [undefined, true]) {
				const offered = Type.Object({}, additionalProperties === undefined ? {} : { additionalProperties });
				const wanted = Type.Object({ b: Type.Optional(Type.String()) });
				const consumer = remote(`t.optional-output-${member}`, {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("server"),
					variants: {
						main: {
							state: { value: member === "state" ? wanted : Type.Unknown() },
							methods: { read: method(undefined, member === "result" ? wanted : Type.Unknown()) },
						},
					},
				});
				const provider = remote(consumer.name, {
					...consumer.def,
					variants: {
						main: {
							state: { value: member === "state" ? offered : Type.Unknown() },
							methods: { read: method(undefined, member === "result" ? offered : Type.Unknown()) },
						},
					},
				});
				const { server, browser } = setup();
				server.serve(provider, (_input, _principal, self) => ({
					variant: "main",
					read: () => ({ b: 7 }),
					value: self.state("value", offered, { b: 7 }),
				}));
				try {
					assert.throws(
						() => server.hold(consumer, {}),
						(error) => isChordError(error, "contract_mismatch") && error.message.includes(member),
					);
					await assert.rejects(
						browser.get(consumer, {}),
						(error) =>
							isChordError(error, "upgrade_required") &&
							error.message.includes("contract_mismatch") &&
							error.message.includes(member),
					);
				} finally {
					await browser.close();
					await server.close();
				}
			}
		}
	});

	it("nested additive arguments and inputs are cleaned before reaching local and linked providers", async () => {
		const before = Type.Array(Type.Object({ a: Type.String() }));
		const after = Type.Array(Type.Object({ a: Type.String(), b: Type.Optional(Type.Number()) }));
		const consumer = remote("t.nested-cleaned-inputs", {
			version: 1,
			input: Type.Object({ rows: before }),
			host: hostNamed("server"),
			variants: { main: { methods: { read: method(Type.Object({ rows: before }), Type.Unknown()) } } },
		});
		const provider = remote(consumer.name, {
			...consumer.def,
			input: Type.Object({ rows: after }),
			variants: { main: { methods: { read: method(Type.Object({ rows: after }), Type.Unknown()) } } },
		});
		const { server, browser } = setup();
		server.serve(provider, (input) => ({ variant: "main", read: (args) => ({ input, args }) }));
		try {
			for (const host of [server, browser]) {
				const input = { rows: [{ a: "address", b: "stripped" }] };
				const ref = await host.get(consumer, input);
				assert.deepEqual(await ref.read({ rows: [{ a: "argument", b: "stripped" }] } as never), {
					input: { rows: [{ a: "address" }] },
					args: { rows: [{ a: "argument" }] },
				});
			}
		} finally {
			await browser.close();
			await server.close();
		}
	});

	it("same-version consumers reject conflicting named-field patterns at bind and call additive providers", async () => {
		for (const conflicting of [true, false]) {
			const consumer = remote("t.consumer-pattern", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("server"),
				variants: {
					main: {
						methods: {
							send: method(Type.Object({ x: Type.String() }, { additionalProperties: false }), Type.String()),
						},
					},
				},
			});
			const provider = remote(consumer.name, {
				...consumer.def,
				variants: {
					main: {
						methods: {
							send: method(
								Type.Object(
									{ x: Type.String(), extra: Type.Optional(Type.Number()) },
									{
										patternProperties: {
											"^x$": Type.String(),
											x: conflicting ? Type.Number() : Type.String(),
										},
									},
								),
								Type.String(),
							),
						},
					},
				},
			});
			const server = createHost({ self: "host", name: "server" });
			const handled: unknown[] = [];
			server.serve(provider, () => ({
				variant: "main",
				send: (args) => {
					handled.push(args);
					return args.x;
				},
			}));
			const [down, up] = memoryLinkPair();
			server.accept(down, { kind: "host", name: "worker", principal: "worker" });
			const worker = createHost({ self: "host", name: "worker", upstream: { link: up, principal: "server" } });
			try {
				if (conflicting) {
					assert.throws(
						() => server.hold(consumer, {}),
						(error) => isChordError(error, "contract_mismatch"),
					);
					await assert.rejects(worker.get(consumer, {}), (error) => isChordError(error, "contract_mismatch"));
					assert.deepEqual(handled, []);
				} else {
					const ref = await worker.get(consumer, {});
					assert.equal(await ref.send({ x: "consumer input" }), "consumer input");
					assert.deepEqual(handled, [{ x: "consumer input" }]);
				}
			} finally {
				await worker.close();
				await server.close();
			}
		}
	});

	it("control projections preserve a pending shape until its missing snapshot arrives", async () => {
		const Switch = remote("t.pending-projections", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				before: { state: { n: Type.Number() }, methods: { ping: method(undefined, Type.String()) } },
				after: {
					state: { n: Type.Number(), added: Type.String() },
					methods: { ping: method(undefined, Type.String()) },
				},
			},
		});
		const server = createHost({ self: "host", name: "server" });
		const facets = [false, true].map((added) => ({
			name: "switch",
			setup: (api: FacetApi) => {
				api.serve(Switch, (_input, _principal, self) => {
					const n = self.state("n", Type.Number(), 7);
					return added
						? { variant: "after", n, added: self.state("added", Type.String(), "new value"), ping: () => "after" }
						: { variant: "before", n, ping: () => "before" };
				});
			},
		}));
		await server.install(facets[0]!);
		const [down, up] = memoryLinkPair();
		server.accept(down, { kind: "host", name: "worker", principal: "worker" });
		let deliver: ((frame: Frame) => void) | undefined;
		let pending: Frame | undefined;
		const link: Link = {
			get closed() {
				return up.closed;
			},
			send: (frame) => up.send(frame),
			receive: (handler) => {
				deliver = handler;
				up.receive((frame) => {
					if (frame.t === "state" && frame.m === "added" && frame.as === "snap") pending = frame;
					else handler(frame);
				});
			},
			onClose: (handler) => up.onClose(handler),
			close: (reason) => up.close(reason),
		};
		const worker = createHost({ self: "host", name: "worker", upstream: { link, principal: "server" } });
		try {
			const ref = await worker.get(Switch, {});
			const shapes: string[] = [];
			ref.onShape((shape) => shapes.push(shape.variant!));
			await server.reload([facets[1]!]);
			await until(() => pending !== undefined);
			expect(ref.variant).toBe("before");
			assert.equal(ref.n.value, 7);
			await server.reload([]);
			assert.equal(await worker.root((ctx) => ref.ping(ctx), { signal: AbortSignal.timeout(1000) }), "after");
			expect(ref.variant).toBe("before");
			assert.deepEqual(shapes, []);
			assert.ok(pending !== undefined && deliver !== undefined);
			deliver(pending);
			await until(() => ref.variant === "after");
			const hydrated = ref;
			assert.equal(hydrated.variant, "after");
			if (hydrated.variant !== "after") throw new Error("pending shape did not hydrate");
			assert.equal(hydrated.added.value, "new value");
			assert.equal(hydrated.n.value, 7);
			assert.deepEqual(shapes, ["after"]);
		} finally {
			await worker.close();
			await server.close();
		}
	});

	it("a previous-protocol peer is refused; shape projections do not version state", async () => {
		const { server, browser, link } = setup();
		await browser.hold(Notes, {}).ready;
		const shape = link.received.find((frame) => frame.t === "shape");
		assert.ok(shape !== undefined && !("codeVersion" in shape));
		assert.deepEqual(shape.t === "shape" ? [...shape.state].sort() : [], ["notes", "title"]);

		const [down, raw] = memoryLinkPair();
		server.accept(down, { principal: { user: "old" } });
		const closed = new Promise<string>((resolve) => (raw as Link).onClose(resolve));
		raw.receive(() => {});
		raw.send({ t: "hello", protocol: PROTOCOL_VERSION - 1, name: "old", kind: "client", codeVersion: 0 });
		assert.equal(await closed, `protocol-version ${PROTOCOL_VERSION}`);
		await browser.close();
		await server.close();
	});
});

describe("terminal consumer host shutdown", () => {
	it("ends externally held upstream views after cleanup and rejects new acquisitions", async () => {
		const { server, browser } = setup();
		const ref = await browser.get(Notes, {});
		await ref.add("retained");
		await until(() => ref.notes.value.length === 1);
		await browser.close();
		assert.equal(ref.status, "gone");
		assert.throws(
			() => ref.notes.value,
			(error) => isChordError(error, "gone"),
		);
		await assert.rejects(ref.add("after close"), (error) => isChordError(error, "gone"));
		await assert.rejects(browser.get(Notes, {}), (error) => isChordError(error, "gone"));
		assert.throws(
			() => browser.hold(Notes, {}),
			(error) => isChordError(error, "gone"),
		);
		await server.close();
	});

	it("settles loading readiness and fences a route that completes after close", async () => {
		const resolving = Promise.withResolvers<void>();
		const route = Promise.withResolvers<Link>();
		const consumer = new HostImpl({ self: "host", name: "consumer", kind: "client" });
		consumer.route("server", {
			principal: () => "server",
			authorize: () => true,
			resolve: async () => {
				resolving.resolve();
				return route.promise;
			},
		});
		const ref = consumer.hold(Notes, {});
		const rejected = assert.rejects(ref.ready, (error) => isChordError(error, "gone"));
		await resolving.promise;
		await consumer.close();
		await rejected;
		assert.equal(ref.status, "gone");
		await assert.rejects(ref.rename("closed"), (error) => isChordError(error, "gone"));
		const [down, up] = memoryLinkPair();
		route.resolve(down);
		await tick();
		assert.equal(down.closed, true);
		assert.equal(up.closed, true);
		assert.equal(consumer.connections.size, 0);
		assert.equal(consumer.bindings.size, 0);
	});
});

describe("current projections decode fresh calls", () => {
	for (const stalled of ["window", "snapshot"] as const) {
		for (const beforeArgs of [false, true]) {
			for (const kind of ["client", "host"] as const) {
				it(`${kind} ${beforeArgs ? "args to no args" : "no args to args"} with a blocked ${stalled} preserves implicit arguments and holder cancellation`, async () => {
					const Switch = remote("t.projection-arity", {
						version: 1,
						input: Type.Object({}),
						host: hostNamed("server"),
						variants: {
							args: {
								state: { n: Type.Number(), extra: Type.String(), argsOnly: Type.String() },
								methods: {
									send: method(Type.String(), Type.String()),
									wait: method(Type.String(), Type.String()),
									bump: method(),
								},
							},
							bare: {
								state: { n: Type.Number(), extra: Type.String(), bareOnly: Type.String() },
								methods: {
									send: method(undefined, Type.String()),
									wait: method(undefined, Type.String()),
									bump: method(),
								},
							},
						},
					});
					const server = createHost({ self: "host", name: "server" });
					const calls: unknown[] = [];
					const entered = Promise.withResolvers<void>();
					const facet = (args: boolean) => ({
						name: "arity",
						setup: (api: FacetApi) => {
							api.serve(Switch, (_input, _principal, self) => {
								const n = self.state("n", Type.Number(), 0);
								const extra = self.state("extra", Type.String(), "shared");
								const bump = (ctx: Ctx) => n.replace(ctx, n.value + 1);
								const wait = async (value: unknown, ctx: Ctx) => {
									calls.push(value);
									entered.resolve();
									await new Promise<void>((resolve) =>
										ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
									);
									return "cancelled";
								};
								return args
									? {
											variant: "args",
											n,
											extra,
											argsOnly: self.state("argsOnly", Type.String(), "args snapshot"),
											bump,
											send: (value: string) => {
												calls.push(value);
												return value;
											},
											wait,
										}
									: {
											variant: "bare",
											n,
											extra,
											bareOnly: self.state("bareOnly", Type.String(), "bare snapshot"),
											bump,
											send: () => {
												calls.push(undefined);
												return "bare";
											},
											wait: (ctx: Ctx) => wait(undefined, ctx),
										};
							});
						},
					});
					await server.install(facet(beforeArgs));
					const [down, up] = memoryLinkPair();
					server.accept(down, {
						principal: "guest",
						...(kind === "host" ? { kind, name: "worker" } : {}),
						window: stalled === "window" ? 1 : undefined,
					});
					let holdSnapshots = false;
					let held: Frame[] = [];
					let deliver: ((frame: Frame) => void) | undefined;
					const counting = new CountingLink(up);
					const link: Link = {
						get closed() {
							return counting.closed;
						},
						send: (frame) => counting.send(frame),
						onClose: (handler) => counting.onClose(handler),
						close: (reason) => counting.close(reason),
						receive: (handler) => {
							deliver = handler;
							counting.receive((frame) => {
								if (holdSnapshots && frame.t === "state" && frame.as === "snap") held.push(frame);
								else handler(frame);
							});
						},
					};
					const browser = createHost({
						self: "host",
						name: "worker",
						kind,
						upstream: { link, principal: "server" },
					});
					const Runner = local("t.arity-holder", { version: 1, input: Type.Object({}) });
					const start = Promise.withResolvers<void>();
					const finished = Promise.withResolvers<unknown>();
					browser.serve(Runner, (_input, _principal, self) => {
						const target = self.get(Switch, {});
						self.task(async (ctx) => {
							await start.promise;
							try {
								const call = Reflect.get(target, "wait") as (...args: unknown[]) => Promise<string>;
								await (beforeArgs ? call(ctx) : call("holder", ctx));
								finished.resolve("not cancelled");
							} catch (error) {
								finished.resolve(error);
							}
						});
						return {};
					});
					try {
						const ref = await browser.get(Switch, {});
						const runner = await browser.get(Runner, {});
						if (stalled === "window") {
							counting.paused = true;
							await ref.bump();
							await ref.bump();
						} else holdSnapshots = true;
						await server.reload([facet(!beforeArgs)]);
						await until(() =>
							counting.received.some(
								(frame) =>
									(frame.t === "projections" || frame.t === "shape") &&
									frame.callVariants.some((entry) => entry.variant === (beforeArgs ? "bare" : "args")),
							),
						);
						assert.equal(ref.variant, beforeArgs ? "args" : "bare");
						const send = Reflect.get(ref, "send") as (...args: unknown[]) => Promise<string>;
						assert.equal(await (beforeArgs ? send() : send("implicit")), beforeArgs ? "bare" : "implicit");
						start.resolve();
						await entered.promise;
						runner.release();
						assert.ok(isChordError(await finished.promise, "aborted"));
						assert.deepEqual(calls, beforeArgs ? [undefined, undefined] : ["implicit", "holder"]);
						assert.equal(ref.variant, beforeArgs ? "args" : "bare");
					} finally {
						start.resolve();
						counting.release();
						holdSnapshots = false;
						for (const frame of held) deliver?.(frame);
						held = [];
						await browser.close();
						await server.close();
					}
				});
			}
		}
	}
});
