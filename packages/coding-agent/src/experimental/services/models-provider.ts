import { type Cell, ChordError, type Ctx as Context, defineFacet, type Facet, local } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { AgentLane, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ModelRuntime } from "../../core/model-runtime.ts";
import type { SettingsManager } from "../../core/settings-manager.ts";
import { Models, type Models as ModelsService, type ModelsState, ModelsStateSchema } from "./models.ts";

export interface ModelsServiceRuntime {
	readonly service: ModelsService;
	initial(context: Context): Promise<ModelsState>;
}

export function createModelsService(
	lane: AgentLane,
	modelRuntime: ModelRuntime | undefined,
	settingsManager: SettingsManager | undefined,
	createState: (initial: ModelsState) => Cell<ModelsState>,
): ModelsServiceRuntime {
	let catalogRevision = 0;
	const state = createState({
		catalog: { revision: 0, availableModels: [] },
		configuration: { model: null, thinkingLevel: "off" },
		refresh: { status: "idle" },
	});
	const readConfiguration = async (context: Context): Promise<ModelsState["configuration"]> => {
		const [selected, thinkingLevel] = await Promise.all([
			lane.getModel(withAbortSignal(context.signal, BACKGROUND_CONTEXT)),
			lane.getThinkingLevel(withAbortSignal(context.signal, BACKGROUND_CONTEXT)),
		]);
		return {
			model: selected === undefined ? null : { provider: selected.provider, modelId: selected.id },
			thinkingLevel,
		};
	};
	const readThinkingLevels = async (context: Context): Promise<ThinkingLevel[]> => {
		const selected = await lane.getModel(withAbortSignal(context.signal, BACKGROUND_CONTEXT));
		return selected === undefined ? ["off"] : getSupportedThinkingLevels(selected);
	};
	const readCatalog = async (context: Context): Promise<ModelsState["catalog"]> => {
		const selected = await lane.getModel(withAbortSignal(context.signal, BACKGROUND_CONTEXT));
		const available = modelRuntime?.getAvailableSnapshot() ?? [];
		const catalog =
			selected === undefined || includesModel(available, selected) ? available : [...available, selected];
		catalogRevision += 1;
		return {
			revision: catalogRevision,
			availableModels: catalog.map((model) => ({
				provider: model.provider,
				modelId: model.id,
				name: model.name,
				reasoning: model.reasoning,
			})),
		};
	};
	const service: ModelsService = {
		state,
		async cycleThinking(context) {
			const levels = await readThinkingLevels(context);
			const current = await lane.getThinkingLevel(withAbortSignal(context.signal, BACKGROUND_CONTEXT));
			const index = levels.indexOf(current);
			const next = levels[(index + 1) % levels.length] ?? "off";
			await lane.setThinkingLevel(next, withAbortSignal(context.signal, BACKGROUND_CONTEXT));
			const configuration = await readConfiguration(context);
			state.change(context, (draft) => {
				draft.configuration = configuration;
			});
		},
		async getThinkingLevels(context) {
			return [...(await readThinkingLevels(context))];
		},
		async refresh(context) {
			state.change(context, (draft) => {
				draft.refresh = { status: "refreshing" };
			});
			const refresh = modelRuntime?.refresh({ signal: context.signal });
			if (refresh === undefined) {
				const [catalog, configuration] = await Promise.all([readCatalog(context), readConfiguration(context)]);
				state.change(context, (draft) => {
					draft.catalog = catalog;
					draft.configuration = configuration;
					draft.refresh = { status: "done" };
				});
				return;
			}
			const result = await refresh;
			const errors = Object.fromEntries([...result.errors].map(([id, error]) => [id, error.message]));
			const [catalog, configuration] = await Promise.all([readCatalog(context), readConfiguration(context)]);
			state.change(context, (draft) => {
				draft.catalog = catalog;
				draft.configuration = configuration;
				draft.refresh = Object.keys(errors).length === 0 ? { status: "done" } : { status: "warning", errors };
			});
		},
		async select(model, context) {
			const selected = modelRuntime?.getModel(model.provider, model.modelId);
			if (selected === undefined)
				throw new ChordError("invalid", `Unknown model: ${model.provider}/${model.modelId}`, { reason: "model" });
			await lane.setModel(
				{ provider: selected.provider, modelId: selected.id },
				withAbortSignal(context.signal, BACKGROUND_CONTEXT),
			);
			settingsManager?.setDefaultModelAndProvider(selected.provider, selected.id);
			await settingsManager?.flush();
			const configuration = await readConfiguration(context);
			state.change(context, (draft) => {
				draft.configuration = configuration;
			});
		},
		async selectThinking(level, context) {
			const levels = await readThinkingLevels(context);
			if (!levels.includes(level)) {
				throw new ChordError(
					"invalid",
					`Thinking level ${level} is unavailable; choose one of: ${levels.join(", ")}`,
					{ reason: "thinking_level" },
				);
			}
			await lane.setThinkingLevel(level, withAbortSignal(context.signal, BACKGROUND_CONTEXT));
			const configuration = await readConfiguration(context);
			state.change(context, (draft) => {
				draft.configuration = configuration;
			});
		},
	};
	return {
		service,
		async initial(context) {
			const [catalog, configuration] = await Promise.all([readCatalog(context), readConfiguration(context)]);
			return { catalog, configuration, refresh: { status: "idle" } };
		},
	};
}

