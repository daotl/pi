import type { ProviderStreams } from "../types.ts";
import { markHistoryPreservingApi } from "./history-provenance.ts";
import { lazyApi } from "./lazy.ts";

const directStreams = new WeakMap<ProviderStreams, Pick<ProviderStreams, "stream" | "streamSimple">>();

/** @internal Recognizes factory-created direct transport, never an API name. */
export function isDirectOpenAICompletionsApi(streams: ProviderStreams): boolean {
	const original = directStreams.get(streams);
	return (
		original !== undefined && original.stream === streams.stream && original.streamSimple === streams.streamSimple
	);
}

export const openAICompletionsApi = (): ProviderStreams => {
	const streams = markHistoryPreservingApi(lazyApi(() => import("./openai-completions.ts")));
	directStreams.set(streams, { stream: streams.stream, streamSimple: streams.streamSimple });
	return streams;
};
