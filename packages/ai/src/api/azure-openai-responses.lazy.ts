import type { ProviderStreams } from "../types.ts";
import { markContextClampingApi } from "./context-clamp-provenance.ts";
import { lazyApi } from "./lazy.ts";

export const azureOpenAIResponsesApi = (): ProviderStreams =>
	markContextClampingApi(lazyApi(() => import("./azure-openai-responses.ts")));
