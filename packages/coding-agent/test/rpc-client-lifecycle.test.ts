import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const directories: string[] = [];
afterEach(() => {
	vi.useRealTimers();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function withClient(run: (client: RpcClient) => Promise<void>) {
	const directory = mkdtempSync(join(tmpdir(), "pi-rpc-lifecycle-"));
	directories.push(directory);
	const cliPath = join(directory, "worker.mjs");
	writeFileSync(
		cliPath,
		`
import { createInterface } from "node:readline";
process.on("SIGTERM", () => process.stdout.write(JSON.stringify({type:"agent_settled"})+"\\n"));
let held;
const reply = (command, data) => process.stdout.write(JSON.stringify({type:"response", id:command.id, command:command.type, success:true, data})+"\\n");
createInterface({input:process.stdin}).on("line", line => {
 const command=JSON.parse(line);
 if(command.type==="compact"||command.type==="bash") {
  held=command;
  process.stdout.write(JSON.stringify({type:"agent_start"})+"\\n");
 } else {
  if(held){reply(held,held.type==="compact"?{summary:"completed summary",firstKeptEntryId:"kept",tokensBefore:99}:{});held=undefined;}
  reply(command,command.type==="get_messages"?{messages:[]}:{});
 }
});
`,
	);
	const client = new RpcClient({ cliPath, env: { PI_OFFLINE: "1" } });
	try {
		await client.start();
		await run(client);
	} finally {
		vi.useRealTimers();
		await client.stop();
	}
}

function requestStarted(client: RpcClient): Promise<void> {
	return new Promise((resolve) => {
		const unsubscribe = client.onEvent((event) => {
			if (event.type === "agent_start") {
				unsubscribe();
				resolve();
			}
		});
	});
}

describe("RpcClient request lifetime", () => {
	it("keeps long compaction pending until its terminal response", async () => {
		await withClient(async (client) => {
			const started = requestStarted(client);
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			let settled = false;
			const result = client.compact().then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
			void result.then(() => {
				settled = true;
			});
			await started;
			await vi.advanceTimersByTimeAsync(30_001);
			expect(settled).toBe(false);
			await client.getMessages();
			expect(await result).toMatchObject({ value: { summary: "completed summary", tokensBefore: 99 } });
		});
	});
	it("keeps ordinary deadlines but does not deliver their late responses as events", async () => {
		await withClient(async (client) => {
			const started = requestStarted(client);
			const events: string[] = [];
			client.onEvent((event) => events.push(event.type));
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			const result = client.bash("held").then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
			await started;
			await vi.advanceTimersByTimeAsync(30_000);
			expect(await result).toMatchObject({
				error: expect.objectContaining({
					message: expect.stringContaining("Timeout waiting for response to bash"),
				}),
			});
			await client.getMessages();
			expect(events).not.toContain("response");
		});
	});
	it("settles held requests when forced shutdown completes before the exit event", async () => {
		await withClient(async (client) => {
			const started = requestStarted(client);
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			let settled = false;
			const result = client.compact().then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
			void result.then(() => {
				settled = true;
			});
			await started;
			const stopping = client.stop();
			// Synchronous advancement keeps the OS exit event behind the forced-stop deadline.
			vi.advanceTimersByTime(1000);
			await stopping;
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(settled).toBe(true);
			expect(await result).toMatchObject({ error: expect.any(Error) });
		});
	});
});
