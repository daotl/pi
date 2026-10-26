import { type Ctx as Context, hostNamed, method, type Readable, remote } from "@earendil-works/chord";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

export interface ModelRef {
	provider: string;
	modelId: string;
}

export interface ModelSummary extends ModelRef {
	name: string;
	reasoning: boolean;
}

export interface ModelsState {
	catalog: {
		revision: number;
		availableModels: ModelSummary[];
	};
	configuration: {
		model: ModelRef | null;
		thinkingLevel: ThinkingLevel;
	};
	refresh: { status: "idle" | "refreshing" | "done" } | { status: "warning"; errors: Record<string, string> };
}

export interface Models {
	readonly state: Readable<ModelsState>;
	cycleThinking(context: Context): Promise<void>;
	getThinkingLevels(context: Context): Promise<ThinkingLevel[]>;
	refresh(context: Context): Promise<void>;
	select(model: ModelRef, context: Context): Promise<void>;
	selectThinking(level: ThinkingLevel, context: Context): Promise<void>;
}

export const ThinkingLevelSchema = Type.Union([
	Type.Literal("off"),
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("max"),
]);
export const ModelRefSchema = Type.Object({ provider: Type.String(), modelId: Type.String() });
export const ModelsStateSchema = Type.Unsafe<ModelsState>(
	Type.Object({
		catalog: Type.Object({
			revision: Type.Number(),
			availableModels: Type.Array(
				Type.Object({
					provider: Type.String(),
					modelId: Type.String(),
					name: Type.String(),
					reasoning: Type.Boolean(),
				}),
			),
		}),
		configuration: Type.Object({
			model: Type.Union([ModelRefSchema, Type.Null()]),
			thinkingLevel: ThinkingLevelSchema,
		}),
		refresh: Type.Union([
			Type.Object({ status: Type.Union([Type.Literal("idle"), Type.Literal("refreshing"), Type.Literal("done")]) }),
			Type.Object({ status: Type.Literal("warning"), errors: Type.Record(Type.String(), Type.String()) }),
		]),
	}),
);
export const Models = remote("pi.models", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: {
		active: {
			state: { state: ModelsStateSchema },
			methods: {
				cycleThinking: method(),
				getThinkingLevels: method(undefined, Type.Array(ThinkingLevelSchema)),
				refresh: method(),
				select: method(ModelRefSchema),
				selectThinking: method(ThinkingLevelSchema),
			},
		},
	},
});
