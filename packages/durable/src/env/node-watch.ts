import { createHash } from "node:crypto";
import { type FSWatcher, watch as fsWatch, type Stats } from "node:fs";
import { lstat, readdir, readFile, readlink, stat, statfs } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, sep } from "node:path";
import type { Context } from "@earendil-works/chord";
import { FileError, type FileWatcher, type WatchChange, type WatchTarget } from "./index.ts";

/** How `NodeExecutionEnv` watches. */
export interface NodeWatchOptions {
	/**
	 * Force a mode. By default `polling` is chosen on Windows, where native watchers keep directories open and so block
	 * renaming their parents, and for file systems that do not report remote changes.
	 */
	mode?: "native" | "polling";
	/** Interval between snapshots in `polling` mode; default 2000 ms. */
	pollIntervalMs?: number;
	/** Most directories one watcher covers; default 10,000. */
	maxDirectories?: number;
}

type ResolvedTarget = {
	readonly path: string;
	readonly recursive: boolean;
	readonly hidden: boolean;
	readonly names: ReadonlySet<string>;
};

/** What a snapshot remembers of one path. Directories and ancestors are compared by identity only. */
type Entry = {
	readonly kind: "file" | "directory" | "symlink" | "other";
	readonly dev: number;
	readonly ino: number;
	readonly size: number;
	readonly mtimeMs: number;
	readonly hash?: string;
};

type Snapshot = Map<string, Entry>;

/** A native watcher and the identity of what it was installed on: a path replaced by another file needs a new one. */
type Installed = { readonly watcher: FSWatcher; readonly dev: number; readonly ino: number };

/** Real directory coverage maps each replacement boundary back to the lexical targets that depend on it. */
type ResolvedParent = { readonly entry: Entry; readonly targets: Map<string, Set<string>> };

/** A scan keeps lexical link identities in the snapshot and followed directory identities for native coverage. */
type Scan = {
	readonly snapshot: Snapshot;
	readonly linkedFiles: ReadonlySet<string>;
	readonly linkedDirectories: ReadonlyMap<string, Entry>;
	readonly resolvedParents: ReadonlyMap<string, ResolvedParent>;
};

const DEBOUNCE_MS = 50;
/**
 * On macOS, `fs.watch` returns before libuv's FSEvents stream is live, and changes in between are never reported
 * (about 2% of changes made right after the call, none after 100 ms). A rescan this long after installing watchers
 * catches them.
 */
const FSEVENTS_SETTLE_MS = 500;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_MAX_DIRECTORIES = 10_000;
/** In polling mode, recently modified small files are also compared by content: a second write within the file system's
 * timestamp granularity can keep size and modification time. */
const HASH_MAX_BYTES = 256 * 1024;
const HASH_RECENT_MS = 5000;

/** Linux `statfs` magic numbers of file systems that accept watches but do not report changes made elsewhere. */
const UNRELIABLE_FILE_SYSTEMS = new Set([
	0x6969, // NFS
	0x517b, // SMB
	0xff534d42, // CIFS
	0xfe534d42, // SMB2
	0x65735546, // FUSE (sshfs, Android shared storage)
	0x01021997, // 9P (WSL2 Windows drives)
	0x0bd00bd0, // Lustre
	0x47504653, // GPFS
	0x00c36400, // Ceph
	0x5346414f, // OpenAFS
	0x6b414653, // kAFS
	0x5dca2df5, // sdcardfs
]);

class BudgetExceeded extends Error {}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function isDenied(error: unknown): boolean {
	return isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM");
}

function entryOf(stats: Stats, hash?: string): Entry {
	const kind = stats.isFile()
		? "file"
		: stats.isDirectory()
			? "directory"
			: stats.isSymbolicLink()
				? "symlink"
				: "other";
	return {
		kind,
		dev: stats.dev,
		ino: stats.ino,
		size: kind === "directory" ? 0 : stats.size,
		mtimeMs: kind === "directory" ? 0 : stats.mtimeMs,
		...(hash === undefined ? {} : { hash }),
	};
}

function sameEntry(a: Entry, b: Entry): boolean {
	return (
		a.kind === b.kind &&
		a.dev === b.dev &&
		a.ino === b.ino &&
		a.size === b.size &&
		a.mtimeMs === b.mtimeMs &&
		a.hash === b.hash
	);
}

/** Ancestors of `path`, nearest first, up to the root. */
function ancestorsOf(path: string): string[] {
	const result: string[] = [];
	for (let current = dirname(path); ; current = dirname(current)) {
		result.push(current);
		if (dirname(current) === current) return result;
	}
}

