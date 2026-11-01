import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { ChordError, invalid } from "./errors.ts";
import { canonicalJson, fits, hash64, receivedSchemaRoots } from "./schema.ts";
import type { Ctx, Exposed, Readable, RefBase, StateSource } from "./types.ts";

const MEMBER = Symbol("chord.member");

/** A method's arguments and result; `undefined`: it takes no arguments, or returns nothing (void). */
export interface MethodSpec<
	A extends TSchema | undefined = TSchema | undefined,
	R extends TSchema | undefined = TSchema | undefined,
> {
	readonly [MEMBER]: "method";
	readonly args: A;
	readonly result: R;
}

export interface OpaqueSpec<T = unknown> {
	readonly [MEMBER]: "opaque";
	readonly id: string;
	/** Type carrier only; never set. */
	readonly type?: T;
}

/**
 * A method. `method()`: no arguments (called as `ref.name(ctx)`, implemented as `(ctx) => …`) and no result.
 * `method(args)`: no result, the handler returns nothing (void). `method(args, result)`, or `method(undefined, result)`
 * for a method without arguments that returns something.
 */
export function method(): MethodSpec<undefined, undefined>;
export function method<A extends TSchema>(args: A): MethodSpec<A, undefined>;
export function method<A extends TSchema | undefined, R extends TSchema>(args: A, result: R): MethodSpec<A, R>;
export function method(args?: TSchema, result?: TSchema): MethodSpec {
	return { [MEMBER]: "method", args, result };
}

/** A native in-process object identified by `name@version` (local contracts only). */
export const opaque = <T = unknown>(id: string): OpaqueSpec<T> => {
	if (!/^[^@\s]+@\d+$/.test(id)) throw new TypeError(`opaque id must be name@version: ${id}`);
	return { [MEMBER]: "opaque", id };
};

export interface VariantDef {
	readonly state?: Readonly<Record<string, TSchema>>;
	readonly methods?: Readonly<Record<string, MethodSpec>>;
}

/** Where objects of a remote type live: one named host. */
export interface HostNamed {
	readonly name: string;
}

/** Where objects of a remote type live: the host `prefix` + the input's string field `key` (`session:` + `session`). */
export interface HostFamily<K extends string = string> {
	readonly prefix: string;
	readonly key: K;
}

/** A remote type's placement: data only, so a description carries it and every host can check it. */
export type Placement = HostNamed | HostFamily;

/** Objects of the type live on the host named `name` (`hostNamed("server")`). */
export function hostNamed(name: string): HostNamed {
	if (typeof name !== "string" || name === "") throw new TypeError("hostNamed needs a host name");
	return { name };
}

/**
 * Objects of the type live on `prefix` + the value of the input's string field `key`: `hostFamily("session:",
 * "session")` puts `{ session: "S1", … }` on `session:S1`. The field is required and must be a non-empty string.
 */
export function hostFamily<const K extends string>(prefix: string, key: K): HostFamily<K> {
	if (typeof prefix !== "string" || prefix === "") throw new TypeError("hostFamily needs a host-name prefix");
	if (typeof key !== "string" || key === "") throw new TypeError("hostFamily needs an input field name");
	return { prefix, key };
}

/** Required string fields of `I`: what a `hostFamily` may name. */
type StringKeys<I> = { [K in keyof I]-?: I[K] extends string ? K : never }[keyof I] & string;
/** The placements a remote type with input `I` may have. */
export type PlacementFor<I> = HostNamed | HostFamily<StringKeys<I>>;

/** The host an object of `placement` with this (normalized) input lives on. Throws `invalid/placement`. */
export function resolveHost(typeName: string, placement: Placement, input: unknown): string {
	if ("name" in placement) return placement.name;
	const value =
		input !== null && typeof input === "object" ? (input as Record<string, unknown>)[placement.key] : undefined;
	if (typeof value !== "string" || value === "")
		throw invalid("placement", `${typeName}: input field ${placement.key} names no host`);
	return placement.prefix + value;
}

/** Whether the host named `hostName` may serve a type of `placement`. */
export const placedOn = (placement: Placement, hostName: string): boolean =>
	"name" in placement
		? placement.name === hostName
		: hostName.startsWith(placement.prefix) && hostName.length > placement.prefix.length;

