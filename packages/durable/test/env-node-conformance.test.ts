import { execFileSync } from "node:child_process";
import type * as Fs from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { rename, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FileWatcher, getOrThrow, type WatchChange, type WatchTarget } from "../src/env/index.ts";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { registerEnvConformance } from "../src/testing/index.ts";

const nativeEvents = vi.hoisted(() => ({ muted: false }));

// Model events lost while libuv restarts the loop's shared FSEvents stream. Subscriptions, filesystem operations,
// and settle scans stay real; only delivery is suppressed during the controlled restart window.
vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	return {
		...actual,
		watch: (path: Fs.PathLike, options: Fs.WatchOptionsWithStringEncoding, listener: Fs.WatchListener<string>) =>
			actual.watch(path, options, (event, filename) => {
				if (!nativeEvents.muted) listener(event, filename);
			}),
	};
});

const windows = process.platform === "win32";
const gitBash = join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe");
const context = BACKGROUND_CONTEXT;

/**
 * Remove a test directory. On Windows, `taskkill /T` runs asynchronously and can miss descendants such as Git Bash's
 * `sleep`, so a killed command's processes can hold the directory for a while after `exec` settles; retry until they
 * exit.
 */
async function removeTempDir(dir: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (attempt >= 80 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")) throw error;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

registerEnvConformance(
	{ describe, expect, it },
	"NodeExecutionEnv conformance",
	async (use) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-conformance-"));
		try {
			await use(new NodeExecutionEnv({ cwd }));
		} finally {
			await removeTempDir(cwd);
		}
	},
	// Git Bash's `ln -s` copies instead of linking unless native symlinks are enabled.
	windows ? { shell: [gitBash, "-c"], symlinks: false } : {},
);

registerEnvConformance(
	{ describe, expect, it },
	"NodeExecutionEnv conformance with polling watches",
	async (use) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-conformance-"));
		try {
			await use(new NodeExecutionEnv({ cwd, watch: { mode: "polling", pollIntervalMs: 100 } }));
		} finally {
			await removeTempDir(cwd);
		}
	},
	windows ? { shell: [gitBash, "-c"], symlinks: false } : {},
);

describe("NodeExecutionEnv native overlapping watches", () => {
	it.skipIf(windows).each([false, true])("unions recursive duplicate targets (reversed: %s)", async (reversed) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-overlap-"));
		const env = new NodeExecutionEnv({ cwd, watch: { mode: "native" } });
		const file = join(cwd, "skills/a/b/data");
		try {
			getOrThrow(await env.createDir("skills/a/b", undefined, context));
			getOrThrow(await env.writeFile(file, "before", context));
			const targets: WatchTarget[] = [{ path: "skills", recursive: true }, { path: "skills" }, { path: "skills/a" }];
			if (reversed) targets.reverse();
			const changes: WatchChange[] = [];
			const watcher = getOrThrow(await env.watch(targets, (change) => changes.push(change), context));
			try {
				expect(watcher.mode).toBe("native");
				// Past the one-time FSEvents settle scan: only native coverage can discover the next write.
				await delay(800);
				changes.length = 0;
				getOrThrow(await env.writeFile(file, "after", context));
				const deadline = Date.now() + 2000;
				while (
					!changes.some((change) => "paths" in change && change.paths.includes(file)) &&
					Date.now() < deadline
				) {
					await delay(20);
				}
				expect(changes.some((change) => "paths" in change && change.paths.includes(file))).toBe(true);
			} finally {
				await watcher.close(context);
			}
		} finally {
			await removeTempDir(cwd);
		}
	});
});

