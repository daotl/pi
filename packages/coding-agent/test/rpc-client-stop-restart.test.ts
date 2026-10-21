import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => mocks);

function child() {
	return Object.assign(new EventEmitter(), {
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill: vi.fn(() => true),
	});
}
afterEach(() => {
	vi.useRealTimers();
	mocks.spawn.mockReset();
});

describe("RpcClient controlled stop/restart", () => {
	it("rejects at forced deadline and ignores obsolete child events after restart", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const first = child();
		const second = child();
		mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second);
		const client = new RpcClient();
		try {
			const starting = client.start();
			await vi.advanceTimersByTimeAsync(100);
			await starting;
			const outcome = client.compact().then(
				(value) => ({ value }),
				(error: unknown) => ({ error }),
			);
			let stopped = false;
			const stopping = client.stop().then(() => {
				stopped = true;
			});
			expect(first.kill.mock.calls).toEqual([["SIGTERM"]]);
			await vi.advanceTimersByTimeAsync(999);
			expect(stopped).toBe(false);
			expect(first.kill.mock.calls).toEqual([["SIGTERM"]]);
			await vi.advanceTimersByTimeAsync(1);
			await stopping;
			expect(first.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
			expect(await outcome).toMatchObject({
				error: expect.objectContaining({ message: "Agent process stopped. Stderr: " }),
			});
			// No exit event has been emitted: the deadline itself must settle the request.
			const restarting = client.start();
			await vi.advanceTimersByTimeAsync(100);
			await restarting;
			let newSettled = false;
			const next = client.compact().then((value) => {
				newSettled = true;
				return value;
			});
			const command = JSON.parse(second.stdin.read().toString()) as { id: string };
			first.emit("exit", 43, null);
			first.emit("error", new Error("obsolete child error"));
			first.stdin.emit("error", new Error("obsolete stdin error"));
			await Promise.resolve();
			expect(newSettled).toBe(false);
			second.stdout.write(
				`${JSON.stringify({ type: "response", id: command.id, command: "compact", success: true, data: { summary: "new generation", tokensBefore: 7, firstKeptEntryId: "kept" } })}\n`,
			);
			expect(await next).toMatchObject({ summary: "new generation", tokensBefore: 7 });
		} finally {
			const stopping = client.stop();
			second.emit("exit", 0, null);
			await stopping;
			for (const process of [first, second]) {
				process.stdin.destroy();
				process.stdout.destroy();
				process.stderr.destroy();
			}
		}
	});
});