export const placementText = (placement: Placement): string =>
	"name" in placement ? placement.name : `${placement.prefix}<${placement.key}>`;

export interface RemoteDef {
	readonly version: number;
	readonly input: TSchema;
	/** Where its objects live: `hostNamed(…)` or `hostFamily(…)`. Part of the contract (and its fingerprint). */
	readonly host: Placement;
	readonly variants: Readonly<Record<string, VariantDef>>;
}

/** A local member: a method, an opaque native object, or a state member described by its schema. */
export type LocalMember = MethodSpec | OpaqueSpec | TSchema;

export interface LocalDef {
	readonly version: number;
	readonly input: TSchema;
	readonly members?: Readonly<Record<string, LocalMember>>;
}

// A description travels as a reference's contract token (wire.ts), so it is declared once, as the schema that validates it.
// `TSchema` is an empty interface: any object is one, which is all a peer's schema is checked for here.
const SchemaObject = Type.Unsafe<TSchema>(Type.Object({}));

const MemberDescriptionSchema = Type.Union([
	// Absent `args`: the method takes none. Absent `result`: it returns nothing.
	Type.Object({
		kind: Type.Literal("method"),
		args: Type.Optional(SchemaObject),
		result: Type.Optional(SchemaObject),
	}),
	Type.Object({ kind: Type.Literal("state"), schema: SchemaObject }),
	Type.Object({ kind: Type.Literal("opaque"), id: Type.String() }),
]);
export type MemberDescription = Static<typeof MemberDescriptionSchema>;

/** Local contracts have one unnamed variant. */
export const LOCAL_VARIANT = "";

const PlacementSchema = Type.Union([
	Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
	Type.Object(
		{ prefix: Type.String({ minLength: 1 }), key: Type.String({ minLength: 1 }) },
		{ additionalProperties: false },
	),
]);

export const DescriptionSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	scope: Type.Union([Type.Literal("remote"), Type.Literal("local")]),
	version: Type.Integer(),
	input: SchemaObject,
	/** Remote types only (required there): where their objects live. */
	host: Type.Optional(PlacementSchema),
	variants: Type.Record(Type.String(), Type.Record(Type.String(), MemberDescriptionSchema)),
});
export type Description = Static<typeof DescriptionSchema>;

interface ContractBase {
	readonly name: string;
	readonly version: number;
	readonly input: TSchema;
	readonly description: Description;
	readonly fingerprint: string;
}

export interface RemoteContract<D extends RemoteDef = RemoteDef> extends ContractBase {
	readonly scope: "remote";
	readonly def: D;
}

export interface LocalContract<D extends LocalDef = LocalDef> extends ContractBase {
	readonly scope: "local";
	readonly def: D;
}

export type AnyContract = RemoteContract | LocalContract;

/** Names a reference uses itself; members may not use them. */
export const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
	"variant",
	"status",
	"ready",
	"shape",
	"error",
	"onShape",
	"onStatus",
	"release",
	"then",
	"contract",
]);

function describeMember(name: string, member: unknown, scope: "remote" | "local"): MemberDescription {
	if (RESERVED_MEMBERS.has(name)) throw new TypeError(`member name is reserved: ${name}`);
	const brand = (member as { [MEMBER]?: string })[MEMBER];
	if (brand === "method") {
		const spec = member as MethodSpec;
		return {
			kind: "method",
			...(spec.args === undefined ? {} : { args: spec.args }),
			...(spec.result === undefined ? {} : { result: spec.result }),
		};
	}
	if (brand === "opaque") {
		if (scope === "remote") throw new TypeError(`remote contracts cannot expose opaque members: ${name}`);
		return { kind: "opaque", id: (member as OpaqueSpec).id };
	}
	return { kind: "state", schema: member as TSchema };
}

function finish<C extends AnyContract>(contract: Omit<C, "fingerprint">): C {
	return { ...contract, fingerprint: hash64(canonicalJson(contract.description)) } as C;
}

function checkHeader(name: string, version: number): void {
	if (!name) throw new TypeError("contract name is empty");
	if (!Number.isInteger(version) || version < 1) throw new TypeError(`contract version must be a positive integer`);
}

