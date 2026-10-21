import { getEventListeners } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { countChatTokens, countTokens, TokenizeTransientError } from "../src/tokenize.ts";
import type { Model } from "../src/types.ts";

const model: Model<"openai-completions"> = {
	id: "local",
	name: "Local",
	api: "openai-completions",
	provider: "local",
	baseUrl: "http://127.0.0.1/v1",
	reasoning: false,
	input: ["text"],
	contextWindow: 10000,
	maxTokens: 1000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
for (const kind of ["text", "chat"] as const) {
	describe(`${kind} tokenizer response lifetime`, () => {
		const count = (
			selected: typeof model,
			options: { fetch: typeof fetch; signal?: AbortSignal; timeoutMs?: number },
		) =>
			kind === "text"
				? countTokens(selected, { ...options, text: "hello" })
				: countChatTokens(selected, { ...options, messages: [{ role: "user", content: "hello" }] });
		it.each(["abort", "timeout"] as const)("settles a native unfinished JSON body on %s", async (action) => {
			const received = Promise.withResolvers<void>();
			const watchdog = Promise.withResolvers<never>();
			const timer = setTimeout(() => watchdog.reject(new Error("Tokenizer body did not settle")), 2000);
			const controller = new AbortController();
			const server = createServer((_request, response) => {
				response.writeHead(200, { "content-type": "application/json" });
				response.write("{");
			});
			let operation: Promise<{ value?: number; error?: unknown }> | undefined;
			try {
				await new Promise<void>((resolve, reject) => {
					server.once("error", reject);
					server.listen(0, "127.0.0.1", resolve);
				});
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("Missing listener");
				operation = count(
					{ ...model, baseUrl: `http://127.0.0.1:${address.port}/v1` },
					{
						signal: controller.signal,
						timeoutMs: action === "timeout" ? 300 : 1500,
						fetch: async (...args) => {
							try {
								const response = await fetch(...args);
								received.resolve();
								return response;
							} catch (error) {
								received.reject(error);
								throw error;
							}
						},
					},
				).then(
					(value) => ({ value }),
					(error: unknown) => ({ error }),
				);
				await Promise.race([received.promise, watchdog.promise]);
				await new Promise<void>((resolve) => setImmediate(resolve));
				if (action === "abort") controller.abort();
				const result = await Promise.race([operation, watchdog.promise]);
				if (action === "abort") expect(result).toEqual({ value: undefined });
				else expect(result.error).toBeInstanceOf(TokenizeTransientError);
				expect(getEventListeners(controller.signal, "abort")).toEqual([]);
			} finally {
				clearTimeout(timer);
				controller.abort();
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
				await operation;
			}
		});
		it("does not wait for a rejected body's cancellation promise", async () => {
			const pending = Promise.withResolvers<void>();
			const cancel = vi.fn(() => pending.promise);
			const watchdog = Promise.withResolvers<never>();
			const timer = setTimeout(
				() => watchdog.reject(new Error("Rejected-body disposal blocked classification")),
				200,
			);
			try {
				const result = count(model, {
					fetch: async () => new Response(new ReadableStream({ cancel }), { status: 404 }),
				});
				expect(await Promise.race([result, watchdog.promise])).toBeUndefined();
				expect(cancel).toHaveBeenCalledTimes(1);
			} finally {
				clearTimeout(timer);
				pending.resolve();
			}
		});
		it("cleans caller listeners when fetching fails", async () => {
			const controller = new AbortController();
			await expect(
				count(model, {
					signal: controller.signal,
					fetch: async () => {
						throw new Error("connection refused");
					},
				}),
			).rejects.toBeInstanceOf(TokenizeTransientError);
			expect(getEventListeners(controller.signal, "abort")).toEqual([]);
			controller.abort();
		});
	});
}