const ModelsRuntime = local("pi.local.models-runtime", {
	version: 1,
	input: Type.Object({}),
	members: { state: ModelsStateSchema, ...Models.def.variants.active.methods },
});

export function createModelsServiceFacet(options: {
	readonly lane: AgentLane;
	readonly modelRuntime: ModelRuntime | undefined;
	readonly settingsManager?: SettingsManager;
}): Facet {
	return {
		name: "@pi/models",
		...defineFacet(({ serve }) => {
			serve(
				ModelsRuntime,
				(_input, _principal, self) => {
					let runtime!: ModelsServiceRuntime;
					runtime = createModelsService(options.lane, options.modelRuntime, options.settingsManager, () =>
						self.state("models", ModelsStateSchema, { init: (ctx) => runtime.initial(ctx) }),
					);
					return {
						state: runtime.service.state,
						cycleThinking: (ctx) => runtime.service.cycleThinking(ctx),
						getThinkingLevels: (ctx) => runtime.service.getThinkingLevels(ctx),
						refresh: (ctx) => runtime.service.refresh(ctx),
						select: (model, ctx) => runtime.service.select(model, ctx),
						selectThinking: (level, ctx) => runtime.service.selectThinking(level, ctx),
					};
				},
				{ lifetime: "host" },
			);
			serve(Models, (_input, _principal, self) => {
				const runtime = self.get(ModelsRuntime, {});
				return {
					variant: "active",
					state: runtime.state,
					cycleThinking: (ctx) => invokeModels(runtime.cycleThinking(ctx)),
					getThinkingLevels: (ctx) => invokeModels(runtime.getThinkingLevels(ctx)),
					refresh: (ctx) => invokeModels(runtime.refresh(ctx)),
					select: (model, ctx) => invokeModels(runtime.select(model, ctx)),
					selectThinking: (level, ctx) => invokeModels(runtime.selectThinking(level, ctx)),
				};
			});
		}),
	};
}
function includesModel(
	models: readonly { readonly provider: string; readonly id: string }[],
	selected: { readonly provider: string; readonly id: string },
): boolean {
	return models.some((model) => model.provider === selected.provider && model.id === selected.id);
}

async function invokeModels<T>(operation: Promise<T>): Promise<T> {
	try {
		return await operation;
	} catch (error) {
		if (error instanceof ChordError) throw error;
		if (error instanceof Error && error.name === "AbortError") throw new ChordError("aborted", "Operation cancelled");
		throw new ChordError("unavailable", "Internal session error", { reason: "internal_error", cause: error });
	}
}
