import type { ProviderStreams } from "../types.ts";
import { markContextClampingApi } from "./context-clamp-provenance.ts";
import { lazyApi } from "./lazy.ts";

export const googleVertexApi = (): ProviderStreams =>
	markContextClampingApi(lazyApi(() => import("./google-vertex.ts")));
