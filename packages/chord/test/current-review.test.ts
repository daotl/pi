import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it, vi } from "vitest";
import { Cell, Derived } from "../src/cell.ts";
import { HostImpl } from "../src/host.ts";
import {
	createHost,
	type Facet,
	hostNamed,
	local,
	memoryLinkPair,
	method,
	type Readable,
	type Ref,
	remote,
} from "../src/index.ts";
import type { Factory } from "../src/object.ts";
import { normalize, projectJson } from "../src/schema.ts";
import type { Frame } from "../src/wire.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function latch<T>() {
	return Promise.withResolvers<T>();
}
async function until(check: () => boolean): Promise<void> {
	for (let index = 0; index < 200 && !check(); index++) await tick();
	assert.ok(check(), "condition not reached");
}

describe("current review regressions", () => {
	it("discards a disposed consumer candidate while a surviving resource is preparing", async () => {
		const host = new HostImpl({ self: null, onError: () => {} });
		const opened = latch<void>();
		const resume = latch<void>();
		const Provider = local("review.disposed-provider", {
			version: 1,
			input: Type.Object({}),
			members: { value: Type.Number() },
		});
		const Consumer = local("review.disposed-consumer", {
			version: 1,
			input: Type.Object({}),
			members: { value: Type.Number() },
		});
		const Survivor = local("review.surviving-candidate", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		host.serve(Provider, (_input, _principal, self) => ({ value: self.state("value", Type.Number(), 1) }));
		const consumerFactory: Factory<typeof Consumer> = (_input, _principal, self) => {
			const provider = self.get(Provider, {});
			return { value: self.derive([provider.value], (value) => value + 1) };
		};
		await host.install({
			name: "consumers",
			setup: ({ serve }) => {
				serve(Consumer, consumerFactory);
				serve(Survivor, () => ({ read: () => "old" }));
			},
		});
		const consumer = await host.get(Consumer, {});
		const object = [...host.objects.values()].find((entry) => entry.typeName === Consumer.name)!;
		const survivor = await host.get(Survivor, {});
		const before = host.codeVersion;
		const reloading = host.reload([
			{
				name: "consumers",
				setup: ({ serve }) => {
					serve(Consumer, consumerFactory);
					serve(Survivor, (_input, _principal, self) => {
						self.resource("new", {
							version: 1,
							open: async () => {
								opened.resolve();
								await resume.promise;
								return "new";
							},
						});
						return { read: () => "new" };
					});
				},
			},
		]);
		void reloading.catch(() => {});
		try {
			await opened.promise;
			consumer.release();
			await object.dispose(false);
			assert.equal(object.status, "disposed");
			resume.resolve();
			const report = await reloading;
			assert.equal(host.codeVersion, before + 1);
			assert.equal(report.prepared.includes(object.address), false);
			assert.equal(await survivor.read(), "new");
		} finally {
			resume.resolve();
			await reloading.catch(() => {});
			await host.close();
		}
	});

	for (const operation of ["normalize", "projectJson"] as const) {
		it(`${operation} independently projects sibling aliases`, () => {
			const schema = Type.Object({
				left: Type.Object({ a: Type.Number() }),
				right: Type.Object({ b: Type.Number() }),
			});
			const shared = { a: 1, b: 2 };
			const input = { left: shared, right: shared };
			const result = operation === "normalize" ? normalize(schema, input, "aliases") : projectJson(schema, input);
			assert.deepEqual(result, { left: { a: 1 }, right: { b: 2 } });
			assert.deepEqual(shared, { a: 1, b: 2 });
		});

		it(`${operation} snapshots accessors without mutating caller data or invoking setters`, () => {
			const schema = Type.Object({ nested: Type.Object({ keep: Type.Number() }) });
			const shared = { keep: 1, discard: 2 };
			let reads = 0;
			let writes = 0;
			const input = Object.defineProperty({}, "nested", {
				enumerable: true,
				get: () => {
					reads++;
					return shared;
				},
				set: () => {
					writes++;
				},
			});
			const result = operation === "normalize" ? normalize(schema, input, "accessor") : projectJson(schema, input);
			assert.deepEqual(result, { nested: { keep: 1 } });
			assert.deepEqual(shared, { keep: 1, discard: 2 });
			assert.equal(reads, 1);
			assert.equal(writes, 0);
			assert.ok(result !== null && typeof result === "object" && "nested" in result);
			assert.notEqual(result.nested, shared);
		});
	}

	it("cancels retirement watchers and timers before close returns with an old root held", async () => {
		const host = new HostImpl({ self: null, onError: () => {} });
		const release = latch<void>();
		const entered = latch<void>();
		const pinned = host.root(async () => {
			entered.resolve();
			await release.promise;
		});
		let watchers = 0;
		const watch = host.watchRetirement.bind(host);
		const watchSpy = vi.spyOn(host, "watchRetirement").mockImplementation((callback) => {
			watchers++;
			const stop = watch(callback);
			return () => {
				watchers--;
				stop();
			};
		});
		const timers = vi.spyOn(globalThis, "setTimeout");
		const clears = vi.spyOn(globalThis, "clearTimeout");
		let rejected: Promise<void> | undefined;
		try {
			await entered.promise;
			await host.reload([]);
			assert.ok(host.previous !== undefined && host.previous.roots.size > 0);
			rejected = assert.rejects(host.reload([], { retireDeadline: 60_000 }), /closed|aborted/);
			await until(() => watchers === 1);
			const index = timers.mock.calls.findIndex(([, delay]) => delay === 60_000);
			assert.notEqual(index, -1);
			const timer = timers.mock.results[index]!.value;
			await host.close();
			await rejected;
			assert.equal(watchers, 0, "cancelled retirement must release its host subscription");
			assert.ok(
				clears.mock.calls.some(([cleared]) => cleared === timer),
				"cancelled retirement must clear its deadline",
			);
		} finally {
			release.resolve();
			await pinned;
			await host.close();
			await rejected;
			watchSpy.mockRestore();
			timers.mockRestore();
			clears.mockRestore();
		}
	});

	it("consumes late rejected asynchronous callbacks without accepting their changes", async () => {
		const host = createHost({ self: null, onError: () => {} });
		const errors: unknown[] = [];
		const onUnhandled = (error: unknown) => errors.push(error);
		process.on("unhandledRejection", onUnhandled);
		try {
			await host.root((ctx) => {
				const cell = new Cell("value", Type.Object({ n: Type.Number() }), { value: { n: 1 } }, () => {}, {
					dev: true,
					report: () => {},
				});
				assert.throws(
					() =>
						cell.change(ctx, async (draft) => {
							await Promise.resolve();
							draft.n = 2;
						}),
					/synchronous/,
				);
				assert.deepEqual(cell.value, { n: 1 });
				const derived = new Derived(
					"late",
					[],
					async () => {
						await Promise.resolve();
						throw new Error("late derivation rejection");
					},
					{ dev: true, report: () => {} },
				);
				assert.throws(() => derived.compute(() => undefined), /synchronous/);
			});
			const Bad = local("review.async-factory", { version: 1, input: Type.Object({}) });
			// Deliberately violate the synchronous factory type to exercise its runtime boundary.
			host.serve(Bad, (() =>
				(async () => {
					await Promise.resolve();
					throw new Error("late factory rejection");
				})()) as never);
			await assert.rejects(host.get(Bad, {}), /synchronous/);
			await tick();
			await tick();
			assert.deepEqual(errors, []);
		} finally {
			process.off("unhandledRejection", onUnhandled);
			await host.close();
		}
	});

	for (const forced of [false, true]) {
		it(`finishes ${forced ? "forced shutdown" : "ordinary release"} after readable cleanup throws`, async () => {
			const host = createHost({ self: null, onError: () => {} });
			const closed: string[] = [];
			const cancelled = latch<void>();
			const started = latch<void>();
			const State = local("review.throwing-readable", {
				version: 1,
				input: Type.Object({}),
				members: { value: Type.Number(), wait: method() },
			});
			const source: Readable<number> = {
				value: 1,
				subscribe: (listener) => {
					listener(1);
					return () => {};
				},
				events: (listener) => {
					listener({ type: "snap", value: 1 });
					return () => {
						throw new Error("readable cleanup failed");
					};
				},
			};
			host.serve(State, (_input, _principal, self) => {
				self.resource("native", {
					version: 1,
					open: () => "native",
					close: (value) => {
						closed.push(value);
					},
				});
				return {
					value: source,
					wait: async (ctx) => {
						started.resolve();
						await new Promise<void>((resolve) =>
							ctx.signal.addEventListener(
								"abort",
								() => {
									cancelled.resolve();
									resolve();
								},
								{ once: true },
							),
						);
					},
				};
			});
			const first = await host.get(State, {});
			first.value.subscribe(() => {});
			if (forced) {
				const second = await host.get(State, {});
				second.value.subscribe(() => {});
				const call = first.wait();
				await started.promise;
				await assert.rejects(host.close(), /readable cleanup|disposal failed/);
				await cancelled.promise;
				await call;
				assert.equal(first.status, "gone");
				assert.equal(second.status, "gone");
			} else {
				const statuses: string[] = [];
				first.onStatus((status) => statuses.push(status));
				assert.throws(() => first.release(), /readable cleanup failed/);
				await until(() => closed.length === 1);
				assert.deepEqual(statuses, ["released"]);
				await host.close();
			}
			assert.deepEqual(closed, ["native"]);
		});
	}

	for (const bodyFails of [false, true]) {
		it(`releases every root reference and retires its code when cleanup fails${bodyFails ? " after a body failure" : ""}`, async () => {
			const host = new HostImpl({ self: null, onError: () => {} });
			const State = local("review.root-cleanup", {
				version: 1,
				input: Type.Object({ id: Type.Number() }),
				members: { value: Type.Number(), read: method(undefined, Type.Number()) },
			});
			const failures = [new Error("first cleanup failed"), new Error("second cleanup failed")];
			const bodyFailure = new Error("root body failed");
			const stopped: number[] = [];
			host.serve(
				State,
				({ id }) => ({
					value: {
						value: id,
						subscribe: (listener) => {
							listener(id);
							return () => {};
						},
						events: (listener) => {
							listener({ type: "snap", value: id });
							return () => {
								stopped.push(id);
								if (id < failures.length) throw failures[id];
							};
						},
					},
					read: () => id,
				}),
				{ linger: 60_000 },
			);
			const entered = latch<void>();
			const finish = latch<void>();
			const refs: Ref<typeof State>[] = [];
			const original = host.current;
			const running = host.root(async (ctx) => {
				for (const id of [0, 1, 2]) {
					const ref = await ctx.get(State, { id });
					refs.push(ref);
					ref.value.subscribe(() => {});
					assert.equal(await ref.read(ctx), id);
				}
				entered.resolve();
				await finish.promise;
				if (bodyFails) throw bodyFailure;
			});
			const rejected = assert.rejects(running, (error) => {
				assert.ok(error instanceof AggregateError);
				if (bodyFails) {
					assert.equal(error.errors[0], bodyFailure);
					assert.ok(error.errors[1] instanceof AggregateError);
					assert.deepEqual(error.errors[1].errors, failures);
				} else assert.deepEqual(error.errors, failures);
				return true;
			});
			try {
				await entered.promise;
				const objects = [...host.objects.values()];
				await host.reload([]);
				assert.equal(host.previous, original);
				finish.resolve();
				await rejected;
				assert.deepEqual(stopped, [0, 1, 2]);
				assert.deepEqual(
					refs.map((ref) => ref.status),
					["released", "released", "released"],
				);
				for (const object of objects) {
					assert.equal(object.refs.size, 0);
					assert.equal(object.leases.size, 0);
				}
				assert.equal(original.roots.size, 0);
				assert.equal(host.previous, undefined);
				assert.equal(host.codeVersions.has(original.id), false);
				await host.reload([], { retireDeadline: Infinity });
				const next = await host.get(State, { id: 2 });
				assert.equal(await next.read(), 2);
				next.release();
			} finally {
				finish.resolve();
				await running.catch(() => {});
				await host.close();
			}
		});
	}

	for (const reporterThrows of [false, true]) {
		it(`settles calls and reload receipts after remote readable teardown fails${reporterThrows ? " and reporting throws" : ""}`, async () => {
			const reports: unknown[] = [];
			const provider = new HostImpl({
				name: "provider",
				self: null,
				onError: (error) => {
					reports.push(error);
					if (reporterThrows) throw new Error("reporter failed");
				},
			});
			const peer = new HostImpl({ name: "peer", self: null, onError: () => {} });
			const State = remote("review.connection-cleanup", {
				version: 1,
				input: Type.Object({ id: Type.Number() }),
				host: hostNamed("provider"),
				variants: { main: { state: { first: Type.Number(), second: Type.Number() } } },
			});
			const Waiting = remote("review.connection-pending", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("peer"),
				variants: { main: { methods: { wait: method() } } },
			});
			const stopped: string[] = [];
			const failure = new Error("remote readable cleanup failed");
			provider.serve(State, ({ id }) => {
				const source = (member: string): Readable<number> => ({
					value: id,
					subscribe: (listener) => {
						listener(id);
						return () => {};
					},
					events: (listener) => {
						listener({ type: "snap", value: id });
						return () => {
							stopped.push(`${id}:${member}`);
							if (id === 0 && member === "first") throw failure;
						};
					},
				});
				return { variant: "main", first: source("first"), second: source("second") };
			});
			const started = latch<void>();
			const cancelled = latch<void>();
			peer.serve(Waiting, () => ({
				variant: "main",
				wait: async (ctx) => {
					started.resolve();
					await new Promise<void>((resolve) =>
						ctx.signal.addEventListener(
							"abort",
							() => {
								cancelled.resolve();
								resolve();
							},
							{ once: true },
						),
					);
				},
			}));
			const [up, down] = memoryLinkPair();
			peer.connect(up, { principal: null });
			provider.accept(down, { principal: null, kind: "host", name: "peer" });
			try {
				await peer.get(State, { id: 0 });
				await peer.get(State, { id: 1 });
				const waiting = await provider.get(Waiting, {});
				const connection = [...provider.connections][0]!;
				const served = [...connection.served.values()];
				const rejected = assert.rejects(waiting.wait(), { code: "unavailable" });
				await started.promise;
				const receiptRejected = assert.rejects(connection.replace(999, "pending-reload", false), {
					code: "unavailable",
				});
				// No await: the receipt must still be in flight when the transport closes.
				down.close("connection lost");
				await Promise.all([rejected, receiptRejected, cancelled.promise]);
				assert.deepEqual(stopped, ["0:first", "0:second", "1:first", "1:second"]);
				for (const hold of served) {
					assert.equal(hold.kind, "local");
					if (hold.kind === "local") {
						assert.equal(hold.ref.status, "released");
						assert.equal(hold.ref.object.refs.size, 0);
						assert.equal(hold.feeds.size, 0);
					}
				}
				assert.equal(connection.calls.size, 0);
				assert.equal(connection.replacements.size, 0);
				assert.equal(connection.served.size, 0);
				assert.equal(connection.remotes.size, 0);
				assert.equal(provider.connections.has(connection), false);
				assert.equal(waiting.status, "gone");
				assert.deepEqual(reports, [failure]);
			} finally {
				await peer.close();
				await provider.close();
			}
		});
	}

	for (const cancelGet of [false, true]) {
		it(`settles method-only readiness when the last state view ${cancelGet ? "is cancelled" : "is released"} mid-hydration`, async () => {
			const Service = remote("review.pending-shape", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("provider"),
				variants: {
					main: { state: { value: Type.Number() }, methods: { ping: method(undefined, Type.String()) } },
				},
			});
			const provider = createHost({ name: "provider", self: null });
			provider.serve(Service, (_input, _principal, self) => ({
				variant: "main",
				value: self.state("value", Type.Number(), 1),
				ping: () => "pong",
			}));
			const [up, down] = memoryLinkPair();
			const buffered: Frame[] = [];
			let deliver: (frame: Frame) => void = () => {};
			const client = createHost({ name: "client", kind: "client", self: null });
			client.connect(
				{
					get closed() {
						return up.closed;
					},
					send: (frame) => up.send(frame),
					receive: (handler) =>
						up.receive((frame) => {
							if (frame.t === "state") buffered.push(frame);
							else {
								deliver = handler;
								handler(frame);
							}
						}),
					onClose: (handler) => up.onClose(handler),
					close: (reason) => up.close(reason),
				},
				{ principal: null },
			);
			provider.accept(down, { principal: null });
			try {
				const controller = new AbortController();
				const full = cancelGet ? undefined : client.hold(Service, {});
				const getting = cancelGet ? client.get(Service, {}, { signal: controller.signal }) : undefined;
				const cancelled = getting === undefined ? undefined : assert.rejects(getting, { code: "aborted" });
				const methods = client.hold(Service, {}, { state: false });
				await until(() => buffered.length > 0);
				assert.equal(methods.status, "loading");
				if (cancelGet) controller.abort();
				else full!.release();
				await cancelled;
				await methods.ready;
				assert.equal(await methods.ping(), "pong");
				for (const frame of buffered) deliver(frame);
				assert.throws(() => methods.value.value, /not hydrated/);
			} finally {
				await client.close();
				await provider.close();
			}
		});
	}

	it("preserves reserved JSON data in keyed inputs and in-host remote arguments", async () => {
		const host = createHost({ name: "host", self: null });
		const Data = Type.Record(Type.String(), Type.Unknown());
		const Service = remote("review.json-data", {
			version: 1,
			input: Type.Object({ key: Data }),
			host: hostNamed("host"),
			variants: {
				main: { methods: { read: method(undefined, Type.Unknown()), echo: method(Data, Type.Unknown()) } },
			},
		});
		const inputs: unknown[] = [];
		host.serve(Service, (input) => {
			inputs.push(input);
			return { variant: "main", read: () => input, echo: (args) => args };
		});
		const data = JSON.parse(
			'{"constructor":"recorded","prototype":"value","__proto__":{"polluted":true},"nested":{"constructor":"nested"}}',
		);
		try {
			const first = await host.get(Service, { key: data });
			const second = await host.get(Service, { key: { ...data, constructor: "different" } });
			assert.equal(inputs.length, 2);
			assert.deepEqual(await first.read(), { key: data });
			assert.deepEqual(await second.read(), { key: { ...data, constructor: "different" } });
			const echoed = await first.echo(data);
			assert.deepEqual(echoed, data);
			assert.notEqual(echoed, data);
			assert.ok(echoed !== null && typeof echoed === "object" && "nested" in echoed);
			assert.notEqual(echoed.nested, data.nested);
			assert.equal(Object.hasOwn(echoed, "__proto__"), true);
			assert.equal(Object.getPrototypeOf(echoed), Object.prototype);
			assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
		} finally {
			await host.close();
		}
	});

	for (const linked of [false, true]) {
		it(`projects removable non-JSON fields before strict copying ${linked ? "linked" : "in-host"} JSON data`, async () => {
			const provider = createHost({ name: "provider", self: null });
			const client = linked ? createHost({ name: "client", kind: "client", self: null }) : provider;
			const Data = Type.Record(Type.String(), Type.Unknown());
			const Input = Type.Object({ key: Data });
			const Args = Type.Object({ payload: Data, nested: Type.Object({ text: Type.String() }) });
			const Service = remote("review.project-before-copy", {
				version: 1,
				input: Input,
				host: hostNamed("provider"),
				variants: {
					main: { methods: { read: method(undefined, Type.Unknown()), echo: method(Args, Type.Unknown()) } },
				},
			});
			const inputs: unknown[] = [];
			let calls = 0;
			provider.serve(Service, (input) => {
				inputs.push(input);
				return {
					variant: "main",
					read: () => input,
					echo: (args) => {
						calls++;
						return args;
					},
				};
			});
			if (linked) {
				const [up, down] = memoryLinkPair();
				provider.accept(down, { principal: null });
				client.connect(up, { principal: null });
			}
			const data = JSON.parse('{"constructor":"kept","prototype":"data","__proto__":{"polluted":true}}');
			const discard = () => "not JSON";
			const input = { key: data, discard: 1n, callback: discard };
			const args = {
				payload: data,
				nested: { text: "kept", discard: 2n, callback: discard },
				discard: 3n,
				callback: discard,
			};
			try {
				const ref = await client.get(Service, input);
				assert.deepEqual(await ref.read(), { key: data });
				assert.deepEqual(inputs, [{ key: data }]);
				const echoed = await ref.echo(args);
				assert.deepEqual(echoed, { payload: data, nested: { text: "kept" } });
				assert.ok(echoed !== null && typeof echoed === "object" && "payload" in echoed);
				assert.notEqual(echoed.payload, data);
				assert.ok(echoed.payload !== null && typeof echoed.payload === "object");
				assert.equal(Object.hasOwn(echoed.payload, "__proto__"), true);
				assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
				assert.equal(args.nested.discard, 2n);
				assert.equal(args.callback, discard);
				assert.equal(input.discard, 1n);
				await assert.rejects(ref.echo({ ...args, payload: { retained: 4n } }), /non-JSON bigint/);
				await assert.rejects(ref.echo({ ...args, payload: { retained: discard } }), /non-JSON function/);
				assert.equal(calls, 1, "retained non-JSON data must never reach the provider");
			} finally {
				if (linked) await client.close();
				await provider.close();
			}
		});
	}

	it("joins loader-owned reload shutdown and refuses new installation after close starts", async () => {
		const loaded = latch<Facet[]>();
		let setups = 0;
		const host = createHost({ self: null, loader: () => loaded.promise });
		const reload = host.reload(["delayed"]);
		const rejected = assert.rejects(reload, /closed|aborted/);
		let finished = false;
		const closing = host.close().then(() => {
			finished = true;
		});
		await tick();
		assert.equal(finished, false, "close must join its owned loader");
		loaded.resolve([
			{
				name: "delayed",
				setup: () => {
					setups++;
				},
			},
		]);
		await Promise.all([closing, rejected]);
		assert.equal(setups, 0);
		await assert.rejects(host.reload([]), /closed/);
		const Empty = local("review.closed", { version: 1, input: Type.Object({}) });
		assert.throws(() => host.serve(Empty, () => ({})), /closed/);
		assert.throws(
			() =>
				host.install({
					name: "after",
					setup: () => {
						setups++;
					},
				}),
			/closed/,
		);
		assert.equal(setups, 0);
	});

	it("aborts and joins prepared candidate facet runs before finishing close", async () => {
		const opened = latch<void>();
		const finish = latch<void>();
		const cleanupStarted = latch<void>();
		const finishCleanup = latch<void>();
		const closed: string[] = [];
		let candidateSignal: AbortSignal | undefined;
		const host = createHost({ self: null, onError: () => {} });
		const Service = local("review.closing-candidate", { version: 1, input: Type.Object({}) });
		await host.install({ name: "service", setup: ({ serve }) => serve(Service, () => ({})) });
		await host.get(Service, {});
		const reloading = host.reload([
			{
				name: "service",
				setup: ({ serve, signal }) => {
					candidateSignal = signal;
					serve(Service, (_input, _principal, self) => {
						self.resource("new", {
							version: 1,
							open: async () => {
								opened.resolve();
								await finish.promise;
								return "owned";
							},
							close: async (value) => {
								closed.push(value);
								cleanupStarted.resolve();
								await finishCleanup.promise;
							},
						});
						return {};
					});
				},
			},
		]);
		const rejected = assert.rejects(reloading, /closed|aborted/);
		let finished = false;
		try {
			await opened.promise;
			const closing = host.close().then(() => {
				finished = true;
			});
			assert.equal(candidateSignal?.aborted, true);
			await tick();
			assert.equal(finished, false, "close must join candidate open");
			finish.resolve();
			await cleanupStarted.promise;
			await tick();
			assert.equal(finished, false, "close must join candidate cleanup");
			assert.deepEqual(closed, ["owned"]);
			finishCleanup.resolve();
			await Promise.all([closing, rejected]);
			assert.deepEqual(closed, ["owned"]);
		} finally {
			finish.resolve();
			finishCleanup.resolve();
			await host.close();
			await rejected;
		}
	});

	it("derives through candidate providers, migrations and transitive derived state before publishing", async () => {
		const host = createHost({ name: "host", self: null, dev: true, onError: () => {} });
		const P1 = remote("review.derived-provider", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("host"),
			variants: { main: { state: { text: Type.String() } } },
		});
		const P2 = remote("review.derived-provider", {
			version: 2,
			input: Type.Object({}),
			host: hostNamed("host"),
			variants: { main: { state: { body: Type.String() } } },
		});
		const Consumer = local("review.derived-consumer", {
			version: 1,
			input: Type.Object({}),
			members: { length: Type.Number() },
		});
		await host.install({
			name: "both",
			setup: ({ serve }) => {
				serve(
					P1,
					(_input, _principal, self) => ({ variant: "main", text: self.state("text", Type.String(), "old") }),
					{ linger: 60_000 },
				);
				serve(Consumer, (_input, _principal, self) => {
					const provider = self.get(P1, {});
					return { length: self.derive([provider.text], (text) => text.length) };
				});
			},
		});
		const ref = await host.get(Consumer, {});
		try {
			assert.equal(ref.length.value, 3);
			await host.reload([
				{
					name: "both",
					setup: ({ serve }) => {
						serve(
							P2,
							(_input, _principal, self) => {
								const text = self.state("text", Type.String(), "unused", {
									version: 2,
									migrate: () => "candidate",
								});
								return { variant: "main", body: self.derive([text], (value) => `${value}!`) };
							},
							{ linger: 60_000 },
						);
						serve(Consumer, (_input, _principal, self) => {
							const provider = self.get(P2, {});
							return { length: self.derive([provider.body], (text) => text.length) };
						});
					},
				},
			]);
			assert.equal(ref.length.value, 10);
			const before = host.codeVersion;
			await assert.rejects(
				host.reload([
					{
						name: "both",
						setup: ({ serve }) => {
							serve(
								P2,
								(_input, _principal, self) => {
									const text = self.state("text", Type.String(), "unused", {
										version: 3,
										migrate: () => "unpublished",
									});
									return { variant: "main", body: self.derive([text], (value) => `${value}!`) };
								},
								{ linger: 60_000 },
							);
							serve(Consumer, (_input, _principal, self) => {
								const provider = self.get(P2, {});
								return {
									length: self.derive([provider.body], (text) => {
										if (text === "unpublished!") throw new Error("candidate refused");
										return text.length;
									}),
								};
							});
						},
					},
				]),
				/candidate refused/,
			);
			assert.equal(host.codeVersion, before);
			assert.equal(ref.length.value, 10);
		} finally {
			await host.close();
		}
	});

	it("does not forward a relay call cancelled between route settlement and await resumption", async () => {
		const server = new HostImpl({ name: "server", self: null, onError: () => {} });
		const worker = createHost({ name: "worker", self: null });
		const client = createHost({ name: "client", kind: "client", self: null });
		const Service = remote("review.relay-cancel", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("worker"),
			variants: { main: { methods: { mutate: method() } } },
		});
		let mutations = 0;
		worker.serve(Service, () => ({
			variant: "main",
			mutate: () => {
				mutations++;
			},
		}));
		const [workerSide, serverSide] = memoryLinkPair();
		worker.connect(workerSide, { principal: null });
		let forwarded = 0;
		server.route("worker", {
			authorize: () => true,
			principal: () => null,
			resolve: async () => ({
				get closed() {
					return serverSide.closed;
				},
				send: (frame) => {
					if (frame.t === "call") forwarded++;
					return serverSide.send(frame);
				},
				receive: (handler) => serverSide.receive(handler),
				onClose: (handler) => serverSide.onClose(handler),
				close: (reason) => serverSide.close(reason),
			}),
		});
		const [clientSide, originSide] = memoryLinkPair();
		server.accept(originSide, { principal: null });
		client.connect(clientSide, { principal: null });
		try {
			const ref = await client.get(Service, {});
			const origin = [...server.connections].find((connection) => connection.link === originSide)!;
			const served = [...origin.served.values()].find((hold) => hold.kind === "relay");
			assert.ok(served?.kind === "relay");
			const relay = served.relay;
			const downstream = relay.down!;
			// Promise.race settles first; cancellation runs before its awaiting continuation takes ownership.
			relay.ready = () => {
				queueMicrotask(() =>
					queueMicrotask(() => {
						for (const controller of origin.incoming.values()) controller.abort(new Error("cancel handoff"));
					}),
				);
				return Promise.resolve(downstream);
			};
			await assert.rejects(ref.mutate(), { code: "aborted" });
			await tick();
			assert.equal(forwarded, 0);
			assert.equal(mutations, 0);
			assert.equal(relay.calls.size, 0);
			assert.equal(downstream.relayedCalls.size, 0);
		} finally {
			await client.close();
			await server.close();
			await worker.close();
		}
	});
});