export function remote<const D extends RemoteDef>(
	name: string,
	def: D & { readonly host: PlacementFor<Static<D["input"]>> },
): RemoteContract<D> {
	checkHeader(name, def.version);
	const placement = def.host as Placement | undefined;
	if (placement === undefined || !Value.Check(PlacementSchema, placement))
		throw new TypeError(`remote contract ${name} needs \`host\`: hostNamed(…) or hostFamily(…)`);
	// A JSON copy: the description travels, and a placement object may carry nothing else.
	const host: Placement =
		"name" in placement ? { name: placement.name } : { prefix: placement.prefix, key: placement.key };
	const variants: Record<string, Record<string, MemberDescription>> = Object.create(null);
	if (Object.keys(def.variants).length === 0) throw new TypeError(`remote contract ${name} has no variants`);
	for (const [kind, variant] of Object.entries(def.variants)) {
		const members: Record<string, MemberDescription> = Object.create(null);
		for (const [key, schema] of Object.entries(variant.state ?? {}))
			members[key] = describeMember(key, schema, "remote");
		for (const [key, spec] of Object.entries(variant.methods ?? {})) {
			if (Object.hasOwn(members, key))
				throw new TypeError(`member ${key} is both state and method in ${name}.${kind}`);
			members[key] = describeMember(key, spec, "remote");
			if (members[key].kind !== "method") throw new TypeError(`methods.${key} is not a method()`);
		}
		variants[kind] = members;
	}
	const description: Description = { name, scope: "remote", version: def.version, input: def.input, host, variants };
	return finish<RemoteContract<D>>({
		scope: "remote",
		name,
		version: def.version,
		input: def.input,
		def,
		description,
	});
}

export function local<const D extends LocalDef>(name: string, def: D): LocalContract<D> {
	checkHeader(name, def.version);
	const members: Record<string, MemberDescription> = Object.create(null);
	for (const [key, member] of Object.entries(def.members ?? {})) members[key] = describeMember(key, member, "local");
	const description: Description = {
		name,
		scope: "local",
		version: def.version,
		input: def.input,
		variants: { [LOCAL_VARIANT]: members },
	};
	return finish<LocalContract<D>>({ scope: "local", name, version: def.version, input: def.input, def, description });
}

const receivedContracts = new WeakSet<AnyContract>();

const STRUCTURAL_KINDS: Readonly<Record<string, true>> = {
	Object: true,
	Record: true,
	Array: true,
	Tuple: true,
	String: true,
	Number: true,
	Integer: true,
	Boolean: true,
	Null: true,
	Literal: true,
	Unknown: true,
	Any: true,
	Never: true,
	Optional: true,
	Readonly: true,
};

/** Whether the token was reconstructed from declarative peer metadata, not registered application code. */
export const isReceivedContract = (contract: AnyContract): boolean => receivedContracts.has(contract);

/**
 * A consumer token received over a link. Descriptions are bounded to 64 levels, 16384 nodes and 256 KiB of text
 * before hashing or compatibility. Input normalization uses registered provider schemas. Peer regex sources must
 * match registered schemas; flat primitive unions may match their registered subtree, while references and other
 * executable forms require the identical trusted schema root. Runtime projection uses the registered kinds/subtrees.
 * Adapters have no historical schemas, so unmatched executable old-version schemas are refused.
 */
