import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { VIRTUAL_MODEL_STATE_ENTRY } from "../../src/core/virtual-models.ts";
import { createHarness, getMessageText } from "./harness.ts";

it.each([false, true])(
	"continues a virtual selection only on its prefix's physical model (switch %s)",
	async (switchModel) => {
		let selected = "original";
		const harness = await createHarness({
			fauxApi: "openai-completions",
			models: [{ id: "original" }, { id: "different" }],
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.registerVirtualModel({
						provider: "router",
						id: "auto",
						name: "Auto",
						contextWindow: 8192,
						route: (_request, ctx) => ({
							model: ctx.modelRegistry.find("faux", selected)!,
							thinkingLevel: "off",
							state: { chosen: selected },
						}),
					});
				},
			],
		});
		try {
			const runtime = harness.session.modelRuntime;
			harness.session.agent.streamFunction = (model, context, options) =>
				runtime.streamSimple(model, context, options);
			await harness.session.setModel(runtime.getModel("router", "auto")!);
			harness.setResponses([fauxAssistantMessage("original partial", { stopReason: "aborted" })]);
			await harness.session.prompt("original question");
			const before = harness.faux.state.callCount;
			const routerStates = structuredClone(
				harness.sessionManager
					.getEntries()
					.filter((entry) => entry.type === "custom" && entry.customType === VIRTUAL_MODEL_STATE_ENTRY),
			);
			selected = switchModel ? "different" : "original";
			const requests: Array<{ texts: string[]; prefill: boolean }> = [];
			harness.setResponses([
				(context, options) => {
					requests.push({
						texts: context.messages.filter((message) => message.role !== "system").map(getMessageText),
						prefill: options?.returnPrefill === true,
					});
					return fauxAssistantMessage("original partial completed");
				},
			]);
			await harness.session.continue();
			if (switchModel) {
				expect(requests).toEqual([]);
				expect(harness.faux.state.callCount).toBe(before);
				expect(harness.session.getLastAssistantText()).toBe("original partial");
				expect(
					harness.sessionManager
						.getEntries()
						.filter((entry) => entry.type === "custom" && entry.customType === VIRTUAL_MODEL_STATE_ENTRY),
				).toEqual(routerStates);
			} else {
				expect(requests).toEqual([{ texts: ["original question", "original partial"], prefill: true }]);
				expect(harness.session.getLastAssistantText()).toBe("original partial completed");
			}
			expect(harness.session.model).toMatchObject({ provider: "router", id: "auto" });
			expect(harness.session.isIdle).toBe(true);
		} finally {
			await harness.session.abort();
			harness.cleanup();
		}
	},
);

it.each(["same", "provider", "model"] as const)(
	"validates direct-Agent prefix origin on a physical selection (%s)",
	async (origin) => {
		const harness = await createHarness({
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		try {
			harness.sessionManager.appendMessage({ role: "user", content: "question", timestamp: 1 });
			harness.session.refreshContext();
			const model = harness.getModel();
			const prefix = {
				...fauxAssistantMessage("prefix"),
				api: model.api,
				provider: origin === "provider" ? "foreign" : model.provider,
				model: origin === "model" ? "foreign" : model.id,
			};
			let requests = 0;
			harness.setResponses([
				() => {
					requests++;
					return fauxAssistantMessage("prefix completed");
				},
			]);
			await harness.session.agent.continue(prefix);
			expect(requests).toBe(origin === "same" ? 1 : 0);
			if (origin === "same") expect(harness.session.getLastAssistantText()).toBe("prefix completed");
			else
				expect(harness.session.agent.state.messages.at(-1)).toMatchObject({
					role: "assistant",
					stopReason: "error",
					content: [{ type: "text", text: "" }],
				});
		} finally {
			await harness.session.abort();
			harness.cleanup();
		}
	},
);
