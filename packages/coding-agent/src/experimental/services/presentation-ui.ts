import { type Ctx as Context, local, opaque } from "@earendil-works/chord";
import { Type } from "typebox";

export interface PresentationSelectItem {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

/** Narrow process-local UI capabilities available to presentation facets. */
export interface PresentationUI {
	select(
		title: string,
		items: readonly PresentationSelectItem[],
		selectedValue: string | undefined,
		context: Context,
	): Promise<string | undefined>;
	showStatus(message: string, context: Context): void;
}

export const PresentationUI = local("pi.local.presentation-ui", {
	version: 1,
	input: Type.Object({}),
	members: { ui: opaque<PresentationUI>("pi.presentation-ui@1") },
});
