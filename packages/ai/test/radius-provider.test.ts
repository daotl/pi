import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore } from "../src/auth/credential-store.ts";
import { createModels } from "../src/models.ts";
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
