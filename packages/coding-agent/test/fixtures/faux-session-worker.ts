import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineFacet, local } from "@earendil-works/chord";
import { AgentHarness, BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { consumeInternalProcessRole } from "../../src/experimental/process.ts";
import { runSessionWorkerWithHarness } from "../../src/experimental/session-worker.ts";
import { KeyedProbe } from "./keyed-service.ts";

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const role = consumeInternalProcessRole();
	if (role !== "session-worker") throw new Error("Faux Session worker requires a session-worker invocation");
	void runSessionWorkerWithHarness(process.argv.slice(2), async (session, options) => {
		if (options.provider !== "anthropic" || options.model !== "claude-sonnet-4-5") {
			throw new Error(`Unexpected faux worker model: ${options.provider}/${options.model}`);
		}
		const faux = fauxProvider();
		faux.setResponses([fauxAssistantMessage("deterministic remote answer", { timestamp: 20 })]);
		const models = createModels();
		models.setProvider(faux.provider);
		const harness = (
			await AgentHarness.create(
				{
					session,
					models,
					model: faux.getModel(),
					tools: [],
					resources: {},
				},
				BACKGROUND_CONTEXT,
			)
		).harness;
		const ProbeState = local("test.local.keyed-probe", {
			version: 1,
			input: Type.Object({ key: Type.String() }),
			members: {
				state: Type.Object({ value: Type.String() }),
				replace: KeyedProbe.def.variants.active.methods.replace,
			},
		});
		const keyedProbeFacet = {
			name: "@test/keyed-probe",
			...defineFacet(({ serve }) => {
				serve(
					ProbeState,
					(_input, _principal, self) => {
						const state = self.state("probe", Type.Object({ value: Type.String() }), { value: "first" });
						return { state, replace: (value, ctx) => state.replace(ctx, { value }) };
					},
					{ linger: 0 },
				);
				serve(KeyedProbe, ({ key }, _principal, self) => {
					const probe = self.get(ProbeState, { key }, { principal: "worker" });
					return {
						variant: "active",
						state: probe.state,
						replace: (value, ctx) => probe.replace(value, ctx),
						async wait(ctx) {
							ctx.signal.throwIfAborted();
							await new Promise<void>((_resolve, reject) =>
								ctx.signal.addEventListener("abort", () => reject(abortError(ctx.signal)), { once: true }),
							);
						},
					};
				});
			}),
		};
		return { harness, facetLoader: async () => ({ facets: [keyedProbeFacet], async dispose() {} }) };
	}).catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}

function abortError(signal: AbortSignal): Error {
	const reason: unknown = signal.reason;
	return reason instanceof Error ? reason : new DOMException("The operation was aborted", "AbortError");
}
