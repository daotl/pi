import { describe, expect, it, vi } from "vitest";
import { countChatTokens, countTokens } from "../src/tokenize.ts";
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
	});
}
