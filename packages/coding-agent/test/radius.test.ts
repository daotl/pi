import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { getRadiusMcpUrl, RADIUS_PROVIDER_ID } from "../src/core/radius.ts";
import { allowNetwork, enableBuiltinProviders } from "./test-network-env.ts";

function radiusOAuthCredential(gatewayBaseUrl: string) {
	return {
		type: "oauth" as const,
		access: "access-token",
		refresh: "refresh-token",
		expires: Date.now() + 60 * 60 * 1000,
		gatewayConfig: radiusConfig(gatewayBaseUrl),
	};
}

function radiusConfig(baseUrl: string) {
	return {
		baseUrl,
		models: [
			{
				id: "auto",
				name: "Radius Auto",
				reasoning: false,
				input: ["text" as const],
				cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],
	};
}

let tempDir: string;

beforeEach(() => {
	allowNetwork();
	tempDir = join(tmpdir(), `pi-test-radius-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	vi.restoreAllMocks();
	if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
});

describe("Radius provider", () => {
	// Bundled provider metadata; fetches below are mocked or explicitly disabled.
	it("restores the legacy credential catalog without network access", async () => {
		enableBuiltinProviders();
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				[RADIUS_PROVIDER_ID]: radiusOAuthCredential("https://radius.example.com/v1"),
			}),
			modelsStore: new InMemoryModelsStore(),
			modelsPath: null,
			allowModelNetwork: false,
		});

		const model = runtime.getModel(RADIUS_PROVIDER_ID, "auto");
		expect(model).toMatchObject({ api: "pi-messages", baseUrl: "https://radius.example.com/v1" });
		expect(runtime.getProvider(RADIUS_PROVIDER_ID)?.name).toBe("Radius");
		expect(runtime.hasConfiguredAuth(RADIUS_PROVIDER_ID)).toBe(true);
		expect(getRadiusMcpUrl(runtime.getProvider(RADIUS_PROVIDER_ID))).toBe("https://radius.pi.dev/mcp");
	});

	it("fetches and stores the catalog for configured Radius auth", async () => {
		enableBuiltinProviders();
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify(radiusConfig("https://radius.example.com/v1")), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const modelsStore = new InMemoryModelsStore();
		const credentials = AuthStorage.inMemory({
			[RADIUS_PROVIDER_ID]: {
				type: "oauth",
				access: "access-token",
				refresh: "refresh-token",
				expires: Date.now() + 60 * 60 * 1000,
			},
		});
		const runtime = await ModelRuntime.create({
			credentials,
			modelsStore,
			modelsPath: null,
			allowModelNetwork: true,
		});

		expect(runtime.getModel(RADIUS_PROVIDER_ID, "auto")).toBeDefined();
		expect((await modelsStore.read(RADIUS_PROVIDER_ID))?.models).toHaveLength(1);
		const radiusRequest = vi
			.mocked(fetch)
			.mock.calls.find(([url]) => String(url) === "https://radius.pi.dev/v1/config");
		expect(radiusRequest?.[1]?.headers).toMatchObject({ authorization: "Bearer access-token" });
	});

	it("does not refresh catalogs over the network by default", async () => {
		enableBuiltinProviders();
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected catalog fetch"));
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				[RADIUS_PROVIDER_ID]: radiusOAuthCredential("https://radius.example.com/v1"),
			}),
			modelsStore: new InMemoryModelsStore(),
			modelsPath: null,
		});

		expect(runtime.getModel(RADIUS_PROVIDER_ID, "auto")).toBeDefined();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("does not fetch or make Radius models available without configured auth", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsStore: new InMemoryModelsStore(),
			modelsPath: null,
			allowModelNetwork: true,
		});

		expect(runtime.getAvailableSnapshot().filter((model) => model.provider === RADIUS_PROVIDER_ID)).toEqual([]);
		expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("radius.pi.dev/v1/config"))).toBe(false);
	});

	it("supports custom Radius gateways from models.json", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () => new Response(JSON.stringify(radiusConfig("http://localhost:8788/v1")), { status: 200 }),
		);
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: { "radius-dev": { name: "Radius (dev)", baseUrl: "http://localhost:8788", oauth: "radius" } },
			}),
		);
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				"radius-dev": {
					type: "oauth",
					access: "access-token",
					refresh: "refresh-token",
					expires: Date.now() + 60 * 60 * 1000,
				},
			}),
			modelsStore: new InMemoryModelsStore(),
			modelsPath,
			allowModelNetwork: true,
		});

		expect(runtime.getModel("radius-dev", "auto")).toMatchObject({
			api: "pi-messages",
			baseUrl: "http://localhost:8788/v1",
		});
		expect(runtime.getProvider("radius-dev")?.name).toBe("Radius (dev)");
		expect(getRadiusMcpUrl(runtime.getProvider("radius-dev"))).toBe("http://localhost:8788/mcp");
	});

	it("derives MCP from the configured Radius provider instead of its credential catalog", async () => {
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify({ providers: { radius: { oauth: "radius", baseUrl: "https://custom.example/v1/" } } }),
		);
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({ radius: radiusOAuthCredential("https://catalog.example/v1") }),
			modelsStore: new InMemoryModelsStore(),
			modelsPath,
			allowModelNetwork: false,
		});

		expect(runtime.getModel("radius", "auto")?.baseUrl).toBe("https://catalog.example/v1");
		expect(getRadiusMcpUrl(runtime.getProvider("radius"))).toBe("https://custom.example/mcp");
		expect(getRadiusMcpUrl(undefined)).toBeUndefined();
		expect(getRadiusMcpUrl({})).toBeUndefined();
	});

	it("requires baseUrl for custom Radius gateways", async () => {
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(modelsPath, JSON.stringify({ providers: { "radius-dev": { oauth: "radius" } } }));
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsStore: new InMemoryModelsStore(),
			modelsPath,
			allowModelNetwork: false,
		});

		expect(runtime.getError()).toContain('"baseUrl" is required when "oauth" is set');
	});
});
