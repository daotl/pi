import { describe, expect, it, vi } from "vitest";
import { countChatTokens, countTokens } from "../src/tokenize.ts";
import type { Model, ProviderHeaders } from "../src/types.ts";
import { formatUserAgent } from "../src/utils/identity.ts";

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
	describe(`${kind} tokenizer credential merging`, () => {
		it.each<{ modelHeaders?: Record<string, string>; callerHeaders?: ProviderHeaders; expected: string | null }>([
			{ expected: "Bearer generated" },
			{ modelHeaders: { authorization: "model" }, expected: "model" },
			{ modelHeaders: { Authorization: "model" }, callerHeaders: { authorization: "caller" }, expected: "caller" },
			{ callerHeaders: { authorization: null }, expected: null },
			{ modelHeaders: { Authorization: "model" }, callerHeaders: { authorization: null }, expected: null },
		])(
			"preserves successful counting with header precedence $expected",
			async ({ modelHeaders, callerHeaders, expected }) => {
				let request: Request | undefined;
				const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
					request = new Request(input, init);
					return Response.json(kind === "text" ? { tokens: [1] } : { input_tokens: 1 });
				});
				const selected = { ...model, headers: modelHeaders };
				const common = { apiKey: "generated", headers: callerHeaders, fetch };
				const result =
					kind === "text"
						? await countTokens(selected, { ...common, text: "hello" })
						: await countChatTokens(selected, { ...common, messages: [{ role: "user", content: "hello" }] });
				expect(result).toBe(1);
				expect(fetch).toHaveBeenCalledTimes(1);
				expect(request?.headers.get("authorization")).toBe(expected);
				expect(request?.headers.get("user-agent")).toBe(formatUserAgent());
				expect(request?.url).toBe(
					kind === "text"
						? "http://localhost:8080/tokenize"
						: "http://localhost:8080/v1/chat/completions/input_tokens",
				);
				expect(await request?.json()).toEqual(
					kind === "text"
						? { content: "hello" }
						: { model: "local", messages: [{ role: "user", content: "hello" }] },
				);
			},
		);

		it.each([
			{ modelHeaders: { "User-Agent": "model-agent" }, headers: undefined, expected: "model-agent" },
			{
				modelHeaders: { "User-Agent": "model-agent" },
				headers: { "user-agent": "request-agent" },
				expected: "request-agent",
			},
			{ modelHeaders: { "User-Agent": "model-agent" }, headers: { "user-agent": null }, expected: null },
		])("preserves configured user agent precedence ($expected)", async ({ modelHeaders, headers, expected }) => {
			let sent: string | null | undefined;
			const fetch: typeof globalThis.fetch = async (_input, init) => {
				sent = new Headers(init?.headers).get("user-agent");
				return Response.json(kind === "text" ? { tokens: [1] } : { input_tokens: 1 });
			};
			const selected = { ...model, headers: modelHeaders };
			const result =
				kind === "text"
					? await countTokens(selected, { text: "hello", fetch, headers })
					: await countChatTokens(selected, { messages: [{ role: "user", content: "hello" }], fetch, headers });
			expect(result).toBe(1);
			expect(sent).toBe(expected);
		});
	});
}
