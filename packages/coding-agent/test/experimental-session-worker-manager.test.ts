import { ChildProcess } from "node:child_process";
import { createHost, defineFacet, type Frame, hostNamed, local, method, remote } from "@earendil-works/chord";
import {
	type AgentLane,
	BACKGROUND_CONTEXT,
	type JsonlSessionMetadata,
	type LaneSnapshot,
} from "@earendil-works/pi-agent-core";
import { createRoutedLinkPair } from "@earendil-works/pi-server";
import lockfile from "proper-lockfile";
import { Type } from "typebox";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CoordinatorConnectionEvent } from "../src/experimental/coordinator.ts";
import * as processRuntime from "../src/experimental/process.ts";
import { createSessionWorkerServices } from "../src/experimental/services/worker.ts";
import {
	SESSION_WORKER_CONTROL_TOKEN_ENV,
	SESSION_WORKER_PEER_ID_ENV,
	SESSION_WORKER_SERVICE_PROTOCOL_VERSION,
} from "../src/experimental/session-worker.ts";
import { SessionWorkerManager } from "../src/experimental/session-worker-manager.ts";

const metadata: JsonlSessionMetadata = {
	id: "session-1",
	createdAt: 1,
	storageVersion: 1,
	cwd: "/tmp",
	path: "/tmp/session-1.jsonl",
	modifiedAt: 1,
};

class FakeCoordinator {
	readonly controlPath = "/tmp/control.sock";
	readonly serverConnectionId = "server-generation-1";
	readonly wasReplaced = false;
	readonly sent: { peerId: string; payload: unknown }[] = [];
	readonly #listeners = new Set<(event: CoordinatorConnectionEvent) => void>();
	onSend?: (peerId: string, payload: Record<string, unknown>) => void;
	serviceProtocolVersion: number | undefined = SESSION_WORKER_SERVICE_PROTOCOL_VERSION;

