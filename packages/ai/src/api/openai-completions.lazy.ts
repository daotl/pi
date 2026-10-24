import type { ChatTokenRequest } from "../tokenize.ts";
import type { Model, ProviderStreams, SimpleStreamOptions, TranscriptContext } from "../types.ts";
import { markContextClampingApi } from "./context-clamp-provenance.ts";
import { markHistoryPreservingApi } from "./history-provenance.ts";
import { lazyApi } from "./lazy.ts";

const directStreams = new WeakMap<ProviderStreams, Pick<ProviderStreams, "stream" | "streamSimple">>();

const loadApi = () => import("./openai-completions.ts");

/** Lazily serialize the native chat input without loading the adapter into core entry graphs. */
export async function buildChatTokenRequest(
	model: Model<"openai-completions">,
	context: TranscriptContext,
	options?: SimpleStreamOptions,
): Promise<ChatTokenRequest> {
	return (await loadApi()).buildChatTokenRequest(model, context, options);
}

/** @internal Recognizes factory-created direct transport, never an API name. */
export function isDirectOpenAICompletionsApi(streams: ProviderStreams): boolean {
	const original = directStreams.get(streams);
	return (
		original !== undefined && original.stream === streams.stream && original.streamSimple === streams.streamSimple
	);
}

export const openAICompletionsApi = (): ProviderStreams => {
	const streams = markContextClampingApi(markHistoryPreservingApi(lazyApi(loadApi)));
	directStreams.set(streams, { stream: streams.stream, streamSimple: streams.streamSimple });
	return streams;
};
