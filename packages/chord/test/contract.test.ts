import assert from "node:assert/strict";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { describe, it } from "vitest";
import { bind, coverage, hostFamily, hostNamed, isChordError, local, method, opaque, remote } from "../src/index.ts";
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

	it("fingerprints are stable and description-based", () => {
		const copy = remote("t.chat", chatV1.def);
		assert.equal(copy.fingerprint, chatV1.fingerprint);
		assert.notEqual(remote("t.chat", { ...chatV1.def, version: 2 }).fingerprint, chatV1.fingerprint);
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
