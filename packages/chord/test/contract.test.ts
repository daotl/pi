import assert from "node:assert/strict";
import { type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { describe, it } from "vitest";
import { contractFromDescription } from "../src/contract.ts";
import {
	bind,
	coverage,
	createHost,
	hostFamily,
	hostNamed,
	isChordError,
	local,
	memoryLinkPair,
	method,
	opaque,
	type Ref,
	remote,
} from "../src/index.ts";
import { canonicalIdentity, fits, normalize } from "../src/schema.ts";

const View = Type.Object({ text: Type.String() });

const chatV1 = remote("t.chat", {
	version: 1,
	input: Type.Object({ session: Type.String(), conversation: Type.Number({ default: 0 }) }),
	host: hostFamily("session:", "session"),
	variants: {
		viewer: { state: { view: View } },
		participant: {
			state: { view: View },
			methods: { send: method(Type.Object({ text: Type.String() }), Type.Object({ id: Type.Number() })) },
		},
	},
});

describe("contracts", () => {
	it("normalizes input and omits defaults from the identity", () => {
		const a = normalize(chatV1.input, { session: "s", extra: 1 }, "input");
		assert.deepEqual(a, { session: "s", conversation: 0 });
		const b = normalize(chatV1.input, { conversation: 0, session: "s" }, "input");
		assert.equal(canonicalIdentity(chatV1.input, a), canonicalIdentity(chatV1.input, b));
		assert.equal(canonicalIdentity(chatV1.input, a), '{"session":"s"}');
		assert.throws(
			() => normalize(chatV1.input, { session: 1 }, "input"),
			(error) => isChordError(error, "invalid") && error.reason === "input",
		);
	});

	it("tuple tails must fit consumer result and state policies", () => {
		const wanted = Type.Tuple([Type.String()]);
		const offered = Type.Tuple([Type.String()], { additionalItems: true });
		const strings = Type.Tuple([Type.String()], { additionalItems: Type.String() });
		assert.equal(Value.Check(offered, ["x", 1]), true);
		assert.equal(Value.Check(wanted, ["x", 1]), false);
		assert.equal(Value.Check(strings, ["x", 1]), false);
		assert.equal(fits(offered, wanted), false);
		assert.equal(fits(offered, strings), false);
		assert.equal(fits(strings, Type.Array(Type.String())), true);
		assert.equal(fits(offered, Type.Array(Type.String())), false);
		assert.equal(fits(wanted, offered), true);
		for (const member of ["result", "state"] as const) {
			const contract = (schema: typeof wanted) =>
				remote(`t.tuple-tail-${member}`, {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("server"),
					variants: {
						main:
							member === "result"
								? { methods: { read: method(undefined, schema) } }
								: { state: { value: schema } },
					},
				});
			assert.throws(
				() => bind(contract(offered), undefined, contract(wanted)),
				(error) => isChordError(error, "contract_mismatch") && error.message.includes(member),
			);
		}
	});

	it("union sibling constraints remain part of result and state coverage", () => {
		const wanted = Type.Union([Type.Number(), Type.String()], { minimum: 1 });
		const offered = Type.Number();
		assert.equal(Value.Check(offered, 0), true);
		assert.equal(Value.Check(wanted, 0), false);
		assert.equal(fits(offered, wanted), false);
		assert.equal(fits(wanted, wanted), true);
		assert.equal(fits(offered, Type.Union([Type.Number(), Type.String()])), true);
		for (const member of ["result", "state"] as const) {
			const contract = (schema: typeof wanted | typeof offered) =>
				remote(`t.union-siblings-${member}`, {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("server"),
					variants: {
						main:
							member === "result"
								? { methods: { read: method(undefined, schema) } }
								: { state: { value: schema } },
					},
				});
			const provider = contract(offered);
			const consumer = contract(wanted);
			assert.match(coverage(provider.description, consumer.description) ?? "", new RegExp(member));
			assert.throws(
				() => bind(provider, undefined, consumer),
				(error) => isChordError(error, "contract_mismatch") && error.message.includes(member),
			);
		}
	});

	it("finite result and state coverage retains sibling validation constraints", () => {
		for (const finite of [{ enum: ["a", "bb"] }, { const: "a" }]) {
			const offered = Type.String({ ...finite, enum: ["a"] });
			const wanted = Type.String({ ...finite, minLength: 2 });
			assert.equal(Value.Check(offered, "a"), true);
			assert.equal(Value.Check(wanted, "a"), false);
			for (const member of ["result", "state"] as const) {
				const contract = (schema: typeof offered) =>
					remote(`t.finite-${member}`, {
						version: 1,
						input: Type.Object({}),
						host: hostNamed("server"),
						variants: {
							main:
								member === "result"
									? { methods: { read: method(undefined, schema) } }
									: { state: { value: schema } },
						},
					});
				assert.throws(
					() => bind(contract(offered), undefined, contract(wanted)),
					(error) => isChordError(error, "contract_mismatch") && error.message.includes(member),
				);
			}
		}
	});

	for (const container of ["object", "array"] as const) {
		for (const finite of ["const", "enum"] as const) {
			it(`rejects ${finite} ${container} outputs with incompatible nested types`, () => {
				const value = container === "object" ? { x: 1 } : [1];
				const membership = finite === "const" ? { const: value } : { enum: [value] };
				const offered =
					container === "object"
						? Type.Object({ x: Type.Number() }, membership)
						: Type.Array(Type.Number(), membership);
				const wanted = container === "object" ? Type.Object({ x: Type.String() }) : Type.Array(Type.String());
				for (const member of ["result", "state"] as const) {
					const contract = (schema: TSchema) =>
						remote(`t.finite-container-${member}`, {
							version: 1,
							input: Type.Object({}),
							host: hostNamed("server"),
							variants: {
								main:
									member === "result"
										? { methods: { read: method(undefined, schema) } }
										: { state: { value: schema } },
							},
						});
					assert.throws(
						() => bind(contract(offered), undefined, contract(wanted)),
						(error) => isChordError(error, "contract_mismatch"),
					);
				}
			});
		}
	}

	it("named properties must fit every matching provider pattern without rejecting additive methods", () => {
		const consumerArgs = Type.Object({ x: Type.String() }, { additionalProperties: false });
		const conflictingArgs = Type.Object(
			{ x: Type.String() },
			{ patternProperties: { "^x$": Type.String(), x: Type.Number() } },
		);
		assert.equal(Value.Check(consumerArgs, { x: "text" }), true);
		assert.equal(Value.Check(conflictingArgs, { x: "text" }), false);
		assert.equal(fits(consumerArgs, conflictingArgs), false);
		const contract = (args: typeof consumerArgs) =>
			remote("t.named-patterns", {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("server"),
				variants: { main: { methods: { send: method(args) } } },
			});
		const consumer = contract(consumerArgs);
		assert.throws(
			() => bind(contract(conflictingArgs), undefined, consumer),
			(error) => isChordError(error, "contract_mismatch") && /arguments/.test(error.message),
		);
		const additiveArgs = Type.Object(
			{ x: Type.String(), added: Type.Optional(Type.Number()) },
			{ patternProperties: { "^x$": Type.String(), x: Type.String() } },
		);
		assert.equal(fits(consumerArgs, additiveArgs), true);
		assert.equal(bind(contract(additiveArgs), undefined, consumer), undefined);
	});

	it("optional output fields require a constraint on every way the provider may supply them", () => {
		const wanted = Type.Object({ b: Type.Optional(Type.String()) });
		for (const additionalProperties of [undefined, true, Type.Number()]) {
			const offered = Type.Object({}, additionalProperties === undefined ? {} : { additionalProperties });
			assert.equal(Value.Check(offered, { b: 7 }), true);
			assert.equal(Value.Check(wanted, { b: 7 }), false);
			assert.equal(fits(offered, wanted), false);
		}
		assert.equal(fits(Type.Object({}, { additionalProperties: false }), wanted), true);
		assert.equal(fits(Type.Object({}, { additionalProperties: Type.String() }), wanted), true);
		assert.equal(fits(Type.Object({}, { patternProperties: { "^b$": Type.String() } }), wanted), true);
		assert.equal(
			fits(
				Type.Object({}, { additionalProperties: Type.Number(), patternProperties: { "^b$": Type.String() } }),
				wanted,
			),
			true,
		);
		assert.equal(fits(Type.Object({}, { patternProperties: { "^other$": Type.String() } }), wanted), false);
		assert.equal(
			fits(Type.Object({}, { patternProperties: { "^b$": Type.String(), b: Type.Number() } }), wanted),
			false,
		);
	});

	it("closed results and state reject provider pattern keys outside the consumer policy", () => {
		const offered = Type.Object({}, { patternProperties: { "^x$": Type.Number() }, additionalProperties: false });
		const wanted = Type.Object({}, { additionalProperties: false });
		assert.equal(Value.Check(offered, { x: 1 }), true);
		assert.equal(Value.Check(wanted, { x: 1 }), false);
		assert.equal(fits(offered, wanted), false);
		for (const member of ["result", "state"] as const) {
			const contract = (schema: typeof wanted) =>
				remote(`t.closed-pattern-${member}`, {
					version: 1,
					input: Type.Object({}),
					host: hostNamed("server"),
					variants: {
						main:
							member === "result"
								? { methods: { read: method(undefined, schema) } }
								: { state: { value: schema } },
					},
				});
			assert.throws(
				() => bind(contract(offered), undefined, contract(wanted)),
				(error) => isChordError(error, "contract_mismatch") && error.message.includes(member),
			);
		}
	});

	it("closed object patterns remain conservative while accepting identical compatible name policies", () => {
		const wanted = Type.Object({}, { patternProperties: { "^x": Type.Number() }, additionalProperties: false });
		const offered = Type.Object(
			{ x: Type.Optional(Type.Integer()) },
			{ patternProperties: { "^x": Type.Integer() }, additionalProperties: false },
		);
		assert.equal(Value.Check(offered, { x: 1, xx: 2 }), true);
		assert.equal(Value.Check(wanted, { x: 1, xx: 2 }), true);
		assert.equal(fits(offered, wanted), true);
		const provider = remote("t.closed-compatible-patterns", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: { main: { state: { value: offered }, methods: { read: method(undefined, offered) } } },
		});
		const consumer = remote(provider.name, {
			...provider.def,
			variants: { main: { state: { value: wanted }, methods: { read: method(undefined, wanted) } } },
		});
		assert.equal(bind(provider, undefined, consumer), undefined);
		assert.equal(
			fits(Type.Object({}, { patternProperties: { "^y": Type.Number() }, additionalProperties: false }), wanted),
			false,
		);
		assert.equal(
			fits(Type.Object({}, { patternProperties: { "^x": Type.String() }, additionalProperties: false }), wanted),
			false,
		);
	});

	it("cleaned inputs preserve nested additive contracts without relaxing output compatibility", () => {
		const before = Type.Array(Type.Object({ a: Type.String() }));
		const after = Type.Array(Type.Object({ a: Type.String(), b: Type.Optional(Type.Number()) }));
		assert.equal(fits(before, after), false);
		assert.equal(fits(before, after, "cleaned-input"), true);
		assert.equal(
			fits(Type.Array(Type.Object({ a: Type.String() }, { additionalProperties: true })), after, "cleaned-input"),
			false,
		);
		const consumer = remote("t.nested-additive", {
			version: 1,
			input: Type.Object({ rows: before }),
			host: hostNamed("server"),
			variants: { main: { methods: { send: method(Type.Object({ rows: before })) } } },
		});
		const provider = remote(consumer.name, {
			...consumer.def,
			input: Type.Object({ rows: after }),
			variants: { main: { methods: { send: method(Type.Object({ rows: after })) } } },
		});
		assert.equal(bind(provider, undefined, consumer), undefined);
	});

	for (const surface of ["input", "args", "result", "state"] as const) {
		it(`unchanged nested primitive unions allow additive ${surface} siblings locally and over a link`, async () => {
			const oldShape = Type.Object({ choice: Type.Union([Type.String(), Type.Number()]) });
			const newShape = Type.Object({
				choice: Type.Union([Type.String(), Type.Number()]),
				added: Type.Optional(Type.Number()),
			});
			const contract = <S extends typeof oldShape>(shape: S) =>
				remote(`t.additive-union-${surface}`, {
					version: 1,
					input: surface === "input" ? Type.Object({ nested: shape }) : Type.Object({}),
					host: hostNamed("server"),
					variants: {
						main: {
							state: { value: surface === "state" ? Type.Object({ nested: shape }) : Type.Number() },
							methods: {
								read: method(
									surface === "args" ? Type.Object({ nested: shape }) : Type.Object({}),
									surface === "result" ? Type.Object({ nested: shape }) : Type.String(),
								),
							},
						},
					},
				});
			const consumer = contract(oldShape);
			const provider = contract(newShape);
			assert.equal(coverage(provider.description, consumer.description), undefined);
			assert.equal(bind(provider, undefined, consumer), undefined);
			const server = createHost({ self: {}, name: "server" });
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal: {} });
			const client = createHost({ self: {}, kind: "client", upstream: { link: up, principal: {} } });
			try {
				server.serve(provider, (input, _principal, self) => ({
					variant: "main",
					value: self.state(
						"value",
						provider.def.variants.main.state.value,
						surface === "state" ? { nested: { choice: "snapshot", added: 3 } } : 0,
					),
					read: (args) => {
						if (surface === "args") assert.deepEqual(args, { nested: { choice: 7 } });
						if (surface === "input") assert.deepEqual(input, { nested: { choice: "address" } });
						return surface === "result" ? { nested: { choice: 9, added: 4 } } : "accepted";
					},
				}));
				for (const host of [server, client]) {
					const ref = await host.get(consumer, surface === "input" ? { nested: { choice: "address" } } : {});
					const result = await ref.read(surface === "args" ? { nested: { choice: 7 } } : {});
					assert.deepEqual(result, surface === "result" ? { nested: { choice: 9, added: 4 } } : "accepted");
					assert.deepEqual(
						ref.value.value,
						surface === "state" ? { nested: { choice: "snapshot", added: 3 } } : 0,
					);
					ref.release();
				}
			} finally {
				await client.close();
				await server.close();
			}
		});
	}

	it("additive siblings do not authorize peer references, schema DAGs, regexes or spoofed union branches", async () => {
		const provider = remote("t.nested-union-trust", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				main: {
					methods: {
						call: method(
							Type.Object({
								choice: Type.Union([Type.String(), Type.Number()]),
								added: Type.Optional(Type.Number()),
							}),
						),
					},
				},
			},
		});
		let invoked = false;
		const server = createHost({ self: {}, name: "server" });
		server.serve(provider, () => ({
			variant: "main",
			call: () => {
				invoked = true;
			},
		}));
		const defs: Record<string, object> = { n0: {} };
		for (let i = 1; i <= 14; i++)
			defs[`n${i}`] = { allOf: [{ $ref: `#/$defs/n${i - 1}` }, { $ref: `#/$defs/n${i - 1}` }] };
		try {
			for (const choice of [
				{ anyOf: [{ $defs: defs, $ref: "#/$defs/n14" }] },
				{ anyOf: [{ type: "string", pattern: "^(a+)+$" }, { type: "number" }] },
				{ anyOf: [{ type: "string", "~kind": "Cyclic" }, { type: "number" }] },
				{ "~kind": "Cyclic", $defs: defs },
			]) {
				const peer = contractFromDescription({
					...provider.description,
					variants: { main: { call: { kind: "method", args: Type.Object({ choice }) } } },
				});
				assert.throws(
					() => server.hold(peer, {}),
					(error) => isChordError(error, "invalid") && error.reason === "token",
				);
			}
			assert.equal(invoked, false);
		} finally {
			await server.close();
		}
	});

	it("received union projections retain the consumer shape and cannot be changed through shared metadata", async () => {
		const consumer = remote("t.owned-union-projection", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("server"),
			variants: {
				main: {
					methods: { call: method(Type.Object({ choice: Type.Union([Type.String(), Type.Number()]) })) },
				},
			},
		});
		const provider = remote(consumer.name, {
			...consumer.def,
			variants: {
				main: {
					methods: {
						call: method(
							Type.Object({
								choice: Type.Union([Type.String(), Type.Number()]),
								added: Type.Optional(Type.Number()),
							}),
						),
					},
				},
			},
		});
		const description = JSON.parse(JSON.stringify(consumer.description)) as typeof consumer.description;
		const peer = contractFromDescription(description);
		const shared = contractFromDescription(description);
		const server = createHost({ self: {}, name: "server" });
		const seen: unknown[] = [];
		server.serve(provider, () => ({
			variant: "main",
			call: (args) => {
				seen.push(args);
			},
		}));
		try {
			const ref = (await server.get(peer, {})) as unknown as Ref<typeof consumer>;
			const member = description.variants.main.call;
			assert.ok(member.kind === "method");
			member.args = Type.Object({ choice: Type.Unknown(), added: Type.Number() });
			for (const value of ["text", 7]) {
				const args = { choice: value, added: 99 };
				await ref.call(args);
			}
			const other = (await server.get(shared, {})) as unknown as Ref<typeof consumer>;
			await other.call({ choice: 8 });
			assert.deepEqual(seen, [{ choice: "text" }, { choice: 7 }, { choice: 8 }]);
			other.release();
			ref.release();
		} finally {
			await server.close();
		}
	});

	it("object arguments stay callable and cleaned with a record provider locally and over a link", async () => {
		const consumer = remote("t.object-record-arguments", {
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
			variants: { main: { methods: { send: method(Type.Record(Type.String(), Type.String()), Type.String()) } } },
		});
		assert.equal(coverage(provider.description, consumer.description), undefined);
		const server = createHost({ self: {}, name: "server" });
		const [down, up] = memoryLinkPair();
		server.accept(down, { principal: {} });
		const client = createHost({ self: {}, kind: "client", upstream: { link: up, principal: {} } });
		try {
			server.serve(provider, () => ({
				variant: "main",
				send: (args) => {
					assert.deepEqual(args, { x: "ok" });
					return args.x;
				},
			}));
			for (const host of [server, client]) {
				const ref = await host.get(consumer, {});
				const args = { x: "ok", extra: "discard" };
				assert.equal(await ref.send(args), "ok");
				ref.release();
			}
		} finally {
			await client.close();
			await server.close();
		}
	});

	it("rebinding a received object token cannot change an existing reference's argument projection", async () => {
		const consumer = remote("t.rebound-object-record", {
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
		const recordProvider = remote(consumer.name, {
			...consumer.def,
			variants: { main: { methods: { send: method(Type.Record(Type.String(), Type.String()), Type.String()) } } },
		});
		const incompatible = remote(consumer.name, {
			...consumer.def,
			variants: { main: { methods: { send: method(Type.Record(Type.String(), Type.Number()), Type.String()) } } },
		});
		const peer = contractFromDescription(consumer.description);
		const server = createHost({ self: {}, name: "server" });
		try {
			server.serve(consumer, () => ({
				variant: "main",
				send: (args) => {
					assert.deepEqual(args, { x: "retained" });
					return args.x;
				},
			}));
			const ref = (await server.get(peer, {})) as unknown as Ref<typeof consumer>;
			const args = { x: "retained", extra: "discard" };
			assert.equal(await ref.send(args), "retained");
			assert.throws(
				() => bind(incompatible, undefined, peer),
				(error) => isChordError(error, "contract_mismatch"),
			);
			assert.equal(await ref.send(args), "retained");
			assert.equal(bind(recordProvider, undefined, peer), undefined);
			assert.equal(await ref.send(args), "retained");
			ref.release();
		} finally {
			await server.close();
		}
	});

	it("fingerprints are stable and description-based", () => {
		const copy = remote("t.chat", chatV1.def);
		assert.equal(copy.fingerprint, chatV1.fingerprint);
		assert.notEqual(remote("t.chat", { ...chatV1.def, version: 2 }).fingerprint, chatV1.fingerprint);
	});

	for (const variant of ["main", "__proto__"] as const) {
		it(`calls inherited-name and computed __proto__ methods over a link in variant ${variant}`, async () => {
			const contract = remote(`t.member-names-${variant}`, {
				version: 1,
				input: Type.Object({}),
				host: hostNamed("server"),
				variants: {
					[variant]: {
						methods: {
							toString: method(undefined, Type.String()),
							valueOf: method(undefined, Type.String()),
							hasOwnProperty: method(undefined, Type.String()),
							constructor: method(undefined, Type.String()),
							["__proto__"]: method(undefined, Type.String()),
						},
					},
				},
			});
			const server = createHost({ self: {}, name: "server" });
			const [down, up] = memoryLinkPair();
			server.accept(down, { principal: {} });
			const client = createHost({
				self: {},
				name: "client",
				kind: "client",
				upstream: { link: up, principal: {} },
			});
			try {
				server.serve(contract, () => ({
					variant,
					toString: () => "toString result",
					valueOf: () => "valueOf result",
					hasOwnProperty: () => "hasOwnProperty result",
					constructor: () => "constructor result",
					["__proto__"]: () => "__proto__ result",
				}));
				const ref = client.hold(contract, {});
				await ref.ready;
				assert.equal(ref.variant, variant);
				assert.equal(await ref.toString(), "toString result");
				assert.equal(await ref.valueOf(), "valueOf result");
				// biome-ignore lint/suspicious/noPrototypeBuiltins: This invokes the remote contract member, not Object.prototype.
				assert.equal(await ref.hasOwnProperty(), "hasOwnProperty result");
				assert.equal(await ref.constructor(), "constructor result");
				assert.equal(await ref.__proto__(), "__proto__ result");
			} finally {
				await client.close();
				await server.close();
			}
		});
	}

	it("calls a computed __proto__ member through a local reference", async () => {
		const contract = local("t.local-prototype-member", {
			version: 1,
			input: Type.Object({}),
			members: { ["__proto__"]: method(undefined, Type.String()) },
		});
		assert.throws(
			() => bind(local(contract.name, { version: 1, input: Type.Object({}) }), undefined, contract),
			(error) => isChordError(error, "contract_mismatch"),
		);
		const host = createHost({ self: {}, name: "server" });
		try {
			host.serve(contract, () => ({ ["__proto__"]: () => "local result" }));
			const ref = host.hold(contract, {});
			await ref.ready;
			assert.equal(await ref.__proto__(), "local result");
		} finally {
			await host.close();
		}
	});

	it("rejects actual state and method collisions, including computed __proto__", () => {
		for (const name of ["send", "toString", "__proto__"]) {
			assert.throws(
				() =>
					remote("t.duplicate-member", {
						version: 1,
						input: Type.Object({}),
						host: hostNamed("server"),
						variants: { main: { state: { [name]: Type.String() }, methods: { [name]: method() } } },
					}),
				TypeError,
			);
		}
	});

	it("rejects reserved member names and opaque remote members", () => {
		assert.throws(() => local("t.x", { version: 1, input: Type.Object({}), members: { status: method() } }));
		assert.throws(() =>
			remote("t.x", {
				host: hostNamed("server"),
				version: 1,
				input: Type.Object({}),
				variants: { a: { state: { h: opaque("x@1") as never } } },
			}),
		);
	});

	it("covers additive changes and refuses breaking ones", () => {
		const additive = remote("t.chat", {
			...chatV1.def,
			variants: {
				...chatV1.def.variants,
				participant: {
					state: { view: Type.Object({ text: Type.String(), extra: Type.Number() }) },
					methods: {
						send: method(
							Type.Object({ text: Type.String(), urgent: Type.Optional(Type.Boolean()) }),
							Type.Object({ id: Type.Number(), at: Type.Number() }),
						),
					},
				},
			},
		});
		assert.equal(coverage(additive.description, chatV1.description), undefined);
		assert.equal(bind(additive, undefined, chatV1), undefined);

		const required = remote("t.chat", {
			...chatV1.def,
			variants: {
				...chatV1.def.variants,
				participant: {
					state: { view: View },
					methods: {
						send: method(
							Type.Object({ text: Type.String(), urgent: Type.Boolean() }),
							Type.Object({ id: Type.Number() }),
						),
					},
				},
			},
		});
		assert.match(coverage(required.description, chatV1.description) ?? "", /arguments/);
		assert.throws(
			() => bind(required, undefined, chatV1),
			(error) => isChordError(error, "contract_mismatch"),
		);

		const retyped = remote("t.chat", {
			...chatV1.def,
			variants: { ...chatV1.def.variants, viewer: { state: { view: Type.Object({ text: Type.Number() }) } } },
		});
		assert.match(coverage(retyped.description, chatV1.description) ?? "", /state/);
	});

	it("methods without arguments or result: described without them; their presence must match, a void consumer accepts a result", () => {
		const of = (members: Parameters<typeof local>[1]["members"]) =>
			local("t.methods", { version: 1, input: Type.Object({}), members }).description;
		const none = of({ m: method() });
		assert.deepEqual(none.variants[""]?.m, { kind: "method" });
		const withArgs = of({ m: method(Type.String()) });
		const withResult = of({ m: method(undefined, Type.Number()) });
		assert.equal(coverage(none, none), undefined);
		assert.match(coverage(withArgs, none) ?? "", /arguments/, "the consumer sends none, the provider expects some");
		assert.match(coverage(none, withArgs) ?? "", /arguments/, "the consumer sends some, the provider takes none");
		assert.equal(coverage(withResult, none), undefined, "a void consumer ignores a result");
		assert.match(coverage(none, withResult) ?? "", /result/, "a consumer expecting a result needs one");
	});

	it("binds other versions only through accepts adapters", () => {
		const v2 = remote("t.chat", { ...chatV1.def, version: 2, variants: { viewer: { state: { body: View } } } });
		assert.throws(
			() => bind(v2, undefined, chatV1),
			(error) => isChordError(error, "contract_mismatch"),
		);
		const adapter = (current: Record<string, unknown>) => ({ variant: "viewer", view: current.body });
		assert.equal(bind(v2, { 1: adapter }, chatV1), adapter);
	});

	it("compares opaque members by name@version and function members structurally", () => {
		const a = local("t.idx", {
			version: 1,
			input: Type.Object({}),
			members: {
				harness: opaque("h@1"),
				onChange: method(Type.Function([Type.String()], Type.Void())),
			},
		});
		const b = local("t.idx", { ...a.def, members: { ...a.def.members, harness: opaque("h@2") } });
		assert.match(coverage(b.description, a.description) ?? "", /opaque/);
		assert.ok(fits(Type.Function([Type.Unknown()], Type.Void()), Type.Function([Type.String()], Type.Void())));
		assert.ok(!fits(Type.Function([Type.String()], Type.Void()), Type.Function([Type.Unknown()], Type.Void())));
	});
});
