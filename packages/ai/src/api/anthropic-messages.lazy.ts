import type { ProviderStreams } from "../types.ts";
import { markHistoryPreservingApi } from "./history-provenance.ts";
import { lazyApi } from "./lazy.ts";

export const anthropicMessagesApi = (): ProviderStreams =>
	markHistoryPreservingApi(lazyApi(() => import("./anthropic-messages.ts")));
