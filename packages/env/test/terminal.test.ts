import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Connection, RemoteError } from "../src/connection.ts";
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
		terminal.write("test -t 0 && echo IS-A-TTY; stty size; echo $TERM\n");
		await output.waitFor("IS-A-TTY");
		await output.waitFor("24 80");
		await output.waitFor("xterm-256color");
		terminal.resize(100, 30);
		terminal.write("stty size\n");
		await output.waitFor("30 100");
		terminal.write("exit 3\n");
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
		terminal.write("echo READY\n");
		await output.waitFor("READY");
		expect(await terminal.foreground()).toBeUndefined();
		terminal.write("sleep 100\n");
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
		terminal.write("sh -c 'trap \"\" HUP; echo $$ > job.pid; printf JOB-; printf STARTED; exec sleep 100' &\n");
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
			terminal.write(piece);
		}
		expect(await terminal.exited).toBe(0);
		expect(readFileSync(join(cwd, "input.txt"), "utf8")).toBe(text);
	}, 20_000);

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
