import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	createAssistantMessageEventStream,
	getAttributionHeaders,
	type Model,
	normalizeContext,
	PI_ATTRIBUTION,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamSimple as streamNativeCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSION } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createInMemoryModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "./utilities.ts";

describe("createAgentSession client identity", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;
	let originalTelemetryEnv: string | undefined;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sdk-identity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		originalTelemetryEnv = process.env.PI_TELEMETRY;
		delete process.env.PI_TELEMETRY;
	});

	afterEach(() => {
		if (originalTelemetryEnv === undefined) {
			delete process.env.PI_TELEMETRY;
		} else {
			process.env.PI_TELEMETRY = originalTelemetryEnv;
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createModel(provider: string, baseUrl: string, id = `${provider}-test-model`): Model<Api> {
		return {
			id,
			name: `${provider} Test Model`,
			api: "openai-completions",
			provider,
			baseUrl,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 4096,
		};
	}

	function createDoneStream() {
		const stream = createAssistantMessageEventStream();
		const message: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: "openai-completions",
			provider: "capture-provider",
			model: "capture-model",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		stream.end(message);
		return stream;
	}

	async function captureOptions(
		model: Model<Api>,
		options: {
			telemetryEnabled?: boolean;
			providerHeaders?: Record<string, string>;
			sessionId?: string;
		} = {},
	): Promise<SimpleStreamOptions | undefined> {
		const settingsManager = SettingsManager.create(cwd, agentDir);
		if (options.telemetryEnabled === false) {
			settingsManager.setEnableInstallTelemetry(false);
		}

		const authStorage = AuthStorage.inMemory({
			[model.provider]: { type: "api_key", key: "test-api-key" },
		});
		const modelRegistry = await createInMemoryModelRegistry(authStorage);
		let capturedOptions: SimpleStreamOptions | undefined;

		modelRegistry.registerProvider(model.provider, {
			api: model.api,
			headers: options.providerHeaders,
			streamSimple: (_model, _context, providerOptions) => {
				capturedOptions = providerOptions;
				return createDoneStream();
			},
		});

		const modelRuntime = getModelRuntime(modelRegistry);
		const sessionManager = SessionManager.inMemory(cwd);
		if (options.sessionId) {
			sessionManager.newSession({ id: options.sessionId });
		}

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model,
			modelRuntime,
			settingsManager,
			sessionManager,
		});

		try {
			const stream = await session.agent.streamFunction(model, normalizeContext({ messages: [] }), {
				sessionId: session.sessionId,
			});
			await stream.result();
			return capturedOptions;
		} finally {
			session.dispose();
			modelRegistry.unregisterProvider(model.provider);
		}
	}

	async function captureNativeHeaders(
		model: Model<Api>,
		options: {
			telemetryEnabled?: boolean;
			providerHeaders?: Record<string, string>;
			requestHeaders?: SimpleStreamOptions["headers"];
			extensionFactory?: ExtensionFactory;
			virtualProvider?: string;
		} = {},
	): Promise<Headers> {
		const settingsManager = SettingsManager.inMemory({
			enableInstallTelemetry: options.telemetryEnabled ?? true,
			cacheWarming: "off",
		});
		const registry = await createInMemoryModelRegistry(
			AuthStorage.inMemory({
				[model.provider]: { type: "api_key", key: "test-api-key" },
			}),
		);
		registry.registerProvider(model.provider, {
			api: "openai-completions",
			baseUrl: model.baseUrl,
			models: [
				{
					id: model.id,
					name: model.name,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
				},
			],
			headers: options.providerHeaders,
			streamSimple: (requestModel, context, requestOptions) =>
				streamNativeCompletions({ ...requestModel, api: "openai-completions" }, context, requestOptions),
		});
		const runtime = getModelRuntime(registry);
		if (options.virtualProvider) {
			runtime.registerVirtualModel({
				provider: options.virtualProvider,
				id: "routed",
				name: "Routed",
				route: () => ({ model, thinkingLevel: "off" }),
			});
		}
		const selected = options.virtualProvider ? runtime.getModel(options.virtualProvider, "routed")! : model;
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: selected,
			modelRuntime: runtime,
			settingsManager,
			sessionManager: SessionManager.inMemory(cwd),
			resourceLoader: createTestResourceLoader({
				extensionsResult: await createTestExtensionsResult(
					options.extensionFactory ? [options.extensionFactory] : [],
					cwd,
				),
			}),
		});
		let captured: Headers | undefined;
		try {
			const stream = await session.agent.streamFunction(
				selected,
				normalizeContext({
					messages: [{ role: "user", content: "hello", timestamp: 1 }],
				}),
				{
					sessionId: "identity-session",
					headers: options.requestHeaders,
					fetch: async (input, init) => {
						captured = new Request(input, init).headers;
						const chunk = {
							id: "identity",
							choices: [{ delta: { content: "ok" }, finish_reason: "stop", index: 0 }],
							usage: { prompt_tokens: 1, completion_tokens: 1 },
						};
						return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
							headers: { "content-type": "text/event-stream" },
						});
					},
				},
			);
			const result = await stream.result();
			expect(result.stopReason, result.errorMessage).toBe("stop");
			if (!captured) throw new Error("Native request was not dispatched");
			return captured;
		} finally {
			session.dispose();
			registry.unregisterProvider(model.provider);
		}
	}

	it.each([
		["openrouter", "other", "https://other.example/v1", false],
		["router", "openrouter", "https://openrouter.ai/api/v1", true],
	] as const)(
		"assembles identity for physical %s routing to %s",
		async (virtualProvider, provider, baseUrl, attributed) => {
			let observed: SimpleStreamOptions["headers"];
			const headers = await captureNativeHeaders(createModel(provider, baseUrl), {
				virtualProvider,
				extensionFactory: (pi) => {
					pi.on("before_provider_headers", (event) => {
						observed = { ...event.headers };
					});
				},
			});
			expect(Object.keys(observed ?? {}).some((name) => name.toLowerCase() === "http-referer")).toBe(attributed);
			expect(headers.has("http-referer")).toBe(attributed);
		},
	);

	it.each([
		["openrouter", "https://openrouter.ai/api/v1", "http-referer", "https://pi.dev"],
		["custom-openrouter", "https://openrouter.ai/api/v1", "x-openrouter-title", "pi"],
		["nvidia", "https://example.test/v1", "x-billing-invoke-origin", "Pi"],
		["custom-nim", "https://integrate.api.nvidia.com/v1", "x-billing-invoke-origin", "Pi"],
		["opencode", "https://opencode.ai/zen/v1", "x-opencode-client", "pi"],
	] as const)("sends SDK identity through native %s requests", async (provider, url, header, expected) => {
		const headers = await captureNativeHeaders(createModel(provider, url));
		expect(headers.get(header)).toBe(expected);
		if (provider === "opencode") expect(headers.get("x-opencode-session")).toBe("identity-session");
	});

	it("keeps provider and request overrides above native identity defaults, including null suppression", async () => {
		const headers = await captureNativeHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
			providerHeaders: {
				"HTTP-Referer": "https://provider.example",
				"X-OpenRouter-Categories": "provider-category",
			},
			requestHeaders: { "X-OpenRouter-Title": "request-title", "X-OpenRouter-Categories": null },
		});
		expect(headers.get("http-referer")).toBe("https://provider.example");
		expect(headers.get("x-openrouter-title")).toBe("request-title");
		expect(headers.has("x-openrouter-categories")).toBe(false);
	});

	it("exposes identity defaults and configured precedence before native header hooks", async () => {
		let observed: SimpleStreamOptions["headers"];
		const headers = await captureNativeHeaders(createModel("openrouter", "https://openrouter.ai/api/v1"), {
			providerHeaders: { "http-referer": "https://provider.example" },
			requestHeaders: { "X-OpenRouter-Title": "request-title" },
			extensionFactory: (pi) => {
				pi.on("before_provider_headers", (event) => {
					observed = { ...event.headers };
					event.headers["User-Agent"] = "hook-agent";
					event.headers["X-OpenRouter-Categories"] = null;
				});
			},
		});

		expect(observed).toMatchObject({
			"User-Agent": expect.stringContaining(`pi/${VERSION}`),
			"http-referer": "https://provider.example",
			"X-OpenRouter-Title": "request-title",
			"X-OpenRouter-Categories": "cli-agent",
		});
		expect(observed).not.toHaveProperty("HTTP-Referer");
		expect(headers.get("user-agent")).toBe("hook-agent");
		expect(headers.get("http-referer")).toBe("https://provider.example");
		expect(headers.get("x-openrouter-title")).toBe("request-title");
		expect(headers.has("x-openrouter-categories")).toBe(false);
	});

	it("lets request headers override the provider's NVIDIA attribution", async () => {
		const headers = await captureNativeHeaders(createModel("nvidia", "https://integrate.api.nvidia.com/v1"), {
			providerHeaders: { "X-BILLING-INVOKE-ORIGIN": "Provider" },
			requestHeaders: { "X-BILLING-INVOKE-ORIGIN": "Request" },
		});
		expect(headers.get("x-billing-invoke-origin")).toBe("Request");
	});

	it.each(["openrouter", "nvidia"] as const)(
		"removes native %s attribution when SDK telemetry is disabled",
		async (provider) => {
			const headers = await captureNativeHeaders(createModel(provider, "https://example.test/v1"), {
				telemetryEnabled: false,
			});
			expect(headers.has("http-referer")).toBe(false);
			expect(headers.has("x-openrouter-title")).toBe(false);
			expect(headers.has("x-billing-invoke-origin")).toBe(false);
		},
	);

	it("identifies pi with a detailed User-Agent and attribution as a CLI agent", async () => {
		const model = createModel("openrouter", "https://openrouter.ai/api/v1");
		const options = await captureOptions(model);

		expect(options?.identity).toEqual({
			userAgent: "detailed",
			version: VERSION,
			attribution: PI_ATTRIBUTION,
		});
		expect(getAttributionHeaders(model, options?.identity)).toEqual({
			"HTTP-Referer": "https://pi.dev",
			"X-OpenRouter-Title": "pi",
			"X-OpenRouter-Categories": "cli-agent",
		});
	});

	it("turns attribution off when telemetry is disabled", async () => {
		const model = createModel("nvidia", "https://integrate.api.nvidia.com/v1");
		const options = await captureOptions(model, { telemetryEnabled: false });

		expect(options?.identity).toEqual({ userAgent: "detailed", version: VERSION, attribution: null });
		expect(getAttributionHeaders(model, options?.identity)).toEqual({});
	});

	it("turns attribution off with PI_TELEMETRY=0", async () => {
		process.env.PI_TELEMETRY = "0";
		const options = await captureOptions(createModel("openrouter", "https://openrouter.ai/api/v1"));

		expect(options?.identity?.attribution).toBeNull();
	});

	it("adds OpenCode session headers for custom OpenCode providers", async () => {
		const options = await captureOptions(createModel("custom-opencode", "https://opencode.ai/zen/v1"), {
			sessionId: "opencode-session",
		});

		expect(options?.headers?.["x-opencode-session"]).toBe("opencode-session");
	});

	it("lets configured OpenCode headers override the session header", async () => {
		const options = await captureOptions(createModel("opencode", "https://opencode.ai/zen/v1"), {
			sessionId: "opencode-session",
			providerHeaders: {
				"x-opencode-session": "configured-session",
			},
		});

		expect(options?.headers?.["x-opencode-session"]).toBe("configured-session");
	});
});
