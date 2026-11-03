import {
	type AssistantMessage,
	type AssistantMessageEvent,
	type AuthResult,
	type AuthType,
	type CredentialStore,
	createAssistantMessageEventStream,
	createProvider,
	InMemoryCredentialStore,
	type Model,
} from "@earendil-works/pi-ai";
import { InMemoryTelemetryContext } from "@earendil-works/pi-telemetry";
import { describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { enableBuiltinProviders } from "./test-network-env.ts";

function authOptions(runtime: ModelRuntime, type?: AuthType) {
	return runtime
		.getProviders()
		.flatMap((provider) => [
			...(!type || type === "oauth"
				? provider.auth.oauth
					? [{ type: "oauth" as const, provider, method: provider.auth.oauth }]
					: []
				: []),
			...(!type || type === "api_key"
				? provider.auth.apiKey
					? [{ type: "api_key" as const, provider, method: provider.auth.apiKey }]
					: []
				: []),
		]);
}

function testModel(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10000,
		maxTokens: 1000,
	};
}

describe("ModelRuntime auth options", () => {
	it.each(["stream", "streamSimple", "streamDeferred"] as const)(
		"preserves cancellation while %s resolves provider authentication",
		async (method) => {
			const runtime = await ModelRuntime.create({
				credentials: new InMemoryCredentialStore(),
				modelsPath: null,
				refreshOnCreate: false,
			});
			const model: Model<"auth-cancel"> = {
				...testModel("pending-auth"),
				provider: "auth-cancel",
				api: "auth-cancel",
				baseUrl: "https://example.test/v1",
			};
			let markStarted: (() => void) | undefined;
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			const respond = vi.fn(() => createAssistantMessageEventStream());
			runtime.registerNativeProvider(
				createProvider({
					id: model.provider,
					models: [model],
					auth: {
						apiKey: {
							name: "Pending auth",
							check: async () => ({ type: "api_key" }),
							resolve: async () => {
								markStarted?.();
								return new Promise<never>(() => {});
							},
						},
					},
					api: { stream: respond, streamSimple: respond, fetchDeferred: respond },
				}),
			);
			const telemetry = new InMemoryTelemetryContext();
			const controller = new AbortController();
			const result = await telemetry.startSpan({ name: "caller" }, async (parent) => {
				const options = { signal: controller.signal, telemetry: parent };
				const stream =
					method === "streamDeferred"
						? runtime.streamDeferred(
								model,
								{ api: model.api, provider: model.provider, modelId: model.id, id: "pending" },
								options,
							)
						: runtime[method](model, { messages: [] }, options);
				await started;
				controller.abort(new Error("private-cancellation-reason"));
				return stream.result();
			});
			expect(result.stopReason).toBe("aborted");
			expect(respond).not.toHaveBeenCalled();
			await vi.waitFor(() => expect(telemetry.getSpans().every((span) => span.settled)).toBe(true));
			expect(telemetry.getSpans()).toHaveLength(2);
			const [parent, span] = telemetry.getSpans();
			expect(span.name).toBe(method === "streamDeferred" ? "pi.ai.poll" : "pi.ai.request");
			expect(span.parentId).toBe(parent.id);
			expect(span.status).toEqual({ status: "ok" });
			expect(span.attributes.stop).toBe("aborted");
			expect(span.events).toEqual([{ name: "pi.ai.first_chunk", attributes: {} }]);
			expect(JSON.stringify(span)).not.toContain("private-cancellation-reason");
			expect(
				telemetry.getMetrics().find((metric) => metric.name === "pi.ai.request.duration")?.attributes.stop,
			).toBe("aborted");
		},
	);

	// Built-in auth metadata is bundled; no provider request is needed.
	it("accepts a pi-ai CredentialStore", async () => {
		enableBuiltinProviders();
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("anthropic", async () => ({ type: "api_key", key: "stored-key" }));
		const runtime = await ModelRuntime.create({ credentials, modelsPath: null });

		expect((await runtime.getAuth("anthropic"))?.auth.apiKey).toBe("stored-key");
	});

	it("scopes provider availability reads and records refresh failures", async () => {
		enableBuiltinProviders();
		const base = new InMemoryCredentialStore();
		const reads: string[] = [];
		let failReads = false;
		const credentials: CredentialStore = {
			read: async (providerId) => {
				reads.push(providerId);
				if (failReads) throw new Error(`read failed for ${providerId}`);
				return base.read(providerId);
			},
			list: () => base.list(),
			modify: (providerId, fn) => base.modify(providerId, fn),
			delete: (providerId) => base.delete(providerId),
		};
		const runtime = await ModelRuntime.create({ credentials, modelsPath: null });

		reads.length = 0;
		await runtime.getAvailable("anthropic");
		expect(new Set(reads)).toEqual(new Set(["anthropic"]));

		failReads = true;
		await expect(runtime.getAvailable("anthropic")).rejects.toThrow("Credential store read failed for anthropic");
		expect(runtime.getError()).toContain("Availability refresh: Credential store read failed for anthropic");

		failReads = false;
		await runtime.getAvailable();
		expect(runtime.getError()).toBeUndefined();
	});

	it("projects provider-owned methods, names, and status", async () => {
		enableBuiltinProviders();
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		const options = authOptions(runtime);

		expect(options).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "api_key",
					provider: expect.objectContaining({ id: "amazon-bedrock", name: "Amazon Bedrock" }),
					method: expect.objectContaining({ name: "AWS credentials or bearer token" }),
				}),
				expect.objectContaining({
					type: "api_key",
					provider: expect.objectContaining({ id: "google-vertex", name: "Google Vertex AI" }),
					method: expect.objectContaining({ name: "Google Cloud credentials" }),
				}),
				expect.objectContaining({
					type: "oauth",
					provider: expect.objectContaining({ id: "anthropic", name: "Anthropic" }),
				}),
				expect.objectContaining({
					type: "api_key",
					provider: expect.objectContaining({ id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway" }),
				}),
				expect.objectContaining({
					type: "api_key",
					provider: expect.objectContaining({ id: "cloudflare-workers-ai", name: "Cloudflare Workers AI" }),
				}),
			]),
		);
		expect(authOptions(runtime, "api_key").every((option) => option.type === "api_key")).toBe(true);
		expect(authOptions(runtime, "oauth").every((option) => option.type === "oauth")).toBe(true);
		expect(options.some((option) => option.provider.id === "openai-codex" && option.type === "api_key")).toBe(false);
	});

	it("attaches the provider's active auth status to every method option", async () => {
		enableBuiltinProviders();
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				anthropic: {
					type: "oauth",
					access: "access",
					refresh: "refresh",
					expires: Date.now() + 60_000,
				},
			}),
			modelsPath: null,
		});

		const options = authOptions(runtime).filter((option) => option.provider.id === "anthropic");
		expect(options).toHaveLength(2);
		expect(await runtime.checkAuth("anthropic")).toMatchObject({ type: "oauth" });
	});

	it("distinguishes subscription OAuth from generic OAuth sign-in", async () => {
		enableBuiltinProviders();
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				anthropic: {
					type: "oauth",
					access: "anthropic-access",
					refresh: "anthropic-refresh",
					expires: Date.now() + 60 * 60_000,
				},
				openrouter: {
					type: "oauth",
					access: "openrouter-key",
					refresh: "",
					expires: Number.MAX_SAFE_INTEGER,
				},
				radius: {
					type: "oauth",
					access: "radius-access",
					refresh: "radius-refresh",
					expires: Date.now() + 60 * 60_000,
				},
			}),
			modelsPath: null,
		});

		expect(runtime.isUsingOAuth("anthropic")).toBe(true);
		expect(runtime.isUsingSubscription("anthropic")).toBe(true);
		expect(runtime.isUsingOAuth("openrouter")).toBe(true);
		expect(runtime.isUsingSubscription("openrouter")).toBe(false);
		expect(runtime.isUsingOAuth("radius")).toBe(true);
		expect(runtime.isUsingSubscription("radius")).toBe(false);
	});

	it("constructs an API key method for an extension API-key provider", async () => {
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		runtime.registerProvider("extension-api-key", {
			name: "Extension API Key",
			baseUrl: "https://example.test/v1",
			apiKey: "$EXTENSION_TEST_API_KEY",
			api: "openai-completions",
			models: [testModel("extension-model")],
		});

		const options = authOptions(runtime).filter((option) => option.provider.id === "extension-api-key");
		expect(options).toHaveLength(1);
		expect(options[0]).toMatchObject({
			type: "api_key",
			provider: { id: "extension-api-key", name: "Extension API Key" },
			method: { name: "API key" },
		});
		expect(options[0]?.method.login).toBeTypeOf("function");
	});

	it("resolves configured auth from request-scoped environment overrides", async () => {
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		runtime.registerProvider("request-env-provider", {
			baseUrl: "https://example.test/v1",
			apiKey: "$REQUEST_SCOPED_API_KEY",
			headers: { "x-request-value": "$REQUEST_SCOPED_HEADER" },
			api: "openai-completions",
			models: [testModel("request-env-model")],
		});

		const auth = await runtime.getAuth("request-env-provider", {
			env: { REQUEST_SCOPED_API_KEY: "request-key", REQUEST_SCOPED_HEADER: "request-header" },
		});

		expect(auth?.auth).toEqual({ apiKey: "request-key", headers: { "x-request-value": "request-header" } });
	});

	it("lets an explicit Authorization header override authHeader case-insensitively", async () => {
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		let capturedHeaders: Record<string, string | null> | undefined;
		runtime.registerProvider("auth-header-provider", {
			baseUrl: "https://example.test/v1",
			apiKey: "generated-key",
			authHeader: true,
			api: "openai-completions",
			streamSimple: (_model, _context, options) => {
				capturedHeaders = options?.headers;
				throw new Error("captured");
			},
			models: [testModel("auth-header-model")],
		});
		const model = runtime.getModel("auth-header-provider", "auth-header-model");
		expect(model).toBeDefined();

		await runtime.completeSimple(model!, { messages: [] }, { headers: { authorization: "Explicit token" } });

		expect(capturedHeaders).toEqual({ authorization: "Explicit token" });
	});

	it("transforms fully assembled headers once without forwarding the transform", async () => {
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		let capturedHeaders: Record<string, string | null> | undefined;
		let transforms = 0;
		runtime.registerProvider("header-provider", {
			baseUrl: "https://example.test/v1",
			apiKey: "generated-key",
			authHeader: true,
			headers: { "x-provider": "provider" },
			api: "openai-completions",
			streamSimple: (_model, _context, options) => {
				expect(options).not.toHaveProperty("transformHeaders");
				capturedHeaders = options?.headers;
				throw new Error("captured");
			},
			models: [{ ...testModel("header-model"), headers: { "x-model": "model" } }],
		});
		const model = runtime.getModel("header-provider", "header-model");
		expect(model).toBeDefined();

		await runtime.completeSimple(
			model!,
			{ messages: [] },
			{
				headers: { "x-explicit": "explicit" },
				transformHeaders: async (headers) => {
					transforms++;
					expect(headers).toEqual({
						Authorization: "Bearer generated-key",
						"x-provider": "provider",
						"x-model": "model",
						"x-explicit": "explicit",
					});
					return { ...headers, "x-transformed": "yes" };
				},
			},
		);

		expect(transforms).toBe(1);
		expect(capturedHeaders).toEqual({
			Authorization: "Bearer generated-key",
			"x-provider": "provider",
			"x-model": "model",
			"x-explicit": "explicit",
			"x-transformed": "yes",
		});
	});

	it("does not cancel an extension OAuth refresh with the request", async () => {
		const credentials = AuthStorage.inMemory({
			"extension-oauth": {
				type: "oauth",
				access: "expired",
				refresh: "refresh",
				expires: 0,
			},
		});
		const runtime = await ModelRuntime.create({ credentials, modelsPath: null });
		let refreshSignal: AbortSignal | undefined;
		runtime.registerProvider("extension-oauth", {
			name: "Extension OAuth",
			baseUrl: "https://example.test/v1",
			api: "openai-completions",
			oauth: {
				name: "Extension subscription",
				login: async () => ({ access: "access", refresh: "refresh", expires: Date.now() + 60_000 }),
				refreshToken: async (credential, signal) => {
					refreshSignal = signal;
					return { ...credential, expires: Date.now() + 60_000 };
				},
				getApiKey: (credential) => credential.access,
			},
			models: [testModel("extension-model")],
		});
		const controller = new AbortController();

		await runtime.getAuth("extension-oauth", { signal: controller.signal });
		expect(refreshSignal).toBeInstanceOf(AbortSignal);
		const reason = new Error("cancelled");
		controller.abort(reason);
		// A started refresh may already have rotated the refresh token and must be persisted.
		expect(refreshSignal?.aborted).toBe(false);
	});

	it("does not fabricate an API key method for an extension OAuth-only provider", async () => {
		const runtime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		runtime.registerProvider("extension-oauth", {
			name: "Extension OAuth",
			baseUrl: "https://example.test/v1",
			api: "openai-completions",
			oauth: {
				name: "Extension subscription",
				isSubscription: true,
				login: async () => ({ access: "access", refresh: "refresh", expires: Date.now() + 60_000 }),
				refreshToken: async (credentials) => credentials,
				getApiKey: (credentials) => credentials.access,
			},
			models: [testModel("extension-model")],
		});

		const options = authOptions(runtime).filter((option) => option.provider.id === "extension-oauth");
		expect(options).toHaveLength(1);
		expect(options[0]).toMatchObject({
			type: "oauth",
			provider: { id: "extension-oauth", name: "Extension OAuth" },
			method: { name: "Extension subscription", isSubscription: true },
		});
	});
});

