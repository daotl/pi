import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as CallbackServerModule from "../src/auth/oauth/callback-server.ts";
import type { OAuthCallbackServerOptions } from "../src/auth/oauth/callback-server.ts";
import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";
import { openRouterOAuth } from "../src/auth/oauth/openrouter.ts";
import { createRadiusOAuth } from "../src/auth/oauth/radius.ts";

const control = vi.hoisted(() => ({
	entered: undefined as (() => void) | undefined,
	release: undefined as Promise<void> | undefined,
	uri: "",
}));

vi.mock("../src/auth/oauth/callback-server.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof CallbackServerModule>();
	return {
		...actual,
		startOAuthCallbackServer: async (options: OAuthCallbackServerOptions<unknown>) => {
			const server = await actual.startOAuthCallbackServer({ ...options, port: 0 });
			control.uri = server.redirectUri;
			return {
				...server,
				close: async () => {
					control.entered?.();
					await control.release;
					await server.close();
				},
			};
		},
	};
});

describe("OAuth login callback shutdown", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(["OpenRouter", "OpenAI Codex", "Radius"] as const)(
		"keeps %s cancellation pending until callback shutdown finishes",
		async (provider) => {
			const entered = Promise.withResolvers<void>();
			const gate = Promise.withResolvers<void>();
			control.entered = entered.resolve;
			control.release = gate.promise;
			control.uri = "";
			const abort = new AbortController();
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => Response.json({ authorizationEndpoint: "https://radius.example/authorize" })),
			);
			const oauth =
				provider === "OpenRouter"
					? openRouterOAuth
					: provider === "OpenAI Codex"
						? openaiCodexOAuth
						: createRadiusOAuth({ name: "Radius", gateway: "https://radius.example" });
			let settled = false;
			const login = oauth
				.login({
					signal: abort.signal,
					prompt: async (prompt) => {
						if (prompt.type === "select") return "browser";
						return new Promise<string>((_, reject) => {
							if (prompt.signal?.aborted) reject(new Error("cancelled"));
							else
								prompt.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
						});
					},
					notify: (event) => {
						if (event.type === "auth_url") queueMicrotask(() => abort.abort());
					},
				})
				.then(
					() => {
						settled = true;
						return undefined;
					},
					(error: unknown) => {
						settled = true;
						return error;
					},
				);
			const replacement = createServer();
			try {
				await entered.promise;
				await new Promise<void>((resolve) => setImmediate(resolve));
				expect(settled).toBe(false);
				gate.resolve();
				expect(await login).toBeInstanceOf(Error);
				const url = new URL(control.uri);
				await new Promise<void>((resolve, reject) => {
					replacement.once("error", reject);
					replacement.listen(Number(url.port), "127.0.0.1", resolve);
				});
				expect(replacement.listening).toBe(true);
			} finally {
				gate.resolve();
				await login;
				if (replacement.listening) await new Promise<void>((resolve) => replacement.close(() => resolve()));
				control.entered = undefined;
				control.release = undefined;
			}
		},
	);
});
