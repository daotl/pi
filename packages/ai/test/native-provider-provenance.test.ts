import { describe, expect, it } from "vitest";
import { anthropicMessagesApi } from "../src/api/anthropic-messages.lazy.ts";
import { googleGenerativeAIApi } from "../src/api/google-generative-ai.lazy.ts";
import { isHistoryPreservingApi, markHistoryPreservingApi } from "../src/api/history-provenance.ts";
import { isDirectOpenAICompletionsApi, openAICompletionsApi } from "../src/api/openai-completions.lazy.ts";
import { openAIResponsesApi } from "../src/api/openai-responses.lazy.ts";
import type { Provider } from "../src/models.ts";
import { createModels, createProvider, getProviderApiStreams } from "../src/models.ts";
import type { Api, Model, ProviderStreams } from "../src/types.ts";

function testModel(api: Api): Model<Api> {
	return {
		id: "test-model",
		name: "Test model",
		provider: "test-provider",
		api,
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10000,
		maxTokens: 1000,
	};
}

function testProvider(api: ProviderStreams | Partial<Record<Api, ProviderStreams>>): Provider {
	return createProvider({
		id: "test-provider",
		auth: { apiKey: { name: "Test", resolve: async () => ({ auth: {} }) } },
		models: [],
		api,
	});
}

function capabilities(streams: ProviderStreams | undefined) {
	return {
		history: streams !== undefined && isHistoryPreservingApi(streams),
		direct: streams !== undefined && isDirectOpenAICompletionsApi(streams),
	};
}

describe("native provider provenance", () => {
	it.each([
		["Anthropic", anthropicMessagesApi, true, false],
		["Responses", openAIResponsesApi, true, false],
		["Completions", openAICompletionsApi, true, true],
		["Google", googleGenerativeAIApi, false, false],
	] as const)("recognizes %s capabilities independently", (_name, factory, history, direct) => {
		expect(capabilities(factory())).toEqual({ history, direct });
	});

	it.each([
		["Anthropic", anthropicMessagesApi],
		["Responses", openAIResponsesApi],
		["Completions", openAICompletionsApi],
	] as const)("does not transfer %s provenance to copied or wrapped API objects", (_name, factory) => {
		const streams = factory();
		const copied = { ...streams };
		const wrapped: ProviderStreams = {
			stream: (...args) => streams.stream(...args),
			streamSimple: (...args) => streams.streamSimple(...args),
		};

		for (const unregistered of [copied, wrapped]) {
			expect(capabilities(unregistered)).toEqual({ history: false, direct: false });
			expect(
				capabilities(getProviderApiStreams(testProvider(unregistered), testModel("openai-completions"))),
			).toEqual({ history: false, direct: false });
		}
	});

	it.each([
		["Anthropic", anthropicMessagesApi, false],
		["Responses", openAIResponsesApi, false],
		["Completions", openAICompletionsApi, true],
	] as const)(
		"revokes %s capabilities when either stream changes and restores the original pair",
		(_name, factory, direct) => {
			const streams = factory();
			const original = { stream: streams.stream, streamSimple: streams.streamSimple };

			streams.stream = (...args) => original.stream(...args);
			expect(capabilities(streams)).toEqual({ history: false, direct: false });
			streams.stream = original.stream;
			expect(capabilities(streams)).toEqual({ history: true, direct });

			streams.streamSimple = (...args) => original.streamSimple(...args);
			expect(capabilities(streams)).toEqual({ history: false, direct: false });
			streams.streamSimple = original.streamSimple;
			expect(capabilities(streams)).toEqual({ history: true, direct });
		},
	);

	it("does not grant direct transport permission through history attribution", () => {
		const streams = markHistoryPreservingApi({ ...openAICompletionsApi() });
		expect(capabilities(streams)).toEqual({ history: true, direct: false });
	});

	it("revokes factory dispatch provenance when streamSimple is wrapped or replaced", () => {
		const streams = openAICompletionsApi();
		const provider = testProvider(streams);
		const model = testModel("openai-completions");
		const original = provider.streamSimple;
		const originalApiStream = streams.streamSimple;
		expect(capabilities(getProviderApiStreams(provider, model))).toEqual({ history: true, direct: true });

		provider.streamSimple = (...args) => original(...args);
		expect(getProviderApiStreams(provider, model)).toBeUndefined();
		provider.streamSimple = googleGenerativeAIApi().streamSimple;
		expect(getProviderApiStreams(provider, model)).toBeUndefined();
		provider.streamSimple = original;
		expect(capabilities(getProviderApiStreams(provider, model))).toEqual({ history: true, direct: true });

		streams.streamSimple = (...args) => originalApiStream(...args);
		expect(capabilities(getProviderApiStreams(provider, model))).toEqual({ history: false, direct: false });
		streams.streamSimple = originalApiStream;
		expect(capabilities(getProviderApiStreams(provider, model))).toEqual({ history: true, direct: true });
	});

	it("uses the live per-model API mapping rather than the model API label", () => {
		const completions = openAICompletionsApi();
		const responses = openAIResponsesApi();
		const apis: Partial<Record<Api, ProviderStreams>> = {
			"openai-completions": responses,
			"openai-responses": completions,
		};
		const provider = testProvider(apis);
		const completionModel = testModel("openai-completions");
		const responsesModel = testModel("openai-responses");

		expect(capabilities(getProviderApiStreams(provider, completionModel))).toEqual({ history: true, direct: false });
		expect(capabilities(getProviderApiStreams(provider, responsesModel))).toEqual({ history: true, direct: true });
		apis["openai-completions"] = completions;
		expect(capabilities(getProviderApiStreams(provider, completionModel))).toEqual({ history: true, direct: true });
		apis["openai-completions"] = { ...completions };
		expect(capabilities(getProviderApiStreams(provider, completionModel))).toEqual({ history: false, direct: false });
		delete apis["openai-completions"];
		expect(getProviderApiStreams(provider, completionModel)).toBeUndefined();
	});

	it("does not retain provenance after replacing a provider with the same id", () => {
		const models = createModels();
		const native = testProvider(openAICompletionsApi());
		const custom: Provider = {
			...native,
			streamSimple: (...args) => native.streamSimple(...args),
		};
		const model = testModel("openai-completions");
		models.setProvider(native);
		expect(capabilities(getProviderApiStreams(models.getProvider(native.id)!, model))).toEqual({
			history: true,
			direct: true,
		});
		models.setProvider(custom);
		expect(getProviderApiStreams(models.getProvider(native.id)!, model)).toBeUndefined();
		models.setProvider(native);
		expect(capabilities(getProviderApiStreams(models.getProvider(native.id)!, model))).toEqual({
			history: true,
			direct: true,
		});
	});
});