/** Whether `path` is `ancestor` or below it. */
function isWithin(path: string, ancestor: string): boolean {
	return path === ancestor || path.startsWith(ancestor.endsWith(sep) ? ancestor : ancestor + sep);
}

function excluded(target: ResolvedTarget, name: string): boolean {
	return (target.hidden && name.startsWith(".")) || target.names.has(name);
}

/**
 * Watches by snapshots: native events only trigger a debounced rescan, and changes are the difference between
 * snapshots plus the event paths. A replaced file, a renamed or recreated ancestor, or a directory created with its
 * contents therefore never depends on which events an operating system sends. New directories get their watchers
 * before they are scanned again, so nothing written into them before the watcher existed is missed.
 */
export class NodeFileWatcher implements FileWatcher {
	readonly #targets: readonly ResolvedTarget[];
	readonly #onChange: (change: WatchChange) => void;
	readonly #pollIntervalMs: number;
	readonly #maxDirectories: number;
	readonly #watchers = new Map<string, Installed>();
	readonly #events = new Set<string>();
	#resolvedParents: ReadonlyMap<string, ResolvedParent> = new Map();
	#mode: "native" | "polling";
	#snapshot: Snapshot = new Map();
	#timer: ReturnType<typeof setTimeout> | undefined;
	#settleTimer: ReturnType<typeof setTimeout> | undefined;
	#running: Promise<void> | undefined;
	#dirty = false;
	#closed = false;

	private constructor(
		targets: readonly ResolvedTarget[],
		onChange: (change: WatchChange) => void,
		mode: "native" | "polling",
		options: NodeWatchOptions,
	) {
		this.#targets = targets;
		this.#onChange = onChange;
		this.#mode = mode;
		this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
		this.#maxDirectories = options.maxDirectories ?? DEFAULT_MAX_DIRECTORIES;
	}

	/** Establish coverage: watchers first, then the snapshot later changes are compared with. */
	static async open(
		targets: readonly WatchTarget[],
		resolvePath: (path: string) => string,
		onChange: (change: WatchChange) => void,
		options: NodeWatchOptions,
	): Promise<NodeFileWatcher> {
		const resolved = targets.map((target) => ({
			path: resolvePath(target.path),
			recursive: target.recursive === true,
			hidden: target.exclude?.hidden === true,
			names: new Set(target.exclude?.names ?? []),
		}));
		// Windows refuses to rename a directory while another directory below it is open, and a native watcher keeps
		// every watched directory open: watching would break renames of their parents, so Windows polls.
		const mode =
			options.mode ??
			(process.platform === "win32" || (await anyUnreliable(resolved.map((target) => target.path)))
				? "polling"
				: "native");
		const watcher = new NodeFileWatcher(resolved, onChange, mode, options);
		try {
			await watcher.#sync(false);
		} catch (error) {
			watcher.#stop();
			if (error instanceof BudgetExceeded) throw new FileError("invalid", error.message);
			throw error;
		}
		watcher.#schedulePoll();
		return watcher;
	}

	get mode(): "native" | "polling" {
		return this.#mode;
	}

	async close(_context: Context): Promise<void> {
		if (this.#closed) return;
		this.#stop();
		await this.#running;
	}

	#stop(): void {
		this.#closed = true;
		clearTimeout(this.#timer);
		this.#timer = undefined;
		clearTimeout(this.#settleTimer);
		this.#settleTimer = undefined;
		for (const { watcher } of this.#watchers.values()) watcher.close();
		this.#watchers.clear();
		this.#resolvedParents = new Map();
	}

	#deliver(change: WatchChange): void {
		if (this.#closed) return;
		try {
			this.#onChange(change);
		} catch {
			// A throwing callback must not stop watching.
		}
	}

	#schedulePoll(): void {
		if (this.#closed || this.#mode !== "polling") return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.#flush().finally(() => this.#schedulePoll());
		}, this.#pollIntervalMs);
	}

	#scheduleFlush(): void {
		if (this.#closed || this.#timer !== undefined) return;
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			void this.#flush();
		}, DEBOUNCE_MS);
	}

