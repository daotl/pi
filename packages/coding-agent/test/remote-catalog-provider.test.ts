import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createModels,
	createProvider,
	type ImageModel,
	InMemoryCredentialStore,
	InMemoryModelsStore,
	type Model,
	type ModelsPublication,
	type Provider,
	type RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { openrouterProvider, personalizeOpenRouterCatalog } from "@earendil-works/pi-ai/providers/openrouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hydrateModelCatalog } from "../../ai/scripts/hydrate-model-catalog.ts";
import { VERSION } from "../src/config.ts";
import { ModelConfig } from "../src/core/model-config.ts";
import { composeModelProvider } from "../src/core/provider-composer.ts";
import {
	type PersonalizeCatalog,
	REMOTE_CATALOG_MODEL_TYPES,
	withPersonalizedCatalog,
	withRemoteCatalog,
} from "../src/core/remote-catalog-provider.ts";

const neverAbortedSignal = new AbortController().signal;

function model(id: string): Model<"openai-completions"> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider: "test-provider",
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

function builtinProvider(builtinModels: Model<"openai-completions">[] = [model("static")]): Provider {
	return createProvider({
		id: "test-provider",
		auth: { apiKey: { name: "Test", resolve: async () => ({ auth: {} }) } },
		models: builtinModels,
		api: {
			stream: () => {
				throw new Error("not used");
			},
			streamSimple: () => {
				throw new Error("not used");
			},
		},
	});
}

function testProvider(localGeneratedAt?: number) {
	return withRemoteCatalog(builtinProvider(), "https://pi.dev", localGeneratedAt);
}

async function refreshProvider(
	provider: Provider,
	store: InMemoryModelsStore,
	overrides: Partial<
		Pick<RefreshModelsContext, "allowNetwork" | "force" | "signal" | "credential" | "auth" | "baseUrl">
	> = {},
): Promise<void> {
	const publish = async (publication: ModelsPublication): Promise<boolean> => {
		if (publication.persist === null) await store.delete(provider.id);
		else if (publication.persist !== undefined) await store.write(provider.id, publication.persist);
		publication.update?.();
		return true;
	};
	await provider.refreshModels?.({
		credential: overrides.credential ?? { type: "api_key" },
		auth: overrides.auth ?? {
			apiKey: overrides.credential?.type === "oauth" ? overrides.credential.access : overrides.credential?.key,
		},
		baseUrl: overrides.baseUrl ?? provider.baseUrl,
		stored: await store.read(provider.id),
		publish,
		allowNetwork: overrides.allowNetwork ?? true,
		force: overrides.force,
		signal: overrides.signal ?? neverAbortedSignal,
	});
}

afterEach(() => vi.restoreAllMocks());