	onEvent(listener: (event: CoordinatorConnectionEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	async send(peerId: string, payload: unknown): Promise<void> {
		this.sent.push({ peerId, payload });
		this.onSend?.(peerId, asObject(payload));
	}

	async broadcast(payload: unknown): Promise<void> {
		if (asObject(payload).type !== "discover_workers") return;
		this.emit({
			type: "message",
			from: "worker-1",
			payload: {
				type: "worker_ready",
				...(this.serviceProtocolVersion === undefined
					? {}
					: { serviceProtocolVersion: this.serviceProtocolVersion }),
				token: "worker-token",
				sessionKey: metadata.path,
				sessionId: metadata.id,
				pid: 123,
				metadata,
				pluginManifestPaths: [],
			},
		});
	}

	emit(event: CoordinatorConnectionEvent): void {
		for (const listener of this.#listeners) listener(event);
	}
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function createAttachedWorker(): Promise<{
	coordinator: FakeCoordinator;
	workers: SessionWorkerManager;
	handle: Awaited<ReturnType<SessionWorkerManager["openSession"]>>;
	attachment: Awaited<ReturnType<Awaited<ReturnType<SessionWorkerManager["openSession"]>>["attachClient"]>>;
	release(): Promise<void>;
}> {
	const coordinator = new FakeCoordinator();
	const workers = new SessionWorkerManager(coordinator, "/tmp");
	await workers.discover(new Set(["worker-1"]));
	const handle = await workers.openSession(metadata, BACKGROUND_CONTEXT, []);
	coordinator.onSend = (peerId, payload) => {
		if (payload.type !== "session_demand") return;
		queueMicrotask(() =>
			coordinator.emit({
				type: "message",
				from: peerId,
				payload: {
					type: "demand_applied",
					token: "worker-token",
					sessionKey: metadata.path,
					requestId: payload.requestId,
					attachmentId: payload.attachmentId,
					attached: payload.attached,
				},
			}),
		);
	};
	const attachment = await handle.attachClient!(BACKGROUND_CONTEXT);
	return {
		coordinator,
		workers,
		handle,
		attachment,
		release: () => Promise.resolve(attachment.release(BACKGROUND_CONTEXT)),
	};
}

describe("Session worker lifecycle failures", () => {
	test.each([undefined, 0, SESSION_WORKER_SERVICE_PROTOCOL_VERSION + 1])(
		"fences retained worker protocol %s until process exit and ownership release",
		async (serviceProtocolVersion) => {
			vi.useFakeTimers();
			let legacyAlive = true;
			vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
				if (pid !== 123 || signal !== 0) throw new Error("Unexpected process signal");
				if (legacyAlive) return true;
				throw Object.assign(new Error("No such process"), { code: "ESRCH" });
			});
			const ownershipReleased = Promise.withResolvers<void>();
			const releaseOwnership = vi.fn(() => ownershipReleased.promise);
			const acquireOwnership = vi.spyOn(lockfile, "lock").mockResolvedValue(releaseOwnership);
			const coordinator = new FakeCoordinator();
			coordinator.serviceProtocolVersion = serviceProtocolVersion;
			let replacementPeer = "";
			let replacementToken = "";
			const spawn = vi.spyOn(processRuntime, "spawnInternalProcess").mockImplementation((_role, _args, options) => {
				const child = new ChildProcess();
				Object.defineProperty(child, "pid", { value: 456 });
				replacementPeer = options?.env?.[SESSION_WORKER_PEER_ID_ENV] ?? "";
				replacementToken = options?.env?.[SESSION_WORKER_CONTROL_TOKEN_ENV] ?? "";
				queueMicrotask(() =>
					coordinator.emit({
						type: "message",
						from: replacementPeer,
						payload: {
							type: "worker_ready",
							serviceProtocolVersion: SESSION_WORKER_SERVICE_PROTOCOL_VERSION,
							token: replacementToken,
							sessionKey: metadata.path,
							sessionId: metadata.id,
							pid: 456,
							metadata,
							pluginManifestPaths: [],
						},
					}),
				);
				return child;
			});
			coordinator.onSend = (peerId, payload) => {
				if (payload.type === "shutdown") {
					// A disconnected control socket (or stop acknowledgement) is not process exit.
					coordinator.emit({ type: "peer_disconnected", peerId });
				} else if (payload.type === "session_demand") {
					queueMicrotask(() =>
						coordinator.emit({
							type: "message",
							from: peerId,
							payload: {
								...payload,
								type: "demand_applied",
								token: replacementToken,
								sessionKey: metadata.path,
							},
						}),
					);
				}
			};
			const workers = new SessionWorkerManager(coordinator, "/tmp");
			try {
				const discovering = workers.discover(new Set(["worker-1"]));
				await vi.advanceTimersByTimeAsync(0);
				const opening = workers.openSession(metadata, BACKGROUND_CONTEXT, []);
				await vi.advanceTimersByTimeAsync(100);
				expect(workers.trackedSessions).toEqual([metadata]);
				expect(workers.workerPids.size).toBe(0);
				expect(spawn).not.toHaveBeenCalled();
				expect(acquireOwnership).not.toHaveBeenCalled();
				legacyAlive = false;
				await vi.advanceTimersByTimeAsync(100);
				expect(releaseOwnership).toHaveBeenCalledOnce();
				expect(spawn).not.toHaveBeenCalled();
				ownershipReleased.resolve();
				await discovering;
				const handle = await opening;
				const attachment = await handle.attachClient!(BACKGROUND_CONTEXT);
				attachment.link.send({ t: "ping", n: 1 });
				await vi.advanceTimersByTimeAsync(0);
				expect(workers.workerPids.get(metadata.id)).toBe(456);
				expect(coordinator.sent.filter(({ peerId }) => peerId === "worker-1")).toEqual([
					{ peerId: "worker-1", payload: { type: "shutdown" } },
				]);
				// Neither duplicate readiness nor late disconnect may replace/remove the new worker.
				coordinator.serviceProtocolVersion = SESSION_WORKER_SERVICE_PROTOCOL_VERSION;
				await coordinator.broadcast({ type: "discover_workers" });
				coordinator.emit({ type: "peer_disconnected", peerId: "worker-1" });
				expect(workers.workerPids.get(metadata.id)).toBe(456);
				await attachment.release(BACKGROUND_CONTEXT);
			} finally {
				ownershipReleased.resolve();
				workers.detach();
			}
		},
	);

	test("fails closed rather than signalling an unresponsive retained PID", async () => {
		vi.useFakeTimers();
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const acquire = vi.spyOn(lockfile, "lock");
		const spawn = vi.spyOn(processRuntime, "spawnInternalProcess");
		const coordinator = new FakeCoordinator();
		coordinator.serviceProtocolVersion = undefined;
		const workers = new SessionWorkerManager(coordinator, "/tmp");
		const discovery = expect(workers.discover(new Set(["worker-1"]))).rejects.toThrow(/did not exit/);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(kill).not.toHaveBeenCalledWith(123, "SIGKILL");
		expect(acquire).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
		await discovery;
		await expect(workers.openSession(metadata, BACKGROUND_CONTEXT, [])).rejects.toThrow(/did not exit/);
		expect(workers.workerPids.size).toBe(0);
		workers.detach();
	});

	test("does not replace an exited incompatible worker while session ownership is unavailable", async () => {
		vi.spyOn(process, "kill").mockImplementation(() => {
			throw Object.assign(new Error("No such process"), { code: "ESRCH" });
		});
		vi.spyOn(lockfile, "lock").mockRejectedValue(new Error("Session ownership is unavailable"));
		const spawn = vi.spyOn(processRuntime, "spawnInternalProcess");
		const coordinator = new FakeCoordinator();
		coordinator.serviceProtocolVersion = undefined;
		const workers = new SessionWorkerManager(coordinator, "/tmp");
		await expect(workers.discover(new Set(["worker-1"]))).rejects.toThrow(/ownership is unavailable/);
		await expect(workers.openSession(metadata, BACKGROUND_CONTEXT, [])).rejects.toThrow(/ownership is unavailable/);
		expect(spawn).not.toHaveBeenCalled();
		workers.detach();
	});

	test.each([false, true])(
		"rejects launched readiness mismatch only after child exit (forced: %s)",
		async (forceStop) => {
			vi.useFakeTimers();
			const child = new ChildProcess();
			Object.defineProperty(child, "pid", { value: 456 });
			const kill = vi.spyOn(child, "kill").mockReturnValue(true);
			const releaseOwnership = vi.fn(async () => {});
			vi.spyOn(lockfile, "lock").mockResolvedValue(releaseOwnership);
			const coordinator = new FakeCoordinator();
			vi.spyOn(processRuntime, "spawnInternalProcess").mockImplementation((_role, _args, options) => {
				queueMicrotask(() =>
					coordinator.emit({
						type: "message",
						from: options?.env?.[SESSION_WORKER_PEER_ID_ENV] ?? "",
						payload: {
							type: "worker_ready",
							serviceProtocolVersion: SESSION_WORKER_SERVICE_PROTOCOL_VERSION + 1,
							token: options?.env?.[SESSION_WORKER_CONTROL_TOKEN_ENV],
							sessionKey: metadata.path,
							sessionId: metadata.id,
							pid: 456,
							metadata,
							pluginManifestPaths: [],
						},
					}),
				);
				return child;
			});
			const workers = new SessionWorkerManager(coordinator, "/tmp");
			let settled = false;
			const opening = workers.openSession(metadata, BACKGROUND_CONTEXT, []).finally(() => {
				settled = true;
			});
			const rejected = expect(opening).rejects.toThrow(/worker service protocol/);
			await vi.advanceTimersByTimeAsync(100);
			expect(settled).toBe(false);
			expect(workers.trackedSessions).toEqual([metadata]);
			expect(workers.workerPids.size).toBe(0);
			expect(coordinator.sent.map(({ payload }) => asObject(payload).type)).toEqual(["shutdown"]);
			if (forceStop) {
				await vi.advanceTimersByTimeAsync(10_000);
				expect(kill).toHaveBeenCalledWith("SIGKILL");
				expect(settled).toBe(false);
			}
			Object.defineProperty(child, "exitCode", { value: 0 });
			child.emit("exit", 0, null);
			await vi.advanceTimersByTimeAsync(100);
			await rejected;
			expect(releaseOwnership).toHaveBeenCalledOnce();
			if (!forceStop) expect(kill).not.toHaveBeenCalled();
			workers.detach();
		},
	);

	test("adopts a discovered worker with its existing Session plugin selection", async () => {
		const coordinator = new FakeCoordinator();
		const workers = new SessionWorkerManager(coordinator, "/tmp");
		await workers.discover(new Set(["worker-1"]));
		expect(coordinator.sent).not.toContainEqual({ peerId: "worker-1", payload: { type: "shutdown" } });
		expect(workers.workerPids.size).toBe(1);
		expect(() => workers.assertSessionPluginManifestPaths(metadata, [])).not.toThrow();
		workers.detach();
	});

	test("rejects a different plugin selection for an active Session without stopping it", async () => {
		const { workers } = await createAttachedWorker();
		expect(() => workers.assertSessionPluginManifestPaths(metadata, ["/tmp/plugin/chord-facets.json"])).toThrow(
			"active with a different plugin selection",
		);
		expect(workers.workerPids.size).toBe(1);
		workers.detach();
	});

	test("compensates a timed-out attachment before rejecting it", async () => {
		vi.useFakeTimers();
		const coordinator = new FakeCoordinator();
		const workers = new SessionWorkerManager(coordinator, "/tmp");
		await workers.discover(new Set(["worker-1"]));
		const handle = await workers.openSession(metadata, BACKGROUND_CONTEXT, []);
		const demands: { attachmentId: string; attached: boolean }[] = [];
		coordinator.onSend = (peerId, payload) => {
			if (
				payload.type !== "session_demand" ||
				typeof payload.attachmentId !== "string" ||
				typeof payload.attached !== "boolean"
			) {
				return;
			}
			demands.push({ attachmentId: payload.attachmentId, attached: payload.attached });
			if (payload.attached) return;
			queueMicrotask(() =>
				coordinator.emit({
					type: "message",
					from: peerId,
					payload: {
						type: "demand_applied",
						token: "worker-token",
						sessionKey: metadata.path,
						requestId: payload.requestId,
						attachmentId: payload.attachmentId,
						attached: false,
					},
				}),
			);
		};

		const attaching = expect(handle.attachClient!(BACKGROUND_CONTEXT)).rejects.toThrow("timed out");
		await vi.advanceTimersByTimeAsync(5_000);
		await attaching;
		expect(demands).toHaveLength(2);
		expect(demands[0]).toMatchObject({ attachmentId: expect.any(String), attached: true });
		expect(demands[1]).toEqual({ attachmentId: demands[0]!.attachmentId, attached: false });
		workers.detach();
	});

	test("kills a worker when timed-out demand cannot be reconciled", async () => {
		vi.useFakeTimers();
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const coordinator = new FakeCoordinator();
		const workers = new SessionWorkerManager(coordinator, "/tmp");
		await workers.discover(new Set(["worker-1"]));
		const handle = await workers.openSession(metadata, BACKGROUND_CONTEXT, []);
		coordinator.onSend = () => {};

		const attaching = expect(handle.attachClient!(BACKGROUND_CONTEXT)).rejects.toThrow("worker was terminated");
		await vi.advanceTimersByTimeAsync(5_000);
		await vi.advanceTimersByTimeAsync(5_000);
		await vi.advanceTimersByTimeAsync(10_000);
		await attaching;
		expect(kill).toHaveBeenCalledWith(123, "SIGKILL");
		expect(workers.workerPids.size).toBe(0);
		workers.detach();
	});

	test("bounds Harness-driven worker shutdown", async () => {
		vi.useFakeTimers();
		const kill = vi.spyOn(process, "kill").mockReturnValue(true);
		const { coordinator, workers, handle, release } = await createAttachedWorker();
		await release();
		coordinator.onSend = () => {};

		const closing = handle.close(BACKGROUND_CONTEXT);
		await vi.advanceTimersByTimeAsync(10_000);
		await closing;
		expect(kill).toHaveBeenCalledWith(123, "SIGKILL");
		expect(workers.workerPids.size).toBe(0);
		workers.detach();
	});
});

describe("Session worker native channels", () => {
	test.each([
		["malformed frame", { t: "call", id: "not-a-number" }, /malformed frame/],
		[
			"protocol mismatch",
			{ t: "hello", protocol: 1, name: "presentation", kind: "client", codeVersion: 1 },
			/protocol-version/,
		],
	] as const)("promptly rejects pending calls when the worker closes for %s", async (_name, invalid, reason) => {
		const { coordinator, workers, handle, attachment, release } = await createAttachedWorker();
		const demand = coordinator.sent
			.map(({ payload }) => asObject(payload))
			.find(({ type }) => type === "session_demand")!;
		const scope = { serverConnectionId: "server-generation-1", attachmentId: demand.attachmentId as string };
		const Contract = remote("test.worker-protocol-close", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("session"),
			variants: { active: { methods: { wait: method(), echo: method(Type.String(), Type.String()) } } },
		});
		const entered = Promise.withResolvers<void>();
		const cancelled = Promise.withResolvers<void>();
		const closedScopes: (typeof scope)[] = [];
		const services = await createSessionWorkerServices({
			lane: createServiceLane(),
			modelRuntime: undefined,
			onAttachmentClosed: (closedScope) => closedScopes.push(closedScope),
			facetLoader: async () => ({
				facets: [
					{
						name: "protocol-close-probe",
						...defineFacet(({ serve }) => {
							serve(Contract, () => ({
								variant: "active",
								echo: (value) => value,
								wait: async (ctx) => {
									entered.resolve();
									await new Promise<void>((resolve) => {
										if (ctx.signal.aborted) resolve();
										else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
									});
									cancelled.resolve();
								},
							}));
						}),
					},
				],
				async dispose() {},
			}),
			async publish(publishedScope, frame) {
				coordinator.emit({
					type: "message",
					from: "worker-1",
					payload: {
						type: "chord",
						token: "worker-token",
						sessionKey: metadata.path,
						scope: publishedScope,
						frame,
					},
				});
			},
		});
		const acknowledge = coordinator.onSend;
		coordinator.onSend = (peerId, payload) => {
			if (payload.type === "chord") services.receive(payload.scope as typeof scope, payload.frame as Frame);
			else acknowledge?.(peerId, payload);
		};
		services.attach(scope);
		const client = createHost({ name: "presentation", kind: "client", self: null });
		const retained = await handle.attachClient!(BACKGROUND_CONTEXT);
		const retainedDemand = asObject(coordinator.sent[coordinator.sent.length - 1]!.payload);
		const retainedScope = { ...scope, attachmentId: retainedDemand.attachmentId as string };
		services.attach(retainedScope);
		const retainedClient = createHost({ name: "retained", kind: "client", self: null });
		let closedReason: string | undefined;
		attachment.link.onClose((value) => {
			closedReason = value;
		});
		try {
			client.connect(attachment.link, { principal: null });
			const ref = await client.get(Contract, {});
			retainedClient.connect(retained.link, { principal: null });
			const retainedRef = await retainedClient.get(Contract, {});
			let failure: unknown;
			const waiting = client
				.root((ctx) => ref.wait(ctx))
				.catch((error: unknown) => {
					failure = error;
				});
			await entered.promise;
			services.receive(scope, invalid as unknown as Frame);
			await vi.waitFor(
				() => {
					expect(closedReason).toMatch(reason);
					expect(failure).toMatchObject({ code: "unavailable" });
				},
				{ timeout: 1_000 },
			);
			await waiting;
			await cancelled.promise;
			expect(closedScopes).toEqual([scope]);
			// Repeated demand cannot resurrect this closed attachment; late calls are ignored.
			services.attach(scope);
			expect(services.receive(scope, { t: "ping", n: 99 })).toBe(false);
			await expect(retainedClient.root((ctx) => retainedRef.echo("still attached", ctx))).resolves.toBe(
				"still attached",
			);
			retainedRef.release();
			ref.release();
		} finally {
			await release();
			await client.close();
			await retained.release(BACKGROUND_CONTEXT);
			await retainedClient.close();
			await services.dispose();
			workers.detach();
		}
	});

	test("attachment removal waits for asynchronous plugin resource disposal without closing another attachment", async () => {
		const closing = Promise.withResolvers<void>();
		const finishClose = Promise.withResolvers<void>();
		let resourceClosed = false;
		const Contract = remote("test.worker-attachment-resource", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("session"),
			variants: { active: { methods: { alive: method(undefined, Type.Boolean()) } } },
		});
		const scope = { serverConnectionId: "generation", attachmentId: "released" };
		const retainedScope = { ...scope, attachmentId: "retained" };
		const [releasedLink, releasedTunnel] = createRoutedLinkPair();
		const [retainedLink, retainedTunnel] = createRoutedLinkPair();
		const services = await createSessionWorkerServices({
			lane: createServiceLane(),
			modelRuntime: undefined,
			facetLoader: async () => ({
				facets: [
					{
						name: "attachment-resource",
						...defineFacet(({ serve }) => {
							serve(Contract, (_input, principal, self) => {
								const resource = self.resource("async-close", {
									version: 1,
									open: () => ({ live: true }),
									close: async (value) => {
										if (typeof principal === "string" && principal.endsWith("\0released")) {
											closing.resolve();
											await finishClose.promise;
											resourceClosed = true;
										}
										value.live = false;
									},
								});
								return { variant: "active", alive: () => resource.value.live };
							});
						}),
					},
				],
				async dispose() {},
			}),
			async publish(publishedScope, frame) {
				(publishedScope.attachmentId === scope.attachmentId ? releasedTunnel : retainedTunnel).send(frame);
			},
		});
		const releasedClient = createHost({ name: "released", kind: "client", self: null });
		const retainedClient = createHost({ name: "retained", kind: "client", self: null });
		try {
			services.attach(scope);
			services.attach(retainedScope);
			releasedTunnel.receive((frame) => services.receive(scope, frame));
			retainedTunnel.receive((frame) => services.receive(retainedScope, frame));
			releasedClient.connect(releasedLink, { principal: null });
			retainedClient.connect(retainedLink, { principal: null });
			const releasedRef = await releasedClient.get(Contract, {});
			const retainedRef = await retainedClient.get(Contract, {});
			let removalSettled = false;
			const removal = services
				.removeAttachments((candidate) => candidate.attachmentId === scope.attachmentId)
				.finally(() => {
					removalSettled = true;
				});
			await closing.promise;
			await retainedClient.root((ctx) => retainedRef.alive(ctx));
			expect(removalSettled).toBe(false);
			expect(resourceClosed).toBe(false);
			finishClose.resolve();
			await removal;
			expect(resourceClosed).toBe(true);
			await expect(retainedClient.root((ctx) => retainedRef.alive(ctx))).resolves.toBe(true);
			releasedRef.release();
			retainedRef.release();
		} finally {
			finishClose.resolve();
			await releasedClient.close();
			await retainedClient.close();
			await services.dispose();
		}
	});

	test("joins complete worker disposal and aggregates attachment, host and loader failures", async () => {
		const attachmentError = new Error("attachment close failed");
		const hostError = new Error("host resource close failed");
		const loaderError = new Error("loader dispose failed");
		const closing = Promise.withResolvers<void>();
		const finishClose = Promise.withResolvers<void>();
		const closed: string[] = [];
		const Runtime = local("test.worker-dispose-runtime", { version: 1, input: Type.Object({}) });
		const Contract = remote("test.worker-dispose-attachment", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("session"),
			variants: { active: { methods: { alive: method(undefined, Type.Boolean()) } } },
		});
		const scope = { serverConnectionId: "generation", attachmentId: "failing" };
		const [link, tunnel] = createRoutedLinkPair();
		const services = await createSessionWorkerServices({
			lane: createServiceLane(),
			modelRuntime: undefined,
			facetLoader: async () => ({
				facets: [
					{
						name: "failing-disposal",
						...defineFacet(({ serve }) => {
							serve(
								Runtime,
								(_input, _principal, self) => {
									self.resource("host-resource", {
										version: 1,
										open: () => ({}),
										close: () => {
											closed.push("host");
											throw hostError;
										},
									});
									return {};
								},
								{ lifetime: "host" },
							);
							serve(Contract, (_input, _principal, self) => {
								self.resource("attachment-resource", {
									version: 1,
									open: () => ({}),
									close: async () => {
										closing.resolve();
										await finishClose.promise;
										closed.push("attachment");
										throw attachmentError;
									},
								});
								return { variant: "active", alive: () => true };
							});
						}),
					},
				],
				async dispose() {
					closed.push("loader");
					throw loaderError;
				},
			}),
			async publish(_scope, frame) {
				tunnel.send(frame);
			},
		});
		const client = createHost({ name: "disposal-client", kind: "client", self: null });
		try {
			services.attach(scope);
			tunnel.receive((frame) => services.receive(scope, frame));
			client.connect(link, { principal: null });
			const ref = await client.get(Contract, {});
			await client.root((ctx) => ref.alive(ctx));
			const disposal = services.dispose();
			const failure = disposal.catch((error: unknown) => error);
			await closing.promise;
			expect(services.dispose()).toBe(disposal);
			expect(closed).toEqual([]);
			finishClose.resolve();
			const error = await failure;
			const flatten = (value: unknown): unknown[] =>
				value instanceof AggregateError ? value.errors.flatMap(flatten) : [value];
			expect(flatten(error)).toEqual(expect.arrayContaining([attachmentError, hostError, loaderError]));
			expect(closed.sort()).toEqual(["attachment", "host", "loader"]);
			expect(services.dispose()).toBe(disposal);
			await expect(services.dispose()).rejects.toBe(error);
			ref.release();
		} finally {
			finishClose.resolve();
			await client.close();
			await services.dispose().catch(() => {});
		}
	});