describe("NodeExecutionEnv native watches through symlinked parents", () => {
	it.skipIf(windows).each([
		{ path: "AGENTS.md", exists: true },
		{ path: "AGENTS.md", exists: false },
		{ path: "nested/AGENTS.md", exists: false },
	])(
		"tracks $path (initially exists: $exists), rebuilds after retargeting, and stops on close",
		async (target) => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-link-"));
			const real = mkdtempSync(join(tmpdir(), "pi-durable-env-real-"));
			const env = new NodeExecutionEnv({ cwd, watch: { mode: "native" } });
			const lexical = join(cwd, "link", target.path);
			const first = join(real, "first");
			const second = join(real, "second");
			try {
				getOrThrow(await env.createDir(first, undefined, context));
				getOrThrow(await env.createDir(second, undefined, context));
				if (target.exists) getOrThrow(await env.writeFile(join(first, target.path), "before", context));
				await symlink(first, join(cwd, "link"));
				const changes: WatchChange[] = [];
				const watcher = getOrThrow(await env.watch([{ path: lexical }], (change) => changes.push(change), context));
				const expectChange = async (action: () => Promise<void>): Promise<void> => {
					changes.length = 0;
					await action();
					const deadline = Date.now() + 3000;
					while (
						!changes.some((change) => "paths" in change && change.paths.includes(lexical)) &&
						Date.now() < deadline
					) {
						await delay(20);
					}
					expect(changes.some((change) => "paths" in change && change.paths.includes(lexical))).toBe(true);
					expect(changes.some((change) => "error" in change || "overflow" in change)).toBe(false);
					expect(watcher.mode).toBe("native");
				};
				try {
					// Let the initial FSEvents settle scan finish before writing through the real path.
					await delay(800);
					await expectChange(async () => {
						getOrThrow(await env.writeFile(join(first, target.path), "after initial setup", context));
					});
					await delay(800);
					await expectChange(async () => {
						await symlink(second, join(cwd, "next-link"));
						await rename(join(cwd, "next-link"), join(cwd, "link"));
					});
					// Retargeting must rebuild native coverage, not rely on its one-time settle rescan.
					await delay(800);
					await expectChange(async () => {
						getOrThrow(await env.writeFile(join(second, target.path), "after retargeting", context));
					});
					await delay(800);
					await expectChange(async () => {
						await rename(second, join(real, "old-second"));
					});
					// Let reconciliation discard the old inode before recreating the resolved directory.
					await delay(900);
					await expectChange(async () => {
						getOrThrow(await env.createDir(second, undefined, context));
					});
					await delay(800);
					await expectChange(async () => {
						getOrThrow(await env.writeFile(join(second, target.path), "after directory replacement", context));
					});
					await watcher.close(context);
					changes.length = 0;
					getOrThrow(await env.writeFile(join(second, target.path), "after close", context));
					await delay(600);
					expect(changes).toEqual([]);
				} finally {
					await watcher.close(context);
				}
			} finally {
				await removeTempDir(cwd);
				await removeTempDir(real);
			}
		},
		25_000,
	);

	it.skipIf(windows).each(["absolute", "relative", "nested-relative"])(
		"tracks an initially dangling %s link after native watchers settle",
		async (kind) => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-dangling-link-"));
			const real = mkdtempSync(join(tmpdir(), "pi-durable-env-dangling-real-"));
			const env = new NodeExecutionEnv({ cwd, watch: { mode: "native" } });
			const directory = join(real, "missing", "target");
			const file = join(directory, "AGENTS.md");
			const lexical = join(cwd, "link", "AGENTS.md");
			try {
				let destination = directory;
				if (kind === "nested-relative") {
					await symlink("missing/target", join(real, "indirect"));
					destination = join(real, "indirect");
				}
				await symlink(kind === "absolute" ? destination : relative(cwd, destination), join(cwd, "link"));
				const changes: WatchChange[] = [];
				const watcher = getOrThrow(await env.watch([{ path: lexical }], (change) => changes.push(change), context));
				const expectChange = async (action: () => Promise<void>): Promise<void> => {
					changes.length = 0;
					await action();
					const deadline = Date.now() + 3000;
					while (
						!changes.some((change) => "paths" in change && change.paths.includes(lexical)) &&
						Date.now() < deadline
					) {
						await delay(20);
					}
					expect(changes.some((change) => "paths" in change && change.paths.includes(lexical))).toBe(true);
					expect(changes.some((change) => "error" in change || "overflow" in change)).toBe(false);
					expect(watcher.mode).toBe("native");
				};
				try {
					// No pending settle scan may discover creation on behalf of native coverage.
					await delay(900);
					await expectChange(async () => {
						getOrThrow(await env.createDir(directory, undefined, context));
					});
					await delay(900);
					await expectChange(async () => {
						getOrThrow(await env.writeFile(file, "created after settling", context));
					});
					await delay(900);
					await expectChange(async () => {
						getOrThrow(await env.writeFile(file, "changed after settling", context));
					});
					await watcher.close(context);
					changes.length = 0;
					getOrThrow(await env.writeFile(file, "after close", context));
					await delay(600);
					expect(changes).toEqual([]);
				} finally {
					await watcher.close(context);
				}
			} finally {
				await removeTempDir(cwd);
				await removeTempDir(real);
			}
		},
		15_000,
	);

	it.skipIf(process.platform !== "darwin").each(["install", "close"])(
		"rescans a settled relative-link target when another native watcher %ss",
		async (operation) => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-shared-stream-"));
			const real = mkdtempSync(join(tmpdir(), "pi-durable-env-shared-real-"));
			const env = new NodeExecutionEnv({ cwd, watch: { mode: "native" } });
			const directory = join(real, "missing", "target");
			const lexical = join(cwd, "link", "AGENTS.md");
			const changes: WatchChange[] = [];
			let first: FileWatcher | undefined;
			let second: FileWatcher | undefined;
			const expectLexicalChange = async (): Promise<void> => {
				const deadline = Date.now() + 3000;
				while (
					!changes.some((change) => "paths" in change && change.paths.includes(lexical)) &&
					Date.now() < deadline
				) {
					await delay(20);
				}
				expect(changes.some((change) => "paths" in change && change.paths.includes(lexical))).toBe(true);
				expect(changes.some((change) => "error" in change || "overflow" in change)).toBe(false);
			};
			try {
				getOrThrow(await env.createDir("other", undefined, context));
				getOrThrow(await env.createDir(directory, undefined, context));
				await symlink(relative(cwd, directory), join(cwd, "link"));
				first = getOrThrow(await env.watch([{ path: lexical }], (change) => changes.push(change), context));
				if (operation === "close") {
					second = getOrThrow(await env.watch([{ path: "other" }], () => {}, context));
				}
				// The first watcher's own installations and settle scans are finished before the shared restart.
				await delay(900);
				changes.length = 0;
				nativeEvents.muted = true;
				if (operation === "install") {
					second = getOrThrow(await env.watch([{ path: "other" }], () => {}, context));
				} else {
					await second!.close(context);
				}
				getOrThrow(await env.writeFile(join(directory, "AGENTS.md"), "created during shared restart", context));
				await expectLexicalChange();
				expect(first.mode).toBe("native");
			} finally {
				await first?.close(context);
				await second?.close(context);
				nativeEvents.muted = false;
				await removeTempDir(cwd);
				await removeTempDir(real);
			}
		},
		15_000,
	);
});

