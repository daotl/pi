import type { ProviderStreams } from "../types.ts";

const historyStreams = new WeakMap<ProviderStreams, Pick<ProviderStreams, "stream" | "streamSimple">>();

/** @internal Opt in only repository-owned transports that preserve converted request history. */
export function markHistoryPreservingApi(streams: ProviderStreams): ProviderStreams {
	historyStreams.set(streams, { stream: streams.stream, streamSimple: streams.streamSimple });
	return streams;
}

/** @internal History attribution is not permission to send credentials to a tokenizer endpoint. */
export function isHistoryPreservingApi(streams: ProviderStreams): boolean {
	const original = historyStreams.get(streams);
	return (
		original !== undefined && original.stream === streams.stream && original.streamSimple === streams.streamSimple
	);
}
