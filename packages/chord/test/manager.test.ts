import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { describe, it, onTestFinished, vi } from "vitest";
import { createHost, ipcLink, isChordError } from "../src/index.ts";
import {
	type ControlMessage,
	createHostManager,
	type Driver,
	forkDriver,
	type Instance,
	processLock,
} from "../src/manager.ts";
import { Echo } from "./fixtures/echo.ts";

const entry = fileURLToPath(new URL("./fixtures/worker.ts", import.meta.url));
const scratch = (name: string) => join(tmpdir(), `chord2-${process.pid}-${name}`);

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const driver = (env: Record<string, string> = {}, lock?: string): Driver =>
	forkDriver({ entry, env: { HOST_NAME: "w1", ...env }, init: { greeting: "hi" }, lock });

const fileSockets = !["linux", "android", "win32"].includes(process.platform);
const claimPath = (name: string): string =>
	join(
		`/tmp/chord2-${process.getuid?.() ?? 0}`,
		`chord2-${createHash("sha256").update(name).digest("hex").slice(0, 32)}.sock.reclaim.sqlite`,
	);
function contender(name: string, pause = false) {
	const child = fork(
		fileURLToPath(new URL("./fixtures/lock-contender.ts", import.meta.url)),
		[name, ...(pause ? ["pause"] : [])],
		{ execArgv: [], stdio: ["ignore", "ignore", "inherit", "ipc"] },
	);
	const messages: unknown[] = [];
	const waiters = new Map<string, () => void>();
	child.on("message", (message) => {
		messages.push(message);
		if (typeof message === "string") waiters.get(message)?.();
	});
	return {
		child,
		wait(message: string): Promise<void> {
			if (messages.includes(message)) return Promise.resolve();
			const arrived = Promise.withResolvers<void>();
			waiters.set(message, arrived.resolve);
			return arrived.promise;
		},
	};
}
async function terminate(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = Promise.withResolvers<void>();
	child.once("exit", () => exited.resolve());
	child.kill("SIGKILL");
	await exited.promise;
}

describe("processLock", () => {
	// A socket path over 104 bytes failed with EINVAL on macOS when TMPDIR was deep (./test.sh below macOS's TMPDIR).
	it("admits one holder when the temporary directory is too deep for a socket path", async () => {
		const deep = join(scratch("deep"), "a".repeat(60), "b".repeat(60));
		mkdirSync(deep, { recursive: true });
		const previous = process.env.TMPDIR;
		process.env.TMPDIR = deep;
		try {
			const name = `deep-${process.pid}`;
			const release = await processLock(name);
			await assert.rejects(processLock(name), (error) => isChordError(error) && error.reason === "locked");
			await release();
			await (await processLock(name))();
		} finally {
			if (previous === undefined) delete process.env.TMPDIR;
			else process.env.TMPDIR = previous;
			rmSync(scratch("deep"), { recursive: true, force: true });
		}
	});

	it.skipIf(!fileSockets)(
		"serializes two stale-socket contenders and recovers a crashed reclamation claim",
		async () => {
			const name = `stale-contenders-${process.pid}`;
			const children: ChildProcess[] = [];
			onTestFinished(async () => {
				await Promise.all(children.map(terminate));
				await (await processLock(name))();
			});
			const original = contender(name);
			children.push(original.child);
			await original.wait("acquired");
			await terminate(original.child);
			const first = contender(name, true);
			children.push(first.child);
			await first.wait("reclaiming");
			const second = contender(name, true);
			children.push(second.child);
			await second.wait("locked");
			first.child.send("continue");
			await first.wait("acquired");
			await assert.rejects(processLock(name), (error) => isChordError(error) && error.reason === "locked");
			await terminate(first.child);
			const crashedClaim = contender(name, true);
			children.push(crashedClaim.child);
			await crashedClaim.wait("reclaiming");
			await terminate(crashedClaim.child);
			const release = await processLock(name);
			try {
				// The acquisition-only SQLite lock is gone even while the lifetime socket is still held.
				const probe = new DatabaseSync(claimPath(name), { timeout: 0 });
				try {
					probe.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
				} finally {
					probe.close();
				}
			} finally {
				await release();
			}
			await (await processLock(name))();
		},
	);

	it.skipIf(!fileSockets)("same-name SQLite claims fail closed while different names remain independent", async () => {
		const name = `claim-busy-${process.pid}`;
		// Initialize the persistent file using the public lock path, then hold only its native reclamation lock.
		await (await processLock(name))();
		const occupied = new DatabaseSync(claimPath(name), { timeout: 0 });
		occupied.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
		try {
			await assert.rejects(processLock(name), (error) => isChordError(error) && error.reason === "locked");
			await (await processLock(`${name}-independent`))();
		} finally {
			occupied.close();
		}
		await (await processLock(name))();
	});
});

