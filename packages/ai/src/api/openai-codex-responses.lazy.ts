import type { ProviderStreams } from "../types.ts";
import { markContextClampingApi } from "./context-clamp-provenance.ts";
import { lazyApi } from "./lazy.ts";

export const openAICodexResponsesApi = (): ProviderStreams =>
	markContextClampingApi(lazyApi(() => import("./openai-codex-responses.ts")));