describe("ModelRuntime request telemetry", () => {
	const model: Model<"runtime-telemetry"> = {
		...testModel("physical-model"),
		provider: "runtime-telemetry-provider",
		api: "runtime-telemetry",
		baseUrl: "https://example.test/v1",
		reasoning: true,
	};
	const handle = { api: model.api, provider: model.provider, modelId: model.id, id: "private-deferred-handle" };

	function message(stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
		return {
			role: "assistant",
			api: model.api,
			provider: model.provider,
			model: model.id,
			content: [{ type: "text", text: "private-answer" }],
			usage: {
				input: 11,
				output: 22,
				cacheRead: 33,
				cacheWrite: 44,
				totalTokens: 110,
				cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
			},
			responseId: "response",
			stopReason,
			timestamp: 1,
		};
	}

	async function setup(result = message(), resolve: () => Promise<AuthResult> = async () => ({ auth: {} })) {
		const runtime = await ModelRuntime.create({
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			refreshOnCreate: false,
			allowModelNetwork: false,
		});
		const streamEvents: AssistantMessageEvent[] = [
			{ type: "start", partial: result },
			{ type: "text_delta", contentIndex: 0, delta: "private-answer", partial: result },
			{ type: "text_end", contentIndex: 0, content: "private-answer", partial: result },
			{
				type: "done",
				reason: result.stopReason === "pending" || result.stopReason === "deferred" ? "deferred" : "stop",
				message: result,
			},
		];
		const respond = vi.fn(() => {
			const stream = createAssistantMessageEventStream();
			for (const event of streamEvents) stream.push(event);
			stream.end(result);
			return stream;
		});
		runtime.registerNativeProvider(
			createProvider({
				id: model.provider,
				models: [model],
				auth: { apiKey: { name: "Test", check: async () => ({ type: "api_key" }), resolve } },
				api: { stream: respond, streamSimple: respond, fetchDeferred: respond },
			}),
		);
		return { runtime, respond, streamEvents };
	}

	it.each([
		["stream", true],
		["streamSimple", true],
		["streamDeferred", true],
		["stream", false],
		["streamSimple", false],
		["streamDeferred", false],
	] as const)("records %s telemetry with unchanged results (consume=%s)", async (method, consume) => {
		const telemetry = new InMemoryTelemetryContext();
		const result = message();
		const { runtime, respond, streamEvents } = await setup(result);
		await telemetry.startSpan({ name: "caller" }, async (parent) => {
			const stream =
				method === "streamDeferred"
					? runtime.streamDeferred(model, handle, { telemetry: parent })
					: runtime[method](model, { messages: [] }, { telemetry: parent, reasoning: "high" });
			if (consume) {
				const received: AssistantMessageEvent[] = [];
				for await (const event of stream) received.push(event);
				expect(received).toEqual(streamEvents);
				for (const [index, event] of received.entries()) expect(event).toBe(streamEvents[index]);
			}
			expect(await stream.result()).toBe(result);
		});
		expect(respond).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(telemetry.getSpans().every((span) => span.settled)).toBe(true));
		expect(telemetry.getSpans()).toHaveLength(2);
		const [parent, span] = telemetry.getSpans();
		expect(span.name).toBe(method === "streamDeferred" ? "pi.ai.poll" : "pi.ai.request");
		expect(span.parentId).toBe(parent.id);
		expect(span.status).toEqual({ status: "ok" });
		expect(span.attributes).toEqual({
			provider: model.provider,
			api: model.api,
			model: model.id,
			...(method === "streamDeferred" ? {} : { reasoning: "high" }),
			stop: "stop",
			"usage.input": 11,
			"usage.output": 22,
			"usage.cache_read": 33,
			"usage.cache_write": 44,
			"cost.total": 1,
			"response.id": "response",
		});
		expect(span.events).toEqual([
			{ name: "pi.ai.first_chunk", attributes: {} },
			{ name: "pi.ai.block", attributes: { type: "text", index: 0, chars: 14 } },
		]);
		expect(JSON.stringify(span)).not.toMatch(/private-answer|private-deferred-handle/);
		const metrics = telemetry.getMetrics();
		expect(metrics).toHaveLength(7);
		expect(
			metrics
				.filter((metric) => metric.name === "pi.ai.tokens")
				.map(({ value, attributes }) => ({ value, attributes })),
		).toEqual([
			{ value: 11, attributes: { provider: model.provider, model: model.id, kind: "input" } },
			{ value: 22, attributes: { provider: model.provider, model: model.id, kind: "output" } },
			{ value: 33, attributes: { provider: model.provider, model: model.id, kind: "cache_read" } },
			{ value: 44, attributes: { provider: model.provider, model: model.id, kind: "cache_write" } },
		]);
		expect(metrics.find((metric) => metric.name === "pi.ai.cost")).toMatchObject({
			kind: "counter",
			value: 1,
			attributes: { provider: model.provider, model: model.id },
		});
		for (const metric of metrics.filter((metric) => metric.kind === "histogram")) {
			expect(metric.value).toBeGreaterThanOrEqual(0);
			expect(metric.context).toEqual(span.context);
		}
		expect(metrics.filter((metric) => metric.kind === "histogram").map((metric) => metric.name)).toEqual([
			"pi.ai.first_chunk.duration",
			"pi.ai.request.duration",
		]);
	});

	it.each(["stream", "streamSimple", "streamDeferred"] as const)(
		"records %s authentication failures before provider dispatch",
		async (method) => {
			const telemetry = new InMemoryTelemetryContext();
			const { runtime, respond } = await setup(message(), async () => {
				throw new Error("authentication failed");
			});
			const result = await telemetry.startSpan({ name: "caller" }, (parent) => {
				const options = { telemetry: parent };
				return (
					method === "streamDeferred"
						? runtime.streamDeferred(model, handle, options)
						: runtime[method](model, { messages: [] }, options)
				).result();
			});
			expect(result.stopReason).toBe("error");
			expect(result.errorMessage).toBe(`API key auth failed for provider ${model.provider}: authentication failed`);
			expect(respond).not.toHaveBeenCalled();
			await vi.waitFor(() => expect(telemetry.getSpans().every((span) => span.settled)).toBe(true));
			expect(telemetry.getSpans()).toHaveLength(2);
			const [parent, span] = telemetry.getSpans();
			expect(span.name).toBe(method === "streamDeferred" ? "pi.ai.poll" : "pi.ai.request");
			expect(span.parentId).toBe(parent.id);
			expect(span.attributes.stop).toBe("error");
			expect(span.status).toEqual({
				status: "error",
				error: { name: "provider_error", message: result.errorMessage },
			});
			expect(span.events).toEqual([{ name: "pi.ai.first_chunk", attributes: {} }]);
			expect(JSON.stringify(span.attributes)).not.toContain("API key auth failed");
			expect(JSON.stringify(span.events)).not.toContain("API key auth failed");
			expect(
				telemetry.getMetrics().find((metric) => metric.name === "pi.ai.request.duration")?.attributes.stop,
			).toBe("error");
		},
	);

	it.each(["pending", "deferred"] as const)(
		"records each %s poll without counting provisional usage",
		async (stopReason) => {
			const telemetry = new InMemoryTelemetryContext();
			const result = message(stopReason);
			const { runtime, respond } = await setup(result);
			await telemetry.startSpan({ name: "caller" }, async (parent) => {
				expect(await runtime.fetchDeferred(model, handle, { telemetry: parent })).toBe(result);
				expect(await runtime.fetchDeferred(model, handle, { telemetry: parent })).toBe(result);
			});
			expect(respond).toHaveBeenCalledTimes(2);
			await vi.waitFor(() => expect(telemetry.getSpans().every((span) => span.settled)).toBe(true));
			expect(telemetry.getSpans()).toHaveLength(3);
			const [parent, ...polls] = telemetry.getSpans();
			for (const poll of polls) {
				expect(poll.name).toBe("pi.ai.poll");
				expect(poll.parentId).toBe(parent.id);
				expect(poll.attributes.stop).toBe(stopReason);
			}
			expect(telemetry.getMetrics().map((metric) => metric.name)).toEqual([
				"pi.ai.first_chunk.duration",
				"pi.ai.request.duration",
				"pi.ai.first_chunk.duration",
				"pi.ai.request.duration",
			]);
		},
	);

	it("records a virtual request exactly once against the routed physical model", async () => {
		const telemetry = new InMemoryTelemetryContext();
		const result = message();
		const { runtime, respond } = await setup(result);
		runtime.registerVirtualModel({
			provider: "telemetry-router",
			id: "auto",
			name: "Auto",
			thinkingLevels: ["high"],
			route: () => ({ model, thinkingLevel: "high" }),
		});
		await runtime.refresh({ allowNetwork: false });
		const virtual = runtime.getModel("telemetry-router", "auto");
		expect(virtual).toBeDefined();
		expect(
			await telemetry.startSpan({ name: "caller" }, (parent) =>
				runtime.completeSimple(virtual!, { messages: [] }, { telemetry: parent, reasoning: "high" }),
			),
		).toBe(result);
		expect(respond).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(telemetry.getSpans().every((span) => span.settled)).toBe(true));
		expect(telemetry.getSpans()).toHaveLength(2);
		const [parent, span] = telemetry.getSpans();
		expect(span.name).toBe("pi.ai.request");
		expect(span.parentId).toBe(parent.id);
		expect(span.attributes).toMatchObject({
			provider: model.provider,
			api: model.api,
			model: model.id,
			reasoning: "high",
		});
		expect(telemetry.getMetrics()).toHaveLength(7);
		expect(
			telemetry
				.getMetrics()
				.every((metric) => metric.attributes.provider === model.provider && metric.attributes.model === model.id),
		).toBe(true);
		expect(
			telemetry
				.getMetrics()
				.filter((metric) => metric.name === "pi.ai.cost")
				.map((metric) => metric.value),
		).toEqual([1]);
	});
});
