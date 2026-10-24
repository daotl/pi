import { type AssistantMessage, createProvider, fauxAssistantMessage, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { expect, vi } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, type Harness, type HarnessOptions } from "../suite/harness.ts";

export const privateMarker = "PRIVATE_TOKENIZER_HISTORY";

export interface NativeTokenizerFixture {
	owner: Harness;
	session: AgentSession;
	manager: SessionManager;
	provider: Provider;
	uploads: Array<{ url: string; body: string; authorization: string | null }>;
	summaries: Array<{ body: string; authorization: string | null }>;
	setTokenizer(handler: (url: string, init?: RequestInit) => Promise<Response>): void;
	setResponses(messages: AssistantMessage[]): void;
	cleanup(): void;
}

/** Real SDK/native adapter; only HTTP responses are scripted, with unexpected origins rejected. */
export async function createNativeTokenizerFixture(options: HarnessOptions = {}): Promise<NativeTokenizerFixture> {
	const owner = await createHarness({
		...options,
		settings: { compaction: { enabled: false }, retry: { enabled: false }, ...options.settings },
	});
	try {
		const provider = createProvider({
			id: "tokenizer-native",
			auth: { apiKey: { name: "offline", resolve: async () => ({ auth: { apiKey: "offline-tokenizer-key" } }) } },
			models: [
				{
					id: "local",
					name: "Local",
					api: "openai-completions",
					provider: "tokenizer-native",
					baseUrl: "https://tokenizer.invalid/v1",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 100000,
					maxTokens: 4096,
				},
			],
			api: openAICompletionsApi(),
		});
		owner.session.modelRuntime.registerNativeProvider(provider);
		const model = provider.getModels()[0];
		if (!model) throw new Error("Missing native fixture model");
		const manager = SessionManager.inMemory();
		manager.appendMessage({ role: "system", content: "Trusted tokenizer baseline", timestamp: 0 });
		for (let index = 0; index < 4; index++) {
			manager.appendMessage({ role: "user", content: `question ${index}`, timestamp: index * 2 + 1 });
			manager.appendMessage({
				...fauxAssistantMessage(`answer ${index}`),
				api: model.api,
				provider: model.provider,
				model: model.id,
			});
		}
		manager.appendMessage({ role: "user", content: privateMarker, timestamp: 20 });
		manager.appendMessage({
			...fauxAssistantMessage(`retained answer ${privateMarker}`),
			api: model.api,
			provider: model.provider,
			model: model.id,
		});
		const { session } = await createAgentSession({
			cwd: owner.tempDir,
			agentDir: owner.tempDir,
			model,
			modelRuntime: owner.session.modelRuntime,
			settingsManager: owner.settingsManager,
			resourceLoader: owner.session.resourceLoader,
			sessionManager: manager,
			tools: options.initialActiveToolNames ?? [],
		});
		const uploads: Array<{ url: string; body: string; authorization: string | null }> = [];
		const summaries: Array<{ body: string; authorization: string | null }> = [];
		let tokenize: (url: string, init?: RequestInit) => Promise<Response> = async (url) =>
			url.endsWith("/tokenize")
				? Response.json({ tokens: Array(42).fill(0) })
				: Response.json({ input_tokens: 100 });
		let responses: AssistantMessage[] = [];
		vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			const body = String(init?.body);
			const authorization = new Headers(init?.headers).get("authorization");
			if (url.endsWith("/tokenize") || url.endsWith("/chat/completions/input_tokens")) {
				uploads.push({ url, body, authorization });
				if (url.endsWith("/chat/completions/input_tokens")) {
					const request = JSON.parse(body) as { messages: Array<Record<string, unknown>> };
					for (const message of request.messages) {
						expect(["system", "developer", "user", "assistant", "tool"]).toContain(message.role);
						expect(message).not.toHaveProperty("toolsAdded");
						expect(message).not.toHaveProperty("toolsRemoved");
						if (Array.isArray(message.content)) {
							for (const part of message.content) expect(["text", "image_url"]).toContain(part.type);
						}
					}
				}
				return tokenize(url, init);
			}
			if (url !== "https://tokenizer.invalid/v1/chat/completions") throw new Error(`Unexpected origin: ${url}`);
			summaries.push({ body, authorization });
			const response = responses.shift() ?? fauxAssistantMessage("safe checkpoint");
			if (response.stopReason === "error")
				return Response.json({ error: { message: response.errorMessage } }, { status: 400 });
			const chunk = {
				id: "summary",
				object: "chat.completion.chunk",
				created: 0,
				model: model.id,
				choices: [
					{
						index: 0,
						delta: {
							role: "assistant",
							content: response.content
								.filter((part) => part.type === "text")
								.map((part) => part.text)
								.join(""),
						},
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
			};
			return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
				headers: { "content-type": "text/event-stream" },
			});
		});
		return {
			owner,
			session,
			manager,
			provider,
			uploads,
			summaries,
			setTokenizer: (handler: typeof tokenize) => {
				tokenize = handler;
			},
			setResponses: (messages) => {
				responses = messages;
			},
			cleanup: () => {
				session.dispose();
				owner.cleanup();
			},
		};
	} catch (error) {
		owner.cleanup();
		throw error;
	}
}
