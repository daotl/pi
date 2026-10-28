import { describe, expect, it } from "vitest";
import { isContextClampingApiStreams } from "../src/api/context-clamp-provenance.ts";
import { isHistoryPreservingApi } from "../src/api/history-provenance.ts";
import { isDirectOpenAICompletionsApi, openAICompletionsApi } from "../src/api/openai-completions.lazy.ts";
import { cloudflareStreams } from "../src/providers/cloudflare-stream.ts";
import { fauxProvider } from "../src/providers/faux.ts";
import { withOpenCodeSessionHeader } from "../src/providers/opencode-headers.ts";
import type { Api, Model } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<Api> = {
	id: "model",
	name: "model",
	api: "openai-completions",
	provider: "cloudflare-ai-gateway",
	baseUrl: "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

const context = normalizeContext({ messages: [] });

describe("Cloudflare provider streams", () => {
	it.each([
		["Cloudflare", cloudflareStreams],
		["OpenCode", withOpenCodeSessionHeader],
	] as const)("preserves only native output-clamp authority through %s", (_name, wrap) => {
		const wrapped = wrap(openAICompletionsApi());
		expect(isContextClampingApiStreams(wrapped)).toBe(true);
		expect(isHistoryPreservingApi(wrapped)).toBe(false);
		expect(isDirectOpenAICompletionsApi(wrapped)).toBe(false);
		expect(isContextClampingApiStreams(wrap(fauxProvider().provider))).toBe(false);
		const native = openAICompletionsApi();
		const simple = native.streamSimple;
		native.streamSimple = (...args) => simple(...args);
		expect(isContextClampingApiStreams(wrap(native))).toBe(false);
	});

	it("materializes the model endpoint before dispatch", () => {
		const captured: string[] = [];
		const streams = cloudflareStreams({
			stream: (requestModel) => {
				captured.push(requestModel.baseUrl);
				return new AssistantMessageEventStream();
			},
			streamSimple: (requestModel) => {
				captured.push(requestModel.baseUrl);
				return new AssistantMessageEventStream();
			},
		});
		const env = {
			CLOUDFLARE_ACCOUNT_ID: "account",
			CLOUDFLARE_GATEWAY_ID: "gateway",
		};

		streams.stream(model, context, { env });
		streams.streamSimple(model, context, { env });

		expect(captured).toEqual([
			"https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
			"https://gateway.ai.cloudflare.com/v1/account/gateway/openai",
		]);
	});

	it("keeps placeholders when the provider env does not resolve them", () => {
		let captured: string | undefined;
		const streams = cloudflareStreams({
			stream: (requestModel) => {
				captured = requestModel.baseUrl;
				return new AssistantMessageEventStream();
			},
			streamSimple: (requestModel) => {
				captured = requestModel.baseUrl;
				return new AssistantMessageEventStream();
			},
		});

		streams.streamSimple(model, context, {});

		expect(captured).toBe(model.baseUrl);
	});
});
