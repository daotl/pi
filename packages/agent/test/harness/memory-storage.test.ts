import type { Usage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "../../src/harness/context.ts";
import * as sessionWrites from "../../src/harness/session/commit.ts";
import { MemoryStorage } from "../../src/harness/session/memory.ts";
import * as storedValues from "../../src/harness/session/values.ts";
import { addUsage, emptyUsage } from "../../src/harness/utils/usage.ts";

const NOW = 1_700_000_000_000;

describe("MemoryStorage", () => {
	it("uses the injected clock once per transaction", async () => {
		let timestamp = NOW;
		const storage = new MemoryStorage({ now: () => timestamp++ });

		const first = await storage.commit(
			[
				sessionWrites.insertEntry({
					id: "first",
					parentId: null,
					type: "custom",
					customType: "note",
				}),
				storedValues.setValue(storedValues.sessionName, "first"),
			],
			BACKGROUND_CONTEXT,
		);
		const second = await storage.commit(
			[storedValues.setValue(storedValues.sessionName, "second")],
			BACKGROUND_CONTEXT,
		);

		expect(first.timestamp).toBe(NOW);
		expect(second.timestamp).toBe(NOW + 1);
		expect((await storage.getEntries(["first"], BACKGROUND_CONTEXT)).get("first")?.timestamp).toBe(first.timestamp);
		await storage.close(BACKGROUND_CONTEXT);
	});
});

function charge(totalFromProvider: boolean | undefined): Usage {
	return {
		input: 1,
		output: 2,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 3,
		cost: {
			input: 0.1,
			output: 0.2,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.3,
			...(totalFromProvider === undefined ? {} : { totalFromProvider }),
		},
	};
}

const provenanceCases = [
	{ first: true, second: true, reported: true },
	{ first: true, second: false, reported: false },
	{ first: false, second: true, reported: false },
	{ first: true, second: undefined, reported: false },
	{ first: undefined, second: true, reported: false },
];

describe("usage billing provenance", () => {
	it.each(provenanceCases)("combines $first then $second charges", ({ first, second, reported }) => {
		const total = addUsage(charge(first), charge(second));
		expect(total.totalTokens).toBe(6);
		expect(total.cost.total).toBeCloseTo(0.6);
		expect(total.cost.totalFromProvider).toBe(reported);
	});

	it("treats the empty accumulator as neutral on either side of a reported charge", () => {
		const reported = charge(true);
		expect(addUsage(emptyUsage(), reported)).toEqual(reported);
		expect(addUsage(reported, emptyUsage())).toEqual(reported);
	});

	it.each(provenanceCases)(
		"persists session stats for $first then $second charges",
		async ({ first, second, reported }) => {
			const storage = new MemoryStorage();
			try {
				const initial = await storage.commit(
					[sessionWrites.insertUsage({ id: "first", adjustment: false, usage: charge(first) })],
					BACKGROUND_CONTEXT,
				);
				expect(initial.stats.usage.cost.totalFromProvider === true).toBe(first === true);
				const committed = await storage.commit(
					[sessionWrites.insertUsage({ id: "second", adjustment: false, usage: charge(second) })],
					BACKGROUND_CONTEXT,
				);
				expect(committed.stats.usage.totalTokens).toBe(6);
				expect(committed.stats.usage.cost.total).toBeCloseTo(0.6);
				expect(committed.stats.usage.cost.totalFromProvider).toBe(reported);
				expect(await storage.getStats(BACKGROUND_CONTEXT)).toEqual(committed.stats);
			} finally {
				await storage.close(BACKGROUND_CONTEXT);
			}
		},
	);
});