describe("host manager forced tree cleanup", () => {
	it.skipIf(process.platform !== "win32")(
		"a fatal start kills the child and its descendants before rejecting",
		async () => {
			const file = scratch("grandchild-failed-start");
			const manager = createHostManager({
				driver: driver({ FIXTURE_MODE: "fatal-tree", GRANDCHILD_FILE: file }),
			});
			try {
				await assert.rejects(manager.start(), /fixture tree refuses to start/);
				const grandchild = Number(readFileSync(file, "utf8"));
				assert.ok(Number.isSafeInteger(grandchild) && grandchild > 0, "fixture acknowledged a real descendant");
				assert.equal(alive(grandchild), false);
			} finally {
				await manager.stop();
				rmSync(file, { force: true });
			}
		},
	);

	it.skipIf(process.platform !== "win32")("replacement waits for Windows descendants to terminate", async () => {
		const file = scratch("grandchild-replace");
		const manager = createHostManager({
			driver: driver({ FIXTURE_MODE: "ignore-shutdown", GRANDCHILD_FILE: file }),
			grace: 100,
		});
		try {
			const first = await manager.start();
			const grandchild = Number(readFileSync(file, "utf8"));
			assert.ok(alive(grandchild));
			const second = await manager.replace();
			assert.notEqual(first.pid, second.pid);
			assert.equal(alive(first.pid), false);
			assert.equal(alive(grandchild), false);
		} finally {
			await manager.stop();
			rmSync(file, { force: true });
		}
	});
});

