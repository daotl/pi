import type { ProviderClassifier } from "../types.ts";
import { classify } from "./openai-decisions.ts";

export const openAIDecisionsApi = (): ProviderClassifier => ({ classify });
