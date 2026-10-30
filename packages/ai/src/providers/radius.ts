import { piMessagesApi } from "../api/pi-messages.lazy.ts";
import { envApiKeyAuth, lazyOAuth } from "../auth/helpers.ts";
import { loadRadiusOAuth } from "../auth/oauth/load.ts";
import type { Provider } from "../models.ts";
import type { Model } from "../types.ts";
import { RADIUS_MODELS } from "./radius.models.ts";
import {
	DEFAULT_RADIUS_GATEWAY,
	getRadiusModels,
	getRadiusModelsFromConfig,
	loadRadiusGatewayConfig,
	normalizeRadiusGatewayUrl,
} from "./radius-config.ts";

export interface RadiusProviderOptions {
	id?: string;
	name?: string;
	gateway?: string;
}

/** Radius gateway provider with a persisted, dynamically refreshed catalog. */
export function radiusProvider(options: RadiusProviderOptions = {}): Provider<"pi-messages"> {
	const id = options.id ?? "radius";
	const name = options.name ?? "Radius";
	const gateway = normalizeRadiusGatewayUrl(options.gateway ?? DEFAULT_RADIUS_GATEWAY);
	const baselineModels: Model<"pi-messages">[] =
		gateway === normalizeRadiusGatewayUrl(DEFAULT_RADIUS_GATEWAY)
			? Object.values(RADIUS_MODELS).map((model) => ({ ...model, provider: id }))
			: [];
	// Gateway catalog for this account. Radius org owners can disable models, so once known it replaces
	// the shipped baseline instead of overlaying it. The baseline only covers the time before any catalog exists.
	let dynamicModels: Model<"pi-messages">[] | undefined;
	const streams = piMessagesApi();

	return {
		id,
		name,
		baseUrl: `${gateway}/v1`,
		auth: {
			apiKey: envApiKeyAuth("Radius API key", ["RADIUS_API_KEY"]),
			oauth: lazyOAuth({ name, load: () => loadRadiusOAuth({ name, gateway }) }),
		},
		resolveCachedModelAuth: async (credential, ctx) => ({
			apiKey:
				credential?.type === "oauth" ? credential.access : credential?.key || (await ctx.env("RADIUS_API_KEY")),
		}),
		getModels: () => dynamicModels ?? baselineModels,
		refreshModels: async (context) => {
			// Only side-effect-free, proven auth can identify a stored account catalog.
			const identityText = context.auth?.apiKey
				? JSON.stringify({
						gateway,
						baseUrl: (context.auth.baseUrl ?? context.baseUrl ?? "").replace(/\/+$/, ""),
						credential: context.credential?.type ?? "api_key",
						apiKey: context.auth.apiKey,
						headers: Object.entries(context.auth.headers ?? {})
							.map(([key, value]) => [key.toLowerCase(), value] as const)
							.sort(([left], [right]) => left.localeCompare(right)),
					})
				: undefined;
			const identity =
				identityText === undefined
					? undefined
					: Array.from(
							new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identityText))),
							(byte) => byte.toString(16).padStart(2, "0"),
						).join("");
			const stored = context.stored;
			const matching = identity !== undefined && stored?.personalizationKey === identity;
			const restored = matching
				? ((stored?.models ?? []).filter((model) => model.provider === id) as Model<"pi-messages">[])
				: undefined;
			if (
				!(await context.publish({
					update: () => {
						dynamicModels = restored;
					},
				}))
			) {
				return;
			}
			// Import catalogs cached by the pre-ModelsStore Radius implementation.
			if (!stored && identity !== undefined && context.credential?.type === "oauth") {
				const legacy = getRadiusModels(id, context.credential);
				if (legacy.length > 0) {
					if (
						!(await context.publish({
							persist: { models: legacy, checkedAt: Date.now(), personalizationKey: identity },
							update: () => {
								dynamicModels = legacy;
							},
						}))
					) {
						return;
					}
				}
			}

			if (!context.allowNetwork || context.signal.aborted) return;
			const apiKey = context.auth?.apiKey;
			const config = await loadRadiusGatewayConfig(gateway, apiKey, context.signal);
			if (context.signal.aborted) return;
			const refreshed = getRadiusModelsFromConfig(id, config);
			await context.publish({
				persist: { models: refreshed, checkedAt: Date.now(), personalizationKey: identity },
				update: () => {
					dynamicModels = refreshed;
				},
			});
		},
		stream: (model, context, streamOptions) => streams.stream(model, context, streamOptions),
		streamSimple: (model, context, streamOptions) => streams.streamSimple(model, context, streamOptions),
	};
}