	test("carries contract calls, cancellation and large results through the admitted worker scope", async () => {
		const { coordinator, workers, attachment, release } = await createAttachedWorker();
		const demand = coordinator.sent
			.map(({ payload }) => asObject(payload))
			.find(({ type }) => type === "session_demand")!;
		const scope = { serverConnectionId: "server-generation-1", attachmentId: demand.attachmentId };
		const Contract = remote("test.worker-channel", {
			version: 1,
			input: Type.Object({}),
			host: hostNamed("session"),
			variants: { active: { methods: { echo: method(Type.String(), Type.String()), wait: method() } } },
		});
		const entered = Promise.withResolvers<void>();
		const cancelled = Promise.withResolvers<void>();
		const provider = createHost({ name: "session", self: null });
		provider.serve(Contract, () => ({
			variant: "active",
			echo: (value) => value,
			wait: async (ctx) => {
				entered.resolve();
				await new Promise<void>((resolve) => {
					if (ctx.signal.aborted) resolve();
					else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
				});
				cancelled.resolve();
			},
		}));
		const [workerLink, tunnel] = createRoutedLinkPair();
		const acknowledge = coordinator.onSend;
		coordinator.onSend = (peerId, payload) => {
			if (payload.type === "chord") {
				expect(payload.scope).toEqual(scope);
				tunnel.send(payload.frame as Frame);
			} else acknowledge?.(peerId, payload);
		};
		tunnel.receive((frame) =>
			coordinator.emit({
				type: "message",
				from: "worker-1",
				payload: {
					type: "chord",
					token: "worker-token",
					sessionKey: metadata.path,
					scope,
					frame,
				},
			}),
		);
		provider.accept(workerLink, { principal: null });
		const client = createHost({ name: "presentation", kind: "client", self: null });
		try {
			client.connect(attachment.link, { principal: null });
			const ref = await client.get(Contract, {});
			const value = "message".repeat(20_000);
			await expect(client.root((ctx) => ref.echo(value, ctx))).resolves.toBe(value);
			const controller = new AbortController();
			const waiting = client.root((ctx) => ref.wait(ctx), { signal: controller.signal });
			await entered.promise;
			controller.abort();
			await expect(waiting).rejects.toMatchObject({ code: "aborted" });
			await cancelled.promise;
			await expect(client.root((ctx) => ref.echo("after-cancel", ctx))).resolves.toBe("after-cancel");
			ref.release();
		} finally {
			await release();
			await client.close();
			await provider.close();
			workers.detach();
		}
	});

