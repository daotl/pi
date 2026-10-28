import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { getOrThrow, type ShellOutputInfo, type WatchChange, type WatchTarget } from "@earendil-works/pi-durable/env";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Connection, nodePlatform } from "../src/connection.ts";
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
		// The cancel follows the request at once, bypassing the client's own abort check, so the daemon stops the walk.
		const controller = new AbortController();
		controller.abort();
		const cancelled = connection.request("listFiles", { path: env.cwd }, { signal: controller.signal });
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
