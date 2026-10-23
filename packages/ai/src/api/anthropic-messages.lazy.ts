import type { ProviderStreams } from "../types.ts";
import { markContextClampingApi } from "./context-clamp-provenance.ts";
import { markHistoryPreservingApi } from "./history-provenance.ts";
import { lazyApi } from "./lazy.ts";

export const anthropicMessagesApi = (): ProviderStreams =>
	markContextClampingApi(markHistoryPreservingApi(lazyApi(() => import("./anthropic-messages.ts"))));
