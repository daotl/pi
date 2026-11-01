import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createRadiusOAuth } from "../src/auth/oauth/radius.ts";
import { createModels, type Provider } from "../src/models.ts";
import { InMemoryModelsStore } from "../src/models-store.ts";
import { radiusProvider } from "../src/providers/radius.ts";
import { getRadiusModelsFromConfig, type RadiusGatewayConfig } from "../src/providers/radius-config.ts";

function radiusConfig(): RadiusGatewayConfig {
	return {
		baseUrl: "https://radius.example/v1",
		models: [
			{
				id: "balanced",
				name: "Fresh Balanced",
				reasoning: true,
				input: ["text"],
				cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
				contextWindow: 424242,
				maxTokens: 32000,
			},
			{
				id: "organization-only",
				name: "Organization Only",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16000,
			},
		],
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Radius provider catalogs", () => {
	it("ships a static public catalog for the default gateway", () => {
		const provider = radiusProvider();
		expect(provider.getModels().length).toBeGreaterThan(0);
		expect(provider.getModels()).toContainEqual(
			expect.objectContaining({ id: "balanced", provider: "radius", api: "pi-messages" }),
		);
	});

	it("does not apply the public Radius catalog to custom gateways", () => {
		const provider = radiusProvider({ id: "radius-dev", gateway: "http://localhost:8788" });
		expect(provider.getModels()).toEqual([]);
	});

	it("replaces the static public catalog with refreshed models", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify(radiusConfig()), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("radius", async () => ({ type: "api_key", key: "radius-key" }));
		const models = createModels({ credentials });
		models.setProvider(radiusProvider());

		const result = await models.refresh({ providers: ["radius"] });

		expect(result.errors).toEqual(new Map());
		expect(models.getModel("radius", "balanced")).toMatchObject({
			name: "Fresh Balanced",
			baseUrl: "https://radius.example/v1",
			contextWindow: 424242,
		});
		expect(models.getModel("radius", "organization-only")).toBeDefined();
		// Models disabled by the organization must not reappear from the shipped catalog.
		expect(models.getModels("radius").map((model) => model.id)).toEqual(["balanced", "organization-only"]);
	});

	it.each([false, true])("restores only matching account and gateway catalogs offline (empty: %s)", async (empty) => {
		const store = new InMemoryModelsStore();
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("radius", async () => ({ type: "api_key", key: "account-a" }));
		const config = empty ? { ...radiusConfig(), models: [] } : radiusConfig();
		const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(config));
		const models = createModels({ credentials, modelsStore: store });
		models.setProvider(radiusProvider());
		expect((await models.refresh({ providers: ["radius"] })).errors).toEqual(new Map());
		const saved = await store.read("radius");
		expect(saved?.personalizationKey).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(saved)).not.toContain("account-a");
		fetch.mockClear();
		models.setProvider(radiusProvider());
		await models.refresh({ providers: ["radius"], allowNetwork: false });
		expect(models.getModels("radius")).toEqual(getRadiusModelsFromConfig("radius", config));
		await credentials.modify("radius", async () => ({ type: "api_key", key: "account-b" }));
		await models.refresh({ providers: ["radius"], allowNetwork: false });
		expect(models.getModels("radius")).toEqual(radiusProvider().getModels());
		await credentials.modify("radius", async () => ({ type: "api_key", key: "account-a" }));
		const otherGateway = radiusProvider({ gateway: "https://other-radius.example" });
		models.setProvider(otherGateway);
		await models.refresh({ providers: ["radius"], allowNetwork: false });
		expect(models.getModels("radius")).toEqual([]);
		await store.write("radius", { models: getRadiusModelsFromConfig("radius", config), checkedAt: 1 });
		models.setProvider(radiusProvider());
		await models.refresh({ providers: ["radius"], allowNetwork: false });
		expect(models.getModels("radius")).toEqual(radiusProvider().getModels());
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each(["environment", "oauth", "unverifiable"] as const)(
		"derives %s cache identity without invoking request auth",
		async (kind) => {
			const credentials = new InMemoryCredentialStore();
			if (kind === "oauth") {
				await credentials.modify("radius", async () => ({
					type: "oauth",
					access: "access-a",
					refresh: "refresh-a",
					expires: Date.now() + 3600000,
				}));
			}
			const store = new InMemoryModelsStore();
			const provider = radiusProvider();
			const resolve = vi.fn(async () => ({ auth: { apiKey: "environment-a" } }));
			const refresh = vi.fn(async () => {
				throw new Error("Must not refresh OAuth offline");
			});
			const models = createModels({
				credentials,
				modelsStore: store,
				authContext: { env: async () => "environment-a", fileExists: async () => false },
			});
			const configured = {
				...provider,
				auth: {
					apiKey: { name: "Test", resolve },
					oauth: provider.auth.oauth ? { ...provider.auth.oauth, refresh } : undefined,
				},
			};
			models.setProvider(configured);
			const fetch = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(Response.json({ ...radiusConfig(), models: [] }));
			await models.refresh({ providers: ["radius"] });
			if (kind === "oauth")
				await credentials.modify("radius", async (current) =>
					current?.type === "oauth" ? { ...current, expires: 0 } : current,
				);
			models.setProvider({
				...configured,
				resolveCachedModelAuth: kind === "unverifiable" ? undefined : configured.resolveCachedModelAuth,
			});
			resolve.mockClear();
			fetch.mockClear();
			await models.refresh({ providers: ["radius"], allowNetwork: false });
			expect(models.getModels("radius")).toEqual(kind === "unverifiable" ? radiusProvider().getModels() : []);
			expect(resolve).not.toHaveBeenCalled();
			expect(refresh).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it.each(["Bearer gateway", null])("uses effective catalog auth headers (%s)", async (authorization) => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("radius", async () => ({ type: "api_key", key: "stored-secret" }));
		const provider = radiusProvider();
		const models = createModels({ credentials });
		models.setProvider({
			...provider,
			auth: {
				apiKey: {
					name: "Gateway",
					resolve: async () => ({
						auth: { apiKey: "stored-secret", headers: { Authorization: authorization, "X-Organization": "org" } },
					}),
				},
			},
		});
		const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			expect(String(input)).toBe("https://radius.pi.dev/v1/config");
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe(authorization);
			expect(headers.get("x-organization")).toBe("org");
			expect(headers.get("accept")).toBe("application/json");
			return Response.json(radiusConfig());
		});
		expect((await models.refresh({ providers: ["radius"] })).errors).toEqual(new Map());
		expect(models.getModels("radius")).toEqual(getRadiusModelsFromConfig("radius", radiusConfig()));
		expect(fetch).toHaveBeenCalledOnce();
	});

	it.each(["auth", "provider"] as const)(
		"loads and publishes the %s endpoint catalog without sending credentials to the original gateway",
		async (endpointSource) => {
			const credentials = new InMemoryCredentialStore();
			await credentials.modify("radius", async () => ({ type: "api_key", key: "stored-secret" }));
			const store = new InMemoryModelsStore();
			const models = createModels({ credentials, modelsStore: store });
			const endpoint = "https://account-radius.example/v1/";
			const config: RadiusGatewayConfig = {
				baseUrl: endpoint,
				models: [{ ...radiusConfig().models[1], id: "account-only", name: "Account Only" }],
			};
			models.setProvider({
				...radiusProvider(),
				baseUrl: endpointSource === "provider" ? endpoint : "https://configured-radius.example/v1",
				auth: {
					apiKey: {
						name: "Account gateway",
						resolve: async () => ({
							auth: {
								apiKey: "resolved-secret",
								headers: { "X-Organization": "account-org" },
								...(endpointSource === "auth" ? { baseUrl: endpoint } : {}),
							},
						}),
					},
				},
			});
			const requests: { url: string; authorization: string | null; organization: string | null }[] = [];
			vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				requests.push({
					url,
					authorization: headers.get("authorization"),
					organization: headers.get("x-organization"),
				});
				return Response.json(url === "https://account-radius.example/v1/config" ? config : radiusConfig());
			});

			const result = await models.refresh({ providers: ["radius"] });

			expect(result.errors).toEqual(new Map());
			expect(requests).toEqual([
				{
					url: "https://account-radius.example/v1/config",
					authorization: "Bearer resolved-secret",
					organization: "account-org",
				},
			]);
			const accountModels = getRadiusModelsFromConfig("radius", config);
			expect(models.getModels("radius")).toEqual(accountModels);
			expect((await store.read("radius"))?.models).toEqual(accountModels);
		},
	);

	it.each([
		{ network: false, bearerHeader: false },
		{ network: true, bearerHeader: false },
		{ network: false, bearerHeader: true },
		{ network: true, bearerHeader: true },
	])(
		"keeps OAuth catalogs across token rotation and failed network refresh ($network, bearer header: $bearerHeader)",
		async ({ network, bearerHeader }) => {
			const credentials = new InMemoryCredentialStore();
			await credentials.modify("radius", async () => ({
				type: "oauth",
				access: "old-access",
				refresh: "old-refresh",
				expires: Date.now() + 3600000,
			}));
			const store = new InMemoryModelsStore();
			const models = createModels({ credentials, modelsStore: store });
			const oauth = createRadiusOAuth({ name: "Radius", gateway: "https://radius.pi.dev" });
			const makeProvider = (): Provider<"pi-messages"> => {
				const provider = radiusProvider();
				const configure = (auth: { apiKey?: string }) => ({
					...auth,
					...(bearerHeader ? { headers: { Authorization: `Bearer ${auth.apiKey}` } } : {}),
				});
				return {
					...provider,
					auth: {
						...provider.auth,
						oauth: {
							...oauth,
							toAuth: async (credential) => configure(await oauth.toAuth(credential)),
						},
					},
					resolveCachedModelAuth: async (credential, ctx) =>
						configure((await provider.resolveCachedModelAuth!(credential, ctx)) ?? {}),
				};
			};
			models.setProvider(makeProvider());
			let catalogFails = false;
			vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
				if (String(input).endsWith("/oauth/token")) {
					return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
				}
				if (catalogFails) return new Response("unavailable", { status: 503 });
				return Response.json(radiusConfig());
			});
			expect((await models.refresh()).errors).toEqual(new Map());
			const saved = await store.read("radius");
			await credentials.modify("radius", async (current) => {
				if (current?.type !== "oauth") throw new Error("Expected OAuth credential");
				return { ...current, expires: 0 };
			});
			// Request authentication can rotate the token before a cache-only catalog refresh.
			expect((await models.getAuth("radius"))?.auth.apiKey).toBe("new-access");
			catalogFails = true;
			models.setProvider(makeProvider());
			const result = await models.refresh({ allowNetwork: network });
			expect(result.errors.size).toBe(network ? 1 : 0);
			expect(models.getModels("radius")).toEqual(getRadiusModelsFromConfig("radius", radiusConfig()));
			expect(await store.read("radius")).toEqual(saved);
			// A new login is a different identity even if a gateway reissues the same token value.
			await credentials.modify("radius", async (current) => {
				if (current?.type !== "oauth") throw new Error("Expected OAuth credential");
				return { ...current, catalogId: "another-login" };
			});
			await models.refresh({ allowNetwork: false });
			expect(models.getModels("radius")).toEqual(radiusProvider().getModels());
		},
	);

	it("migrates a proven legacy catalog before rotating an expired token", async () => {
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("radius", async () => ({
			type: "oauth",
			access: "legacy-access",
			refresh: "legacy-refresh",
			expires: 0,
		}));
		const store = new InMemoryModelsStore();
		const legacyIdentity = JSON.stringify({
			gateway: "https://radius.pi.dev",
			baseUrl: "https://radius.pi.dev/v1",
			credential: "oauth",
			apiKey: "legacy-access",
			headers: [],
		});
		const personalizationKey = Array.from(
			new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(legacyIdentity))),
			(byte) => byte.toString(16).padStart(2, "0"),
		).join("");
		const accountModels = getRadiusModelsFromConfig("radius", radiusConfig());
		await store.write("radius", { models: accountModels, checkedAt: 1, personalizationKey });
		const models = createModels({ credentials, modelsStore: store });
		const provider = radiusProvider();
		models.setProvider({
			...provider,
			auth: { ...provider.auth, oauth: createRadiusOAuth({ name: "Radius", gateway: "https://radius.pi.dev" }) },
		});
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
			String(input).endsWith("/oauth/token")
				? Response.json({ access_token: "rotated-access", refresh_token: "rotated-refresh", expires_in: 3600 })
				: new Response("unavailable", { status: 503 }),
		);
		expect((await models.refresh()).errors.size).toBe(1);
		expect(models.getModels("radius")).toEqual(accountModels);
		const migrated = await store.read("radius");
		expect(migrated?.personalizationKey).not.toBe(personalizationKey);
		expect(JSON.stringify(migrated)).not.toContain("legacy-access");
		await models.refresh({ allowNetwork: false });
		expect(models.getModels("radius")).toEqual(accountModels);
	});

	it("exposes no models when the organization disabled all of them", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ baseUrl: "https://radius.example/v1", models: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("radius", async () => ({ type: "api_key", key: "radius-key" }));
		const models = createModels({ credentials });
		models.setProvider(radiusProvider());

		const result = await models.refresh({ providers: ["radius"] });

		expect(result.errors).toEqual(new Map());
		expect(models.getModels("radius")).toEqual([]);
	});
});
