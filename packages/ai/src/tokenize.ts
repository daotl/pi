/**
 * Token counting via a server's `/tokenize` endpoint.
 *
 * llama.cpp's llama-server (and some other OpenAI-compatible servers) expose a
 * `POST /tokenize` endpoint that returns the model's own token ids for a piece
 * of text. Using it gives the exact token count for the loaded model instead of a
 * chars/4 estimate. Providers without the endpoint (OpenAI, Anthropic, most
 * hosted APIs) cause a fetch failure, and countTokens() returns undefined so the
 * caller can fall back to an estimate.
 */

import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions.js";
import type { Model, ProviderHeaders } from "./types.ts";
import { providerHeadersToRecord } from "./utils/headers.ts";
import { formatUserAgent } from "./utils/identity.ts";
import { type RetryPolicy, retryDelayMs } from "./utils/retry.ts";
import { sleep } from "./utils/sleep.ts";

export interface CountTokensOptions {
	text: string;
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: Record<string, string>;
	/** Custom fetch (for tests). Defaults to global fetch. */
	fetch?: typeof globalThis.fetch;
	/** AbortSignal (for tests). */
	signal?: AbortSignal;
	/** Request timeout in milliseconds. Default 30000. */
	timeoutMs?: number;
}

/** Chat-template input serialized by the native Chat Completions adapter. */
export interface ChatTokenRequest {
	model: string;
	messages: ChatCompletionMessageParam[];
	tools?: ChatCompletionTool[];
	tool_choice?: ChatCompletionToolChoiceOption;
	[key: string]: unknown;
}

/** Options for {@link countChatTokens}. Supply serialized wire content, not transcript messages. */
export type CountChatTokensOptions = {
	apiKey?: string;
	headers?: ProviderHeaders;
	env?: Record<string, string>;
	/** Custom fetch (for tests). Defaults to global fetch. */
	fetch?: typeof globalThis.fetch;
	/** AbortSignal (for tests). */
	signal?: AbortSignal;
	/** Request timeout in milliseconds. Default 30000. */
	timeoutMs?: number;
} & ({ request: ChatTokenRequest; messages?: never } | { messages: unknown[]; request?: never });

function usableTokenizerBaseUrl(baseUrl: string): boolean {
	if (!baseUrl || /[{}\s]/.test(baseUrl)) return false;
	try {
		const url = new URL(baseUrl);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * Derive the `/tokenize` URL from a model base URL.
 *
 * llama.cpp serves `/tokenize` at the server root while the OpenAI-compatible
 * base URL often ends in `/v1`. Strip a trailing `/vN` before appending. Returns
 * undefined for empty, unresolved, or non-HTTP(S) base URLs.
 */
export function tokenizeEndpointUrl(baseUrl: string): string | undefined {
	const trimmed = baseUrl.replace(/\/+$/, "");
	if (!usableTokenizerBaseUrl(trimmed)) return undefined;
	const root = /\/v\d+$/.test(trimmed) ? trimmed.replace(/\/v\d+$/, "") : trimmed;
	return `${root}/tokenize`;
}

/**
 * Derive the `/chat/completions/input_tokens` URL from a model base URL.
 *
 * llama.cpp (and other OpenAI-compatible servers) expose an input-token counting
 * variant of the chat endpoint. Unlike `/tokenize`, it applies the chat template
 * and handles multimodal content (images, audio), so the count matches what a
 * real inference request would produce. Returns undefined for unusable base URLs.
 */
export function chatTokenizeEndpointUrl(baseUrl: string): string | undefined {
	const trimmed = baseUrl.replace(/\/+$/, "");
	if (!usableTokenizerBaseUrl(trimmed)) return undefined;
	return `${trimmed}/chat/completions/input_tokens`;
}

/**
 * Thrown for transient tokenizer network/body failures, timeouts, HTTP 408/429,
 * and server failures. Other 4xx responses and completed unusable bodies mean
 * the optional endpoint is unavailable and return undefined instead.
 */
export class TokenizeTransientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TokenizeTransientError";
	}
}

/**
 * Count the tokens `text` occupies according to the model server's own tokenizer.
 *
 * Returns the exact count, or undefined for an unavailable endpoint, unusable
 * completed response, empty text or caller cancellation. Transient failures
 * throw TokenizeTransientError so callers can apply their existing retry policy.
 */