export function contractFromDescription(description: Description): AnyContract {
	// Bound metadata before recursive hashing, compatibility checks, or schema traversal. This does not restrict
	// schema keywords: peer schemas remain data, and only registered provider schemas normalize object inputs.
	const pending: { value: unknown; depth: number }[] = [{ value: description, depth: 0 }];
	let nodes = 0;
	let characters = 0;
	while (pending.length > 0) {
		const { value, depth } = pending.pop()!;
		if (++nodes > 16384 || depth > 64 || characters > 262144)
			throw invalid("token", "contract description exceeds metadata limits");
		if (typeof value === "string") characters += value.length;
		else if (value !== null && typeof value === "object") {
			for (const [key, child] of Object.entries(value)) {
				characters += key.length;
				pending.push({ value: child, depth: depth + 1 });
				if (pending.length + nodes > 16384 || characters > 262144)
					throw invalid("token", "contract description exceeds metadata limits");
			}
		}
	}
	if (characters > 262144) throw invalid("token", "contract description exceeds metadata limits");
	// Own each received token independently. Neither caller mutation nor another token sharing a schema object may
	// change the schema associated with a bound runtime projection. Wire metadata has no hidden TypeBox properties.
	description = JSON.parse(canonicalJson(description)) as Description;
	const owned: object[] = [description];
	while (owned.length > 0) {
		const value = owned.pop()!;
		for (const child of Object.values(value)) if (child !== null && typeof child === "object") owned.push(child);
		Object.freeze(value);
	}
	const { name, scope, version, input, host } = description;
	if (
		typeof name !== "string" ||
		(scope !== "remote" && scope !== "local") ||
		!Number.isInteger(version) ||
		(scope === "remote") !== (host !== undefined)
	) {
		throw new ChordError("invalid", "malformed contract token", { reason: "token" });
	}
	const base = { name, version, input, description, fingerprint: hash64(canonicalJson(description)) };
	const contract: AnyContract =
		scope === "remote"
			? { ...base, scope, def: { version, input, host: host!, variants: {} } }
			: { ...base, scope, def: { version, input } };
	receivedContracts.add(contract);
	return contract;
}

/** Returns why `provider` does not cover `consumer`, or undefined when it does. */
export function coverage(provider: Description, consumer: Description): string | undefined {
	if (provider.name !== consumer.name || provider.scope !== consumer.scope) return "different type";
	if (!samePlacement(provider, consumer)) return "host";
	if (!fits(consumer.input, provider.input, "cleaned-input")) return "input";
	for (const [kind, consumerMembers] of Object.entries(consumer.variants)) {
		const providerMembers = provider.variants[kind];
		if (providerMembers === undefined) return `variant ${kind} missing`;
		for (const [name, wanted] of Object.entries(consumerMembers)) {
			const offered = providerMembers[name];
			if (offered === undefined || offered.kind !== wanted.kind) return `${kind}.${name} missing or of another kind`;
			if (offered.kind === "method" && wanted.kind === "method") {
				// Both take arguments or neither does; a consumer that expects no result accepts any.
				if ((wanted.args === undefined) !== (offered.args === undefined)) return `${kind}.${name} arguments`;
				if (
					wanted.args !== undefined &&
					offered.args !== undefined &&
					!fits(wanted.args, offered.args, "cleaned-input")
				)
					return `${kind}.${name} arguments`;
				if (wanted.result !== undefined && (offered.result === undefined || !fits(offered.result, wanted.result)))
					return `${kind}.${name} result`;
			} else if (offered.kind === "state" && wanted.kind === "state") {
				if (!fits(offered.schema, wanted.schema)) return `${kind}.${name} state`;
			} else if (offered.kind === "opaque" && wanted.kind === "opaque" && offered.id !== wanted.id) {
				return `${kind}.${name} opaque ${offered.id} != ${wanted.id}`;
			}
		}
	}
	return undefined;
}

const samePlacement = (a: Description, b: Description): boolean =>
	canonicalJson(a.host ?? null) === canonicalJson(b.host ?? null);
const placementOf = (description: Description): string =>
	description.host === undefined ? "(local)" : placementText(description.host);

/** Maps the provider's current implementation to the view a consumer of an older contract version expects. */
export type Adapter = (current: Record<string, unknown>) => Record<string, unknown>;
export type Accepts = Readonly<Record<number, Adapter>>;

