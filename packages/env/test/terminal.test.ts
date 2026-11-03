import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Connection, type Json, RemoteError } from "../src/connection.ts";
import { openTerminal } from "../src/terminal.ts";
import { daemon } from "./daemon.ts";

const connections: Connection[] = [];
const dirs: string[] = [];
afterAll(() => {
	for (const connection of connections) connection.close();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function connect(): { connection: Connection; cwd: string } {
	const cwd = mkdtempSync(join(tmpdir(), "pi-env-terminal-"));
	dirs.push(cwd);
	const connection = new Connection({ command: [daemon] });
	connections.push(connection);
	return { connection, cwd };
}

/** Collects output and waits for text to appear in it. */
function collector(): {
	onData: (bytes: Uint8Array) => void;
	bytes: () => Buffer;
	waitFor: (text: string) => Promise<void>;
} {
	const chunks: Buffer[] = [];
	const waiting: { text: string; resolve: () => void }[] = [];
	const bytes = () => Buffer.concat(chunks);
	return {
		bytes,
		onData: (data) => {
			chunks.push(Buffer.from(data));
			const all = bytes().toString("latin1");
			for (const wait of waiting.splice(0)) {
				if (all.includes(wait.text)) wait.resolve();
				else waiting.push(wait);
			}
		},
		waitFor: (text) =>
			bytes().toString("latin1").includes(text)
				? Promise.resolve()
				: new Promise((resolve) => waiting.push({ text, resolve })),
	};
}

describe.skipIf(process.platform === "win32")("openTerminal", () => {
	it("runs a program in a terminal with input, resizing and its exit code", async () => {
		const { connection, cwd } = connect();
		const output = collector();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["/bin/sh"],
			env: { PS1: "$ ", TERM: "xterm-256color" },
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		expect(terminal.pid).toBeGreaterThan(0);
		await terminal.write("test -t 0 && echo IS-A-TTY; stty size; echo $TERM\n");
		await output.waitFor("IS-A-TTY");
		await output.waitFor("24 80");
		await output.waitFor("xterm-256color");
		terminal.resize(100, 30);
		await terminal.write("stty size\n");
		await output.waitFor("30 100");
		await terminal.write("exit 3\n");
		expect(await terminal.exited).toBe(3);
	}, 20_000);

	it("reports the job in the foreground, not the shell at its prompt", async () => {
		const { connection, cwd } = connect();
		const output = collector();
		const terminal = await openTerminal(connection, {
			cwd,
			// Interactive, for job control: the shell puts each job in front of the terminal.
			argv: ["/bin/sh", "-i"],
			env: { PS1: "$ ", TERM: "xterm-256color" },
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		await terminal.write("echo READY\n");
		await output.waitFor("READY");
		expect(await terminal.foreground()).toBeUndefined();
		await terminal.write("sleep 100\n");
		// The shell forks before it execs: wait until the foreground job is the command itself, not the forked shell.
		const named = process.platform === "darwin" || process.platform === "linux";
		let foreground = await terminal.foreground();
		for (let tries = 0; (!foreground || (named && foreground.name !== "sleep")) && tries < 100; tries++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
			foreground = await terminal.foreground();
		}
		expect(foreground?.pid).toBeGreaterThan(0);
		expect(foreground?.pid).not.toBe(terminal.pid);
		if (named) expect(foreground?.name).toBe("sleep");
		terminal.close();
		await expect(terminal.exited).rejects.toMatchObject({ code: "aborted" });
		await expect(terminal.foreground()).rejects.toMatchObject({ code: "EBADF" });
	}, 20_000);

	it.each(["terminal", "connection"])("kills HUP-ignoring background jobs when closing the %s", async (mode) => {
		const { connection, cwd } = connect();
		const output = collector();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["/bin/sh", "-i"],
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		await terminal.write("sh -c 'trap \"\" HUP; echo $$ > job.pid; printf JOB-; printf STARTED; exec sleep 100' &\n");
		await output.waitFor("JOB-STARTED");
		const pid = Number(readFileSync(join(cwd, "job.pid"), "utf8"));
		try {
			if (mode === "terminal") terminal.close();
			else connection.close();
			await terminal.exited.catch(() => undefined);
			// The connection rejects pending requests before the daemon consumes EOF and kills its session.
			await expect
				.poll(() => {
					try {
						process.kill(pid, 0);
						return true;
					} catch {
						return false;
					}
				})
				.toBe(false);
		} finally {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				/* Already reaped. */
			}
		}
	});

	it("kills HUP-ignoring jobs on normal leader exit and preserves its exit code", async () => {
		const { connection, cwd } = connect();
		const output = collector();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["/bin/sh", "-i"],
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		await terminal.write("sh -c 'trap \"\" HUP; echo $$ > job.pid; printf JOB-; printf STARTED; exec sleep 100' &\n");
		await output.waitFor("JOB-STARTED");
		const pid = Number(readFileSync(join(cwd, "job.pid"), "utf8"));
		try {
			await terminal.write("exit 7\n");
			expect(await terminal.exited).toBe(7);
			// No close/cancel: completion itself must relinquish a cleaned session.
			await expect
				.poll(() => {
					try {
						process.kill(pid, 0);
						return true;
					} catch {
						return false;
					}
				})
				.toBe(false);
		} finally {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				/* Already reaped. */
			}
			terminal.close();
		}
	});

	it("delivers raw bytes, not decoded text", async () => {
		const { connection, cwd } = connect();
		const output = collector();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["sh", "-c", "printf 'a\\377b'"],
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		expect(await terminal.exited).toBe(0);
		expect([...output.bytes()]).toEqual([0x61, 0xff, 0x62]);
	});

	it("keeps input in order", async () => {
		const { connection, cwd } = connect();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["sh", "-c", "head -c 40000 > input.txt"],
			cols: 80,
			rows: 24,
			onData: () => {},
		});
		let text = "";
		for (let index = 0; index < 4000; index++) {
			const piece = `${String(index).padStart(9, "0")}\n`;
			text += piece;
			await terminal.write(piece);
		}
		expect(await terminal.exited).toBe(0);
		expect(readFileSync(join(cwd, "input.txt"), "utf8")).toBe(text);
	}, 20_000);

	it("bounds undrained input without delaying resize, close, or another terminal", async () => {
		const { connection, cwd } = connect();
		const output = collector();
		let target = 0;
		const request = connection.request.bind(connection);
		const capture = vi.spyOn(connection, "request").mockImplementation((op, json, options) =>
			request(op, json, {
				...options,
				onStart: (id, session) => {
					options?.onStart?.(id, session);
					if (op === "pty") target = id;
				},
			}),
		);
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["sh", "-c", "stty raw -echo; printf READY; exec sleep 100"],
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		capture.mockRestore();
		const exited = terminal.exited.catch((error: unknown) => error);
		try {
			await output.waitFor("READY");
			const session = await connection.session();
			let refused: unknown;
			for (let index = 0; index < 16; index++) {
				try {
					await connection.request("ptyWrite", { target }, { session, payload: Buffer.alloc(1024 * 1024, 0x61) });
				} catch (error) {
					refused = error;
					break;
				}
			}
			// No reader can release the budget; accepting every chunk would retain unbounded input.
			expect(refused).toMatchObject({ code: "EAGAIN" });
			await connection.request("ptyResize", { target, cols: 100, rows: 30 }, { session });
			const other = await openTerminal(connection, {
				cwd,
				argv: ["sh", "-c", "exit 7"],
				cols: 80,
				rows: 24,
				onData: () => {},
			});
			expect(await other.exited).toBe(7);
			terminal.close();
			expect(await exited).toMatchObject({ code: "aborted" });
		} finally {
			terminal.close();
			await exited;
		}
	});

	it("surfaces terminal input admission failures to an awaiting writer", async () => {
		const { connection, cwd } = connect();
		const output = collector();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["sh", "-c", "stty raw -echo; printf READY; exec sleep 100"],
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		const exited = terminal.exited.catch((error: unknown) => error);
		try {
			await output.waitFor("READY");
			await expect(terminal.write(Buffer.alloc(16 * 1024 * 1024, 0x61))).rejects.toMatchObject({ code: "EAGAIN" });
		} finally {
			terminal.close();
			await exited;
		}
	});

	it("rejects concurrent writes without queuing input and accepts the next awaited write", async () => {
		const { connection, cwd } = connect();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["sleep", "100"],
			cols: 80,
			rows: 24,
			onData: () => {},
		});
		const exited = terminal.exited.catch((error: unknown) => error);
		const admitted = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const request = connection.request.bind(connection);
		let writes = 0;
		const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
			const reply = await request(op, json, options);
			if (op === "ptyWrite" && ++writes === 1) {
				admitted.resolve();
				await release.promise;
			}
			return reply;
		});
		try {
			const first = terminal.write("first");
			await admitted.promise;
			await expect(terminal.write("not-admitted")).rejects.toMatchObject({ code: "EAGAIN" });
			expect(writes).toBe(1);
			release.resolve();
			await first;
			await terminal.write("second");
			expect(writes).toBe(2);
		} finally {
			release.resolve();
			gate.mockRestore();
			terminal.close();
			await exited;
		}
	});

	it.each(["close", "callback_error", "success"] as const)(
		"preserves %s while delivering completed terminal output",
		async (outcome) => {
			const { connection, cwd } = connect();
			const completed = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const request = connection.request.bind(connection);
			const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
				if (op !== "pty") return request(op, json, options);
				const queued: { event: Json; payload: Uint8Array }[] = [];
				const reply = await request(op, json, {
					...options,
					onEvent: (event, payload) => {
						if (event.kind === "started") options?.onEvent?.(event, payload);
						else queued.push({ event, payload });
					},
				});
				completed.resolve();
				await release.promise;
				// The real daemon result has already removed this request's cancellation control.
				for (const { event, payload } of queued) options?.onEvent?.(event, payload);
				return reply;
			});
			const failure = new Error("final terminal callback failed");
			let output = "";
			try {
				const terminal = await openTerminal(connection, {
					cwd,
					argv: ["sh", "-c", "printf final-output; exit 7"],
					cols: 80,
					rows: 24,
					onData: (bytes) => {
						output += Buffer.from(bytes).toString();
						if (outcome !== "success") terminal.close();
						if (outcome === "callback_error") throw failure;
					},
				});
				await completed.promise;
				const result =
					outcome === "success"
						? expect(terminal.exited).resolves.toBe(7)
						: outcome === "callback_error"
							? expect(terminal.exited).rejects.toBe(failure)
							: expect(terminal.exited).rejects.toMatchObject({ code: "aborted" });
				release.resolve();
				await result;
				expect(output).toBe("final-output");
			} finally {
				release.resolve();
				gate.mockRestore();
			}
		},
	);

	it("kills the program on close", async () => {
		const { connection, cwd } = connect();
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["sleep", "100"],
			cols: 80,
			rows: 24,
			onData: () => {},
		});
		terminal.close();
		await expect(terminal.exited).rejects.toMatchObject({ code: "aborted" });
	});

	it("contains a failing output callback and leaves other terminals on the connection running", async () => {
		const { connection, cwd } = connect();
		const output = collector();
		const other = await openTerminal(connection, {
			cwd,
			argv: ["/bin/sh"],
			cols: 80,
			rows: 24,
			onData: output.onData,
		});
		const failure = new Error("terminal consumer failed");
		let calls = 0;
		const terminal = await openTerminal(connection, {
			cwd,
			argv: ["/bin/sh", "-c", "read line; while :; do printf output; done"],
			cols: 80,
			rows: 24,
			onData: () => {
				calls++;
				throw failure;
			},
		});
		const rejected = expect(terminal.exited).rejects.toBe(failure);
		await terminal.write("start\n");
		await rejected;
		expect(calls).toBe(1);
		await expect(terminal.foreground()).rejects.toMatchObject({ code: "EBADF" });
		await other.write("printf SURVIVED; exit 7\n");
		expect(await other.exited).toBe(7);
		expect(output.bytes().toString()).toContain("SURVIVED");
	});

	it("fails to open in a missing directory", async () => {
		const { connection, cwd } = connect();
		await expect(
			openTerminal(connection, { cwd: join(cwd, "missing"), cols: 80, rows: 24, onData: () => {} }),
		).rejects.toBeInstanceOf(RemoteError);
	});

	it("rejects writes to a terminal that does not exist", async () => {
		const { connection } = connect();
		await expect(connection.request("ptyWrite", { target: 999 })).rejects.toMatchObject({ code: "EBADF" });
	});
});
