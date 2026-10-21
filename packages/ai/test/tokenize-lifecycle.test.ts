import { getEventListeners } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { countChatTokens, countTokens, TokenizeTransientError } from "../src/tokenize.ts";
import type { Model, ProviderHeaders } from "../src/types.ts";

const model: Model<"openai-completions"> = {
	id: "local",
	name: "Local",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://localhost:8080/v1",
	reasoning: false,
	input: ["text"],
	contextWindow: 10000,
	maxTokens: 1000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

for (const kind of ["text", "chat"] as const) {
	describe(`${kind} tokenizer lifecycle`, () => {
		function count(
			options: {
				fetch: typeof globalThis.fetch;
				headers?: ProviderHeaders;
				apiKey?: string;
				signal?: AbortSignal;
				timeoutMs?: number;
			},
			selected = model,
		) {
			return kind === "text"
				? countTokens(selected, { ...options, text: "hello" })
				: countChatTokens(selected, { ...options, messages: [{ role: "user", content: "hello" }] });
		}
		it("honors nullable case-insensitive credential suppression", async () => {
			let auth: string | null = null;
			await count({
				apiKey: "secret",
				headers: { authorization: null },
				fetch: async (_url, init) => {
					auth = new Headers(init?.headers).get("authorization");
					return Response.json(kind === "text" ? { tokens: [1] } : { input_tokens: 1 });
				},
			});
			expect(auth).toBeNull();
		});
		it.each([400, 401, 403, 404, 405, 422])("treats permanent HTTP %s as unavailable", async (status) => {
			const cancel = vi.fn();
			const body = new ReadableStream({ cancel });
			expect(await count({ fetch: async () => new Response(body, { status }) })).toBeUndefined();
			expect(cancel).toHaveBeenCalledTimes(1);
		});
		it.each([408, 429, 503])("keeps HTTP %s transient", async (status) => {
			await expect(count({ fetch: async () => new Response("retry", { status }) })).rejects.toBeInstanceOf(
				TokenizeTransientError,
			);
		});
		it.each(["<html>not JSON</html>", ""])("treats a completed unusable body as unavailable", async (body) => {
			expect(await count({ fetch: async () => new Response(body) })).toBeUndefined();
		});
		it.each(["abort", "timeout"] as const)("settles a stalled native response body on %s", async (outcome) => {
			const received = Promise.withResolvers<void>();
			const server = createServer((_request, response) => {
				response.writeHead(200, { "content-type": "application/json" });
				response.write("{");
			});
			await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing HTTP listener");
			const controller = new AbortController();
			try {
				const operation = count(
					{
						signal: controller.signal,
						timeoutMs: outcome === "timeout" ? 50 : 1000,
						fetch: async (...args) => {
							const response = await fetch(...args);
							received.resolve();
							return response;
						},
					},
					{ ...model, baseUrl: `http://127.0.0.1:${address.port}/v1` },
				);
				const result = operation.then(
					(value) => ({ value }),
					(error: unknown) => ({ error }),
				);
				await received.promise;
				await new Promise<void>((resolve) => setImmediate(resolve));
				if (outcome === "abort") controller.abort();
				if (outcome === "abort") expect(await result).toEqual({ value: undefined });
				else expect(await result).toMatchObject({ error: expect.any(TokenizeTransientError) });
				expect(getEventListeners(controller.signal, "abort")).toEqual([]);
			} finally {
				controller.abort();
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		});
		it("cleans cancellation listeners after a network failure", async () => {
			const controller = new AbortController();
			await expect(
				count({
					signal: controller.signal,
					fetch: async () => {
						throw new Error("network failed");
					},
				}),
			).rejects.toBeInstanceOf(TokenizeTransientError);
			expect(getEventListeners(controller.signal, "abort")).toEqual([]);
			controller.abort();
		});
		it("does not dispatch an unresolved endpoint", async () => {
			const fetch = vi.fn(async () => Response.json({}));
			expect(await count({ fetch }, { ...model, baseUrl: "https://{resource}.example.com/v1" })).toBeUndefined();
			expect(fetch).not.toHaveBeenCalled();
		});
	});
}