	#scheduleSettle(): void {
		if (this.#closed) return;
		clearTimeout(this.#settleTimer);
		this.#settleTimer = setTimeout(() => {
			this.#settleTimer = undefined;
			void this.#flush();
		}, FSEVENTS_SETTLE_MS);
	}

	#flush(): Promise<void> {
		if (this.#running !== undefined) {
			this.#dirty = true;
			return this.#running;
		}
		this.#running = (async () => {
			try {
				do {
					this.#dirty = false;
					const events = [...this.#events];
					this.#events.clear();
					const changed = await this.#sync(true);
					for (const path of events) changed.add(path);
					if (changed.size > 0) this.#deliver({ paths: [...changed].sort() });
				} while (this.#dirty && !this.#closed);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const fileError =
					error instanceof FileError
						? error
						: new FileError(isDenied(error) ? "permission_denied" : "invalid", message);
				this.#deliver({ error: fileError });
				this.#stop();
			} finally {
				this.#running = undefined;
			}
		})();
		return this.#running;
	}

	/** Rescan, report differences, and install watchers for new directories, rescanning until none are new. */
	async #sync(report: boolean): Promise<Set<string>> {
		const changed = new Set<string>();
		for (let round = 0; round < 10 && !this.#closed; round++) {
			const scan = await this.#scan();
			// Closed during the scan: installing watchers now would leak them.
			if (this.#closed) break;
			const next = scan.snapshot;
			if (report) for (const path of this.#diff(this.#snapshot, next)) changed.add(path);
			this.#snapshot = next;
			this.#resolvedParents = scan.resolvedParents;
			if (this.#mode === "polling" || !this.#reconcileWatchers(scan)) break;
			if (process.platform === "darwin") this.#scheduleSettle();
			// Something written into a new directory before its watcher existed shows up in the next round.
			report = true;
		}
		return changed;
	}

	#diff(previous: Snapshot, next: Snapshot): string[] {
		const changed: string[] = [];
		for (const [path, entry] of next) {
			const before = previous.get(path);
			if (before === undefined || !sameEntry(before, entry)) changed.push(this.#reported(path));
		}
		for (const path of previous.keys()) if (!next.has(path)) changed.push(this.#reported(path));
		return changed;
	}

	/** An ancestor that changed identity moved every target below it; report those targets. */
	#reported(path: string): string {
		if (this.#targets.some((target) => isWithin(path, target.path))) return path;
		return this.#targets.find((target) => isWithin(target.path, path))?.path ?? path;
	}

	async #scan(): Promise<Scan> {
		const snapshot: Snapshot = new Map();
		const linkedFiles = new Set<string>();
		const linkedDirectories = new Map<string, Entry>();
		const resolvedParents = new Map<string, ResolvedParent>();
		// Directories are counted once, but traversed once per target: overlapping targets differ in recursion and
		// exclusions, and an entry recorded for one target must still be descended into for another.
		const counted = new Set<string>();
		const traversed = new Set<string>();
		/** Kinds of listed entries, not following links: a target that links to a directory is recorded by `stat`, but
		 * symbolic links below a recursive target are not followed. */
		const listed = new Map<string, Entry["kind"]>();
		const countDirectory = (path: string): void => {
			counted.add(path);
			if (counted.size > this.#maxDirectories) {
				throw new BudgetExceeded(`Watched paths exceed ${this.#maxDirectories} directories`);
			}
		};
		const record = async (path: string, stats: Stats): Promise<void> => {
			let hash: string | undefined;
			if (
				this.#mode === "polling" &&
				stats.isFile() &&
				stats.size <= HASH_MAX_BYTES &&
				Date.now() - stats.mtimeMs < HASH_RECENT_MS
			) {
				hash = await readFile(path).then(
					(content) => createHash("sha256").update(content).digest("hex"),
					() => undefined,
				);
			}
			snapshot.set(path, entryOf(stats, hash));
		};
		const scanDirectory = async (index: number, target: ResolvedTarget, directory: string): Promise<void> => {
			const key = `${index}\0${directory}`;
			if (traversed.has(key)) return;
			traversed.add(key);
			let names: string[];
			try {
				names = await readdir(directory);
			} catch (error) {
				// The watched directory itself must be readable; below it, unreadable directories are skipped.
				if (directory === target.path && isDenied(error)) throw error;
				if (isNodeError(error) && ["ENOENT", "EACCES", "EPERM", "ENOTDIR"].includes(error.code ?? "")) return;
				throw error;
			}
			for (const name of names) {
				if (excluded(target, name)) continue;
				const path = `${directory.endsWith(sep) ? directory : directory + sep}${name}`;
				let kind = listed.get(path);
				if (kind === undefined) {
					const stats = await lstat(path).catch(() => undefined);
					if (stats === undefined) continue;
					kind = entryOf(stats).kind;
					listed.set(path, kind);
					// A target's own entry (following links) wins over its listing by another target.
					if (!snapshot.has(path)) await record(path, stats);
				}
				if (target.recursive && kind === "directory") {
					countDirectory(path);
					await scanDirectory(index, target, path);
				}
			}
		};
		for (const [index, target] of this.#targets.entries()) {
			for (const ancestor of ancestorsOf(target.path)) {
				if (snapshot.has(ancestor)) continue;
				const stats = await lstat(ancestor).catch(() => undefined);
				// Identity only: an ancestor's own timestamps change with every unrelated sibling.
				if (stats !== undefined) snapshot.set(ancestor, { ...entryOf(stats), size: 0, mtimeMs: 0 });
				if (stats?.isSymbolicLink()) {
					const followed = await stat(ancestor).catch(() => undefined);
					if (followed?.isDirectory()) linkedDirectories.set(ancestor, entryOf(followed));
				}
			}
			// Resolve even dangling links: their real parents, unlike lexical parents, see later recreation.
			if (this.#mode === "native") await this.#scanResolvedParents(target.path, resolvedParents);
			// The target itself may be a symbolic link to what is watched; follow it. A missing target is watched for its
			// creation; one that cannot be reached for lack of permission fails.
			let stats: Stats;
			try {
				stats = await stat(target.path);
			} catch (error) {
				if (isDenied(error)) throw error;
				continue;
			}
			await record(target.path, stats);
			if (stats.isFile() && (await lstat(target.path).catch(() => undefined))?.isSymbolicLink()) {
				linkedFiles.add(target.path);
			}
			if (stats.isDirectory()) {
				countDirectory(target.path);
				await scanDirectory(index, target, target.path);
			}
		}
		return { snapshot, linkedFiles, linkedDirectories, resolvedParents };
	}

	/** Walk link destinations component by component, retaining every real replacement boundary up to a missing path. */
	async #scanResolvedParents(target: string, parents: Map<string, ResolvedParent>): Promise<void> {
		let directory = parse(target).root;
		let components = target.slice(directory.length).split(sep);
		let links = 0;
		while (components.length > 0) {
			const component = components.shift();
			if (component === undefined || component === "" || component === ".") continue;
			if (component === "..") {
				directory = dirname(directory);
				continue;
			}
			const stats = await stat(directory).catch(() => undefined);
			if (!stats?.isDirectory()) return;
			const path = join(directory, component);
			let parent = parents.get(directory);
			if (parent === undefined) {
				parent = { entry: entryOf(stats), targets: new Map() };
				parents.set(directory, parent);
			}
			let targets = parent.targets.get(path);
			if (targets === undefined) {
				targets = new Set();
				parent.targets.set(path, targets);
			}
			targets.add(target);
			const entry = await lstat(path).catch(() => undefined);
			if (entry?.isSymbolicLink()) {
				// Match the OS's finite link traversal: cyclic and ever-expanding links must not hang watch setup.
				if (++links > 40) return;
				const destination = await readlink(path).catch(() => undefined);
				if (destination === undefined) return;
				const root = isAbsolute(destination) ? parse(destination).root : "";
				if (root !== "") directory = root;
				// Do not normalize `..` before resolving preceding links; it refers to their real directory.
				components = [...destination.slice(root.length).split(sep), ...components];
			} else if (entry?.isDirectory()) {
				directory = path;
			} else {
				return;
			}
		}
	}

	/**
	 * Watch lexical ancestors and resolved replacement boundaries, each target directory, each target that links to
	 * a file (changes to that file are not events of the link's directory), and on Linux each directory below a
	 * recursive target (elsewhere one recursive watcher per target). Returns whether a watcher was added.
	 */
	#reconcileWatchers({ snapshot, linkedFiles, linkedDirectories, resolvedParents }: Scan): boolean {
		const wanted = new Map<string, boolean>();
		for (const path of linkedFiles) wanted.set(path, false);
		for (const path of linkedDirectories.keys()) wanted.set(path, false);
		for (const path of resolvedParents.keys()) wanted.set(path, false);
		const perDirectory = process.platform === "linux" || process.platform === "android";
		for (const target of this.#targets) {
			for (const ancestor of ancestorsOf(target.path)) {
				if (snapshot.get(ancestor)?.kind === "directory" && !wanted.has(ancestor)) wanted.set(ancestor, false);
			}
			if (snapshot.get(target.path)?.kind !== "directory") continue;
			const recursiveRoot = target.recursive && !perDirectory;
			wanted.set(target.path, recursiveRoot || wanted.get(target.path) === true);
			if (target.recursive && perDirectory) {
				for (const [path, entry] of snapshot) {
					if (entry.kind === "directory" && path !== target.path && isWithin(path, target.path)) {
						wanted.set(path, false);
					}
				}
			}
		}
		for (const [path, installed] of this.#watchers) {
			const entry = resolvedParents.get(path)?.entry ?? linkedDirectories.get(path) ?? snapshot.get(path);
			// Gone, or replaced: a watcher follows the directory it was installed on, not the path.
			if (!wanted.has(path) || entry === undefined || entry.dev !== installed.dev || entry.ino !== installed.ino) {
				installed.watcher.close();
				this.#watchers.delete(path);
			}
		}
		let added = false;
		for (const [path, recursive] of wanted) {
			const entry = resolvedParents.get(path)?.entry ?? linkedDirectories.get(path) ?? snapshot.get(path);
			if (this.#watchers.has(path) || entry === undefined) continue;
			const linked = linkedFiles.has(path);
			try {
				const watcher = fsWatch(path, { recursive, persistent: false }, (event, filename) => {
					if (linked) this.#onLinkedFileEvent(path);
					else this.#onEvent(path, filename === null ? undefined : String(filename));
					// Renaming the resolved directory itself may name it rather than a child. Its lexical parents
					// do not cover the real parent, so rescan even when that name is outside the target's scope.
					if (event === "rename" && linkedDirectories.has(path)) this.#scheduleFlush();
				});
				// A watched directory that disappears or fails: rescan, which also replaces the watcher.
				watcher.on("error", () => {
					watcher.close();
					if (this.#watchers.get(path)?.watcher === watcher) this.#watchers.delete(path);
					this.#scheduleFlush();
				});
				this.#watchers.set(path, { watcher, dev: entry.dev, ino: entry.ino });
				added = true;
			} catch (error) {
				// Out of watches or unsupported: compare snapshots from now on, and say coverage was uncertain.
				if (isNodeError(error) && error.code !== "ENOENT" && error.code !== "EACCES" && error.code !== "EPERM") {
					this.#switchToPolling();
					return false;
				}
			}
		}
		return added;
	}

	#switchToPolling(): void {
		if (this.#mode === "polling") return;
		this.#mode = "polling";
		for (const { watcher } of this.#watchers.values()) watcher.close();
		this.#watchers.clear();
		this.#resolvedParents = new Map();
		this.#deliver({ overflow: true });
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#schedulePoll();
	}

	#onEvent(directory: string, filename: string | undefined): void {
		if (this.#closed) return;
		const path =
			filename === undefined ? directory : `${directory.endsWith(sep) ? directory : directory + sep}${filename}`;
		// A real parent's event must retain the lexical target even when following its link currently fails.
		let resolved = false;
		for (const [boundary, targets] of this.#resolvedParents.get(directory)?.targets ?? []) {
			if (filename !== undefined && !isWithin(boundary, path)) continue;
			for (const target of targets) this.#events.add(target);
			resolved = true;
		}
		// Events about unrelated siblings of an ancestor, or about excluded entries, are ignored.
		const relevant = this.#inScope(path);
		if (relevant) this.#events.add(this.#reported(path));
		if (resolved || relevant || filename === undefined) this.#scheduleFlush();
	}

	/** The file a target links to changed: report the target. */
	#onLinkedFileEvent(target: string): void {
		if (this.#closed) return;
		this.#events.add(target);
		this.#scheduleFlush();
	}

	#inScope(path: string): boolean {
		for (const target of this.#targets) {
			if (isWithin(target.path, path)) return true;
			if (!isWithin(path, target.path) || path === target.path) continue;
			const components = relative(target.path, path).split(sep);
			if (!target.recursive && components.length > 1) continue;
			if (components.some((name) => excluded(target, name))) continue;
			return true;
		}
		return false;
	}
}

/** Whether any path, or its nearest existing ancestor, is on a file system that does not report remote changes. */
async function anyUnreliable(paths: readonly string[]): Promise<boolean> {
	if (process.platform !== "linux" && process.platform !== "android") return false;
	for (const path of paths) {
		for (const candidate of [path, ...ancestorsOf(path)]) {
			const info = await statfs(candidate).catch(() => undefined);
			if (info === undefined) continue;
			if (UNRELIABLE_FILE_SYSTEMS.has(info.type)) return true;
			break;
		}
	}
	return false;
}
