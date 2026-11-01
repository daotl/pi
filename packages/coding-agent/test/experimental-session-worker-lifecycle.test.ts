import type { ChildProcess } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHost } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core";
import { createRoutedLinkPair } from "@earendil-works/pi-server";
import lockfile from "proper-lockfile";
import { Check } from "typebox/value";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CoordinatorConnection, ensureCoordinator } from "../src/experimental/coordinator.ts";
import * as processRuntime from "../src/experimental/process.ts";
import { AgentController } from "../src/experimental/services/agent-controller.ts";
import { Transcript } from "../src/experimental/services/transcript.ts";
import {
	SESSION_WORKER_CONTROL_ADDRESS_ENV,
	SESSION_WORKER_CONTROL_TOKEN_ENV,
	SESSION_WORKER_PEER_ID_ENV,
	SESSION_WORKER_SESSION_KEY_ENV,
	type SessionWorkerEvent,
	SessionWorkerEventSchema,
	WorkerLifecycle,
} from "../src/experimental/session-worker.ts";
import { SessionWorkerManager } from "../src/experimental/session-worker-manager.ts";
import { createExperimentalSessions } from "./experimental-session-support.ts";
import { KeyedProbe } from "./fixtures/keyed-service.ts";

const GENERATION = "generation-1";

function createLifecycle(options: { initialDemandGraceMs?: number; orphanDemandGraceMs?: number } = {}) {
	const retire = vi.fn();
	const lifecycle = new WorkerLifecycle({
		initialServerConnectionId: GENERATION,
		initialDemandGraceMs: options.initialDemandGraceMs ?? 100,
		orphanDemandGraceMs: options.orphanDemandGraceMs ?? 200,
		onRetire: retire,
	});
	return { lifecycle, retire };
}

afterEach(() => {
	vi.useRealTimers();
});