describe("NodeExecutionEnv watch limits", () => {
	it("refuses a tree over the directory budget and stops with an error when one grows past it", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-durable-env-watch-"));
		try {
			const env = new NodeExecutionEnv({ cwd, watch: { maxDirectories: 3 } });
			getOrThrow(await env.createDir("tree/a/b", undefined, context));
			getOrThrow(await env.createDir("tree/c", undefined, context));
			expect(await env.watch([{ path: "tree", recursive: true }], () => {}, context)).toMatchObject({
				ok: false,
				error: { code: "invalid" },
			});

			getOrThrow(await env.remove("tree/c", { recursive: true }, context));
			const changes: WatchChange[] = [];
			const watcher = getOrThrow(
				await env.watch([{ path: "tree", recursive: true }], (change) => changes.push(change), context),
			);
			getOrThrow(await env.createDir("tree/d", undefined, context));
			const deadline = Date.now() + 3000;
			while (!changes.some((change) => "error" in change) && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			expect(changes.at(-1)).toMatchObject({ error: { code: "invalid" } });
			await watcher.close(context);
		} finally {
			await removeTempDir(cwd);
		}
	});
});

describe("NodeExecutionEnv readers", () => {
	const dirs: string[] = [];
	const tempDir = (): string => {
		const dir = mkdtempSync(join(tmpdir(), "pi-durable-env-readers-"));
		dirs.push(dir);
		return dir;
	};
	afterEach(async () => {
		for (const dir of dirs.splice(0)) await removeTempDir(dir);
	}, 15_000);

	it("reads ranges spanning several internal chunks exactly", async () => {
		const cwd = tempDir();
		const bytes = new Uint8Array(2.5 * 1024 * 1024);
		for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31) % 251;
		writeFileSync(join(cwd, "big.bin"), bytes);
		const reader = getOrThrow(await new NodeExecutionEnv({ cwd }).openBinaryReader("big.bin", undefined, context));
		try {
			const all = getOrThrow(await reader.read(0, bytes.length + 10, context));
			expect(all.length).toBe(bytes.length);
			expect(Buffer.from(all).equals(Buffer.from(bytes))).toBe(true);
			const middle = getOrThrow(await reader.read(1024 * 1024 - 3, 7, context));
			expect([...middle]).toEqual([...bytes.subarray(1024 * 1024 - 3, 1024 * 1024 + 4)]);
		} finally {
			await reader.close(context);
		}
	});

	it.skipIf(windows)("refuses a FIFO without waiting for a writer", async () => {
		const cwd = tempDir();
		execFileSync("mkfifo", [join(cwd, "pipe")]);
		const result = await new NodeExecutionEnv({ cwd }).openBinaryReader("pipe", undefined, context);
		expect(result).toMatchObject({ ok: false, error: { code: "invalid" } });
	});
});