	test("ignores malformed, wrong-worker, wrong-generation and wrong-attachment frames", async () => {
		const { coordinator, workers, attachment, release } = await createAttachedWorker();
		const demand = coordinator.sent
			.map(({ payload }) => asObject(payload))
			.find(({ type }) => type === "session_demand")!;
		const scope = { serverConnectionId: "server-generation-1", attachmentId: demand.attachmentId };
		const payload = {
			type: "chord",
			token: "worker-token",
			sessionKey: metadata.path,
			scope,
			frame: { t: "ping", n: 7 },
		};
		const frames: Frame[] = [];
		attachment.link.receive((frame) => frames.push(frame));
		for (const frame of [
			{ t: "ping", n: 7 },
			{ t: "bye", reason: "stale terminal" },
		]) {
			for (const [from, update] of [
				["unknown-worker", {}],
				["worker-1", { token: "wrong-token" }],
				["worker-1", { sessionKey: "/tmp/another-session.jsonl" }],
				["worker-1", { scope: null }],
				["worker-1", { scope: { ...scope, serverConnectionId: "retired-server" } }],
				["worker-1", { scope: { ...scope, attachmentId: "another-attachment" } }],
			] as const)
				coordinator.emit({ type: "message", from, payload: { ...payload, frame, ...update } });
		}
		coordinator.emit({ type: "message", from: "worker-1", payload });
		await vi.waitFor(() => expect(frames).toEqual([{ t: "ping", n: 7 }]));
		await release();
		coordinator.emit({ type: "message", from: "worker-1", payload: { ...payload, frame: { t: "ping", n: 8 } } });
		await Promise.resolve();
		expect(frames).toEqual([{ t: "ping", n: 7 }]);
		workers.detach();
	});

