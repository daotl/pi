import type { ProviderStreams } from "../types.ts";
import { markContextClampingApi } from "./context-clamp-provenance.ts";
import { lazyApi } from "./lazy.ts";

export const googleGenerativeAIApi = (): ProviderStreams =>
	markContextClampingApi(lazyApi(() => import("./google-generative-ai.ts")));
