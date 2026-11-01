import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay, setImmediate as nextTurn } from "node:timers/promises";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { getOrThrow, type ShellOutputInfo, type WatchChange, type WatchTarget } from "@earendil-works/pi-durable/env";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Connection, type Json, nodePlatform, RemoteError } from "../src/connection.ts";
import { LocalExecutionEnv } from "../src/list-files.ts";
import { RemoteExecutionEnv } from "../src/remote-env.ts";
import { daemon } from "./daemon.ts";

const context = BACKGROUND_CONTEXT;
const connections: Connection[] = [];
const dirs: string[] = [];
afterAll(() => {
	for (const connection of connections) connection.close();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
});

function environment(): { env: RemoteExecutionEnv; connection: Connection } {
	const cwd = mkdtempSync(join(tmpdir(), "pi-env-remote-"));
	dirs.push(cwd);
	const connection = new Connection({ command: [daemon] });
	connections.push(connection);
	return { env: new RemoteExecutionEnv({ connection, id: "pi-env:test", cwd }), connection };
}

async function expectNativeChange(changes: WatchChange[], path: string, action: () => void): Promise<void> {
	changes.length = 0;
	action();
	const deadline = Date.now() + 3000;
	while (!changes.some((change) => "paths" in change && change.paths.includes(path)) && Date.now() < deadline) {
		await delay(20);
	}
	expect(changes.some((change) => "paths" in change && change.paths.includes(path))).toBe(true);
	expect(changes.some((change) => "error" in change || "overflow" in change)).toBe(false);
}