describe("Session worker lifecycle", () => {
	test("retires only after client demand and Harness activity are both gone", async () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		lifecycle.operationStarted("run", "main", "operation-1");
		lifecycle.setDemand(GENERATION, "attachment-1", false);
		expect(retire).not.toHaveBeenCalled();

		lifecycle.operationStopped("run", "main", "operation-1");
		await vi.runAllTicks();
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test("retains the worker until every presentation attachment is released", () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		lifecycle.setDemand(GENERATION, "attachment-2", true);
		lifecycle.setDemand(GENERATION, "attachment-1", false);
		expect(retire).not.toHaveBeenCalled();
		lifecycle.setDemand(GENERATION, "attachment-2", false);
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test("tracks a nested compaction independently from its enclosing run", () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		lifecycle.operationStarted("run", "main", "operation-1");
		lifecycle.operationStarted("compaction", "main", "operation-1");
		lifecycle.setDemand(GENERATION, "attachment-1", false);

		lifecycle.operationStopped("compaction", "main", "operation-1");
		expect(retire).not.toHaveBeenCalled();
		lifecycle.operationStopped("run", "main", "operation-1");
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test.each(["compaction", "navigation"] as const)("clears suspended %s activity", (kind) => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		lifecycle.operationStarted(kind, "main", "operation-1");
		lifecycle.setDemand(GENERATION, "attachment-1", false);

		lifecycle.operationStopped(kind, "main", "operation-1");
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test("does not retire while a demand acknowledgement holds reconciliation", () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		const release = lifecycle.holdRetirement();
		lifecycle.setDemand(GENERATION, "attachment-1", false);
		expect(retire).not.toHaveBeenCalled();
		release();
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test("holds retirement only for requests from the active attachment", () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		const release = lifecycle.beginRequest(GENERATION, "attachment-1");
		lifecycle.setDemand(GENERATION, "attachment-1", false);
		expect(retire).not.toHaveBeenCalled();
		release();
		expect(retire).toHaveBeenCalledOnce();
		expect(() => lifecycle.beginRequest(GENERATION, "attachment-1")).toThrow(/retiring/);
		lifecycle.close();
	});

	test("rejects requests from stale generations and attachments", () => {
		vi.useFakeTimers();
		const { lifecycle } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		expect(() => lifecycle.beginRequest("stale", "attachment-1")).toThrow(/stale server generation/);
		expect(() => lifecycle.beginRequest(GENERATION, "wrong-attachment")).toThrow(/active attachment/);
		lifecycle.close();
	});

	test("retains disconnected-generation demand for the orphan grace", async () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		lifecycle.serverDisconnected(GENERATION);

		vi.advanceTimersByTime(199);
		expect(retire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		await vi.runAllTicks();
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test("allows a replacement generation to retain the worker", async () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		lifecycle.setDemand(GENERATION, "attachment-1", true);
		lifecycle.serverDisconnected(GENERATION);
		lifecycle.serverConnected("generation-2");
		lifecycle.setDemand("generation-2", "attachment-2", true);

		vi.advanceTimersByTime(200);
		expect(retire).not.toHaveBeenCalled();
		lifecycle.setDemand("generation-2", "attachment-2", false);
		await vi.runAllTicks();
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test("retires a launched worker that never receives initial demand", async () => {
		vi.useFakeTimers();
		const { lifecycle, retire } = createLifecycle();
		vi.advanceTimersByTime(100);
		await vi.runAllTicks();
		expect(retire).toHaveBeenCalledOnce();
		lifecycle.close();
	});

	test("rejects demand after retirement has won the race", () => {
		vi.useFakeTimers();
		const { lifecycle } = createLifecycle();
		vi.advanceTimersByTime(100);
		expect(() => lifecycle.setDemand(GENERATION, "attachment-1", true)).toThrow(/retiring/);
		lifecycle.close();
	});

	test("rejects demand from a stale server generation", () => {
		vi.useFakeTimers();
		const { lifecycle } = createLifecycle();
		expect(() => lifecycle.setDemand("stale", "attachment-1", true)).toThrow(/stale server generation/);
		lifecycle.close();
	});
});

test("replaces a retained pre-Chord worker only after process exit and session ownership release", async () => {
	const directory = await mkdtemp("/tmp/pi-worker-fence-");
	const sessionDir = join(directory, "sessions");
	const [metadata] = await createExperimentalSessions(sessionDir, ["upgrade-session"]);
	if (!metadata) throw new Error("Expected durable upgrade session");
	const controlPath = join(directory, "control.sock");
	const lease = await ensureCoordinator(join(directory, "public.sock"), controlPath);
	const coordinator = new CoordinatorConnection({ controlPath, endpoint: join(directory, "server.sock") });
	const workers = new SessionWorkerManager(coordinator, sessionDir, {
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	});
	const peerId = "legacy-upgrade-worker";
	const fixture = new URL("fixtures/faux-session-worker.ts", import.meta.url);
	const realSpawn = processRuntime.spawnInternalProcess;
	let child: ChildProcess | undefined;
	let replacement: ChildProcess | undefined;
	let replacementOpenedAfterExit = false;
	let exclusiveRelease: (() => Promise<void>) | undefined;
	let restoreSpawn: (() => void) | undefined;
	const client = createHost({ name: "presentation", kind: "client", self: null });
	try {
		await coordinator.connect();
		const connected = Promise.withResolvers<void>();
		const disconnected = Promise.withResolvers<void>();
		const removeConnected = coordinator.onEvent((event) => {
			if (event.type === "peer_connected" && event.peerId === peerId) connected.resolve();
			if (event.type === "peer_disconnected" && event.peerId === peerId) disconnected.resolve();
		});
		child = realSpawn("session-worker", [JSON.stringify({ sessionDir, metadata, pluginManifestPaths: [] })], {
			entryUrl: fixture,
			env: {
				[SESSION_WORKER_CONTROL_ADDRESS_ENV]: controlPath,
				[SESSION_WORKER_CONTROL_TOKEN_ENV]: "legacy-token",
				[SESSION_WORKER_SESSION_KEY_ENV]: Buffer.from(metadata.path).toString("base64url"),
				[SESSION_WORKER_PEER_ID_ENV]: peerId,
				__PI_TEST_LEGACY_WORKER_DIR: directory,
			},
		});
		const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
		await connected.promise;
		const discovering = workers.discover(new Set([peerId]));
		const spawn = vi.spyOn(processRuntime, "spawnInternalProcess").mockImplementation((role, args, options) => {
			if (role !== "session-worker") return realSpawn(role, args, options);
			replacementOpenedAfterExit = child!.exitCode !== null || child!.signalCode !== null;
			replacement = realSpawn(role, args, { ...options, entryUrl: fixture });
			return replacement;
		});
		restoreSpawn = () => spawn.mockRestore();
		await vi.waitFor(async () => access(join(directory, "shutdown-received")));
		await disconnected.promise;
		removeConnected();
		expect(child.exitCode).toBeNull();
		expect(child.signalCode).toBeNull();
		expect(workers.workerPids.size).toBe(0);
		expect(workers.trackedSessions).toEqual([metadata]);
		let opened = false;
		const opening = workers.openSession(metadata, BACKGROUND_CONTEXT, []).then((handle) => {
			opened = true;
			return handle;
		});
		await Promise.resolve();
		expect(opened).toBe(false);
		expect(spawn).not.toHaveBeenCalled();
		await expect(access(join(directory, "invalid-chord-frame"))).rejects.toMatchObject({ code: "ENOENT" });
		await writeFile(join(directory, "allow-exit"), "exit");
		await exited;
		await discovering;
		const handle = await opening;
		expect(replacementOpenedAfterExit).toBe(true);
		expect(workers.workerPids.get(metadata.id)).not.toBe(child.pid);
		const attachment = await handle.attachClient!(BACKGROUND_CONTEXT);
		client.connect(attachment.link, { principal: null });
		try {
			const transcript = await client.get(Transcript, {});
			const controller = await client.get(AgentController, {});
			await client.ready();
			expect(transcript.state.value.snapshot?.lane).toBe("main");
			const response = await client.root((context) =>
				controller.prompt({ message: "question", images: null }, context),
			);
			expect(response.accepted).toBe(true);
			await vi.waitFor(() => {
				expect(transcript.state.value.snapshot).toMatchObject({
					operation: null,
					lastResult: { operationId: response.operationId },
				});
			});
			controller.release();
			transcript.release();
		} finally {
			await client.close();
			await attachment.release(BACKGROUND_CONTEXT);
		}
		await workers.shutdown();
		// A real successor can reacquire ownership after the replacement also stops.
		exclusiveRelease = await lockfile.lock(metadata.path, { realpath: true });
		await exclusiveRelease();
		exclusiveRelease = undefined;
	} finally {
		restoreSpawn?.();
		await client.close();
		for (const process of [child, replacement]) {
			if (process && process.exitCode === null && process.signalCode === null) {
				const exited = new Promise<void>((resolve) => process.once("exit", () => resolve()));
				process.kill("SIGKILL");
				await exited;
			}
		}
		await exclusiveRelease?.();
		workers.detach();
		coordinator.close();
		lease.close();
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);

test.each([false, true])(
	"real worker keeps sibling native traffic flowing during demand cleanup (shutdown: %s)",
	async (shutdown) => {
		const directory = await mkdtemp("/tmp/pi-worker-demand-");
		const sessionDir = join(directory, "sessions");
		const [metadata] = await createExperimentalSessions(sessionDir, ["demand-cleanup"]);
		if (!metadata) throw new Error("Expected durable session");
		const controlPath = join(directory, "control.sock");
		const lease = await ensureCoordinator(join(directory, "public.sock"), controlPath);
		const coordinator = new CoordinatorConnection({ controlPath, endpoint: join(directory, "server.sock") });
		const peerId = "demand-cleanup-worker";
		const events: SessionWorkerEvent[] = [];
		const scopes = ["attachment-a", "attachment-b"].map((attachmentId) => ({
			serverConnectionId: coordinator.serverConnectionId,
			attachmentId,
		}));
		const pairs = scopes.map(() => createRoutedLinkPair());
		const clients = scopes.map((_, index) =>
			createHost({ name: `demand-client-${index}`, kind: "client", self: null }),
		);
		let child: ChildProcess | undefined;
		const removeListener = coordinator.onEvent((event) => {
			if (event.type !== "message" || event.from !== peerId || !Check(SessionWorkerEventSchema, event.payload))
				return;
			const payload: SessionWorkerEvent = event.payload;
			events.push(payload);
			if (payload.type === "chord") {
				const index = scopes.findIndex((scope) => scope.attachmentId === payload.scope.attachmentId);
				if (index !== -1) pairs[index]![1].send(payload.frame);
			}
		});
		try {
			await coordinator.connect();
			child = processRuntime.spawnInternalProcess(
				"session-worker",
				[
					JSON.stringify({
						sessionDir,
						metadata,
						pluginManifestPaths: [],
						provider: "anthropic",
						model: "claude-sonnet-4-5",
					}),
				],
				{
					entryUrl: new URL("fixtures/faux-session-worker.ts", import.meta.url),
					env: {
						[SESSION_WORKER_CONTROL_ADDRESS_ENV]: controlPath,
						[SESSION_WORKER_CONTROL_TOKEN_ENV]: "demand-token",
						[SESSION_WORKER_SESSION_KEY_ENV]: Buffer.from(metadata.path).toString("base64url"),
						[SESSION_WORKER_PEER_ID_ENV]: peerId,
						__PI_TEST_WORKER_CLEANUP_DIR: directory,
					},
				},
			);
			const exited = new Promise<number | null>((resolve) => child!.once("exit", resolve));
			await vi.waitFor(() => expect(events.some((event) => event.type === "worker_ready")).toBe(true), {
				timeout: 10_000,
			});
			for (const [index, scope] of scopes.entries()) {
				await coordinator.send(peerId, {
					type: "session_demand",
					...scope,
					requestId: `attach-${index}`,
					attached: true,
				});
				await vi.waitFor(() =>
					expect(
						events.some((event) => event.type === "demand_applied" && event.requestId === `attach-${index}`),
					).toBe(true),
				);
				pairs[index]![1].receive((frame) => {
					void coordinator.send(peerId, { type: "chord", scope, frame });
				});
				clients[index]!.connect(pairs[index]![0], { principal: null });
			}
			const first = await clients[0]!.get(KeyedProbe, { key: "gated-cleanup" });
			const sibling = await clients[1]!.get(KeyedProbe, { key: "sibling" });
			await coordinator.send(peerId, {
				type: "session_demand",
				...scopes[0]!,
				requestId: "detach-a",
				attached: false,
			});
			await vi.waitFor(async () => access(join(directory, "cleanup-entered")));
			await coordinator.send(peerId, {
				type: "session_demand",
				...scopes[0]!,
				requestId: "reattach-a",
				attached: true,
			});
			let echo: string | undefined;
			const echoing = clients[1]!
				.root((ctx) => sibling.echo("sibling remains responsive", ctx))
				.then((value) => {
					echo = value;
				});
			await vi.waitFor(() => expect(echo).toBe("sibling remains responsive"));
			await echoing;
			expect(
				events.filter(
					(event) =>
						(event.type === "demand_applied" || event.type === "demand_rejected") &&
						["detach-a", "reattach-a"].includes(event.requestId),
				),
			).toEqual([]);
			const controller = new AbortController();
			const waiting = clients[1]!
				.root((ctx) => sibling.wait(ctx), { signal: controller.signal })
				.catch((error: unknown) => error);
			await vi.waitFor(async () => access(join(directory, "wait-entered")));
			controller.abort(new Error("cancel sibling while A closes"));
			await vi.waitFor(async () => access(join(directory, "wait-cancelled")));
			expect(await waiting).toBeInstanceOf(Error);
			if (shutdown) {
				await coordinator.send(peerId, { type: "shutdown" });
				await vi.waitFor(async () => access(join(directory, "shutdown-entered")));
				expect(child.exitCode).toBeNull();
				await writeFile(join(directory, "allow-cleanup"), "release");
				expect(await exited).toBe(0);
				expect(events.some((event) => event.type === "demand_rejected" && event.requestId === "reattach-a")).toBe(
					true,
				);
				expect(events.some((event) => event.type === "demand_applied" && event.requestId === "reattach-a")).toBe(
					false,
				);
			} else {
				await writeFile(join(directory, "allow-cleanup"), "release");
				await vi.waitFor(() =>
					expect(
						events
							.filter(
								(event) =>
									event.type === "demand_applied" && ["detach-a", "reattach-a"].includes(event.requestId),
							)
							.map((event) => event.type === "demand_applied" && event.requestId),
					).toEqual(["detach-a", "reattach-a"]),
				);
				await coordinator.send(peerId, { type: "shutdown" });
				expect(await exited).toBe(0);
			}
			await access(join(directory, "cleanup-finished"));
			first.release();
			sibling.release();
		} finally {
			await writeFile(join(directory, "allow-cleanup"), "release");
			for (const client of clients) await client.close();
			if (child && child.exitCode === null && child.signalCode === null) {
				const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
				child.kill("SIGKILL");
				await exited;
			}
			removeListener();
			coordinator.close();
			lease.close();
			await rm(directory, { recursive: true, force: true });
		}
	},
	30_000,
);
