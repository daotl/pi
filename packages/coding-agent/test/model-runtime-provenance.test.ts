import { createProvider, type Model, type Provider, type ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { registerApiProvider, registerFauxProvider, resetApiProviders } from "@earendil-works/pi-ai/compat";
import { azureProvider } from "@earendil-works/pi-ai/providers/azure";
import { cloudflareAIGatewayProvider } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway";
import { cloudflareWorkersAIProvider } from "@earendil-works/pi-ai/providers/cloudflare-workers-ai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { afterEach, expect, it } from "vitest";
import { ModelRuntime } from "../src/core/model-runtime.ts";

afterEach(() => resetApiProviders());
const definition = {
	id: "model",
	name: "model",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10000,
	maxTokens: 1000,
};
function provider(api: string, streams: ProviderStreams) {
	return createProvider({
		id: "native-test",
		auth: { apiKey: { name: "offline", resolve: async () => ({ auth: { apiKey: "offline" } }) } },
		models: [{ ...definition, api, provider: "native-test", baseUrl: "https://example.invalid/v1" }],
		api: streams,
	});
}

it.each([
	["openai-completions", openAICompletionsApi, true],
	["anthropic-messages", anthropicMessagesApi, false],
	["openai-responses", openAIResponsesApi, false],
] as const)("separates native %s history from direct tokenizer permission", async (api, factory, direct) => {
	const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
	const native = provider(api, factory());
	runtime.registerNativeProvider(native);
	const model = native.getModels()[0] as Model<string>;
	expect(runtime.canAttributeRequestHistory(model)).toBe(true);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(direct);
	runtime.registerVirtualModel({
		provider: native.id,
		id: "virtual-sibling",
		name: "Virtual sibling",
		route: () => ({ model, thinkingLevel: "off" }),
	});
	await runtime.refresh({ allowNetwork: false });
	const virtual = runtime.getModel(native.id, "virtual-sibling")!;
	expect(runtime.canAttributeRequestHistory(virtual)).toBe(false);
	expect(runtime.canAttributeRequestHistory(virtual, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(virtual)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model)).toBe(true);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(direct);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
	const wrapped = runtime.getProvider(native.id)!;
	const wrappedStream = wrapped.stream;
	const wrappedSimple = wrapped.streamSimple;
	wrapped.stream = (...args) => wrappedStream(...args);
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
	wrapped.stream = wrappedStream;
	wrapped.streamSimple = (...args) => wrappedSimple(...args);
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
	wrapped.streamSimple = wrappedSimple;
	expect(runtime.canAttributeRequestHistory(model)).toBe(true);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
	const originalStream = native.stream;
	native.stream = (...args) => originalStream(...args);
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
	native.stream = originalStream;
	expect(runtime.canAttributeRequestHistory(model)).toBe(true);
	const saved = native.streamSimple;
	native.streamSimple = (...args) => saved(...args);
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
	native.streamSimple = saved;
	expect(runtime.canAttributeRequestHistory(model)).toBe(true);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
	const replacement = provider(api, factory());
	native.stream = replacement.stream;
	native.streamSimple = replacement.streamSimple;
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
	native.stream = originalStream;
	native.streamSimple = saved;
	runtime.registerProvider(native.id, { api, streamSimple: (...args) => saved(...args), apiKey: "offline" });
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
});

it("denies direct uploads to an OpenAI-labelled faux registration and observes live registry replacement", async () => {
	const faux = registerFauxProvider({ api: "openai-completions" });
	try {
		const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
		runtime.registerProvider("custom-test", {
			api: "openai-completions",
			apiKey: "offline",
			baseUrl: "https://example.invalid/v1",
			models: [definition],
		});
		const model = runtime.getModel("custom-test", "model")!;
		runtime.registerVirtualModel({
			provider: model.provider,
			id: "virtual-sibling",
			name: "Virtual sibling",
			route: () => ({ model, thinkingLevel: "off" }),
		});
		await runtime.refresh({ allowNetwork: false });
		expect(runtime.canAttributeRequestHistory(model)).toBe(true);
		expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
		const streams = openAICompletionsApi();
		registerApiProvider({ api: "openai-completions", ...streams });
		expect(runtime.canAttributeRequestHistory(model)).toBe(false);
		expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
		resetApiProviders();
		expect(runtime.canAttributeRequestHistory(model)).toBe(true);
		expect(runtime.canAttributeRequestHistory(model, true)).toBe(true);
	} finally {
		faux.unregister();
	}
});

it("revokes composed dispatch evidence when either entry point is replaced", async () => {
	const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
	runtime.registerProvider("composed-test", {
		api: "openai-completions",
		apiKey: "offline",
		baseUrl: "https://example.invalid/v1",
		models: [definition],
	});
	const model = runtime.getModel("composed-test", "model")!;
	runtime.registerVirtualModel({
		provider: model.provider,
		id: "virtual-sibling",
		name: "Virtual sibling",
		route: () => ({ model, thinkingLevel: "off" }),
	});
	await runtime.refresh({ allowNetwork: false });
	const composed = runtime.getProvider("composed-test")!;
	const original = { stream: composed.stream, streamSimple: composed.streamSimple };
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(true);
	composed.stream = (...args) => original.stream(...args);
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	composed.stream = original.stream;
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(true);
	composed.streamSimple = (...args) => original.streamSimple(...args);
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	composed.streamSimple = original.streamSimple;
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(true);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
});

it("does not grant physical capabilities to manually matching API transports with virtual siblings", async () => {
	const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
	const native = provider("openai-completions", openAICompletionsApi());
	const manual: Provider = {
		...native,
		stream: (...args) => native.stream(...args),
		streamSimple: (...args) => native.streamSimple(...args),
	};
	runtime.registerNativeProvider(manual);
	const model = manual.getModels()[0];
	runtime.registerVirtualModel({
		provider: manual.id,
		id: "virtual-sibling",
		name: "Virtual sibling",
		route: () => ({ model, thinkingLevel: "off" }),
	});
	await runtime.refresh({ allowNetwork: false });
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
	expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
});

it.each([
	["openai-completions", openAICompletionsApi],
	["anthropic-messages", anthropicMessagesApi],
	["openai-responses", openAIResponsesApi],
	["google-generative-ai", googleGenerativeAIApi],
	["google-vertex", googleVertexApi],
	["bedrock-converse-stream", bedrockConverseStreamApi],
	["openai-codex-responses", openAICodexResponsesApi],
	["azure-openai-responses", azureOpenAIResponsesApi],
	["mistral-conversations", mistralConversationsApi],
] as const)(
	"revokes native %s output budgeting for replaced factory/provider/composed dispatch",
	async (api, factory) => {
		const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
		const streams = factory();
		const native = provider(api, streams);
		runtime.registerNativeProvider(native);
		const model = native.getModels()[0];
		runtime.registerVirtualModel({
			provider: model.provider,
			id: "virtual-sibling",
			name: "Virtual sibling",
			route: () => ({ model, thinkingLevel: "off" }),
		});
		await runtime.refresh({ allowNetwork: false });
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		const simple = streams.streamSimple;
		streams.streamSimple = (...args) => simple(...args);
		expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
		streams.streamSimple = simple;
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		const original = native.stream;
		native.stream = (...args) => original(...args);
		expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
		native.stream = original;
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		const nativeSimple = native.streamSimple;
		native.streamSimple = (...args) => nativeSimple(...args);
		expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
		native.streamSimple = nativeSimple;
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		runtime.registerProvider(native.id, { api, apiKey: "offline" });
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		const composed = runtime.getProvider(native.id)!;
		const composedSimple = composed.streamSimple;
		composed.streamSimple = (...args) => composedSimple(...args);
		expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
		composed.streamSimple = composedSimple;
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		const composedStream = composed.stream;
		composed.stream = (...args) => composedStream(...args);
		expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
		composed.stream = composedStream;
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		registerApiProvider({ api, ...factory() });
		expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
		resetApiProviders();
		expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
		runtime.registerProvider(native.id, { api, streamSimple: (...args) => simple(...args), apiKey: "offline" });
		expect(runtime.usesAdapterOutputClamp(model)).toBe(false);
	},
);

it.each([
	["Azure", azureProvider],
	["OpenCode", opencodeProvider],
	["OpenCode Go", opencodeGoProvider],
	["Cloudflare gateway", cloudflareAIGatewayProvider],
	["Cloudflare workers", cloudflareWorkersAIProvider],
] as const)("retains only output budgeting for model-free %s factory dispatch", async (_name, factory) => {
	const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
	const native = factory();
	runtime.registerNativeProvider(native);
	const model: Model<"openai-completions"> = {
		...definition,
		id: "not-in-catalog",
		api: "openai-completions",
		provider: native.id,
		baseUrl: "https://example.invalid/v1",
	};
	expect(runtime.usesAdapterOutputClamp(model)).toBe(true);
	expect(runtime.canAttributeRequestHistory(model)).toBe(false);
	expect(runtime.canAttributeRequestHistory(model, true)).toBe(false);
});