describe("RemoteExecutionEnv", () => {
	it("rejects oversized JSON and payload requests without interrupting a running command", async () => {
		const { env, connection } = environment();
		const ready = Promise.withResolvers<void>();
		let output = "";
		const controller = new AbortController();
		const running = env.exec(
			[
				process.execPath,
				"-e",
				'process.stdout.write("ready", () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0))',
			],
			{
				onOutput: (text) => {
					output += text;
					ready.resolve();
				},
			},
			withAbortSignal(controller.signal, context),
		);
		try {
			await ready.promise;
			const session = await connection.session();
			let starts = 0;
			for (const options of [
				{
					json: { path: join(env.cwd, "oversized.bin"), parents: false },
					payload: new Uint8Array(16 * 1024 * 1024),
				},
				{
					json: { path: join(env.cwd, "oversized-json.bin"), extra: "é".repeat(8 * 1024 * 1024) },
					payload: undefined,
				},
			]) {
				await expect(
					connection.request("write", options.json, {
						payload: options.payload,
						onStart: () => starts++,
					}),
				).rejects.toMatchObject({ code: "E2BIG" });
			}
			expect(starts).toBe(0);
			expect(await connection.session()).toBe(session);
			getOrThrow(await env.writeFile("after-size-error.txt", "still connected", context));
			expect(getOrThrow(await env.readTextFile("after-size-error.txt", context))).toBe("still connected");
			expect(existsSync(join(env.cwd, "oversized.bin"))).toBe(false);
			expect(existsSync(join(env.cwd, "oversized-json.bin"))).toBe(false);
		} finally {
			controller.abort();
			const result = await running;
			expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
		}
		expect(output).toBe("ready");
	});

	it("accepts the exact encoded frame limit and rejects one extra payload byte", async () => {
		const { env, connection } = environment();
		const path = join(env.cwd, "frame-limit.bin");
		const json = { path, parents: false };
		const size = 16 * 1024 * 1024 - 9 - Buffer.byteLength(JSON.stringify({ ...json, op: "write" }));
		const payload = new Uint8Array(size).fill(0x61);
		await connection.request("write", json, { payload });
		await expect(connection.request("write", json, { payload: new Uint8Array(size + 1) })).rejects.toMatchObject({
			code: "E2BIG",
		});
		expect(
			Buffer.compare(Buffer.from(getOrThrow(await env.readBinaryFile(path, context))), Buffer.from(payload)),
		).toBe(0);
	});

	it.each([
		{ timeoutMs: -1 },
		{ timeoutMs: 1e300 },
		{ window: { maxBytes: 1000, maxLines: 20, minIntervalMs: -1, bytesPerSecond: 1000 } },
		{ window: { maxBytes: 1000, maxLines: 20, minIntervalMs: 1e300, bytesPerSecond: 1000 } },
	])("settles invalid wire durations with EINVAL and keeps the daemon usable: %j", async (fields) => {
		const { env, connection } = environment();
		const session = await connection.session();
		// A hung native request needs a real guard: fake timers cannot drive the child process's I/O.
		let guard: NodeJS.Timeout | undefined;
		const deadline = new Promise<never>((_resolve, reject) => {
			guard = setTimeout(() => reject(new Error("invalid duration request did not settle")), 2000);
		});
		try {
			await expect(
				Promise.race([
					connection.request("exec", {
						argv: [process.execPath, "-e", 'require("node:fs").writeFileSync("invalid-ran", "ran")'],
						cwd: env.cwd,
						...fields,
					}),
					deadline,
				]),
			).rejects.toMatchObject({ code: "EINVAL" });
			expect(existsSync(join(env.cwd, "invalid-ran"))).toBe(false);
			let output = "";
			const result = await connection.request(
				"exec",
				{
					argv: [process.execPath, "-e", "process.stdout.write('valid')"],
					cwd: env.cwd,
					timeoutMs: 10_000.5,
					window: { maxBytes: 1000, maxLines: 20, minIntervalMs: 0.5, bytesPerSecond: 1000 },
				},
				{
					onEvent: (_event, payload) => {
						output += Buffer.from(payload).toString("utf8");
					},
				},
			);
			expect(result.json.exitCode).toBe(0);
			expect(result.session).toBe(session);
			expect(output).toBe("valid");
		} finally {
			clearTimeout(guard);
		}
	});

	it.each([
		"exec cwd",
		"read",
		"write",
		"rename",
		"listFiles",
		"local listFiles",
		"absolutePath",
		"joinPath",
		"temp",
		"watch",
	])("cancels %s while shared startup is pending without dispatching it", async (operation) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-env-path-startup-"));
		dirs.push(cwd);
		const entered = Promise.withResolvers<void>();
		const startup = Promise.withResolvers<readonly string[]>();
		const connection = new Connection({
			command: () => {
				entered.resolve();
				return startup.promise;
			},
		});
		connections.push(connection);
		const env = new RemoteExecutionEnv({ connection, id: "path-startup", cwd });
		const controller = new AbortController();
		const cancelledContext = withAbortSignal(controller.signal, context);
		const invoke = () => {
			switch (operation) {
				case "exec cwd":
					return env.exec(
						[process.execPath, "-e", 'require("node:fs").writeFileSync("cancelled", "ran")'],
						{ cwd },
						cancelledContext,
					);
				case "read":
					return env.readTextFile("missing", cancelledContext);
				case "write":
					return env.writeFile("cancelled", "ran", cancelledContext);
				case "rename":
					return env.renameFile("missing", "cancelled", cancelledContext);
				case "listFiles":
					return env.listFiles(".", undefined, cancelledContext);
				case "local listFiles":
					return new LocalExecutionEnv({ connection, cwd }).listFiles(".", undefined, cancelledContext);
				case "absolutePath":
					return env.absolutePath(".", cancelledContext);
				case "joinPath":
					return env.joinPath(["a", "b"], cancelledContext);
				case "temp":
					return env.createTempDir("cancelled-", cancelledContext);
				default:
					return env.watch([{ path: "." }], () => {}, cancelledContext);
			}
		};
		let settled = false;
		const cancelled = invoke().then((result) => {
			settled = true;
			return result;
		});
		await entered.promise;
		const survivor = connection.info();
		try {
			controller.abort();
			await nextTurn();
			expect(settled).toBe(true);
			expect(await cancelled).toMatchObject({ ok: false, error: { code: "aborted" } });
		} finally {
			startup.resolve([daemon]);
			await survivor;
			const result = await cancelled;
			if (
				result.ok &&
				typeof result.value === "object" &&
				result.value !== null &&
				"close" in result.value &&
				typeof result.value.close === "function"
			)
				await result.value.close(context);
		}
		getOrThrow(await env.writeFile("survivor", "shared startup", context));
		expect(getOrThrow(await env.readTextFile("survivor", context))).toBe("shared startup");
		expect(existsSync(join(cwd, "cancelled"))).toBe(false);
	});

	it("does not start a connection for already-aborted file and metadata operations", async () => {
		let starts = 0;
		const connection = new Connection({
			command: async () => {
				starts++;
				throw new Error("unexpected startup");
			},
		});
		connections.push(connection);
		const env = new RemoteExecutionEnv({ connection, id: "already-aborted", cwd: tmpdir() });
		const controller = new AbortController();
		controller.abort();
		const aborted = withAbortSignal(controller.signal, context);
		for (const result of await Promise.all([
			env.readTextFile("missing", aborted),
			env.writeFile("cancelled", "ran", aborted),
			env.renameFile("missing", "cancelled", aborted),
			env.listFiles(".", undefined, aborted),
			env.absolutePath(".", aborted),
			env.joinPath(["a", "b"], aborted),
		]))
			expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
		expect(starts).toBe(0);
	});

	it("keeps abort precedence when the shared command factory subsequently rejects", async () => {
		const entered = Promise.withResolvers<void>();
		const startup = Promise.withResolvers<readonly string[]>();
		const connection = new Connection({
			command: () => {
				entered.resolve();
				return startup.promise;
			},
		});
		connections.push(connection);
		const env = new RemoteExecutionEnv({ connection, id: "failed-startup-abort", cwd: tmpdir() });
		const controller = new AbortController();
		const aborted = withAbortSignal(controller.signal, context);
		const command = env.exec([process.execPath, "-e", "process.exit(0)"], { cwd: "." }, aborted);
		const file = env.readTextFile("missing", aborted);
		await entered.promise;
		controller.abort();
		await nextTurn();
		startup.reject(new Error("startup failed after cancellation"));
		for (const result of await Promise.all([command, file])) {
			expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
		}
	});
	it("does not create a directory for an already-aborted request, including a session-bound request", async () => {
		const { env, connection } = environment();
		const session = await connection.session();
		const controller = new AbortController();
		controller.abort();
		for (const bound of [undefined, session]) {
			const path = join(env.cwd, `not-dispatched-${bound ?? "unbound"}`);
			await expect(
				connection.request("mkdir", { path, recursive: true }, { signal: controller.signal, session: bound }),
			).rejects.toMatchObject({ code: "aborted" });
			expect(existsSync(path)).toBe(false);
		}
	});

	it("settles an aborted command during startup without cancelling another caller or dispatching the command", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-env-start-abort-"));
		dirs.push(cwd);
		const entered = Promise.withResolvers<void>();
		const startup = Promise.withResolvers<readonly string[]>();
		const connection = new Connection({
			command: () => {
				entered.resolve();
				return startup.promise;
			},
		});
		connections.push(connection);
		const env = new RemoteExecutionEnv({ connection, id: "pi-env:startup-abort", cwd });
		const controller = new AbortController();
		let settled = false;
		const cancelled = env
			.exec(
				[process.execPath, "-e", 'require("node:fs").writeFileSync("cancelled.txt", "ran")'],
				undefined,
				withAbortSignal(controller.signal, context),
			)
			.then((result) => {
				settled = true;
				return result;
			});
		await entered.promise;
		const survivor = connection.request(
			"write",
			{ path: join(cwd, "survivor.txt"), parents: false },
			{ payload: Buffer.from("shared startup survived") },
		);
		try {
			controller.abort();
			// Drain cancellation's promise chain while the command factory remains held.
			await delay(0);
			expect(settled).toBe(true);
			expect(await cancelled).toMatchObject({ ok: false, error: { code: "aborted" } });
		} finally {
			startup.resolve([daemon]);
			await survivor;
			await cancelled;
		}
		expect(getOrThrow(await env.readTextFile("survivor.txt", context))).toBe("shared startup survived");
		expect(existsSync(join(cwd, "cancelled.txt"))).toBe(false);
	});

	it.each([undefined, "."])(
		"cleanup cancels commands waiting for shared startup before dispatch (cwd: %s)",
		async (cwdOverride) => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-env-cleanup-startup-"));
			dirs.push(cwd);
			const entered = Promise.withResolvers<void>();
			const startup = Promise.withResolvers<readonly string[]>();
			const connection = new Connection({
				command: () => {
					entered.resolve();
					return startup.promise;
				},
			});
			connections.push(connection);
			const env = new RemoteExecutionEnv({ connection, id: "cleanup-startup", cwd });
			const other = new RemoteExecutionEnv({ connection, id: "cleanup-survivor", cwd });
			let settled = false;
			const cancelled = env
				.exec(
					[process.execPath, "-e", 'require("node:fs").writeFileSync("cancelled.txt", "ran")'],
					cwdOverride === undefined ? undefined : { cwd: cwdOverride },
					context,
				)
				.then((result) => {
					settled = true;
					return result;
				});
			await entered.promise;
			const survivor = other.exec([process.execPath, "-e", "process.exit(0)"], undefined, context);
			try {
				let cleaned = false;
				const cleanup = env.cleanup(context).then(() => {
					cleaned = true;
				});
				await nextTurn();
				expect(cleaned).toBe(true);
				await cleanup;
				expect(settled).toBe(true);
				expect(await cancelled).toMatchObject({ ok: false, error: { code: "aborted" } });
			} finally {
				startup.resolve([daemon]);
				await Promise.all([cancelled, survivor]);
			}
			expect(getOrThrow(await survivor).exitCode).toBe(0);
			expect(existsSync(join(cwd, "cancelled.txt"))).toBe(false);
			getOrThrow(await other.writeFile("survivor.txt", "still connected", context));
			expect(getOrThrow(await other.readTextFile("survivor.txt", context))).toBe("still connected");
		},
	);

	it("cleanup kills dispatched commands without aborting or closing another environment's connection", async () => {
		const { env, connection } = environment();
		const other = new RemoteExecutionEnv({ connection, id: "cleanup-shared", cwd: env.cwd });
		const ready = Promise.withResolvers<void>();
		const running = env.exec(
			[
				process.execPath,
				"-e",
				'process.stdout.write("ready", () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0))',
			],
			{ onOutput: () => ready.resolve() },
			context,
		);
		await ready.promise;
		await env.cleanup(context);
		expect(getOrThrow(await running).exitCode).toBe(137);
		expect(
			getOrThrow(await other.exec([process.execPath, "-e", "process.exit(0)"], undefined, context)).exitCode,
		).toBe(0);
	});

	it("rejects a completed scan whose reply arrives after local cancellation", async () => {
		const { env, connection } = environment();
		getOrThrow(await env.writeFile("scan.txt", "first\nsecond\n", context));
		const reader = getOrThrow(await env.openBinaryReader("scan.txt", undefined, context));
		const controller = new AbortController();
		const request = connection.request.bind(connection);
		const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
			const reply = await request(op, json, options);
			if (op === "scanLines") controller.abort();
			return reply;
		});
		try {
			expect(await reader.scanLines({ startLine: 0 }, withAbortSignal(controller.signal, context))).toMatchObject({
				ok: false,
				error: { code: "aborted" },
			});
		} finally {
			gate.mockRestore();
			await reader.close(context);
		}
	});

	it("scans long UTF-8 lines once and preserves EOF and cancellation", async () => {
		const { env, connection } = environment();
		const text = `${"a".repeat(64 * 1024 - 1)}€${"b".repeat(3 * 1024 * 1024)}`;
		writeFileSync(join(env.cwd, "lines"), `${text}\nlast€`);
		const reader = getOrThrow(await env.openTextLineReader("lines", context));
		const indexOf = String.prototype.indexOf;
		let scanned = 0;
		const scan = vi.spyOn(String.prototype, "indexOf").mockImplementation(function (this: string, search, position) {
			if (search === "\n") scanned += this.length - (position ?? 0);
			return indexOf.call(this, search, position);
		});
		try {
			expect(getOrThrow(await reader.readLine(context))).toEqual({ text, terminated: true });
			expect(scanned).toBeLessThan(text.length * 3);
			scan.mockRestore();
			expect(getOrThrow(await reader.readLine(context))).toEqual({ text: "last€", terminated: false });
			expect(getOrThrow(await reader.readLine(context))).toBeUndefined();
		} finally {
			scan.mockRestore();
			await reader.close(context);
		}
		const cancelled = getOrThrow(await env.openTextLineReader("lines", context));
		const controller = new AbortController();
		const request = connection.request.bind(connection);
		const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
			const reply = await request(op, json, options);
			if (op === "pread") controller.abort();
			return reply;
		});
		try {
			expect(await cancelled.readLine(withAbortSignal(controller.signal, context))).toMatchObject({
				ok: false,
				error: { code: "aborted" },
			});
		} finally {
			gate.mockRestore();
			await cancelled.close(context);
		}
	});

	it.each([1, 512 * 1024])(
		"rejects a completed %i-byte binary read after cancellation and closes its handle",
		async (size) => {
			const { env, connection } = environment();
			const path = join(env.cwd, "cancelled-read.bin");
			writeFileSync(path, Buffer.alloc(size, 0x61));
			const controller = new AbortController();
			const request = connection.request.bind(connection);
			let handle: number | undefined;
			const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
				const reply = await request(op, json, options);
				if (op === "open") handle = reply.json.handle as number;
				if (op === "pread") controller.abort();
				return reply;
			});
			try {
				expect(await env.readBinaryFile(path, withAbortSignal(controller.signal, context))).toMatchObject({
					ok: false,
					error: { code: "aborted", path },
				});
				expect(handle).toBeDefined();
				await expect(request("fstat", { handle })).rejects.toMatchObject({ code: "EBADF" });
			} finally {
				gate.mockRestore();
			}
		},
	);

	it.each(["binary", "text"] as const)(
		"rejects cancelled unknown-size %s EOF and closes its handle",
		async (encoding) => {
			const { env, connection } = environment();
			const path = join(env.cwd, "empty-read");
			writeFileSync(path, "");
			const controller = new AbortController();
			const request = connection.request.bind(connection);
			let handle: number | undefined;
			const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
				const reply = await request(op, json, options);
				if (op === "open") handle = reply.json.handle as number;
				if (op === "pread" && reply.payload.length === 0) controller.abort();
				return reply;
			});
			try {
				const read = encoding === "binary" ? env.readBinaryFile.bind(env) : env.readTextFile.bind(env);
				expect(await read(path, withAbortSignal(controller.signal, context))).toMatchObject({
					ok: false,
					error: { code: "aborted", path },
				});
				expect(handle).toBeDefined();
				await expect(request("fstat", { handle })).rejects.toMatchObject({ code: "EBADF" });
			} finally {
				gate.mockRestore();
			}
		},
	);

	it.each([false, true])(
		"stops cancellable writes at a held chunk boundary but finishes appends (%s)",
		async (append) => {
			const { env, connection } = environment();
			const controller = new AbortController();
			const path = "cancelled-write.bin";
			getOrThrow(await env.writeFile(path, "prefix", context));
			const bytes = Buffer.alloc(512 * 1024 + 1, 0x61);
			const request = connection.request.bind(connection);
			const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
				const reply = await request(op, json, options);
				// Hold the completed initial write's reply until abort. Later chunks have not started yet.
				if (op === "write" && json.path === join(env.cwd, path)) controller.abort();
				return reply;
			});
			try {
				const write = append ? env.appendFile.bind(env) : env.writeFile.bind(env);
				const result = await write(path, bytes, withAbortSignal(controller.signal, context));
				expect(result).toMatchObject({ ok: false, error: { code: "aborted" } });
			} finally {
				gate.mockRestore();
			}
			const actual = Buffer.from(getOrThrow(await env.readBinaryFile(path, context)));
			expect(actual).toEqual(append ? Buffer.concat([Buffer.from("prefix"), bytes]) : bytes.subarray(0, 512 * 1024));
		},
	);
	it("resolves drive-less Windows roots using the daemon cwd, not the client or environment drive", async () => {
		const connection = new Connection({ command: [] });
		vi.spyOn(connection, "info").mockResolvedValue({
			protocol: 1,
			version: "1",
			os: "windows",
			arch: "x86_64",
			home: "D:\\home",
			tmpdir: "D:\\tmp",
			separator: "\\",
			cwd: "D:\\daemon",
			driveCwds: {},
			pid: 1,
		});
		const env = new RemoteExecutionEnv({ connection, id: "windows", cwd: "E:\\workspace" });
		expect(getOrThrow(await env.absolutePath("\\work\\a.txt", context))).toBe("D:\\work\\a.txt");
		expect(getOrThrow(await env.absolutePath("C:\\explicit\\a.txt", context))).toBe("C:\\explicit\\a.txt");
		expect(getOrThrow(await env.absolutePath("\\\\server\\share\\a.txt", context))).toBe("\\\\server\\share\\a.txt");
	});
	it("transfers only about a window of output a caller keeps, with exact counts", async () => {
		const { env } = environment();
		const total = 5_000_000;
		let delivered = 0;
		let skipped = 0;
		let tail = "";
		const result = await env.exec(
			["sh", "-c", `yes 0123456789abcdef | head -c ${total}`],
			{
				window: { maxBytes: 1000, maxLines: 20, minIntervalMs: 20, bytesPerSecond: 1_000_000 },
				onOutput: (text: string, _context, info: ShellOutputInfo) => {
					delivered += Buffer.byteLength(text);
					if (info.skipped) {
						skipped += info.skipped.bytes;
						tail = "";
					}
					tail += text;
				},
			},
			context,
		);
		expect(getOrThrow(result).exitCode).toBe(0);
		expect(delivered + skipped).toBe(total);
		expect(skipped).toBeGreaterThan(0);
		expect(delivered).toBeLessThan(total / 10);
		// After the last skip comes everything to the end, more than the window.
		const full = "0123456789abcdef\n".repeat(Math.ceil(total / 17)).slice(0, total);
		expect(full.endsWith(tail)).toBe(true);
		expect(tail.length > 1000 || tail.split("\n").length - 1 > 20).toBe(true);
	}, 60_000);

	it("rejects pending requests and reconnects when stdin breaks while pings continue", async () => {
		// A real child pipe cannot use parent fake timers. This guard bounds failure and is always cleared.
		const script = [
			'const { readSync, closeSync } = require("node:fs");',
			"const token = process.argv.at(-1);",
			'process.stdout.write("PI-ENV " + token + "\\n");',
			"function send(kind, id, json) { const body = Buffer.from(JSON.stringify(json)); const head = Buffer.alloc(13); head.writeUInt32BE(9 + body.length); head[4] = kind; head.writeUInt32BE(id, 5); head.writeUInt32BE(body.length, 9); process.stdout.write(Buffer.concat([head, body])); }",
			"let buffered = Buffer.alloc(0); const input = Buffer.alloc(65536); let closed = false;",
			'while (!closed) { const count = readSync(0, input); if (count === 0) process.exit(1); buffered = Buffer.concat([buffered, input.subarray(0, count)]); while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32BE(0)) { const size = 4 + buffered.readUInt32BE(0); const id = buffered.readUInt32BE(5); const json = JSON.parse(buffered.subarray(13, 13 + buffered.readUInt32BE(9))); buffered = buffered.subarray(size); if (json.op === "hello") send(2, id, { protocol: 1, pid: process.pid }); else if (json.op === "lstat") { closeSync(0); closed = true; send(4, id, { kind: "writeClosed" }); break; } } }',
			"setInterval(() => send(6, 0, {}), 40);",
		].join("\n");
		let starts = 0;
		const connection = new Connection({
			command: async () => (++starts === 1 ? [process.execPath, "-e", script, "--"] : [daemon]),
		});
		connections.push(connection);
		let pid: number | undefined;
		let guard: ReturnType<typeof setTimeout> | undefined;
		let cleanupError: unknown;
		const deadline = new Promise<never>((_resolve, reject) => {
			guard = setTimeout(() => reject(new Error("broken stdin requests did not settle")), 2000);
		});
		try {
			pid = (await Promise.race([connection.info(), deadline])).pid;
			let writeClosed!: () => void;
			const ready = new Promise<void>((resolve) => {
				writeClosed = resolve;
			});
			const controller = new AbortController();
			const pending = connection
				.request(
					"lstat",
					{ path: "." },
					{
						signal: controller.signal,
						onEvent: () => writeClosed(),
					},
				)
				.catch((error: unknown) => error);
			await Promise.race([ready, deadline]);
			const next = connection.request("lstat", { path: "." }).catch((error: unknown) => error);
			controller.abort();
			for (const failure of await Promise.race([Promise.all([pending, next]), deadline])) {
				expect(failure).toMatchObject({ fields: { lost: true }, message: "pi-env connection write failed" });
			}
			expect((await Promise.race([connection.info(), deadline])).protocol).toBe(1);
			expect(starts).toBe(2);
		} finally {
			clearTimeout(guard);
			connection.close();
			if (pid !== undefined) {
				try {
					process.kill(pid, "SIGKILL");
				} catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) cleanupError = error;
				}
			}
		}
		if (cleanupError) throw cleanupError;
	});

	it("keeps oversized output windows successful and delivers all bytes before the result", async () => {
		const { env } = environment();
		const total = 20_000_000;
		let delivered = 0;
		const result = await env.exec(
			["sh", "-c", `head -c ${total} /dev/zero`],
			{
				window: { maxBytes: 32_000_000, maxLines: 1_000_000, minIntervalMs: 60_000, bytesPerSecond: 1_000_000 },
				onOutput: (text, _context, info) => {
					delivered += Buffer.byteLength(text);
					expect(info.skipped).toBeUndefined();
					expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16 * 1024 * 1024 - 64 * 1024);
				},
			},
			context,
		);
		expect(getOrThrow(result).exitCode).toBe(0);
		expect(delivered).toBe(total);
	}, 30_000);
	it("aborts commands cancelled right after they are sent", async () => {
		const { env } = environment();
		const started = Date.now();
		for (let attempt = 0; attempt < 20; attempt++) {
			const controller = new AbortController();
			const running = env.exec(["sleep", "5"], undefined, withAbortSignal(controller.signal, context));
			if (attempt % 2 === 0) controller.abort();
			else setTimeout(() => controller.abort(), attempt % 5);
			const result = await running;
			expect(result.ok ? "ok" : result.error.code).toBe("aborted");
		}
		expect(Date.now() - started).toBeLessThan(10_000);
	}, 30_000);

	it.each([
		{ name: "small ASCII", prefix: Buffer.from("prefix!") },
		{ name: "final partial chunk", prefix: Buffer.alloc(512 * 1024 + 7, 0x61) },
		{
			name: "UTF-8 across the chunk boundary",
			prefix: Buffer.concat([Buffer.alloc(512 * 1024 - 1, 0x61), Buffer.from("€😀x")]),
		},
		{ name: "incomplete UTF-8 at the initial end", prefix: Buffer.from([0xe2, 0x82]) },
		{
			name: "incomplete UTF-8 in the final partial chunk",
			prefix: Buffer.concat([Buffer.alloc(512 * 1024 + 5, 0x61), Buffer.from([0xe2, 0x82])]),
		},
	])("bounds growing text reads by the size at open: $name", async ({ prefix }) => {
		const { env, connection } = environment();
		const path = join(env.cwd, "growing.txt");
		writeFileSync(path, prefix);
		const appended = Buffer.alloc(100, 0x62);
		appended[0] = 0xac;
		const request = connection.request.bind(connection);
		const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
			const reply = await request(op, json, options);
			// The real open has captured its stat; append before the caller can issue its first read.
			if (op === "open" && json.path === path) appendFileSync(path, appended);
			return reply;
		});
		try {
			expect(getOrThrow(await env.readTextFile(path, context))).toBe(prefix.toString("utf8"));
		} finally {
			gate.mockRestore();
		}
	});

	it.each(["abort", "callback_error", "timeout"] as const)(
		"preserves %s when cancellation happens while delivering completed command output",
		async (outcome) => {
			const { env, connection } = environment();
			const request = connection.request.bind(connection);
			const gate = vi.spyOn(connection, "request").mockImplementation(async (op, json, options) => {
				if (op !== "exec") return request(op, json, options);
				const queued: { event: Json; payload: Uint8Array }[] = [];
				let spillPath: unknown;
				try {
					const reply = await request(op, json, {
						...options,
						onEvent: (event, payload) => queued.push({ event, payload }),
					});
					spillPath = reply.json.spillPath;
					return reply;
				} catch (error) {
					if (error instanceof RemoteError) spillPath = error.fields.spillPath;
					throw error;
				} finally {
					if (typeof spillPath === "string") dirs.push(join(spillPath, ".."));
					// Deliver real daemon events only after its result/error has removed the cancellation control.
					for (const { event, payload } of queued) options?.onEvent?.(event, payload);
				}
			});
			const controller = new AbortController();
			const callbackFailure = new Error("callback failed");
			let output = "";
			try {
				const result = await env.exec(
					outcome === "timeout" ? "printf hello; sleep 5" : "printf hello",
					{
						...(outcome === "timeout" ? { timeout: 0.3 } : {}),
						spill: { afterBytes: 1, afterLines: 10 },
						onOutput: (text) => {
							output += text;
							controller.abort();
							if (outcome === "callback_error") throw callbackFailure;
						},
					},
					withAbortSignal(controller.signal, context),
				);
				expect(output).toBe("hello");
				expect(controller.signal.aborted).toBe(true);
				expect(result).toMatchObject({ ok: false, error: { code: outcome === "abort" ? "aborted" : outcome } });
				if (!result.ok) {
					if (outcome === "callback_error") {
						expect(result.error.cause).toBe(callbackFailure);
					} else {
						expect(typeof result.error.spillPath).toBe("string");
						expect(getOrThrow(await env.readTextFile(result.error.spillPath!, context))).toBe("hello");
					}
				}
			} finally {
				gate.mockRestore();
			}
		},
	);

	it("reports the remote system in Node's names", async () => {
		const { connection } = environment();
		const { platform, arch } = nodePlatform(await connection.info());
		expect(platform).toBe(process.platform);
		// CI runs the darwin-x64 release daemon on arm64 macOS through Rosetta, so it reports x64 to arm64 Node.
		const rosetta = process.platform === "darwin" && process.arch === "arm64" && arch === "x64";
		if (!rosetta) expect(arch).toBe(process.arch);
		expect(nodePlatform({ os: "windows", arch: "aarch64" })).toEqual({ platform: "win32", arch: "arm64" });
		expect(nodePlatform({ os: "macos", arch: "x86_64" })).toEqual({ platform: "darwin", arch: "x64" });
	});

	it("reports listFiles as not supported by daemons released before it", async () => {
		const { env } = environment();
		expect((await env.connection.info()).features).toContain("listFiles");
		const connection = new Connection({ command: [process.execPath, join(import.meta.dirname, "old-daemon.ts")] });
		connections.push(connection);
		const old = new RemoteExecutionEnv({ connection, id: "pi-env:old", cwd: env.cwd });
		const listed = await old.listFiles(".", undefined, context);
		expect(listed.ok ? "ok" : listed.error.code).toBe("not_supported");
	});

	it("cancels a listing in the daemon", async () => {
		const { env, connection } = environment();
		for (let dir = 0; dir < 100; dir++) {
			mkdirSync(join(env.cwd, `d${dir}`));
			for (let file = 0; file < 100; file++) writeFileSync(join(env.cwd, `d${dir}`, `f${file}`), "");
		}
		// Abort at dispatch, rather than before it, so this exercises daemon cancellation.
		const controller = new AbortController();
		const cancelled = connection.request(
			"listFiles",
			{ path: env.cwd },
			{ signal: controller.signal, onStart: () => controller.abort() },
		);
		await expect(cancelled).rejects.toMatchObject({ code: "aborted" });
		const listed = getOrThrow(await env.listFiles(".", undefined, context));
		expect([listed.entries.length, listed.truncated]).toEqual([10_100, false]);
		const bounded = getOrThrow(await env.listFiles(".", { maxEntries: 5000 }, context));
		expect([bounded.entries.length, bounded.truncated]).toEqual([5000, true]);
		// Creating 10,000 files takes several seconds on Windows CI.
	}, 30_000);

	it("times out a command that produces no output", async () => {
		const { env } = environment();
		const started = Date.now();
		const result = await env.exec(["sleep", "5"], { timeout: 0.3 }, context);
		expect(result.ok ? "ok" : result.error.code).toBe("timeout");
		expect(Date.now() - started).toBeLessThan(3000);
	});

	it("fails requests on handles of a lost connection instead of reaching the new daemon", async () => {
		const { env, connection } = environment();
		getOrThrow(await env.writeFile("a.txt", "AAA", context));
		getOrThrow(await env.writeFile("b.txt", "BBB", context));
		const a = getOrThrow(await env.openBinaryReader("a.txt", undefined, context));
		const { pid } = await connection.info();
		process.kill(pid, "SIGKILL");
		await new Promise((done) => setTimeout(done, 300));
		// The new daemon numbers its handles from 1 again.
		const b = getOrThrow(await env.openBinaryReader("b.txt", undefined, context));
		expect((await connection.info()).pid).not.toBe(pid);
		const stale = await a.read(0, 3, context);
		expect(stale.ok ? new TextDecoder().decode(stale.value) : stale.error.code).toBe("unknown");
		expect(new TextDecoder().decode(getOrThrow(await b.read(0, 3, context)))).toBe("BBB");
		await a.close(context);
		await b.close(context);
	});

	it("computes the command at each start and retries a start that failed", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-env-remote-"));
		dirs.push(cwd);
		let starts = 0;
		const connection = new Connection({
			command: async () => {
				starts++;
				if (starts === 1) throw new Error("ssh gpu-box failed: Network is unreachable");
				return [daemon];
			},
		});
		connections.push(connection);
		const env = new RemoteExecutionEnv({ connection, id: "pi-env:test", cwd });
		const offline = await env.readTextFile("missing.txt", context);
		expect(offline.ok ? "ok" : [offline.error.code, offline.error.message]).toEqual([
			"unknown",
			"ssh gpu-box failed: Network is unreachable",
		]);
		const command = await env.exec(["sh", "-c", "exit 0"], undefined, context);
		expect(command.ok ? command.value.exitCode : command.error.code).toBe(0);
		expect(starts).toBe(2);
	});

	it("writes and reads files larger than one transfer chunk in order", async () => {
		const { env } = environment();
		const content = new Uint8Array(3_500_017);
		for (let index = 0; index < content.length; index++) content[index] = (index * 7919) % 251;
		getOrThrow(await env.writeFile("big.bin", content, context));
		getOrThrow(await env.appendFile("big.bin", content, context));
		const read = getOrThrow(await env.readBinaryFile("big.bin", context));
		expect(read.length).toBe(content.length * 2);
		expect(Buffer.compare(Buffer.from(read.subarray(0, content.length)), Buffer.from(content))).toBe(0);
		expect(Buffer.compare(Buffer.from(read.subarray(content.length)), Buffer.from(content))).toBe(0);
		const reader = getOrThrow(await env.openBinaryReader("big.bin", undefined, context));
		const range = getOrThrow(await reader.read(1_000_003, 2_000_000, context));
		await reader.close(context);
		expect(Buffer.compare(Buffer.from(range), Buffer.from(read.subarray(1_000_003, 3_000_003)))).toBe(0);
	}, 60_000);
});

