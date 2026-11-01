import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it } from "vitest";
import type { HostImpl } from "../src/host.ts";
import { type Ctx, createHost, type Facet, isChordError, local, method } from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200 && !check(); attempt++) await tick();
	assert.ok(check(), "condition not reached");
}

function latch<T>() {
	let open: (value: T) => void = () => {};
	const promise = new Promise<T>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

const Notes = local("t.notes", {
	version: 1,
	input: Type.Object({}),
	members: {
		notes: Type.Array(Type.String()),
		count: Type.Number(),
		has: method(Type.String(), Type.Boolean()),
		add: method(Type.String()),
	},
});

const NotesSchema = Type.Array(Type.String());

describe("state init", () => {
	it("runs after the resources are open and before the object goes live: nothing sees another value", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const loaded = latch<string[]>();
		const log: string[] = [];
		host.serve(Notes, (_input, _principal, self) => {
			const db = self.resource("db", {
				version: 1,
				open: () => {
					log.push("open");
					return { load: () => loaded.promise };
				},
			});
			const notes = self.state("notes", NotesSchema, {
				init: async () => {
					log.push("init");
					return await db.value.load();
				},
			});
			const count = self.derive([notes], (list) => list.length);
			self.on("notes", notes, (list) => {
				log.push(`listener ${list.join(",")}`);
			});
			self.task(async () => {
				log.push(`task ${notes.value.join(",")}`);
			});
			return {
				notes,
				count,
				has: (note) => notes.value.includes(note),
				add: (note, ctx) => {
					notes.change(ctx, (draft) => {
						draft.push(note);
					});
				},
			};
		});
		const ref = host.hold(Notes, {});
		const seen: unknown[] = [];
		ref.notes.subscribe((value) => seen.push(value));
		// A call made while init runs waits until the object is live, then reads the loaded value.
		const has = host.root((ctx) => ref.has("a", ctx));
		await until(() => log.includes("init"));
		assert.equal(ref.status, "loading");
		assert.deepEqual(seen, [], "loading initializers must not notify value subscribers");
		loaded.open(["a", "b"]);
		assert.equal(await has, true);
		assert.equal(ref.count.value, 2);
		await until(() => log.length === 4);
		assert.deepEqual(log, ["open", "init", "listener a,b", "task a,b"]);
		assert.deepEqual(seen, [["a", "b"]]);
	});

	it("an init cell cannot be read inside the factory", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		host.serve(Notes, (_input, _principal, self) => {
			const notes = self.state("notes", NotesSchema, { init: () => [] });
			const count = self.derive([notes], (list) => list.length);
			notes.value;
			return { notes, count, has: () => false, add: () => {} };
		});
		await assert.rejects(host.hold(Notes, {}).ready, (error) => isChordError(error) && error.code === "not_ready");
	});

	it("a throwing or invalid init fails the activation and closes its resources; the next get tries again", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		let result: () => unknown = () => {
			throw new Error("db down");
		};
		const closed: string[] = [];
		host.serve(Notes, (_input, _principal, self) => {
			self.resource("db", { version: 1, open: () => "db", close: (db) => void closed.push(db) });
			const notes = self.state("notes", NotesSchema, { init: () => result() as string[] });
			const count = self.derive([notes], (list) => list.length);
			return { notes, count, has: () => false, add: () => {} };
		});
		await assert.rejects(host.hold(Notes, {}).ready, /db down/);
		assert.deepEqual(closed, ["db"]);
		result = () => [1];
		await assert.rejects(host.hold(Notes, {}).ready, (error) => isChordError(error) && error.code === "invalid");
		assert.deepEqual(closed, ["db", "db"]);
		result = () => ["ok"];
		const ref = host.hold(Notes, {});
		await ref.ready;
		assert.deepEqual(ref.notes.value, ["ok"]);
	});

	it("aborts sibling initializers before joining a failed batch", async () => {
		const host = createHost({ self: "host", onError: () => {} });
		const Service = local("t.failed-init-batch", { version: 1, input: Type.Object({}) });
		const log: string[] = [];
		const started = Promise.withResolvers<void>();
		host.serve(
			Service,
			(_input, _principal, self) => {
				self.resource("native", {
					version: 1,
					open: () => "native",
					close: () => {
						log.push("closed");
					},
				});
				self.state("failure", Type.String(), {
					init: async () => {
						await started.promise;
						throw new Error("first init failed");
					},
				});
				self.state("waiting", Type.String(), {
					init: (ctx) =>
						new Promise<string>((resolve) => {
							started.resolve();
							const aborted = () => {
								log.push("aborted");
								resolve("cancelled");
							};
							if (ctx.signal.aborted) aborted();
							else ctx.signal.addEventListener("abort", aborted, { once: true });
						}),
				});
				return {};
			},
			{ lifetime: "host" },
		);
		try {
			await assert.rejects(host.ready(), /first init failed/);
			assert.deepEqual(log, ["aborted", "closed"]);
		} finally {
			await host.close();
		}
	});

	it("init runs in a root: it can call other objects", async () => {
		const host = createHost({ self: { kind: "host" }, onError: () => {} });
		const Source = local("t.source", {
			version: 1,
			input: Type.Object({}),
			members: { all: method(undefined, NotesSchema) },
		});
		host.serve(Source, () => ({ all: () => ["from source"] }));
		host.serve(Notes, (_input, _principal, self) => {
			const notes = self.state("notes", NotesSchema, {
				init: async (ctx: Ctx) => (await ctx.get(Source, {})).all(ctx),
			});
			const count = self.derive([notes], (list) => list.length);
			return { notes, count, has: () => false, add: () => {} };
		});
		const ref = host.hold(Notes, {});
		await ref.ready;
		assert.deepEqual(ref.notes.value, ["from source"]);
	});

	it("reload initializers can call newly added dependencies without publishing their code", async () => {
		const host = createHost({ self: "host", onError: () => {} });
		const Source = local("t.reload-init-source", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const Leaf = local("t.reload-init-leaf", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const Consumer = local("t.reload-init-consumer", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const started = latch<void>();
		const finish = latch<void>();
		const source: Facet = {
			name: "source",
			setup: ({ serve }) => {
				serve(Leaf, () => ({ read: () => "prepared source" }));
				serve(Source, (_input, _principal, self) => {
					const leaf = self.get(Leaf, {});
					return { read: (ctx) => leaf.read(ctx) };
				});
			},
		};
		const consumer = (added: boolean): Facet => ({
			name: "consumer",
			setup: ({ serve }) =>
				serve(Consumer, (_input, _principal, self) => {
					if (!added) return { read: () => "old" };
					const source = self.get(Source, {});
					const value = self.state("value", Type.String(), {
						init: async (ctx) => {
							const value = await source.read(ctx);
							started.open();
							await finish.promise;
							return value;
						},
					});
					return { read: () => value.value };
				}),
		});
		await host.install(consumer(false));
		const ref = await host.get(Consumer, {});
		const before = host.codeVersion;
		const reloading = host.reload([source, consumer(true)]);
		try {
			await Promise.race([started.promise, reloading]);
			assert.equal(host.codeVersion, before);
			assert.equal(await ref.read(), "old");
			const publicSource = await host.get(Source, {});
			await assert.rejects(publicSource.read(), (error) => isChordError(error, "superseded"));
			publicSource.release();
			finish.open();
			await reloading;
			assert.equal(await ref.read(), "prepared source");
		} finally {
			finish.open();
			await reloading.catch(() => {});
			await host.close();
		}
	});

	it("a failed reload unwinds nested initializer calls and removes its newly added dependency", async () => {
		const host = createHost({ self: "host", onError: () => {} });
		const Source = local("t.failed-init-source", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const Consumer = local("t.failed-init-consumer", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const closed: string[] = [];
		const source: Facet = {
			name: "source",
			setup: ({ serve }) =>
				serve(Source, (_input, _principal, self) => {
					self.resource("native", {
						version: 1,
						open: () => "source",
						close: (value) => {
							closed.push(value);
						},
					});
					return { read: () => "candidate" };
				}),
		};
		const initial: Facet = { name: "consumer", setup: ({ serve }) => serve(Consumer, () => ({ read: () => "old" })) };
		await host.install(initial);
		const ref = await host.get(Consumer, {});
		try {
			await assert.rejects(
				host.reload([
					source,
					{
						name: "consumer",
						setup: ({ serve }) =>
							serve(Consumer, (_input, _principal, self) => {
								const source = self.get(Source, {});
								self.state("value", Type.String(), {
									init: async (ctx) => {
										assert.equal(await source.read(ctx), "candidate");
										throw new Error("initializer refuses candidate");
									},
								});
								return { read: () => "new" };
							}),
					},
				]),
				/initializer refuses candidate/,
			);
			assert.equal(await ref.read(), "old");
			assert.deepEqual(closed, ["source"]);
			assert.throws(() => host.hold(Source, {}), /not served/);
		} finally {
			await host.close();
		}
	});

	it("settled initializers cancel and join unawaited nested calls before rollback closes dependencies", async () => {
		const host = createHost({ self: "host", onError: () => {} });
		const Source = local("t.init-owned-call", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const Consumer = local("t.init-owned-consumer", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		const started = latch<void>();
		const log: string[] = [];
		let escaped: Ctx | undefined;
		let nested: Promise<string> | undefined;
		const source: Facet = {
			name: "source",
			setup: ({ serve }) =>
				serve(Source, (_input, _principal, self) => {
					const resource = self.resource("native", {
						version: 1,
						open: () => "open",
						close: () => {
							log.push("closed");
						},
					});
					return {
						read: async (ctx) => {
							started.open();
							await new Promise<void>((resolve) =>
								ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
							);
							log.push(`cancelled while ${resource.value}`);
							return "cancelled";
						},
					};
				}),
		};
		await host.install({ name: "consumer", setup: ({ serve }) => serve(Consumer, () => ({ read: () => "old" })) });
		const ref = await host.get(Consumer, {});
		try {
			await assert.rejects(
				host.reload([
					source,
					{
						name: "consumer",
						setup: ({ serve }) =>
							serve(Consumer, (_input, _principal, self) => {
								const dependency = self.get(Source, {});
								self.state("value", Type.String(), {
									init: async (ctx) => {
										escaped = ctx;
										nested = dependency.read(ctx);
										await Promise.race([started.promise, nested]);
										throw new Error("initializer failed after spawning call");
									},
								});
								return { read: () => "new" };
							}),
					},
				]),
				/initializer failed after spawning call/,
			);
			assert.equal(await nested, "cancelled");
			assert.deepEqual(log, ["cancelled while open", "closed"]);
			assert.equal(await ref.read(), "old");
			await assert.rejects(
				escaped!.get(Consumer, {}),
				(error) => isChordError(error, "aborted") && error.reason === "expired",
			);
		} finally {
			await host.close();
		}
	});

	describe("reload", () => {
		const facet = (spec: {
			readonly inits: string[];
			readonly extra?: () => string[];
			readonly countVersion?: number;
		}): Facet => ({
			name: "notes",
			setup: (api) =>
				api.serve(Notes, (_input, _principal, self) => {
					const notes = self.state("notes", NotesSchema, {
						init: () => {
							spec.inits.push("notes");
							return ["loaded"];
						},
					});
					const counter = self.state("counter", Type.Number(), 0, { version: spec.countVersion ?? 1 });
					const extra = spec.extra;
					const more =
						extra === undefined
							? undefined
							: self.state("more", NotesSchema, {
									init: () => {
										spec.inits.push("more");
										return extra();
									},
								});
					const count = self.derive(more === undefined ? [notes, counter] : [notes, counter, more], (...lists) =>
						lists.reduce<number>((sum, list) => sum + (typeof list === "number" ? list : list.length), 0),
					);
					return {
						notes,
						count,
						has: (note) => notes.value.includes(note),
						add: (note, ctx) => {
							notes.change(ctx, (draft) => {
								draft.push(note);
							});
						},
					};
				}),
		});

		it("keeps an existing cell without running init; a cell the reload adds runs init while it prepares", async () => {
			const host = createHost({ self: { kind: "host" }, onError: () => {} });
			const inits: string[] = [];
			await host.install(facet({ inits }));
			const ref = host.hold(Notes, {});
			await ref.ready;
			await host.root((ctx) => ref.add("written", ctx));
			await host.reload([facet({ inits, extra: () => ["x", "y"] })]);
			assert.deepEqual(inits, ["notes", "more"]);
			assert.deepEqual(ref.notes.value, ["loaded", "written"]);
			// The new derivation counts the kept cell and the added one: 2 + 0 + 2.
			assert.equal(ref.count.value, 4);
		});

		it("a failing init of an added cell refuses the reload; the old code keeps running", async () => {
			const host = createHost({ self: { kind: "host" }, onError: () => {} });
			const inits: string[] = [];
			await host.install(facet({ inits }));
			const ref = host.hold(Notes, {});
			await ref.ready;
			await assert.rejects(
				host.reload([
					facet({
						inits,
						extra: () => {
							throw new Error("cannot load more");
						},
					}),
				]),
				/cannot load more/,
			);
			assert.equal(ref.count.value, 1);
			assert.equal(await host.root((ctx) => ref.has("loaded", ctx)), true);
		});

		it("in a gated reload, an added cell runs init at the gate", async () => {
			const host = createHost({ self: { kind: "host" }, onError: () => {} });
			const inits: string[] = [];
			await host.install(facet({ inits }));
			const ref = host.hold(Notes, {});
			await ref.ready;
			const release = latch<void>();
			const leased = latch<void>();
			const oldRoot = host.root(async (ctx) => {
				await ref.has("loaded", ctx);
				leased.open();
				await release.promise;
			});
			await leased.promise;
			const reloading = host.reload([facet({ inits, countVersion: 2, extra: () => ["x"] })]);
			try {
				// Observe admission after preparation has reached the gate, not merely after some elapsed time.
				await until(() => {
					const runtime = host as HostImpl;
					const objects = runtime.objects;
					return [...objects.values()].some((object) => object.gate !== undefined);
				});
				assert.deepEqual(inits, ["notes"]);
				release.open();
				await oldRoot;
				const report = await reloading;
				assert.equal(report.gated.length, 1);
				assert.deepEqual(inits, ["notes", "more"]);
				assert.equal(ref.count.value, 2);
			} finally {
				release.open();
				await oldRoot;
				await reloading.catch(() => {});
				await host.close();
			}
		});
	});
});