export async function countTokens(model: Model<any>, options: CountTokensOptions): Promise<number | undefined> {
	const url = tokenizeEndpointUrl(model.baseUrl);
	if (!url || !options.text) return undefined;

	const headers = providerHeadersToRecord(
		{
			"Content-Type": "application/json",
			"User-Agent": formatUserAgent(),
			...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
		},
		model.headers,
		options.headers,
	);

	const fetchFn = options.fetch ?? globalThis.fetch;
	const timeout = options.timeoutMs ?? 30000;

	if (options.signal?.aborted) return undefined;
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const res = await fetchFn(url, {
			method: "POST",
			headers,
			body: JSON.stringify({ content: options.text }),
			signal: controller.signal,
		});

		if (!res.ok) {
			// Disposal is best-effort and must not block HTTP classification.
			try {
				void res.body?.cancel().catch(() => {});
			} catch {
				/* Preserve the HTTP failure. */
			}
			// Optional endpoints cannot recover from permanent client/auth failures.
			if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return undefined;
			throw new TokenizeTransientError(`tokenize endpoint returned ${res.status}`);
		}
		if (res.status === 204) return undefined;
		let data: { tokens?: unknown };
		try {
			data = (await res.json()) as { tokens?: unknown };
		} catch (error) {
			if (error instanceof SyntaxError) return undefined;
			throw error;
		}
		if (Array.isArray(data?.tokens)) return data.tokens.length;
		// 200 without a token array: the endpoint is present but not usable for counting.
		return undefined;
	} catch (error) {
		if (options.signal?.aborted) return undefined;
		if (error instanceof TokenizeTransientError) throw error;
		throw new TokenizeTransientError(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

/**
 * Count the tokens a full chat request occupies according to the model server's
 * own tokenizer, via the `/chat/completions/input_tokens` endpoint.
 *
 * The request body carries the exact messages that would be sent to
 * `/chat/completions` (system message, tool calls, images), so the count includes
 * everything the inference request would consume - including multimodal content
 * that `/tokenize` cannot count. Returns undefined when the endpoint is missing
 * (clear 404), the body is empty, or the response lacks `input_tokens`, so the
 * caller can fall back to an estimate.
 */
export async function countChatTokens(model: Model<any>, options: CountChatTokensOptions): Promise<number | undefined> {
	const url = chatTokenizeEndpointUrl(model.baseUrl);
	const request = options.request ?? { messages: options.messages, model: model.id };
	if (!url || request.messages.length === 0) return undefined;

	const headers = providerHeadersToRecord(
		{
			"Content-Type": "application/json",
			"User-Agent": formatUserAgent(),
			...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
		},
		model.headers,
		options.headers,
	);

	const fetchFn = options.fetch ?? globalThis.fetch;
	const timeout = options.timeoutMs ?? 30000;

	if (options.signal?.aborted) return undefined;
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const res = await fetchFn(url, {
			method: "POST",
			headers,
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		if (!res.ok) {
			// Disposal is best-effort and must not block HTTP classification.
			try {
				void res.body?.cancel().catch(() => {});
			} catch {
				/* Preserve the HTTP failure. */
			}
			// Optional endpoints cannot recover from permanent client/auth failures.
			if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) return undefined;
			throw new TokenizeTransientError(`chat tokenize endpoint returned ${res.status}`);
		}
		if (res.status === 204) return undefined;
		let data: { input_tokens?: unknown };
		try {
			data = (await res.json()) as { input_tokens?: unknown };
		} catch (error) {
			if (error instanceof SyntaxError) return undefined;
			throw error;
		}
		if (typeof data?.input_tokens === "number") return data.input_tokens;
		// 200 without input_tokens: the endpoint is present but not usable for counting.
		return undefined;
	} catch (error) {
		if (options.signal?.aborted) return undefined;
		if (error instanceof TokenizeTransientError) throw error;
		throw new TokenizeTransientError(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

/**
 * Count tokens via `/tokenize`, retrying transient failures with the same
 * exponential-backoff policy used by assistant calls.
 *
 * Unavailable endpoints and completed unusable responses return undefined
 * without retrying. Transient network/body failures, timeouts, HTTP 408/429 and
 * server failures retry up to policy.maxRetries times. Infinity keeps retrying
 * until success, unavailability, or caller cancellation.
 *
 * Returns undefined after exhausting retries (or on abort), so the caller falls
 * back to an estimate rather than failing the whole operation.
 * onUnavailable reports only a definitive unusable endpoint for non-empty text, not
 * cancellation, policy denial, or exhausted transient retries. canRequest is awaited
 * before each attempt; rejection propagates without uploading text or credentials.
 */
export async function countTokensWithRetry(
	model: Model<any>,
	options: CountTokensOptions,
	policy: RetryPolicy | undefined,
	onUnavailable?: () => void,
	canRequest?: () => boolean | Promise<boolean>,
): Promise<number | undefined> {
	const maxAttempts = policy?.enabled ? policy.maxRetries : 0;
	let attempt = 0;
	for (;;) {
		if (options.signal?.aborted || (canRequest && !(await canRequest())) || options.signal?.aborted) return undefined;
		try {
			const count = await countTokens(model, options);
			if (count === undefined && options.text && !options.signal?.aborted) onUnavailable?.();
			return count;
		} catch (error) {
			if (!(error instanceof TokenizeTransientError)) throw error;
			if (attempt >= maxAttempts) return undefined;
			attempt++;
			try {
				const delay = retryDelayMs(policy!, attempt);
				if (options.signal) await sleep(delay, options.signal);
				else await new Promise<void>((resolve) => setTimeout(resolve, delay));
			} catch (sleepError) {
				// Abort during the backoff sleep is terminal: stop retrying.
				if (options.signal?.aborted) return undefined;
				throw sleepError;
			}
		}
	}
}
