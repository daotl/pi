import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateImages } from "../src/images.ts";
import type { ImageModel, ImagesContext } from "../src/types.ts";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
	lastRequestOptions: undefined as unknown,
	usage: {} as Record<string, unknown>,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: unknown, requestOptions?: unknown) => {
					mockState.lastParams = params;
					mockState.lastRequestOptions = requestOptions;
					const signal = (requestOptions as { signal?: AbortSignal } | undefined)?.signal;
					if (signal?.aborted) {
						const error = new Error("Request aborted");
						return {
							withResponse: async () => {
								throw error;
							},
						};
					}
					const response = {
						id: "img-1",
						usage: mockState.usage,
						choices: [
							{
								message: {
									content: "Here is your image.",
									images: [{ image_url: "data:image/png;base64,ZmFrZS1wbmc=" }],
								},
							},
						],
					};
					const promise = Promise.resolve(response) as Promise<typeof response> & {
						withResponse: () => Promise<{
							data: typeof response;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: response,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

describe("openrouter images", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
		mockState.lastRequestOptions = undefined;
		mockState.usage = {
			prompt_tokens: 12,
			completion_tokens: 34,
			prompt_tokens_details: { cached_tokens: 0 },
		};
	});

	it("returns text plus images in final output", async () => {
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "google/gemini-3.1-flash-image-preview",
			name: "Gemini 3.1 Flash Image Preview",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text", "image"],
			output: ["text", "image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
			headers: { "HTTP-Referer": "https://example.com" },
		};
		const context: ImagesContext = {
			input: [{ type: "text", text: "Generate a dog" }],
		};

		const output = await generateImages(model, context, { apiKey: "test" });
		expect(output.stopReason).toBe("stop");
		expect(output.responseId).toBe("img-1");
		expect(output.output[0]).toMatchObject({ type: "text", text: "Here is your image." });
		expect(output.output[1]).toMatchObject({ type: "image", mimeType: "image/png", data: "ZmFrZS1wbmc=" });

		const params = mockState.lastParams as {
			stream?: boolean;
			modalities?: string[];
			messages?: [{ content?: [{ type: string; text?: string }] }];
		};
		expect(params.stream).toBe(false);
		expect(params.modalities).toEqual(["image", "text"]);
		expect(params.messages?.[0]?.content?.[0]).toMatchObject({ type: "text", text: "Generate a dog" });
	});

	it("records paid image billing even when catalog token rates are zero", async () => {
		mockState.usage = { ...mockState.usage, cost: 0.125, is_byok: false, cost_details: null };
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text"],
			output: ["image"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		};
		const result = await generateImages(
			model,
			{ input: [{ type: "text", text: "Generate a dog" }] },
			{ apiKey: "test" },
		);
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toMatchObject({
			input: 12,
			output: 34,
			totalTokens: 46,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.125, totalFromProvider: true },
		});
	});

	it.each([
		{ upstream_inference_cost: 0.9, upstream_inference_prompt_cost: 0.6, upstream_inference_completions_cost: 0.3 },
		{ upstream_inference_cost: null, upstream_inference_prompt_cost: 0.6, upstream_inference_completions_cost: 0.3 },
	])("includes upstream BYOK image charges: %j", async (details) => {
		mockState.usage = { ...mockState.usage, cost: 0.1, is_byok: true, cost_details: details };
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text"],
			output: ["image"],
			cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		};
		const result = await generateImages(
			model,
			{ input: [{ type: "text", text: "Generate a dog" }] },
			{ apiKey: "test" },
		);
		expect(result.stopReason).toBe("stop");
		expect(result.usage?.cost.total).toBeCloseTo(1);
		expect(result.usage?.cost.totalFromProvider).toBe(true);
		expect(result.usage?.cost.input).toBeCloseTo(0.000012);
		expect(result.usage?.cost.output).toBeCloseTo(0.000068);
	});

	it.each([
		{},
		{ cost: null, is_byok: false },
		{ cost: -1, is_byok: false },
		{ cost: Number.POSITIVE_INFINITY, is_byok: false },
		{ cost: "0.5", is_byok: false },
		{ cost: 0.1 },
		{ cost: 0.1, is_byok: true, cost_details: null },
	])("uses tier-aware catalog estimates for missing or invalid image billing: %j", async (accounting) => {
		mockState.usage = {
			...mockState.usage,
			prompt_tokens_details: { cached_tokens: 6, cache_write_tokens: 2 },
			...accounting,
		};
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text"],
			output: ["image"],
			cost: {
				input: 1,
				output: 1,
				cacheRead: 1,
				cacheWrite: 1,
				tiers: [{ inputTokensAbove: 10, input: 2, output: 4, cacheRead: 1, cacheWrite: 3 }],
			},
		};
		const result = await generateImages(
			model,
			{ input: [{ type: "text", text: "Generate a dog" }] },
			{ apiKey: "test" },
		);
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toMatchObject({ input: 6, output: 34, cacheRead: 4, cacheWrite: 2, totalTokens: 46 });
		expect(result.usage?.cost.input).toBeCloseTo(0.000012);
		expect(result.usage?.cost.output).toBeCloseTo(0.000136);
		expect(result.usage?.cost.cacheRead).toBeCloseTo(0.000004);
		expect(result.usage?.cost.cacheWrite).toBeCloseTo(0.000006);
		expect(result.usage?.cost.total).toBeCloseTo(0.000158);
		expect(result.usage?.cost.totalFromProvider).toBe(false);
	});

	it("passes through abort signal and returns aborted result", async () => {
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text", "image"],
			output: ["image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
		};
		const context: ImagesContext = {
			input: [{ type: "text", text: "Generate a dog" }],
		};
		const controller = new AbortController();
		controller.abort();

		const output = await generateImages(model, context, { apiKey: "test", signal: controller.signal });
		expect(output.stopReason).toBe("aborted");
		expect(output.errorMessage).toBe("Request aborted");
		expect(mockState.lastRequestOptions).toMatchObject({ signal: controller.signal });
	});

	it("generateImages resolves the final assistant images result", async () => {
		const model: ImageModel<"openrouter-images"> = {
			type: "image",
			id: "black-forest-labs/flux.2-pro",
			name: "FLUX.2 Pro",
			api: "openrouter-images",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			input: ["text", "image"],
			output: ["image"],
			cost: { input: 0.015, output: 0.03, cacheRead: 0, cacheWrite: 0 },
		};
		const context: ImagesContext = {
			input: [{ type: "text", text: "Generate a dog" }],
		};

		const output = await generateImages(model, context, { apiKey: "test" });
		expect(output.output.some((item) => item.type === "image")).toBe(true);
		// Image-only models must not request text output.
		expect((mockState.lastParams as { modalities?: string[] }).modalities).toEqual(["image"]);
	});
});
