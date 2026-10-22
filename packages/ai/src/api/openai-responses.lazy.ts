import type { ProviderStreams } from "../types.ts";
import { markHistoryPreservingApi } from "./history-provenance.ts";
import { lazyApi } from "./lazy.ts";

export const openAIResponsesApi = (): ProviderStreams =>
	markHistoryPreservingApi(lazyApi(() => import("./openai-responses.ts")));