/** How a consumer token binds to a provider: directly or through an `accepts` adapter. Throws contract_mismatch. */
export function bind(provider: AnyContract, accepts: Accepts | undefined, consumer: AnyContract): Adapter | undefined {
	const projections: { wanted: TSchema; projected: TSchema }[] = [];
	if (isReceivedContract(consumer)) {
		const pending: {
			offered: unknown;
			wanted: unknown;
			projected?: unknown;
			root?: { offered: unknown; wanted: unknown; projected: TSchema };
		}[] = [{ offered: provider.input, wanted: consumer.input }];
		for (const [variant, members] of Object.entries(consumer.description.variants)) {
			for (const [name, wanted] of Object.entries(members)) {
				const offered = provider.description.variants[variant]?.[name];
				if (wanted.kind === "state") {
					pending.push({ offered: offered?.kind === "state" ? offered.schema : undefined, wanted: wanted.schema });
				} else if (wanted.kind === "method") {
					pending.push({ offered: offered?.kind === "method" ? offered.args : undefined, wanted: wanted.args });
					pending.push({
						offered: offered?.kind === "method" ? offered.result : undefined,
						wanted: wanted.result,
					});
				}
			}
		}
		const roots = pending.map((entry) => {
			const projected = JSON.parse(canonicalJson(entry.wanted)) as TSchema;
			entry.projected = projected;
			entry.root = { offered: entry.offered, wanted: entry.wanted, projected };
			return entry.root;
		});
		while (pending.length > 0) {
			const { offered, wanted, projected, root } = pending.pop()!;
			if (wanted === null || typeof wanted !== "object") continue;
			const schema = wanted as Record<string, unknown>;
			const trusted = offered !== null && typeof offered === "object" ? (offered as Record<string, unknown>) : {};
			const projection = projected as Record<string, unknown>;
			delete projection["~kind"];
			// Only a flat primitive union is context-independent: no refs, recursive definitions, combinator branches,
			// or custom kinds. Other executable schemas retain the whole-root check below, including reference context.
			const primitiveUnion =
				trusted["~kind"] === "Union" &&
				Object.keys(schema).every((key) => key === "anyOf" || key === "~kind") &&
				Array.isArray(schema.anyOf) &&
				schema.anyOf.length <= 64 &&
				Array.isArray(trusted.anyOf) &&
				trusted.anyOf.every((branch: unknown) => {
					if (branch === null || typeof branch !== "object") return false;
					const primitive = branch as Record<string, unknown>;
					const kind = primitive["~kind"];
					return (
						kind === "Literal" ||
						(typeof primitive.type === "string" &&
							typeof kind === "string" &&
							kind.toLowerCase() === primitive.type)
					);
				}) &&
				schema.anyOf.every((branch: unknown) => {
					if (branch === null || typeof branch !== "object") return false;
					const primitive = branch as Record<string, unknown>;
					return (
						["string", "number", "integer", "boolean", "null"].includes(String(primitive.type)) &&
						Object.keys(primitive).every((key) => key === "type" || key === "const")
					);
				}) &&
				canonicalJson(schema) === canonicalJson(trusted);
			if (
				(["$ref", "$dynamicRef", "$recursiveRef", "allOf", "anyOf", "oneOf", "not", "if", "then", "else"].some(
					(key) => key in schema,
				) ||
					(typeof schema["~kind"] === "string" && !Object.hasOwn(STRUCTURAL_KINDS, schema["~kind"]))) &&
				!primitiveUnion
			) {
				if (canonicalJson(root?.wanted) !== canonicalJson(root?.offered))
					throw invalid("token", "peer executable schemas must match the registered provider schema");
				root!.projected = root!.offered as TSchema;
			}
			if (primitiveUnion) {
				Object.defineProperties(projection, Object.getOwnPropertyDescriptors(trusted));
				continue;
			}
			// JSON type does not distinguish TypeBox Object/Record or Array/Tuple layouts.
			let kind: string | undefined;
			if (schema.type === "object") {
				if (schema.properties !== null && typeof schema.properties === "object") kind = "Object";
				else if (
					schema.patternProperties !== null &&
					typeof schema.patternProperties === "object" &&
					Object.keys(schema.patternProperties).length === 1
				)
					kind = "Record";
			} else if (schema.type === "array" && schema.items !== null && typeof schema.items === "object") {
				kind = Array.isArray(schema.items) ? "Tuple" : "Array";
			}
			if (kind !== undefined) Object.defineProperty(projection, "~kind", { value: kind, configurable: true });
			if ("pattern" in schema && canonicalJson(schema.pattern) !== canonicalJson(trusted.pattern))
				throw invalid("token", "peer regular expressions must match the registered provider schema");
			// Property/member names are data, not schema keywords; only descend through schema-bearing locations.
			for (const key of [
				"properties",
				"patternProperties",
				"$defs",
				"definitions",
				"dependentSchemas",
				"dependencies",
			]) {
				const children = schema[key];
				if (children === null || typeof children !== "object") continue;
				const known = trusted[key];
				const trustedChildren =
					known !== null && typeof known === "object" ? (known as Record<string, unknown>) : {};
				if (
					key === "patternProperties" &&
					canonicalJson(Object.keys(children).sort()) !== canonicalJson(Object.keys(trustedChildren).sort())
				)
					throw invalid("token", "peer regular expressions must match the registered provider schema");
				for (const [name, child] of Object.entries(children))
					pending.push({
						offered: trustedChildren[name],
						wanted: child,
						projected: (projection[key] as Record<string, unknown>)[name],
						root,
					});
			}
			for (const key of [
				"items",
				"prefixItems",
				"additionalItems",
				"additionalProperties",
				"unevaluatedItems",
				"unevaluatedProperties",
				"contains",
				"propertyNames",
				"not",
				"if",
				"then",
				"else",
				"allOf",
				"anyOf",
				"oneOf",
				"parameters",
				"returnType",
			]) {
				const children = schema[key];
				if (Array.isArray(children)) {
					const known = Array.isArray(trusted[key]) ? (trusted[key] as unknown[]) : [];
					children.forEach((child, index) => {
						pending.push({
							offered: known[index],
							wanted: child,
							projected: (projection[key] as unknown[])[index],
							root,
						});
					});
				} else pending.push({ offered: trusted[key], wanted: children, projected: projection[key], root });
			}
		}
		for (const root of roots) {
			if (root.wanted !== null && typeof root.wanted === "object")
				projections.push({ wanted: root.wanted as TSchema, projected: root.projected });
		}
	}
	let adapter: Adapter | undefined;
	if (
		provider.fingerprint === consumer.fingerprint &&
		canonicalJson(provider.description) === canonicalJson(consumer.description)
	) {
		// Exact tokens need no compatibility check after the received-schema guard.
	} else if (!samePlacement(provider.description, consumer.description)) {
		throw new ChordError(
			"contract_mismatch",
			`${provider.name} lives on ${placementOf(provider.description)}, the consumer expects ${placementOf(consumer.description)}`,
		);
	} else if (provider.version === consumer.version) {
		const reason = coverage(provider.description, consumer.description);
		if (reason !== undefined)
			throw new ChordError(
				"contract_mismatch",
				`${provider.name}@${provider.version} does not cover the consumer's description (${reason}); forgotten version bump?`,
			);
	} else {
		adapter = accepts?.[consumer.version];
		if (adapter === undefined) {
			throw new ChordError(
				"contract_mismatch",
				`${provider.name}: provider version ${provider.version}, consumer version ${consumer.version}, no accepts adapter`,
			);
		}
	}
	// A later compatible provider must not replace the projection used by existing references.
	for (const { wanted, projected } of projections) {
		const existing = receivedSchemaRoots.get(wanted);
		if (existing === undefined) continue;
		if (canonicalJson(existing) !== canonicalJson(projected))
			throw invalid("token", "received schema projection changed across bindings");
		const pending: { existing: unknown; projected: unknown }[] = [{ existing, projected }];
		while (pending.length > 0) {
			const pair = pending.pop()!;
			if (pair.existing === null || typeof pair.existing !== "object") continue;
			const previous = pair.existing as Record<string, unknown>;
			const next = pair.projected as Record<string, unknown>;
			if (previous["~kind"] !== next["~kind"])
				throw invalid("token", "received schema projection changed across bindings");
			for (const [key, child] of Object.entries(previous)) pending.push({ existing: child, projected: next[key] });
		}
	}
	for (const { wanted, projected } of projections)
		if (!receivedSchemaRoots.has(wanted)) receivedSchemaRoots.set(wanted, projected);
	return adapter;
}

