import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import type * as Compat from "../src/compat.ts";
import type * as Builtins from "../src/providers/all.ts";
import type { FetchFunction } from "../src/types.ts";

type BrowserApi = typeof Builtins & Pick<typeof Compat, "getProviders" | "stream" | "streamSimple">;
let browserBundle: string;
beforeAll(async () => {
	const result = await build({
		stdin: {
			contents: `export * from "./src/providers/all.ts";
export { getProviders, stream, streamSimple } from "./src/compat.ts";`,
			resolveDir: fileURLToPath(new URL("..", import.meta.url)),
			loader: "ts",
		},
		bundle: true,
		platform: "browser",
		format: "iife",
		globalName: "browserApi",
		write: false,
		logLevel: "silent",
	});
	browserBundle = result.outputFiles[0].text;
});
function browserRuntime() {
	const sandbox = createContext({
		AbortController,
		AbortSignal,
		Blob,
		clearTimeout,
		console,
		crypto: globalThis.crypto,
		DOMException,
		fetch: () => {
			throw new Error("Unexpected ambient network request");
		},
		FormData,
		Headers,
		performance: globalThis.performance,
		ReadableStream,
		Request,
		Response,
		setTimeout,
		TextDecoder,
		TextEncoder,
		URL,
		URLSearchParams,
	});
	runInContext("globalThis.window = globalThis; globalThis.self = globalThis;", sandbox);
	runInContext(browserBundle, sandbox);
	return { api: sandbox.browserApi as BrowserApi, sandbox };
}
describe("browser runtime without a process global", () => {
	it("reads the provider catalog and compatibility alias", () => {
		const { api, sandbox } = browserRuntime();
		expect("process" in sandbox).toBe(false);
		expect(api.getBuiltinProviders()).toContain("openai");
		expect(api.getProviders()).toEqual(api.getBuiltinProviders());
	});
	it("constructs built-in providers", () => {
		const { api } = browserRuntime();
		expect(
			api
				.builtinProviders()
				.find((p) => p.id === "openai")
				?.getModels()
				.find((m) => m.id === "gpt-4o-mini"),
		).toMatchObject({ provider: "openai", api: "openai-responses" });
	});
	it("registers built-in models", () => {
		const { api } = browserRuntime();
		expect(api.builtinModels().getModel("openai", "gpt-4o-mini")).toMatchObject({
			provider: "openai",
			api: "openai-responses",
		});
	});
	it.each(["stream", "streamSimple"] as const)("dispatches compat %s with an explicit key", async (method) => {
		const { api } = browserRuntime();
		const requests: Request[] = [];
		const fetch: FetchFunction = async (input, init) => {
			requests.push(new Request(input, init));
			return new Response(
				`data: ${JSON.stringify({ type: "response.completed", response: { id: "browser-response", status: "completed", output: [], usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } } })}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		};
		const result = await api[method](
			api.getBuiltinModel("openai", "gpt-4o-mini"),
			{ messages: [{ role: "user", content: "hello", timestamp: 1 }] },
			{ apiKey: "browser-explicit-key", fetch, maxRetries: 0 },
		).result();
		expect(result.errorMessage).toBeUndefined();
		expect(result.stopReason).toBe("stop");
		expect(result.usage).toMatchObject({ input: 2, output: 1, totalTokens: 3 });
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
		expect(requests[0].headers.get("authorization")).toBe("Bearer browser-explicit-key");
		expect(await requests[0].json()).toMatchObject({ model: "gpt-4o-mini", stream: true });
	});
	it("honors dynamic Node local-only mode", () => {
		const { api, sandbox } = browserRuntime();
		sandbox.process = { env: { PI_DISABLE_CLOUD_PROVIDERS: "1" } };
		expect(api.getBuiltinProviders()).toEqual([]);
		expect(api.getProviders()).toEqual([]);
		expect(api.builtinProviders()).toEqual([]);
		expect(api.builtinModels().getProviders()).toEqual([]);
		sandbox.process.env.PI_DISABLE_CLOUD_PROVIDERS = "0";
		expect(api.getBuiltinProviders()).toContain("openai");
		expect(api.builtinModels().getModel("openai", "gpt-4o-mini")?.provider).toBe("openai");
	});
});