describe("host manager (real child processes)", () => {
	for (const terminal of ["fatal", "link"] as const) {
		it(`${terminal} after readiness retires a real worker and creates a usable replacement on demand`, async () => {
			const manager = createHostManager({ driver: driver(), grace: 0 });
			const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
			onTestFinished(async () => {
				await manager.stop();
				await server.close();
			});
			const first = await manager.start();
			if (terminal === "fatal") {
				const reported = Promise.withResolvers<void>();
				first.onControl((message) => {
					if (message.type === "fatal") reported.resolve();
				});
				first.send({ type: "init", value: "fatal-after-ready" });
				await reported.promise;
			} else first.link.close("reconciliation failed");
			const fresh = await manager.start();
			assert.notEqual(fresh.pid, first.pid);
			assert.equal(alive(first.pid), false);
			server.accept(fresh.link, { principal: { worker: "w1" }, kind: "host", name: "w1" });
			const echo = server.hold(Echo, {});
			assert.equal(await echo.echo("replacement"), `hi replacement from ${fresh.pid}`);
		});
	}

	// A child host that forks its own children used to pass its CHORD2_LOCK on, so they failed with "locked".
	it("a child without a lock does not inherit the parent's lock", async () => {
		const name = `chord2-test-${process.pid}-inherited`;
		const release = await processLock(name);
		const previous = process.env.CHORD2_LOCK;
		process.env.CHORD2_LOCK = name;
		const manager = createHostManager({ driver: driver() });
		try {
			await manager.start();
			assert.equal(manager.status, "running");
		} finally {
			if (previous === undefined) delete process.env.CHORD2_LOCK;
			else process.env.CHORD2_LOCK = previous;
			await manager.stop();
			await release();
		}
	});

	it("starts a child host, links it, stops it gracefully", async () => {
		const manager = createHostManager({ driver: driver() });
		const instance = await manager.start();
		assert.equal(manager.status, "running");
		const server = createHost({ self: { kind: "host" }, name: "server", onError: () => {} });
		server.accept(instance.link, { principal: { worker: "w1" }, kind: "host", name: "w1" });
		const echo = server.hold(Echo, {});
		assert.equal(await echo.echo("x"), `hi x from ${instance.pid}`);
		assert.equal(await manager.start(), instance);
		await manager.stop();
		assert.equal(manager.status, "stopped");
		assert.deepEqual(await instance.exited, { code: 0, signal: null });
		await server.close();
	});

	it("a child-owned kernel lock admits one live process; replace waits for the exit before the next start", async () => {
		const lock = `chord2-test-${process.pid}-lock`;
		const pids: number[] = [];
		const base = driver({}, lock);
		const watched: Driver = {
			spawn() {
				// Exit before replace: the previous child is gone when the next one spawns.
				for (const pid of pids) assert.ok(!alive(pid), `pid ${pid} still alive`);
				const instance = base.spawn();
				pids.push(instance.pid);
				return instance;
			},
		};
		const first = createHostManager({ driver: watched });
		const second = createHostManager({ driver: driver({}, lock) });
		const a = await first.start();
		// Both managers race for the same lock; only the kernel decides, so the second child cannot start.
		await assert.rejects(second.start(), (error) => isChordError(error, "unavailable") && error.reason === "locked");
		const b = await first.replace();
		assert.notEqual(a.pid, b.pid);
		await first.stop();
		await second.start();
		await second.stop();
	});

	it("a graceful exit still takes the child's descendants with it", async () => {
		const file = scratch("grandchild-graceful");
		rmSync(file, { force: true });
		const manager = createHostManager({ driver: driver({ GRANDCHILD_FILE: file }) });
		await manager.start();
		const grandchild = Number(readFileSync(file, "utf8"));
		assert.ok(alive(grandchild));
		await manager.stop();
		for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((resolve) => setTimeout(resolve, 20));
		assert.ok(!alive(grandchild));
		rmSync(file, { force: true });
	});

	it("idleFor counts from the busy → idle transition", async () => {
		const listeners = new Set<(message: ControlMessage) => void>();
		const fake: Driver = {
			spawn: () => ({
				pid: 0,
				link: ipcLink({ connected: false, send: () => false, on: () => undefined, off: () => undefined }),
				exited: new Promise(() => {}),
				send: () => {},
				killTree: () => {},
				onControl: (listener) => listeners.add(listener),
			}),
		};
		const emit = (message: ControlMessage) => {
			for (const listener of listeners) listener(message);
		};
		const manager = createHostManager({ driver: fake });
		const started = manager.start();
		for (let i = 0; i < 20 && listeners.size === 0; i++) await new Promise((resolve) => setImmediate(resolve));
		emit({ type: "ready" });
		await started;
		emit({ type: "status", activeCalls: 1 });
		await new Promise((resolve) => setTimeout(resolve, 120));
		assert.equal(manager.liveness.idleFor, 0);
		emit({ type: "status", activeCalls: 0 });
		assert.ok(manager.liveness.idleFor < 60, `idleFor ${manager.liveness.idleFor}`);
	});

	it("kills the process tree when a child ignores shutdown past the grace period", async () => {
		const file = scratch("grandchild");
		rmSync(file, { force: true });
		const manager = createHostManager({
			driver: driver({ FIXTURE_MODE: "ignore-shutdown", GRANDCHILD_FILE: file }),
			grace: 300,
		});
		const instance = await manager.start();
		const grandchild = Number(readFileSync(file, "utf8"));
		assert.ok(alive(grandchild));
		await manager.stop();
		if (process.platform !== "win32") assert.equal((await instance.exited).signal, "SIGKILL");
		assert.equal(alive(instance.pid), false);
		for (let i = 0; i < 50 && alive(grandchild); i++) await new Promise((resolve) => setTimeout(resolve, 20));
		assert.ok(!alive(grandchild));
		rmSync(file, { force: true });
	});

	it("reports a fatal child as a failed start", async () => {
		const manager = createHostManager({ driver: driver({ FIXTURE_MODE: "fatal" }) });
		await assert.rejects(manager.start(), /fixture refuses to start/);
		assert.equal(manager.status, "stopped");
	});

	it("stops an idle child when keepAlive says so", async () => {
		const exits: unknown[] = [];
		const manager = createHostManager({
			driver: driver(),
			keepAlive: (liveness) => !liveness.booting && liveness.idleFor < 150,
			checkInterval: 50,
			onExit: (exit) => exits.push(exit),
		});
		await manager.start();
		for (let i = 0; i < 100 && manager.status !== "stopped"; i++)
			await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(manager.status, "stopped");
		assert.equal(exits.length, 1);
	});
});

// Controlled OS-exit acknowledgement lets these tests distinguish requested termination from joined exit.
function controlledDriver() {
	const spawned: {
		instance: Instance;
		emit(message: ControlMessage): void;
		finish(): void;
		readonly killed: boolean;
		readonly shutdown: boolean;
	}[] = [];
	let notify = Promise.withResolvers<void>();
	const driver: Driver = {
		spawn() {
			const exit = Promise.withResolvers<{ code: number; signal: null }>();
			const controls = new Set<(message: ControlMessage) => void>();
			let killed = false;
			let shutdown = false;
			const instance: Instance = {
				pid: spawned.length + 1,
				link: ipcLink({ connected: true, send: () => true, on: () => undefined, off: () => undefined }),
				exited: exit.promise,
				send: () => {
					shutdown = true;
				},
				killTree: () => {
					killed = true;
				},
				onControl: (listener) => {
					controls.add(listener);
				},
			};
			spawned.push({
				instance,
				emit: (message) => {
					for (const listener of controls) listener(message);
				},
				finish: () => exit.resolve({ code: 0, signal: null }),
				get killed() {
					return killed;
				},
				get shutdown() {
					return shutdown;
				},
			});
			notify.resolve();
			notify = Promise.withResolvers<void>();
			return instance;
		},
	};
	return { driver, spawned, next: () => notify.promise };
}