// ─── Static types ────────────────────────────────────────────────────────────

type Empty = Record<never, never>;
type StateOf<V> = V extends { readonly state: infer S extends Readonly<Record<string, TSchema>> } ? S : Empty;
type StaticOf<S> = S extends TSchema ? Static<S> : never;
type MethodsOf<V> = V extends { readonly methods: infer M extends Readonly<Record<string, MethodSpec>> } ? M : Empty;

/** What a handler returns: the result's value, or nothing for a void method. */
type Returned<R> = [R] extends [TSchema] ? Static<R> | Promise<Static<R>> : void | Promise<void>;
/** What a call resolves to. */
type Resolved<R> = [R] extends [TSchema] ? Static<R> : undefined;

/** A method's handler; `P` is the app's principal type (`ctx.principal`). */
export type MethodImplementation<M, P = unknown> = M extends MethodSpec<infer A, infer R>
	? [A] extends [TSchema]
		? (args: Static<A>, ctx: Ctx<P>) => Returned<R>
		: (ctx: Ctx<P>) => Returned<R>
	: never;
export type Call<M> = M extends MethodSpec<infer A, infer R>
	? [A] extends [TSchema]
		? (args: Static<A>, ctx?: Ctx) => Promise<Resolved<R>>
		: (ctx?: Ctx) => Promise<Resolved<R>>
	: never;

