import { describe, expect, it, vi } from "vitest";
import { countChatTokens, countTokens, countTokensWithRetry, TokenizeTransientError } from "../src/tokenize.ts";
import type { Model } from "../src/types.ts";

const model: Model<"openai-completions"> = {
	id: "local",
	name: "Local",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://127.0.0.1:8080/v1",
	reasoning: false,
	input: ["text"],
	contextWindow: 10000,
	maxTokens: 1000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
for (const kind of ["text", "chat"] as const) {
	describe(`${kind} optional tokenizer unavailability`, () => {
		const count = (fetch: typeof globalThis.fetch, selected = model) =>
			kind === "text"
				? countTokens(selected, { text: "hello", fetch })
				: countChatTokens(selected, { messages: [{ role: "user", content: "hello" }], fetch });
		it.each([400, 401, 403, 404, 405, 422])("does not retry permanent HTTP %s", async (status) => {
			const fetch = vi.fn(async () => new Response("unavailable", { status }));
			if (kind === "text") {
				expect(
					await countTokensWithRetry(
						model,
						{ text: "hello", fetch },
						{ enabled: true, maxRetries: 3, baseDelayMs: 0 },
					),
				).toBeUndefined();
			} else expect(await count(fetch)).toBeUndefined();
			expect(fetch).toHaveBeenCalledTimes(1);
		});
		it.each([408, 429, 503])("keeps HTTP %s transient", async (status) => {
			await expect(count(async () => new Response("retry", { status }))).rejects.toBeInstanceOf(
				TokenizeTransientError,
			);
		});
		it.each(["empty", "HTML", "no-content"] as const)(
			"returns unavailable for a completed %s response",
			async (body) => {
				const fetch = vi.fn(async () =>
					body === "no-content"
						? new Response(null, { status: 204 })
						: new Response(body === "empty" ? "" : "<html>not JSON</html>"),
				);
				expect(await count(fetch)).toBeUndefined();
				expect(fetch).toHaveBeenCalledTimes(1);
			},
		);
		it.each(["https://{resource}.example.com/v1", "not-a-url", "file:///tmp/provider", "http://host/a b"])(
			"does not dispatch unusable endpoint %s",
			async (baseUrl) => {
				const fetch = vi.fn(async () => Response.json({}));
				expect(await count(fetch, { ...model, baseUrl })).toBeUndefined();
				expect(fetch).not.toHaveBeenCalled();
			},
		);
	});
}
