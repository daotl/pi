/**
 * Scheduler fan-out benchmark. One model-issued tool makes `calls` parallel nested calls of a tool that returns at
 * once, with an attached event consumer on in-memory storage, so the time includes the Harness, scheduler, and event
 * projection. Quadratic work shows as four times the time per doubling of `calls`.
 *
 *   node --conditions=source --experimental-strip-types test/scheduler-fanout-bench.ts [calls...]
 */
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Type } from "typebox";
import { createRegistry, defineExtension, defineTool, Harness, ToolResultEntry, watchEvents } from "../src/index.ts";
import { MemoryStorage } from "../src/storage/memory.ts";

async function run(
	calls: number,
): Promise<{ ms: number; commits: number; events: number; starts: number; ends: number }> {
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	const leaf = defineTool({
		name: "leaf",
		description: "Return at once",
		parameters: Type.Object({ n: Type.Number() }),
		execute: async () => ({ output: [{ type: "text", text: "ok" }] }),
	});
	const fan = defineTool({
		name: "fan",
		description: "Call leaf in parallel",
		parameters: Type.Object({ count: Type.Number() }),
		execute: async (args, api, callContext) => {
			const results = await Promise.all(
				Array.from({ length: args.count }, (_, n) =>
					api.executeTool("leaf", { n }, callContext, { progress: false }),
				),
			);
			const failed = results.filter((result) => result.isError).length;
			return { output: [{ type: "text", text: `${failed} failed` }], isError: failed > 0 };
		},
	});
	registry.install(defineExtension({ name: "bench", tools: [leaf, fan] }));
	const storage = new MemoryStorage();
	let commits = 0;
	const commit = storage.commit.bind(storage);
	storage.commit = (writes, adopt, commitContext) => {
		commits++;
		return commit(writes, adopt, commitContext);
	};
	const harness = await Harness.open(storage, { models, registry }, context);
	const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("fan", { count: calls }, { id: "fan" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	const stream = await watchEvents(harness, root.id, context);
	let events = 0;
	let starts = 0;
	let ends = 0;
	let updates = 0;
	stream.start(async (batch) => {
		events += batch.length;
		for (const event of batch) {
			if (event.type === "tool_execution_start") starts++;
			if (event.type === "tool_execution_end") ends++;
			if (event.type === "tool_execution_update") updates++;
		}
	});
	try {
		const started = performance.now();
		const settled = await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
		if (settled.status !== "done") throw new Error(`run: ${settled.status}`);
		await harness.waitForIdle(context);
		await stream.stop();
		const ms = Math.round(performance.now() - started);
		// A run whose nested calls failed, or whose attached consumer missed calls, measures nothing.
		const page = await root.entries({}, 10, undefined, context);
		const result = page.items.find((entry) => ToolResultEntry.is(entry))?.model?.[0];
		if (result?.role !== "toolResult" || result.isError) throw new Error(`run: nested calls failed`);
		if (starts !== calls + 1 || ends !== calls + 1 || updates !== 0) {
			throw new Error(`run: tool events ${starts} starts, ${ends} ends, ${updates} updates for ${calls} calls`);
		}
		return { ms, commits, events, starts, ends };
	} finally {
		await stream.stop();
		await harness.close(context);
	}
}

const sizes = process.argv.slice(2).map(Number);
console.log("calls | ms     | commits | events | starts | ends   | ms per call");
for (const calls of sizes.length > 0 ? sizes : [250, 500, 1000, 2000, 4000]) {
	const { ms, commits, events, starts, ends } = await run(calls);
	console.log(
		`${String(calls).padEnd(5)} | ${String(ms).padEnd(6)} | ${String(commits).padEnd(7)} | ${String(events).padEnd(6)} | ${String(starts).padEnd(6)} | ${String(ends).padEnd(6)} | ${(ms / calls).toFixed(2)}`,
	);
}
