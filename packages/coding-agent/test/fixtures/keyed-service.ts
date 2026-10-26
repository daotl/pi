import { type Ctx as Context, hostNamed, method, type Readable, remote } from "@earendil-works/chord";
import { Type } from "typebox";

export interface KeyedProbe {
	readonly state: Readable<{ value: string }>;
	replace(value: string, context: Context): Promise<void>;
	wait(context: Context): Promise<void>;
}

export const KeyedProbe = remote("test.keyed-probe", {
	version: 1,
	input: Type.Object({ key: Type.String() }),
	host: hostNamed("session"),
	variants: {
		active: {
			state: { state: Type.Object({ value: Type.String() }) },
			methods: { replace: method(Type.String()), wait: method() },
		},
	},
});