/** Whether a method in the active variant takes only ctx. */
export function takesNoArgs(contract: AnyContract, name: string, variant: string | undefined): boolean {
	const member = contract.description.variants[variant ?? LOCAL_VARIANT]?.[name];
	return member?.kind === "method" && member.args === undefined;
}

type VariantImplementation<K, V, P> = { readonly variant: K } & {
	readonly [S in keyof StateOf<V>]: StateSource<StaticOf<StateOf<V>[S]>>;
} & {
	readonly [M in keyof MethodsOf<V>]: MethodImplementation<MethodsOf<V>[M], P>;
};
/**
 * A reference in one variant: its state members are plain readables (a reference you hold has its state) and its
 * methods calls. `variant` discriminates the union `Ref` is for a multi-variant type.
 */
type VariantRef<C extends AnyContract, K, V> = RefBase<C> & { readonly variant: K } & {
	readonly [S in keyof StateOf<V>]: Readable<StaticOf<StateOf<V>[S]>>;
} & {
	readonly [M in keyof MethodsOf<V>]: Call<MethodsOf<V>[M]>;
};

type LocalImplementationMember<M, P> = M extends MethodSpec
	? MethodImplementation<M, P>
	: M extends OpaqueSpec<infer T>
		? T | Exposed<T>
		: M extends TSchema
			? StateSource<Static<M>>
			: never;
type LocalRefMember<M> = M extends MethodSpec
	? Call<M>
	: M extends OpaqueSpec<infer T>
		? T | undefined
		: M extends TSchema
			? Readable<Static<M>>
			: never;
type LocalMembers<D> = D extends { readonly members: infer M extends Readonly<Record<string, LocalMember>> }
	? M
	: Empty;

export type InputOf<C> = C extends { readonly def: { readonly input: infer I extends TSchema } } ? Static<I> : never;

/** What a factory returns for contract C; its methods' `ctx.principal` is `P`. */
export type ImplementationOf<C, P = unknown> = C extends RemoteContract<infer D>
	? { [K in keyof D["variants"]]: VariantImplementation<K, D["variants"][K], P> }[keyof D["variants"]]
	: C extends LocalContract<infer D>
		? { readonly [K in keyof LocalMembers<D>]: LocalImplementationMember<LocalMembers<D>[K], P> } & Record<
				string,
				unknown
			>
		: never;

/**
 * What `get` returns for contract C. A remote type's reference is a union discriminated by `variant`: another variant's
 * members are reachable only after narrowing (`if (ref.variant === "editor") ref.add(…)`). A local type's reference has
 * its members.
 */
export type Ref<C extends AnyContract = AnyContract> = C extends RemoteContract<infer D>
	? { [K in keyof D["variants"]]: VariantRef<C, K, D["variants"][K]> }[keyof D["variants"]]
	: C extends LocalContract<infer D>
		? RefBase<C> & { readonly [K in keyof LocalMembers<D>]: LocalRefMember<LocalMembers<D>[K]> }
		: never;
