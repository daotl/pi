import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { getPackageDir } from "../src/config.ts";
import { RpcClient, type RpcCompactOptions } from "../src/index.ts";
import { getMessageText } from "./suite/harness.ts";

const cliPath = fileURLToPath(new URL("./fixtures/rpc-compact-worker.ts", import.meta.url));
const sourceResolverUrl = pathToFileURL(join(getPackageDir(), "src/experimental/source-resolver.ts")).href;
async function withClient(run: (client: RpcClient) => Promise<void>): Promise<void> {
	const client = new RpcClient({
		cliPath,
		env: {
			PI_OFFLINE: "1",
			PI_DISABLE_CLOUD_PROVIDERS: "1",
			NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${JSON.stringify(sourceResolverUrl)}`,
		},
	});
	try {
		await client.start();
		await run(client);
	} finally {
		await client.stop();
	}
}

describe("RpcClient compact retention across the real process boundary", () => {
	it.each<{ options: RpcCompactOptions | undefined; retained: string[] }>([
		{ options: { keepRecentMessages: 4 }, retained: ["question 2", "answer 2", "question 3", "answer 3"] },
		{ options: { keepRecentTokens: 5 }, retained: ["question 3", "answer 3"] },
		{ options: { keepRecentTokens: 0 }, retained: ["answer 3"] },
		{ options: undefined, retained: ["answer 3"] },
		{ options: { keepRecentMessages: 0 }, retained: ["answer 3"] },
		{ options: { keepRecentMessages: 0, keepRecentTokens: 10000 }, retained: ["answer 3"] },
		{ options: { keepRecentMessages: 4, keepRecentTokens: 0 }, retained: ["answer 3"] },
		{ options: { keepRecentMessages: 2, keepRecentTokens: 10000 }, retained: ["question 3", "answer 3"] },
	])("retains selected history for $options", async ({ options, retained }) => {
		await withClient(async (client) => {
			const result = await client.compact(options);
			const messages = await client.getMessages();
			expect(
				messages.filter((message) => message.role === "user" || message.role === "assistant").map(getMessageText),
			).toEqual(retained);
			const { entries } = await client.getEntries();
			const firstKept = entries.find((entry) => entry.id === result.firstKeptEntryId);
			expect(firstKept?.type === "message" ? getMessageText(firstKept.message) : undefined).toBe(retained[0]);
			expect(entries.findLast((entry) => entry.type === "compaction")).toMatchObject({
				type: "compaction",
				firstKeptEntryId: result.firstKeptEntryId,
				summary: result.summary,
			});
		});
	});
	it("rejects a budget with nothing to summarize without removing history", async () => {
		await withClient(async (client) => {
			const before = await client.getMessages();
			await expect(client.compact({ keepRecentTokens: 10000 })).rejects.toThrow("Nothing to compact");
			expect(await client.getMessages()).toEqual(before);
		});
	});
	it("preserves custom instructions in existing string and object forms", async () => {
		for (const options of ["Focus on code", { customInstructions: "Focus on code", keepRecentMessages: 2 }]) {
			await withClient(async (client) => {
				const result = await client.compact(options);
				expect(result.summary).toBe("Summary: Focus on code");
				const messages = await client.getMessages();
				expect(messages.find((message) => message.role === "compactionSummary")).toMatchObject({
					summary: result.summary,
				});
			});
		}
	});
});
