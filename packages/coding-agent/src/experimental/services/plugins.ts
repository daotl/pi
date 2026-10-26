import { type Ctx as Context, hostNamed, type JsonValue, method, remote } from "@earendil-works/chord";
import { Type } from "typebox";

/** Server-built plugin generations available to presentations. */
export interface PresentationPlugins {
	prepareSession(
		request: { readonly sessionId: string; readonly packagePaths: readonly string[] | null },
		context: Context,
	): Promise<JsonValue>;
	reload(context: Context): Promise<JsonValue>;
}

export const PresentationPlugins = remote("pi.presentation-plugins", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("server"),
	variants: {
		active: {
			methods: {
				prepareSession: method(
					Type.Object({
						sessionId: Type.String(),
						packagePaths: Type.Union([Type.Array(Type.String()), Type.Null()]),
					}),
					Type.Unsafe<JsonValue>(Type.Unknown()),
				),
				reload: method(undefined, Type.Unsafe<JsonValue>(Type.Unknown())),
			},
		},
	},
});

/** Plugin facets hosted in the currently attached Session worker. */
export interface SessionPlugins {
	reload(context: Context): Promise<void>;
}

export const SessionPlugins = remote("pi.session-plugins", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: { active: { methods: { reload: method() } } },
});