describe("RemoteExecutionEnv native watch coverage", () => {
	it.skipIf(process.platform === "win32").each([false, true])(
		"unions duplicate recursive roots in either order (reversed: %s)",
		async (reversed) => {
			const { env: base, connection } = environment();
			const env = new RemoteExecutionEnv({
				connection,
				id: "native-overlap",
				cwd: base.cwd,
				watch: { mode: "native" },
			});
			const file = join(env.cwd, "skills/a/b/data");
			mkdirSync(join(env.cwd, "skills/a/b"), { recursive: true });
			writeFileSync(file, "before");
			const targets: WatchTarget[] = [{ path: "skills", recursive: true }, { path: "skills" }, { path: "skills/a" }];
			if (reversed) targets.reverse();
			const changes: WatchChange[] = [];
			const watcher = getOrThrow(await env.watch(targets, (change) => changes.push(change), context));
			try {
				expect(watcher.mode).toBe("native");
				// Past the one-time FSEvents settle rescan; only native events can discover this edit.
				await delay(900);
				await expectNativeChange(changes, file, () => writeFileSync(file, "after"));
			} finally {
				await watcher.close(context);
			}
		},
	);

	it.skipIf(process.platform === "win32").each([false, true])(
		"preserves recursive coverage shared by lexical and resolved aliases (reversed: %s)",
		async (reversed) => {
			const { env: base, connection } = environment();
			const env = new RemoteExecutionEnv({
				connection,
				id: "native-alias-recursion",
				cwd: base.cwd,
				watch: { mode: "native" },
			});
			const real = mkdtempSync(join(tmpdir(), "pi-env-alias-real-"));
			dirs.push(real);
			mkdirSync(join(real, "a/b"), { recursive: true });
			writeFileSync(join(real, "a/b/data"), "before");
			writeFileSync(join(real, "AGENTS.md"), "boundary target");
			symlinkSync(real, join(env.cwd, "link"));
			// The explicit file target requests its resolved parent nonrecursively, while link requests that same
			// physical directory recursively. notify must receive only their union, never two competing registrations.
			const targets: WatchTarget[] = [{ path: "link", recursive: true }, { path: join(real, "AGENTS.md") }];
			if (reversed) targets.reverse();
			const changes: WatchChange[] = [];
			const watcher = getOrThrow(await env.watch(targets, (change) => changes.push(change), context));
			try {
				expect(watcher.mode).toBe("native");
				// Real native subscriptions, not fake timers: wait beyond the backend's one-time settle scan.
				await delay(900);
				await expectNativeChange(changes, join(env.cwd, "link/a/b/data"), () =>
					writeFileSync(join(real, "a/b/data"), "after"),
				);
			} finally {
				await watcher.close(context);
			}
		},
	);

	it.skipIf(process.platform !== "linux" && process.platform !== "android")(
		"keeps the real target's inotify registration when its symlink alias is retargeted",
		async () => {
			const { env: base, connection } = environment();
			const env = new RemoteExecutionEnv({
				connection,
				id: "native-alias-retarget",
				cwd: base.cwd,
				watch: { mode: "native" },
			});
			const real = mkdtempSync(join(tmpdir(), "pi-env-inotify-alias-"));
			dirs.push(real);
			const first = join(real, "first");
			const second = join(real, "second");
			mkdirSync(first);
			mkdirSync(second);
			writeFileSync(join(first, "AGENTS.md"), "first");
			writeFileSync(join(second, "AGENTS.md"), "second");
			symlinkSync(first, join(env.cwd, "link"));
			const lexical = join(env.cwd, "link/AGENTS.md");
			const direct = join(first, "AGENTS.md");
			const changes: WatchChange[] = [];
			const watcher = getOrThrow(
				await env.watch([{ path: lexical }, { path: direct }], (change) => changes.push(change), context),
			);
			try {
				expect(watcher.mode).toBe("native");
				await delay(900);
				await expectNativeChange(changes, lexical, () => {
					symlinkSync(second, join(env.cwd, "next-link"));
					renameSync(join(env.cwd, "next-link"), join(env.cwd, "link"));
				});
				await delay(900);
				// Unwatching the old lexical alias must not remove the descriptor still needed by direct.
				await expectNativeChange(changes, direct, () => writeFileSync(direct, "first after retarget"));
				await expectNativeChange(changes, lexical, () =>
					writeFileSync(join(second, "AGENTS.md"), "second after retarget"),
				);
			} finally {
				await watcher.close(context);
			}
		},
		15_000,
	);

	it.skipIf(process.platform === "win32").each([
		{ path: "AGENTS.md", exists: true },
		{ path: "AGENTS.md", exists: false },
		{ path: "nested/AGENTS.md", exists: false },
	])(
		"tracks $path through symlink retargeting and directory replacement (exists: $exists)",
		async (target) => {
			const { env: base, connection } = environment();
			const env = new RemoteExecutionEnv({
				connection,
				id: "native-links",
				cwd: base.cwd,
				watch: { mode: "native" },
			});
			const real = mkdtempSync(join(tmpdir(), "pi-env-real-parent-"));
			dirs.push(real);
			const first = join(real, "first");
			const second = join(real, "second");
			mkdirSync(first);
			mkdirSync(second);
			const lexical = join(env.cwd, "link", target.path);
			if (target.exists) writeFileSync(join(first, target.path), "before");
			symlinkSync(first, join(env.cwd, "link"));
			const changes: WatchChange[] = [];
			const watcher = getOrThrow(await env.watch([{ path: lexical }], (change) => changes.push(change), context));
			try {
				expect(watcher.mode).toBe("native");
				await delay(900);
				await expectNativeChange(changes, lexical, () => {
					mkdirSync(join(first, target.path, ".."), { recursive: true });
					writeFileSync(join(first, target.path), "first edit");
				});
				await delay(900);
				await expectNativeChange(changes, lexical, () => {
					symlinkSync(second, join(env.cwd, "next-link"));
					renameSync(join(env.cwd, "next-link"), join(env.cwd, "link"));
				});
				await delay(900);
				await expectNativeChange(changes, lexical, () => {
					mkdirSync(join(second, target.path, ".."), { recursive: true });
					writeFileSync(join(second, target.path), "retargeted edit");
				});
				await delay(900);
				await expectNativeChange(changes, lexical, () => renameSync(second, join(real, "old-second")));
				await delay(900);
				await expectNativeChange(changes, lexical, () => mkdirSync(second));
				await delay(900);
				await expectNativeChange(changes, lexical, () => {
					mkdirSync(join(second, target.path, ".."), { recursive: true });
					writeFileSync(join(second, target.path), "replaced directory edit");
				});
				await watcher.close(context);
				changes.length = 0;
				writeFileSync(join(second, target.path), "after close");
				await delay(600);
				expect(changes).toEqual([]);
			} finally {
				await watcher.close(context);
			}
		},
		30_000,
	);

	it.skipIf(process.platform === "win32").each(["absolute", "relative", "nested-relative"])(
		"tracks initially dangling %s links after settling",
		async (kind) => {
			const { env: base, connection } = environment();
			const env = new RemoteExecutionEnv({
				connection,
				id: "native-dangling",
				cwd: base.cwd,
				watch: { mode: "native" },
			});
			const real = mkdtempSync(join(tmpdir(), "pi-env-dangling-parent-"));
			dirs.push(real);
			const directory = join(real, "missing/target");
			const lexical = join(env.cwd, "link/AGENTS.md");
			let destination = directory;
			if (kind === "nested-relative") {
				symlinkSync("missing/target", join(real, "indirect"));
				destination = join(real, "indirect");
			}
			symlinkSync(kind === "absolute" ? destination : relative(env.cwd, destination), join(env.cwd, "link"));
			const changes: WatchChange[] = [];
			const watcher = getOrThrow(await env.watch([{ path: lexical }], (change) => changes.push(change), context));
			try {
				expect(watcher.mode).toBe("native");
				await delay(900);
				await expectNativeChange(changes, lexical, () => mkdirSync(directory, { recursive: true }));
				await delay(900);
				await expectNativeChange(changes, lexical, () => writeFileSync(join(directory, "AGENTS.md"), "created"));
				await delay(900);
				await expectNativeChange(changes, lexical, () => writeFileSync(join(directory, "AGENTS.md"), "edited"));
				await watcher.close(context);
				changes.length = 0;
				writeFileSync(join(directory, "AGENTS.md"), "after close");
				await delay(600);
				expect(changes).toEqual([]);
			} finally {
				await watcher.close(context);
			}
		},
		20_000,
	);
});