describe("remote catalog provider", () => {
	it("parses keyed catalogs, sends version headers, observes the refresh TTL, and supports forced refreshes", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(JSON.stringify({ dynamic: model("dynamic") }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const provider = testProvider();
		const store = new InMemoryModelsStore();
		await refreshProvider(provider, store);
		await refreshProvider(provider, store);
		await refreshProvider(provider, store, { force: true });

		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "dynamic"]);
		expect((await store.read(provider.id))?.models.map((entry) => entry.id)).toEqual(["dynamic"]);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({
			"User-Agent": expect.stringContaining(`pi/${VERSION}`),
		});
		const requested = new URL(String(fetchSpy.mock.calls[0]?.[0]));
		expect(requested.pathname).toBe("/api/models/providers/test-provider");
		expect(requested.searchParams.get("types")).toBe(REMOTE_CATALOG_MODEL_TYPES.join(","));
	});

	it("overlays image and classifier models and drops unknown model types", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						chat: { ...model("chat"), type: "chat" },
						flux: {
							type: "image",
							id: "flux",
							name: "FLUX",
							api: "openrouter-images",
							provider: "test-provider",
							baseUrl: "https://example.test/v1",
							input: ["text"],
							output: ["image"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						},
						jev: {
							type: "classifier",
							id: "jev",
							name: "Jev",
							api: "typesafe-system-one",
							provider: "test-provider",
							baseUrl: "https://example.test/v1",
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 64000,
						},
						clip: { ...model("clip"), type: "video" },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
		const provider = testProvider();
		const store = new InMemoryModelsStore();
		await refreshProvider(provider, store);

		const models = createModels({ modelsStore: store });
		models.setProvider(provider);
		expect(models.getAllModels("test-provider").map((entry) => entry.id)).toEqual(["static", "chat", "flux", "jev"]);
		expect(models.getModelOfType("image", "test-provider", "flux")?.type).toBe("image");
		expect(models.getModelOfType("classifier", "test-provider", "jev")?.type).toBe("classifier");
		expect(models.getModel("test-provider", "flux")).toBeUndefined();
		const stored = await store.read(provider.id);
		expect(stored?.models.map((entry) => entry.id)).toEqual(["chat", "flux", "jev"]);
	});

	it("prefers the newer of the generated and remote catalogs", async () => {
		const localGeneratedAt = Date.parse("2026-07-23T10:00:00.000Z");
		const newerHeader = new Date(localGeneratedAt + 60_000).toUTCString();
		const responses = [
			new Response(JSON.stringify({ old: model("old") }), {
				headers: { "last-modified": new Date(localGeneratedAt - 60_000).toUTCString() },
			}),
			new Response(JSON.stringify({ newer: model("newer") }), {
				headers: { "last-modified": newerHeader },
			}),
		];
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift() as Response);
		const provider = testProvider(localGeneratedAt);
		const store = new InMemoryModelsStore();

		await refreshProvider(provider, store);
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static"]);

		await refreshProvider(provider, store, { force: true });
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "newer"]);
		expect(await store.read(provider.id)).toMatchObject({ lastModified: Date.parse(newerHeader) });
	});

	it.each([-60_000, 60_000])(
		"uses hydrated freshness for an offline stored catalog offset by %i ms",
		async (offset) => {
			const root = mkdtempSync(join(tmpdir(), "pi-hydrated-freshness-"));
			try {
				const providers = join(root, "src/providers");
				mkdirSync(providers, { recursive: true });
				writeFileSync(
					join(root, "src/models.generated.ts"),
					'import { TEST_PROVIDER_CLASSIFIER_MODELS, TEST_PROVIDER_IMAGE_MODELS, TEST_PROVIDER_MODELS } from "./providers/test-provider.models.ts";\n',
				);
				writeFileSync(join(providers, "test-provider.models.ts"), "");
				const generatedAt = "2026-10-21T12:12:47.000Z";
				const builtin = { ...model("static"), type: "chat", contextWindow: 2000 };
				const catalogPath = join(root, "catalog.json");
				writeFileSync(catalogPath, JSON.stringify({ "test-provider": [builtin] }));
				hydrateModelCatalog(root, catalogPath, { generatedAt });
				const manifest = JSON.parse(readFileSync(join(providers, "data/.manifest.json"), "utf8")) as {
					generatedAt: string;
				};
				const data = JSON.parse(readFileSync(join(providers, "data/test-provider.json"), "utf8")) as Record<
					string,
					Record<string, Model<"openai-completions">>
				>;
				const provider = withRemoteCatalog(
					builtinProvider(Object.values(data["openai-completions"])),
					"https://pi.dev",
					Date.parse(manifest.generatedAt),
				);
				const store = new InMemoryModelsStore();
				await store.write(provider.id, {
					models: [model("static")],
					checkedAt: 1,
					lastModified: Date.parse(generatedAt) + offset,
				});
				const fetchSpy = vi.spyOn(globalThis, "fetch");
				await refreshProvider(provider, store, { allowNetwork: false });
				expect(provider.getModels().find((entry) => entry.id === "static")?.contextWindow).toBe(
					offset < 0 ? 2000 : 1000,
				);
				expect(fetchSpy).not.toHaveBeenCalled();
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
	);

	it("revalidates a stored catalog with its etag and keeps the overlay on 304", async () => {
		const responses = [
			new Response(JSON.stringify({ dynamic: model("dynamic") }), {
				headers: { "content-type": "application/json", etag: '"catalog-1"' },
			}),
			new Response(null, { status: 304, headers: { etag: '"catalog-1"' } }),
		];
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift() as Response);
		const provider = testProvider();
		const store = new InMemoryModelsStore();

		await refreshProvider(provider, store);
		expect(fetchSpy.mock.calls[0]?.[1]?.headers).not.toHaveProperty("if-none-match");
		expect(await store.read(provider.id)).toMatchObject({ etag: '"catalog-1"' });

		const checkedAt = (await store.read(provider.id))?.checkedAt;
		await refreshProvider(provider, store, { force: true });

		expect(fetchSpy.mock.calls[1]?.[1]?.headers).toMatchObject({ "if-none-match": '"catalog-1"' });
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "dynamic"]);
		const stored = await store.read(provider.id);
		expect(stored?.models.map((entry) => entry.id)).toEqual(["dynamic"]);
		expect(stored?.etag).toBe('"catalog-1"');
		expect(stored?.checkedAt).toBeGreaterThanOrEqual(checkedAt ?? 0);
	});

	it("drops a stale etag when the overlay becomes unavailable", async () => {
		const responses = [
			new Response(JSON.stringify({ dynamic: model("dynamic") }), {
				headers: { "content-type": "application/json", etag: '"catalog-1"' },
			}),
			new Response("not implemented", { status: 501 }),
		];
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift() as Response);
		const provider = testProvider();
		const store = new InMemoryModelsStore();

		await refreshProvider(provider, store);
		await refreshProvider(provider, store, { force: true });

		expect((await store.read(provider.id))?.etag).toBeUndefined();
	});

	it("keeps the etag and overlay after a transient failure", async () => {
		const responses = [
			new Response(JSON.stringify({ dynamic: model("dynamic") }), {
				headers: { "content-type": "application/json", etag: '"catalog-1"' },
			}),
			new Response("rate limited", { status: 429 }),
			new Response("rate limited", { status: 429 }),
			new Response("rate limited", { status: 429 }),
			new Response(null, { status: 304, headers: { etag: '"catalog-1"' } }),
		];
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => responses.shift() as Response);
		const provider = testProvider();
		const store = new InMemoryModelsStore();

		await refreshProvider(provider, store);
		await expect(refreshProvider(provider, store, { force: true })).rejects.toThrow(/429/);

		const stored = await store.read(provider.id);
		expect(stored?.etag).toBe('"catalog-1"');
		expect(stored?.models.map((entry) => entry.id)).toEqual(["dynamic"]);

		await refreshProvider(provider, store, { force: true });
		expect(fetchSpy.mock.calls[4]?.[1]?.headers).toMatchObject({ "if-none-match": '"catalog-1"' });
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "dynamic"]);
	});

	it("lets a newer catalog request bypass a stalled older request without stale publication", async () => {
		let calls = 0;
		let markFirstStarted: (() => void) | undefined;
		let finishFirst: ((response: Response) => void) | undefined;
		const firstStarted = new Promise<void>((resolve) => {
			markFirstStarted = resolve;
		});
		const firstResponse = new Promise<Response>((resolve) => {
			finishFirst = resolve;
		});
		vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
			calls++;
			if (calls === 1) {
				markFirstStarted?.();
				return firstResponse;
			}
			return new Response(JSON.stringify({ newer: model("newer") }), {
				headers: { "content-type": "application/json" },
			});
		});
		const provider = testProvider();
		const store = new InMemoryModelsStore();
		const models = createModels({ modelsStore: store });
		models.setProvider(provider);

		const first = models.refresh({ providers: [provider.id], force: true });
		await firstStarted;
		const second = models.refresh({ providers: [provider.id], force: true });
		await second;
		await first;
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "newer"]);

		finishFirst?.(
			new Response(JSON.stringify({ older: model("older") }), {
				headers: { "content-type": "application/json" },
			}),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static", "newer"]);
		expect((await store.read(provider.id))?.models.map((entry) => entry.id)).toEqual(["newer"]);
	});

	it("treats unimplemented pi.dev catalog routes as an unavailable overlay", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not implemented", { status: 501 }));
		const provider = testProvider();
		const store = new InMemoryModelsStore();

		await expect(refreshProvider(provider, store)).resolves.toBeUndefined();
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static"]);
		expect(await store.read(provider.id)).toMatchObject({ models: [], checkedAt: expect.any(Number) });
	});
});

