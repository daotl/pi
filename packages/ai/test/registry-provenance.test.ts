import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	getApiProvider,
	isKnownApiProvider,
	registerApiProvider,
	registerBuiltInApiProviders,
	registerFauxProvider,
	resetApiProviders,
	unregisterApiProviders,
} from "../src/compat.ts";
import type { Api } from "../src/types.ts";

const builtinApis: Api[] = [
	"anthropic-messages",
	"openai-completions",
	"openai-responses",
	"openai-codex-responses",
	"azure-openai-responses",
	"google-generative-ai",
	"google-vertex",
	"mistral-conversations",
	"bedrock-converse-stream",
	"pi-messages",
];

function unexpectedStream(): never {
	throw new Error("Provenance checks must not invoke a transport");
}

describe("compat registry provenance", () => {
	beforeEach(() => resetApiProviders());
	afterEach(() => resetApiProviders());

	it.each(builtinApis)("recognizes repository builtin %s with the correct direct capability", (api) => {
		expect(isKnownApiProvider(api)).toBe(true);
		expect(isKnownApiProvider(api, true)).toBe(api === "openai-completions");
	});

	it("does not recognize missing or externally registered API labels", () => {
		expect(isKnownApiProvider("unregistered")).toBe(false);
		expect(isKnownApiProvider("unregistered", true)).toBe(false);

		for (const api of ["custom-api", "faux", ...builtinApis]) {
			registerApiProvider({ api, stream: unexpectedStream, streamSimple: unexpectedStream });
			expect(isKnownApiProvider(api)).toBe(false);
			expect(isKnownApiProvider(api, true)).toBe(false);
		}
	});

	it.each(["stream", "streamSimple"] as const)(
		"revokes builtin provenance when %s changes and restores it only for the original pair",
		(method) => {
			const provider = getApiProvider("openai-completions")!;
			const original = provider[method];
			provider[method] = unexpectedStream;

			expect(isKnownApiProvider("openai-completions")).toBe(false);
			expect(isKnownApiProvider("openai-completions", true)).toBe(false);
			registerBuiltInApiProviders();
			expect(isKnownApiProvider("openai-completions")).toBe(false);
			expect(isKnownApiProvider("openai-completions", true)).toBe(false);

			provider[method] = original;
			expect(isKnownApiProvider("openai-completions")).toBe(true);
			expect(isKnownApiProvider("openai-completions", true)).toBe(true);
		},
	);

	it("does not transfer builtin provenance when original wrappers are externally re-registered", () => {
		const original = getApiProvider("openai-completions")!;
		registerApiProvider(original, "external");

		expect(isKnownApiProvider("openai-completions")).toBe(false);
		expect(isKnownApiProvider("openai-completions", true)).toBe(false);
		registerBuiltInApiProviders();
		expect(isKnownApiProvider("openai-completions")).toBe(false);
		expect(isKnownApiProvider("openai-completions", true)).toBe(false);

		unregisterApiProviders("external");
		expect(isKnownApiProvider("openai-completions")).toBe(false);
		registerBuiltInApiProviders();
		expect(isKnownApiProvider("openai-completions")).toBe(true);
		expect(isKnownApiProvider("openai-completions", true)).toBe(true);
	});

	it("does not clobber or bless an external override during builtin registration", () => {
		registerApiProvider(
			{ api: "openai-completions", stream: unexpectedStream, streamSimple: unexpectedStream },
			"external",
		);
		const external = getApiProvider("openai-completions");

		registerBuiltInApiProviders();

		expect(getApiProvider("openai-completions")).toBe(external);
		expect(isKnownApiProvider("openai-completions")).toBe(false);
		expect(isKnownApiProvider("openai-completions", true)).toBe(false);

		resetApiProviders();
		expect(isKnownApiProvider("openai-completions")).toBe(true);
		expect(isKnownApiProvider("openai-completions", true)).toBe(true);
	});

	it.each(["faux", "faux:custom", "openai-completions", "openai-responses"])(
		"recognizes explicitly registered faux %s without granting direct transport capability",
		(api) => {
			const registration = registerFauxProvider({ api });
			expect(isKnownApiProvider(api)).toBe(true);
			expect(isKnownApiProvider(api, true)).toBe(false);
			registerBuiltInApiProviders();
			expect(isKnownApiProvider(api)).toBe(true);
			expect(isKnownApiProvider(api, true)).toBe(false);

			registration.unregister();
			expect(isKnownApiProvider(api)).toBe(false);
			expect(isKnownApiProvider(api, true)).toBe(false);
		},
	);

	it.each(["stream", "streamSimple"] as const)("revokes faux provenance when %s changes", (method) => {
		const registration = registerFauxProvider({ api: "openai-completions" });
		const provider = getApiProvider(registration.api)!;
		const original = provider[method];
		provider[method] = unexpectedStream;
		expect(isKnownApiProvider(registration.api)).toBe(false);
		expect(isKnownApiProvider(registration.api, true)).toBe(false);

		provider[method] = original;
		expect(isKnownApiProvider(registration.api)).toBe(true);
		expect(isKnownApiProvider(registration.api, true)).toBe(false);
	});

	it("does not transfer faux provenance to replacement registrations", () => {
		const first = registerFauxProvider({ api: "faux:replacement" });
		const original = getApiProvider(first.api)!;
		registerApiProvider(original);
		expect(isKnownApiProvider(first.api)).toBe(false);

		const second = registerFauxProvider({ api: first.api });
		first.unregister();
		expect(isKnownApiProvider(second.api)).toBe(true);
		expect(isKnownApiProvider(second.api, true)).toBe(false);
		second.unregister();
		expect(isKnownApiProvider(second.api)).toBe(false);
	});

	it("resets overrides and faux registrations to native builtin capabilities", () => {
		const faux = registerFauxProvider({ api: "openai-completions" });
		registerFauxProvider({ api: "faux:reset" });
		const provider = getApiProvider("openai-responses")!;
		provider.streamSimple = unexpectedStream;

		resetApiProviders();
		faux.unregister();

		expect(isKnownApiProvider("openai-completions")).toBe(true);
		expect(isKnownApiProvider("openai-completions", true)).toBe(true);
		expect(isKnownApiProvider("openai-responses")).toBe(true);
		expect(isKnownApiProvider("openai-responses", true)).toBe(false);
		expect(isKnownApiProvider("faux:reset")).toBe(false);
	});
});