const legacyWsl = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "bash.exe");
describe("RemoteExecutionEnv legacy WSL stdin transport", () => {
	// Opt in only on a host with a configured legacy WSL distribution; a bash.exe stub alone is not coverage.
	it
		.skipIf(process.platform !== "win32" || !existsSync(legacyWsl) || process.env.PI_ENV_LEGACY_WSL_TESTS !== "1")
		.each(["timeout", "abort"])(
		"honors %s while a sleeping first line blocks a pipe-sized script tail",
		async (reason) => {
			const { env: base, connection } = environment();
			const env = new RemoteExecutionEnv({ connection, id: "legacy-wsl", cwd: base.cwd, shellPath: legacyWsl });
			expect(getOrThrow(await env.exec("printf legacy-ready", { timeout: 3 }, context)).exitCode).toBe(0);
			const controller = new AbortController();
			let output = "";
			const started = Date.now();
			const result = await env.exec(
				`printf ready; sleep 4\n${"# pipe-filling script tail\n".repeat(100_000)}`,
				{
					...(reason === "timeout" ? { timeout: 0.4 } : {}),
					onOutput: (text) => {
						output += text;
						if (reason === "abort" && output.includes("ready")) controller.abort();
					},
				},
				withAbortSignal(controller.signal, context),
			);
			expect(result.ok ? "ok" : result.error.code).toBe(reason === "abort" ? "aborted" : "timeout");
			expect(Date.now() - started).toBeLessThan(3000);
			expect(getOrThrow(await env.exec("printf recovered", { timeout: 3 }, context)).exitCode).toBe(0);
		},
		15_000,
	);
});