describe("manager terminal lifetime", () => {
	for (const terminal of ["fatal", "link"] as const) {
		it(`${terminal} after ready invalidates reuse and joins exit before an already queued start`, async () => {
			const controlled = controlledDriver();
			const manager = createHostManager({ driver: controlled.driver, grace: 0 });
			const adopted = controlled.next();
			const starting = manager.start();
			await adopted;
			const old = controlled.spawned[0]!;
			old.emit({ type: "ready" });
			await starting;
			const replacementSpawned = controlled.next();
			// This start is queued first; the terminal event must synchronously make the old instance ineligible.
			const replacement = manager.start();
			if (terminal === "fatal") old.emit({ type: "fatal", message: "terminal upstream failure" });
			else old.instance.link.close("reconciliation failed");
			assert.equal(manager.status, "stopping");
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(controlled.spawned.length, 1);
			assert.equal(old.killed, true);
			old.finish();
			await replacementSpawned;
			const fresh = controlled.spawned[1]!;
			fresh.emit({ type: "ready" });
			assert.equal(await replacement, fresh.instance);
			old.emit({ type: "fatal", message: "late old failure" });
			old.emit({ type: "status", activeCalls: 99 });
			assert.equal(manager.status, "running");
			assert.equal(manager.liveness.activeCalls, 0);
			const stopped = manager.stop();
			fresh.instance.link.close("normal shutdown");
			fresh.finish();
			await stopped;
			assert.equal(controlled.spawned.length, 2);
			assert.equal(manager.status, "stopped");
		});

		it(`${terminal} immediately after ready cannot publish a failed instance`, async () => {
			const controlled = controlledDriver();
			const manager = createHostManager({ driver: controlled.driver });
			const adopted = controlled.next();
			const started = manager.start();
			const rejected = assert.rejects(started, /child (failed|link closed)/);
			await adopted;
			const child = controlled.spawned[0]!;
			child.emit({ type: "ready" });
			if (terminal === "fatal") child.emit({ type: "fatal", message: "activation failed" });
			else child.instance.link.close("protocol error");
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(child.killed, true);
			child.finish();
			await rejected;
			await manager.stop();
			assert.equal(manager.status, "stopped");
			assert.equal(manager.liveness.booting, false);
		});
	}

	it("link failure before ready rejects startup and joins the actual exit", async () => {
		const controlled = controlledDriver();
		const manager = createHostManager({ driver: controlled.driver });
		const adopted = controlled.next();
		const started = manager.start();
		const rejected = assert.rejects(started, /child link closed: handshake failed/);
		await adopted;
		const child = controlled.spawned[0]!;
		child.instance.link.close("handshake failed");
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(child.killed, true);
		assert.equal(manager.status, "stopping");
		child.finish();
		await rejected;
		await manager.stop();
		assert.equal(manager.status, "stopped");
	});
});

describe("manager failure boundaries", () => {
	it("a failed OS spawn settles exit and rejects start without an unhandled error", async () => {
		const previous = Object.getOwnPropertyDescriptor(process, "execPath")!;
		Object.defineProperty(process, "execPath", { ...previous, value: join(scratch("missing-node"), "node") });
		try {
			const manager = createHostManager({ driver: forkDriver({ entry }) });
			await assert.rejects(manager.start(), /child exited before ready/);
			assert.equal(manager.status, "stopped");
			await manager.stop();
		} finally {
			Object.defineProperty(process, "execPath", previous);
		}
	});

	it("replacement readiness starts a fresh idle clock and ignores the old child's reports", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		onTestFinished(() => {
			vi.useRealTimers();
		});
		const controls: ((message: ControlMessage) => void)[] = [];
		const fake: Driver = {
			spawn() {
				const exited = Promise.withResolvers<{ code: number; signal: null }>();
				return {
					pid: 0,
					link: ipcLink({ connected: false, send: () => false, on: () => undefined, off: () => undefined }),
					exited: exited.promise,
					send: () => exited.resolve({ code: 0, signal: null }),
					killTree: () => exited.resolve({ code: 0, signal: null }),
					onControl: (listener) => {
						controls.push(listener);
					},
				};
			},
		};
		const manager = createHostManager({ driver: fake });
		const first = manager.start();
		await new Promise<void>((resolve) => setImmediate(resolve));
		controls[0]!({ type: "ready" });
		await first;
		vi.setSystemTime(Date.now() + 60);
		await manager.stop();
		const second = manager.start();
		await new Promise<void>((resolve) => setImmediate(resolve));
		controls[1]!({ type: "ready" });
		await second;
		assert.ok(manager.liveness.idleFor < 30);
		controls[0]!({ type: "status", activeCalls: 5 });
		assert.equal(manager.liveness.activeCalls, 0);
		await manager.stop();
	});
});
