import type { ProviderStreams } from "../types.ts";

const clampingStreams = new WeakMap<ProviderStreams, Pick<ProviderStreams, "stream" | "streamSimple">>();

/** @internal Repository-owned simple adapters that apply the context output ceiling. */
export function markContextClampingApi(streams: ProviderStreams): ProviderStreams {
	clampingStreams.set(streams, { stream: streams.stream, streamSimple: streams.streamSimple });
	return streams;
}

/** @internal Dispatch capability only; grants neither history attribution nor tokenizer permission. */
export function isContextClampingApiStreams(streams: ProviderStreams): boolean {
	const original = clampingStreams.get(streams);
	return (
		original !== undefined && original.stream === streams.stream && original.streamSimple === streams.streamSimple
	);
}