describe("personalized catalog provider", () => {
	const imageModel: ImageModel<"openrouter-images"> = {
		type: "image",
		id: "image",
		name: "image",
		api: "openrouter-images",
		provider: "test-provider",
		baseUrl: "https://example.test/v1",
		input: ["text"],
		output: ["image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	it.each(["transport", "http", "json"] as const)(
		"personalizes the built-in catalog after an optional overlay %s failure",
		async (failure) => {
			vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
				if (String(input).endsWith("/models/user")) {
					return Response.json({
						data: [
							{ id: "static", context_length: 8000, pricing: { prompt: "0.000003", completion: "0.000015" } },
						],
					});
				}
				if (failure === "transport") throw new TypeError("catalog unavailable");
				return failure === "http" ? new Response("unavailable", { status: 503 }) : new Response("{invalid");
			});
			const store = new InMemoryModelsStore();
			const personalized = {
				...model("static"),
				contextWindow: 8000,
				cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
			};
			const provider = withPersonalizedCatalog(
				builtinProvider([model("static"), model("excluded")]),
				personalizeOpenRouterCatalog,
			);

			await refreshProvider(provider, store, { credential: { type: "api_key", key: "test-key" } });

			expect(provider.getModels()).toEqual([personalized]);
			expect((await store.read(provider.id))?.models).toEqual([personalized]);
		},
	);

	it.each(["unchanged", "key", "header", "endpoint", "auth-endpoint", "unverifiable"] as const)(
		"restores only matching personalized identity (%s)",
		async (change) => {
			vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("missing", { status: 404 }));
			const store = new InMemoryModelsStore();
			const credentials = new InMemoryCredentialStore();
			await credentials.modify("test-provider", async () => ({ type: "api_key", key: "key-a" }));
			const builtin = builtinProvider([model("static"), model("other")]);
			const auth = { apiKey: "key-a", headers: { Authorization: "Bearer gateway-a" } };
			const personalized = withPersonalizedCatalog(builtin, async () => [
				{ ...model("static"), contextWindow: 8000 },
			]);
			const base: Provider = {
				...personalized,
				baseUrl: "https://region-a.test/v1",
				auth: { apiKey: { name: "Test", resolve: async () => ({ auth }) } },
				resolveCachedModelAuth: async () => auth,
			};
			const models = createModels({ credentials, modelsStore: store });
			models.setProvider(base);
			await models.refresh();
			if (change === "key") await credentials.modify(base.id, async () => ({ type: "api_key", key: "key-b" }));
			const currentAuth =
				change === "header"
					? { ...auth, headers: { Authorization: "Bearer gateway-b" } }
					: change === "auth-endpoint"
						? { ...auth, baseUrl: "https://resolved.test/v1" }
						: auth;
			models.setProvider({
				...base,
				baseUrl: change === "endpoint" ? "https://region-b.test/v1" : base.baseUrl,
				resolveCachedModelAuth: change === "unverifiable" ? undefined : async () => currentAuth,
			});
			const fetch = vi.mocked(globalThis.fetch);
			fetch.mockClear();
			await models.refresh({ allowNetwork: false });
			expect(models.getModels().map((entry) => [entry.id, entry.contextWindow])).toEqual(
				change === "unchanged"
					? [["static", 8000]]
					: [
							["static", 1000],
							["other", 1000],
						],
			);
			expect(fetch).not.toHaveBeenCalled();
			const saved = await store.read(base.id);
			expect(saved?.personalizationKey).toMatch(/^[a-f0-9]{64}$/);
			expect(JSON.stringify(saved)).not.toMatch(/key-a|gateway-a/);
		},
	);

	it("does not execute arbitrary API-key resolution during cache-only refresh", async () => {
		const resolve = vi.fn(async () => {
			throw new Error("must not resolve offline");
		});
		const store = new InMemoryModelsStore();
		await store.write("test-provider", { models: [model("previous-account")] });
		const models = createModels({ modelsStore: store });
		models.setProvider(
			withPersonalizedCatalog(
				{ ...builtinProvider(), auth: { apiKey: { name: "Test", resolve } } },
				async (catalog) => catalog,
			),
		);
		await models.refresh({ allowNetwork: false });
		expect(models.getModels().map((entry) => entry.id)).toEqual(["static"]);
		expect(resolve).not.toHaveBeenCalled();
	});

	it.each(["unchanged", "key", "header", "endpoint", "command"] as const)(
		"keeps composed OpenRouter catalogs account-scoped offline (%s)",
		async (change) => {
			const credentials = new InMemoryCredentialStore();
			await credentials.modify("openrouter", async () => ({ type: "api_key", key: "stored-secret-a" }));
			const store = new InMemoryModelsStore();
			const config = await ModelConfig.load(undefined);
			const builtin = openrouterProvider();
			const base = withPersonalizedCatalog(
				{
					...builtin,
					getModels: () => [
						{ ...model("static"), provider: "openrouter" },
						{ ...model("other"), provider: "openrouter" },
					],
					getAllModels: undefined,
				},
				personalizeOpenRouterCatalog,
			);
			const models = createModels({ credentials, modelsStore: store });
			const options = { baseUrl: "https://region-a.test/v1", headers: { Authorization: "Bearer gateway-a" } };
			models.setProvider(composeModelProvider("openrouter", base, config, options));
			const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
				if (!String(url).endsWith("/models/user")) return new Response("missing", { status: 404 });
				expect(String(url)).toBe("https://region-a.test/v1/models/user");
				expect(new Headers(init?.headers).get("authorization")).toBe("Bearer gateway-a");
				return Response.json({ data: [{ id: "static", context_length: 8000 }] });
			});
			await models.refresh();
			expect(models.getModels().map((entry) => entry.id)).toEqual(["static"]);
			if (change === "key")
				await credentials.modify("openrouter", async () => ({ type: "api_key", key: "stored-secret-b" }));
			models.setProvider(
				composeModelProvider("openrouter", base, config, {
					...options,
					baseUrl: change === "endpoint" ? "https://region-b.test/v1" : options.baseUrl,
					headers: {
						Authorization:
							change === "header"
								? "Bearer gateway-b"
								: change === "command"
									? "!exit 99"
									: options.headers.Authorization,
					},
				}),
			);
			fetch.mockClear();
			await models.refresh({ allowNetwork: false });
			expect(models.getModels().map((entry) => entry.id)).toEqual(
				change === "unchanged" ? ["static"] : ["static", "other"],
			);
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it.each(["environment", "oauth", "expired-oauth"] as const)(
		"restores unchanged builtin %s auth offline without resolving or refreshing it",
		async (type) => {
			const builtin = openrouterProvider();
			const credential =
				type !== "environment"
					? {
							type: "oauth" as const,
							access: "access-secret",
							refresh: "refresh-secret",
							expires: Date.now() + 3600000,
						}
					: undefined;
			const credentials = new InMemoryCredentialStore();
			if (credential) await credentials.modify("openrouter", async () => credential);
			const modelsStore = new InMemoryModelsStore();
			const resolve = vi.fn(async () => ({ auth: { apiKey: "env-secret" } }));
			const refresh = vi.fn(async () => {
				throw new Error("must not refresh offline");
			});
			const provider = withPersonalizedCatalog(
				{
					...builtin,
					getModels: () => [{ ...model("static"), provider: "openrouter" }],
					getAllModels: undefined,
					auth: {
						...builtin.auth,
						apiKey: { name: "Test", resolve },
						oauth: builtin.auth.oauth ? { ...builtin.auth.oauth, refresh } : undefined,
					},
				},
				async () => [{ ...model("allowed"), provider: "openrouter" }],
			);
			const models = createModels({
				credentials,
				modelsStore,
				authContext: { env: async () => "env-secret", fileExists: async () => false },
			});
			models.setProvider(provider);
			vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
			await models.refresh();
			if (type === "expired-oauth" && credential)
				await credentials.modify("openrouter", async () => ({ ...credential, expires: 0 }));
			resolve.mockClear();
			await models.refresh({ allowNetwork: false });
			expect(models.getModels().map((entry) => entry.id)).toEqual(["allowed"]);
			expect(resolve).not.toHaveBeenCalled();
			expect(refresh).not.toHaveBeenCalled();
		},
	);
	it("derives configured literal and environment keys offline but refuses configured key commands", async () => {
		const config = await ModelConfig.load(undefined);
		const base = openrouterProvider();
		const ctx = { env: async () => "environment-secret", fileExists: async () => false };
		const literal = composeModelProvider("openrouter", base, config, { apiKey: "literal-secret" });
		const environment = composeModelProvider("openrouter", base, config, { apiKey: "$OPENROUTER_API_KEY" });
		const command = composeModelProvider("openrouter", base, config, { apiKey: "!exit 99" });
		expect(await literal.resolveCachedModelAuth?.(undefined, ctx)).toMatchObject({ apiKey: "literal-secret" });
		expect(await environment.resolveCachedModelAuth?.(undefined, ctx)).toMatchObject({
			apiKey: "environment-secret",
		});
		expect(await command.resolveCachedModelAuth?.(undefined, ctx)).toBeUndefined();
		// A stored credential wins over an unused configured command, without executing it.
		expect(await command.resolveCachedModelAuth?.({ type: "api_key", key: "stored-secret" }, ctx)).toMatchObject({
			apiKey: "stored-secret",
		});
	});

	it.each(["overlay", "personalization"] as const)(
		"does not publish a fallback after abort during %s",
		async (phase) => {
			const controller = new AbortController();
			vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
			const store = new InMemoryModelsStore();
			const seed = withPersonalizedCatalog(builtinProvider(), async () => [model("allowed")]);
			await refreshProvider(seed, store);
			const saved = await store.read("test-provider");
			vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
				if (phase === "overlay") controller.abort();
				return new Response("unavailable", { status: 503 });
			});
			const personalize = vi.fn<PersonalizeCatalog>(async () => {
				controller.abort();
				return [model("static")];
			});
			const provider = withPersonalizedCatalog(builtinProvider(), personalize);

			await refreshProvider(provider, store, { signal: controller.signal });

			expect(personalize).toHaveBeenCalledTimes(phase === "overlay" ? 0 : 1);
			expect(provider.getModels()).toEqual(saved?.models);
			expect(await store.read(provider.id)).toEqual(saved);
		},
	);

	it("keeps the saved list and saves nothing when overlay and personalization both fail", async () => {
		// Saving the catalog without personalization would replace the key's list with every model.
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
		const store = new InMemoryModelsStore();
		const seed = withPersonalizedCatalog(builtinProvider(), async () => [model("allowed")]);
		await refreshProvider(seed, store);
		const saved = await store.read("test-provider");
		const personalize: PersonalizeCatalog = async () => {
			throw new Error("user models request failed");
		};
		const provider = withPersonalizedCatalog(builtinProvider(), personalize);

		await expect(refreshProvider(provider, store)).rejects.toThrow("user models request failed");
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["allowed"]);
		expect(await store.read(provider.id)).toEqual(saved);
	});

	it("rejects legacy unbound lists and restores a matching image-only list", async () => {
		const personalize: PersonalizeCatalog = async () => [imageModel];
		const store = new InMemoryModelsStore();
		const provider = withPersonalizedCatalog(builtinProvider(), personalize);

		// Old entries lack an identity and cannot be safely attributed to the current account.
		await store.write(provider.id, { models: [], checkedAt: 1 });
		await refreshProvider(provider, store, { allowNetwork: false });
		expect(provider.getModels().map((entry) => entry.id)).toEqual(["static"]);

		// A key that may use no chat models keeps its image models and shows no chat models.
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
		await refreshProvider(provider, store);
		await refreshProvider(provider, store, { allowNetwork: false });
		expect(provider.getModels()).toEqual([]);
		expect(provider.getAllModels?.().map((entry) => entry.id)).toEqual(["image"]);
	});

	it("keeps an authoritative empty catalog online and for the same identity offline", async () => {
		const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
		const store = new InMemoryModelsStore();
		const personalize = vi.fn<PersonalizeCatalog>(async () => []);
		const provider = withPersonalizedCatalog(builtinProvider(), personalize);
		const credential = { type: "api_key" as const, key: "account-a" };
		await refreshProvider(provider, store, { credential });
		expect(provider.getModels()).toEqual([]);
		expect(provider.getAllModels?.()).toEqual([]);
		expect((await store.read(provider.id))?.models).toEqual([]);
		fetch.mockClear();
		personalize.mockClear();
		const restored = withPersonalizedCatalog(builtinProvider(), personalize);
		await refreshProvider(restored, store, { credential, allowNetwork: false });
		expect(restored.getAllModels?.()).toEqual([]);
		await refreshProvider(restored, store, {
			credential: { type: "api_key", key: "account-b" },
			allowNetwork: false,
		});
		expect(restored.getModels().map((entry) => entry.id)).toEqual(["static"]);
		expect(fetch).not.toHaveBeenCalled();
		expect(personalize).not.toHaveBeenCalled();
	});
});
