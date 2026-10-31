import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface NativeJobs {
	create(name: string): unknown;
	launched(job: unknown, launcherPid: number): number;
	terminate(job: unknown): void;
	active(job: unknown): number;
	close(job: unknown): void;
}

/** Source, emitted dist, esbuild chunk, and standalone executable locations. */
function windowsJobAssetDirectories(moduleUrl: string, executable: string): string[] {
	const directory = dirname(fileURLToPath(moduleUrl));
	return [join(directory, "../native"), join(directory, "native/chord"), join(dirname(executable), "native/chord")];
}

export function createWindowsJob(): {
	readonly name: string;
	readonly launcher: string;
	launched(pid: number): number;
	terminate(): void;
	finish(): Promise<void>;
	close(): void;
} {
	const directories = windowsJobAssetDirectories(import.meta.url, process.execPath);
	const directory = directories.find((candidate) =>
		existsSync(join(candidate, "prebuilds", `win32-${process.arch}`, "windows-job.node")),
	);
	if (directory === undefined) throw new Error(`Chord Windows native assets are missing (${directories.join(", ")})`);
	const target = join(directory, "prebuilds", `win32-${process.arch}`);
	const launcher = join(target, "windows-launcher.exe");
	if (!existsSync(launcher)) throw new Error(`Chord Windows launcher is missing: ${launcher}`);
	const native = createRequire(import.meta.url)(join(target, "windows-job.node")) as NativeJobs;
	const name = `Local\\chord-${randomUUID()}`;
	const job = native.create(name);
	let finished: Promise<void> | undefined;
	let closed = false;
	return {
		name,
		launcher,
		launched: (pid) => native.launched(job, pid),
		terminate: () => {
			if (!closed) native.terminate(job);
		},
		finish: () => {
			finished ??= (async () => {
				try {
					native.terminate(job);
					// TerminateJobObject is asynchronous. The root's exit is not a tree exit.
					while (native.active(job) !== 0) {
						const tick = Promise.withResolvers<void>();
						setTimeout(tick.resolve, 5);
						await tick.promise;
					}
				} finally {
					// On a failed terminate/query, kill-on-close still prevents leaked ownership.
					// The rejection propagates: it must never masquerade as a joined tree exit.
					native.close(job);
					closed = true;
				}
			})();
			return finished;
		},
		close: () => {
			if (!closed) {
				native.close(job);
				closed = true;
			}
		},
	};
}
