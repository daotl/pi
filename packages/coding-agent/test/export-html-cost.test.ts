import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { exportFromFile } from "../src/core/export-html/index.ts";
import { CURRENT_SESSION_VERSION, type SessionHeader } from "../src/core/session-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("export HTML cost", () => {
	it("exports recorded charges, legacy component sums, and summary usage without billing mirrors twice", async () => {
		// #9980: recorded totals can differ from the estimated components; old sessions omit total.
		const cwd = mkdtempSync(join(tmpdir(), "pi-export-cost-"));
		try {
			initTheme("dark");
			const header = {
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: "cost-test",
				timestamp: new Date(0).toISOString(),
				cwd,
			} satisfies SessionHeader;
			const usage = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10 };
			const recorded = {
				...usage,
				cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.9 },
			};
			const assistant = fauxAssistantMessage("recorded charge");
			const entries = [
				{
					type: "message",
					id: "recorded",
					parentId: null,
					timestamp: header.timestamp,
					message: { ...assistant, usage: recorded },
				},
				{
					type: "message",
					id: "legacy",
					parentId: "recorded",
					timestamp: header.timestamp,
					message: {
						...assistant,
						usage: { ...usage, cost: { input: 0.4, output: 0.1, cacheRead: 0, cacheWrite: 0 } },
					},
				},
				{
					type: "message",
					id: "mirror",
					usageSourceId: "recorded",
					parentId: "legacy",
					timestamp: header.timestamp,
					message: { ...assistant, usage: recorded },
				},
				{
					type: "compaction",
					id: "summary",
					parentId: "mirror",
					timestamp: header.timestamp,
					firstKeptEntryId: "legacy",
					summary: "checkpoint",
					tokensBefore: 10,
					usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.25 } },
				},
			];
			const input = join(cwd, "session.jsonl");
			writeFileSync(input, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
			const html = readFileSync(await exportFromFile(input, join(cwd, "out.html")), "utf8");
			const encoded = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
			if (!encoded) throw new Error("Missing exported session payload");
			const exported = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
				usageTotals: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
			};
			expect(exported.usageTotals).toEqual({ input: 3, output: 6, cacheRead: 9, cacheWrite: 12, cost: 1.65 });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