	test("ends attachment links on server replacement without stopping the adopted worker", async () => {
		const { coordinator, workers, attachment, release } = await createAttachedWorker();
		const closed = new Promise<string>((resolve) => attachment.link.onClose(resolve));
		workers.detach();
		await expect(closed).resolves.toMatch(/replaced/);
		expect(attachment.link.closed).toBe(true);
		expect(coordinator.sent.map(({ payload }) => asObject(payload).type)).not.toContain("shutdown");
		expect(workers.workerPids.size).toBe(0);
		await release();
	});

	test("closes active native channels when their worker disconnects", async () => {
		const { coordinator, workers, attachment, handle, release } = await createAttachedWorker();
		const closed = new Promise<string>((resolve) => attachment.link.onClose(resolve));
		coordinator.emit({ type: "peer_disconnected", peerId: "worker-1" });
		await expect(closed).resolves.toMatch(/disconnected/);
		await expect(handle.terminated).resolves.toMatchObject({ message: expect.stringMatching(/unexpectedly/) });
		expect(workers.workerPids.size).toBe(0);
		workers.detach();
		await release();
	});
});

function asObject(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Expected object");
	return value as Record<string, unknown>;
}

function createServiceLane(): AgentLane {
	const snapshot: LaneSnapshot = {
		lane: "main",
		transcript: [],
		tipId: null,
		configuration: { model: { provider: "test", modelId: "model" }, thinkingLevel: "off", activeToolNames: [] },
		stats: {
			messageCount: 0,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		},
		operation: null,
		queues: [],
		faulted: false,
	};
	return {
		async watch() {
			return {
				snapshot,
				start() {},
				async resnapshot() {
					return snapshot;
				},
				unsubscribe() {},
			};
		},
		async getModel() {
			return undefined;
		},
		async getThinkingLevel() {
			return "off" as const;
		},
	} as unknown as AgentLane;
}
