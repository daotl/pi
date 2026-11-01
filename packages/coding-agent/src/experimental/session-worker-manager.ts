import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { Link } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, type Context, type JsonlSessionMetadata } from "@earendil-works/pi-agent-core";
import {
	createRoutedLinkPair,
	type RoutedSessionAttachment,
	type RoutedSessionHandle,
} from "@earendil-works/pi-server";
import lockfile from "proper-lockfile";
import { Check } from "typebox/value";
import type { CoordinatorConnection, CoordinatorConnectionEvent } from "./coordinator.ts";
import { spawnInternalProcess } from "./process.ts";
import {
	SESSION_WORKER_CONTROL_ADDRESS_ENV,
	SESSION_WORKER_CONTROL_TOKEN_ENV,
	SESSION_WORKER_PEER_ID_ENV,
	SESSION_WORKER_SERVICE_PROTOCOL_VERSION,
	SESSION_WORKER_SESSION_KEY_ENV,
	type SessionWorkerEvent,
	SessionWorkerEventSchema,
	type SessionWorkerOptions,
	type WorkerOperationScope,
} from "./session-worker.ts";

const WORKER_STARTUP_TIMEOUT_MS = 15_000;
const WORKER_SHUTDOWN_TIMEOUT_MS = 10_000;
const WORKER_DISCOVERY_TIMEOUT_MS = 5_000;
const WORKER_DEMAND_TIMEOUT_MS = 5_000;
const WORKER_EXIT_POLL_MS = 25;

export class SessionPluginSelectionConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionPluginSelectionConflictError";
	}
}

interface WorkerRecord {
	readonly peerId: string;
	readonly metadata: JsonlSessionMetadata;
	readonly pid: number;
	readonly token: string;
	readonly pluginManifestPaths: readonly string[];
	readonly terminated: Promise<Error | undefined>;
	resolveTerminated(error: Error | undefined): void;
	readonly attachmentIds: Set<string>;
	expectedStop: boolean;
	stopPromise?: Promise<void>;
	stopping: boolean;
}

interface PendingDemand {
	readonly attachmentId: string;
	readonly attached: boolean;
	readonly requestId: string;
	readonly timer: NodeJS.Timeout;
	readonly worker: WorkerRecord;
	resolve(): void;
	reject(error: Error): void;
}

interface WorkerFrameLink {
	readonly worker: WorkerRecord;
	readonly scope: WorkerOperationScope;
	readonly link: Link;
}

interface PendingLaunch {
	readonly sessionKey: string;
	readonly peerId: string;
	readonly token: string;
	readonly pluginManifestPaths: readonly string[];
	readonly child: ChildProcess;
	readonly timer: NodeJS.Timeout;
	readonly promise: Promise<WorkerRecord>;
	resolve(worker: WorkerRecord): void;
	reject(error: Error): void;
}

interface RetiringWorker {
	readonly metadata: JsonlSessionMetadata;
	readonly stopped: Promise<void>;
}

/** Session and process bookkeeping owned by one replaceable server process. */
export class SessionWorkerManager {
	readonly workerPids = new Map<string, number>();
	readonly #coordinator: Pick<
		CoordinatorConnection,
		"controlPath" | "serverConnectionId" | "wasReplaced" | "onEvent" | "send" | "broadcast"
	>;
	readonly #sessionDir: string;
	readonly #model: { readonly provider?: string; readonly model: string } | undefined;
	readonly #workersBySession = new Map<string, WorkerRecord>();
	readonly #workersByPeer = new Map<string, WorkerRecord>();
	readonly #pending = new Map<string, PendingLaunch>();
	readonly #retiring = new Map<string, RetiringWorker>();
	readonly #retiredPeers = new Set<string>();
	readonly #pendingDemand = new Map<string, PendingDemand>();
	readonly #links = new Map<string, WorkerFrameLink>();
	readonly #removeListener: () => void;
	readonly #onWorkerCountChanged: ((count: number) => void) | undefined;
	#discoveryPeers?: Set<string>;
	#resolveDiscovery?: () => void;
	#discovery?: Promise<void>;
	#detached = false;
	#shuttingDown = false;

	constructor(
		coordinator: Pick<
			CoordinatorConnection,
			"controlPath" | "serverConnectionId" | "wasReplaced" | "onEvent" | "send" | "broadcast"
		>,
		sessionDir: string,
		model?: { readonly provider?: string; readonly model: string },
		onWorkerCountChanged?: (count: number) => void,
	) {
		this.#coordinator = coordinator;
		this.#sessionDir = sessionDir;
		this.#model = model;
		this.#onWorkerCountChanged = onWorkerCountChanged;
		this.#removeListener = coordinator.onEvent((event) => this.#handleCoordinatorEvent(event));
	}

	get trackedSessions(): readonly JsonlSessionMetadata[] {
		const metadata = new Map<string, JsonlSessionMetadata>();
		for (const retiring of this.#retiring.values()) metadata.set(retiring.metadata.path, retiring.metadata);
		for (const worker of this.#workersBySession.values()) metadata.set(worker.metadata.path, worker.metadata);
		return [...metadata.values()];
	}

	assertSessionPluginManifestPaths(metadata: JsonlSessionMetadata, manifestPaths: readonly string[]): void {
		const existing = this.#workersBySession.get(metadata.path);
		if (existing !== undefined && !sameStrings(existing.pluginManifestPaths, manifestPaths)) {
			throw new SessionPluginSelectionConflictError(
				`Session ${metadata.id} is active with a different plugin selection`,
			);
		}
		const pending = this.#pending.get(metadata.path);
		if (pending !== undefined && !sameStrings(pending.pluginManifestPaths, manifestPaths)) {
			throw new SessionPluginSelectionConflictError(
				`Session ${metadata.id} is starting with a different plugin selection`,
			);
		}
	}

	discover(peerIds: ReadonlySet<string>): Promise<void> {
		const discovering = this.#discover(peerIds);
		this.#discovery = discovering;
		void discovering
			.finally(() => {
				if (this.#discovery === discovering) this.#discovery = undefined;
			})
			.catch(() => {});
		return discovering;
	}

	async #discover(peerIds: ReadonlySet<string>): Promise<void> {
		if (this.#detached) return;
		const undiscovered = new Set(
			[...peerIds].filter((peerId) => !this.#workersByPeer.has(peerId) && !this.#pendingPeer(peerId)),
		);
		if (undiscovered.size === 0) {
			await Promise.all([...this.#retiring.values()].map((retiring) => retiring.stopped));
			return;
		}
		this.#discoveryPeers = undiscovered;
		const discovered = new Promise<void>((resolve) => {
			this.#resolveDiscovery = resolve;
		});
		await this.#coordinator.broadcast({ type: "discover_workers" });
		let timer: NodeJS.Timeout | undefined;
		await Promise.race([
			discovered,
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, WORKER_DISCOVERY_TIMEOUT_MS);
				timer.unref();
			}),
		]);
		if (timer) clearTimeout(timer);
		this.#discoveryPeers = undefined;
		this.#resolveDiscovery = undefined;
		await Promise.all([...this.#retiring.values()].map((retiring) => retiring.stopped));
	}

	async openSession(
		metadata: JsonlSessionMetadata,
		context: Context,
		pluginManifestPaths: readonly string[],
	): Promise<RoutedSessionHandle> {
		if (this.#detached || this.#shuttingDown) throw new Error("Experimental server is shutting down");
		await this.#discovery;
		await Promise.all(
			[...this.#retiring.values()]
				.filter((retiring) => retiring.metadata.path === metadata.path)
				.map((retiring) => retiring.stopped),
		);
		if (this.#detached || this.#shuttingDown || this.#coordinator.wasReplaced) {
			throw new Error("Experimental server is shutting down");
		}
		this.assertSessionPluginManifestPaths(metadata, pluginManifestPaths);
		const existing = this.#workersBySession.get(metadata.path);
		if (existing) return this.#routedHandle(existing);
		const pending = this.#pending.get(metadata.path);
		if (pending) return this.#routedHandle(await pending.promise);
		return this.#routedHandle(await this.#launch(metadata, context, pluginManifestPaths));
	}

	async closeSession(metadata: JsonlSessionMetadata, context: Context): Promise<void> {
		const worker = this.#workersBySession.get(metadata.path) ?? (await this.#pending.get(metadata.path)?.promise);
		if (worker !== undefined) await this.#stopWorker(worker, context);
	}

	#routedHandle(worker: WorkerRecord): RoutedSessionHandle {
		return {
			terminated: worker.terminated,
			attachClient: (context) => this.#attachClient(worker, context),
			close: (context) => this.#stopWorker(worker, context),
		};
	}

	async #attachClient(worker: WorkerRecord, context: Context): Promise<RoutedSessionAttachment> {
		if (this.#detached || this.#shuttingDown || worker.stopping) {
			throw new Error("Experimental Session worker is stopping");
		}
		if (this.#workersByPeer.get(worker.peerId) !== worker) {
			throw new Error("Experimental Session worker is no longer available");
		}
		const attachmentId = randomUUID();
		worker.attachmentIds.add(attachmentId);
		const scope = this.#operationScope(worker, attachmentId);
		const [tunnel, control] = createRoutedLinkPair();
		const key = scopeKey(scope);
		this.#links.set(key, { worker, scope, link: control });
		control.onClose((reason) => {
			if (this.#links.get(key)?.link !== control) return;
			// Routed links consume bye frames, so receive() cannot forward this terminal event.
			if (
				!this.#detached &&
				!this.#coordinator.wasReplaced &&
				this.#workersByPeer.get(worker.peerId) === worker &&
				worker.attachmentIds.has(attachmentId)
			) {
				void this.#coordinator
					.send(worker.peerId, { type: "chord", scope, frame: { t: "bye", reason } })
					.catch(() => {});
			}
			this.#links.delete(key);
		});
		control.receive((frame) => {
			if (this.#detached || !worker.attachmentIds.has(attachmentId) || this.#links.get(key)?.link !== control)
				return;
			void this.#coordinator
				.send(worker.peerId, { type: "chord", scope, frame })
				.catch(() => control.close("Worker control failed"));
		});
		try {
			await this.#applyDemand(worker, attachmentId, true, true, context);
		} catch (error) {
			worker.attachmentIds.delete(attachmentId);
			this.#links.delete(key);
			control.close("Session attach failed");
			throw error;
		}
		let released = false;
		return {
			link: tunnel,
			release: async (releaseContext) => {
				if (released) return;
				control.close("Session attachment released");
				this.#links.delete(key);
				if (this.#detached || !worker.attachmentIds.has(attachmentId)) return;
				released = true;
				if (this.#detached || !worker.attachmentIds.has(attachmentId)) return;
				try {
					await this.#applyDemand(worker, attachmentId, false, true, releaseContext);
				} catch (error) {
					if (!this.#detached && !this.#coordinator.wasReplaced) throw error;
				} finally {
					worker.attachmentIds.delete(attachmentId);
				}
			},
		};
	}

	async #applyDemand(
		worker: WorkerRecord,
		attachmentId: string,
		attached: boolean,
		compensateOnTimeout: boolean,
		_context: Context,
	): Promise<void> {
		if (worker.stopping || this.#workersByPeer.get(worker.peerId) !== worker) {
			throw new Error("Experimental Session worker is stopping");
		}
		const requestId = randomUUID();
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const applied = new Promise<void>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		const timer = setTimeout(() => {
			if (compensateOnTimeout) void this.#reconcileDemandTimeout(requestId);
			else this.#rejectDemand(requestId, new Error("Session worker demand update timed out"));
		}, WORKER_DEMAND_TIMEOUT_MS);
		timer.unref();
		const pending = { attachmentId, attached, requestId, timer, worker, resolve, reject };
		this.#pendingDemand.set(requestId, pending);
		try {
			await this.#coordinator.send(worker.peerId, {
				type: "session_demand",
				serverConnectionId: this.#coordinator.serverConnectionId,
				requestId,
				attachmentId,
				attached,
			});
		} catch (error) {
			this.#rejectDemand(requestId, error instanceof Error ? error : new Error(String(error)));
		}
		return applied;
	}

	#operationScope(worker: WorkerRecord, attachmentId: string): WorkerOperationScope {
		if (this.#detached || this.#shuttingDown || worker.stopping) {
			throw new Error("Experimental Session worker is stopping");
		}
		if (this.#workersByPeer.get(worker.peerId) !== worker || !worker.attachmentIds.has(attachmentId)) {
			throw new Error("Experimental Session worker has no active attachment");
		}
		return {
			serverConnectionId: this.#coordinator.serverConnectionId,
			attachmentId,
		};
	}

	#stopWorker(worker: WorkerRecord, _context: Context): Promise<void> {
		if (this.#detached || this.#workersByPeer.get(worker.peerId) !== worker) return Promise.resolve();
		worker.stopPromise ??= this.#stopWorkerInternal(worker);
		return worker.stopPromise;
	}

	async #stopWorkerInternal(worker: WorkerRecord): Promise<void> {
		this.#closeWorkerLinks(worker, "Session worker is stopping");
		worker.stopping = true;
		worker.expectedStop = true;
		void this.#coordinator.send(worker.peerId, { type: "shutdown" }).catch(() => {});
		let timer: NodeJS.Timeout | undefined;
		const timedOut = new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), WORKER_SHUTDOWN_TIMEOUT_MS);
			timer.unref();
		});
		try {
			if ((await Promise.race([worker.terminated.then(() => false), timedOut])) === true) {
				try {
					process.kill(worker.pid, "SIGKILL");
				} catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
				}
				this.#removeWorker(worker, undefined);
				await worker.terminated;
			}
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	async shutdown(): Promise<void> {
		if (this.#detached || this.#shuttingDown) return;
		this.#shuttingDown = true;
		const pendingWorkers = [...this.#pending.values()];
		for (const pending of pendingWorkers) {
			void this.#coordinator.send(pending.peerId, { type: "shutdown" }).catch(() => {});
		}
		const pendingFinished = Promise.all(
			pendingWorkers.map((pending) => {
				if (pending.child.exitCode !== null || pending.child.signalCode !== null) return Promise.resolve();
				return new Promise<void>((resolve) => pending.child.once("exit", () => resolve()));
			}),
		).then(() => undefined);
		let timer: NodeJS.Timeout | undefined;
		const pendingTimedOut = new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), WORKER_SHUTDOWN_TIMEOUT_MS);
			timer.unref();
		});
		const stopPending = (async () => {
			if ((await Promise.race([pendingFinished.then(() => false), pendingTimedOut])) === true) {
				for (const pending of pendingWorkers) pending.child.kill("SIGKILL");
				await pendingFinished;
			}
			if (timer) clearTimeout(timer);
		})();
		await Promise.all([
			stopPending,
			...[...this.#retiring.values()].map((retiring) => retiring.stopped),
			...[...this.#workersBySession.values()]
				.filter((worker) => !this.#retiredPeers.has(worker.peerId))
				.map((worker) => this.#stopWorker(worker, BACKGROUND_CONTEXT)),
		]);
		this.#detachState();
	}

	/** Forget workers without stopping them when this server is replaced. */
	detach(): void {
		if (this.#detached) return;
		this.#detached = true;
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Experimental server was replaced"));
		}
		for (const entry of this.#links.values()) entry.link.close("Experimental server was replaced");
		this.#detachState();
	}

	#launch(
		metadata: JsonlSessionMetadata,
		_context: Context,
		pluginManifestPaths: readonly string[],
	): Promise<WorkerRecord> {
		const sessionKey = metadata.path;
		const peerId = `worker-${randomUUID()}`;
		const token = randomUUID();
		let child: ChildProcess;
		try {
			const options: SessionWorkerOptions = {
				sessionDir: this.#sessionDir,
				metadata: {
					id: metadata.id,
					createdAt: metadata.createdAt,
					storageVersion: metadata.storageVersion,
					cwd: metadata.cwd,
					path: metadata.path,
					modifiedAt: metadata.modifiedAt,
					...(metadata.parentSessionId === undefined ? {} : { parentSessionId: metadata.parentSessionId }),
				},
				pluginManifestPaths: [...pluginManifestPaths],
				...(this.#model ?? {}),
			};
			child = spawnInternalProcess("session-worker", [JSON.stringify(options)], {
				env: {
					[SESSION_WORKER_CONTROL_ADDRESS_ENV]: this.#coordinator.controlPath,
					[SESSION_WORKER_CONTROL_TOKEN_ENV]: token,
					[SESSION_WORKER_SESSION_KEY_ENV]: Buffer.from(sessionKey).toString("base64url"),
					[SESSION_WORKER_PEER_ID_ENV]: peerId,
				},
			});
		} catch (error) {
			return Promise.reject(error);
		}
		let resolve!: (worker: WorkerRecord) => void;
		let reject!: (error: Error) => void;
		const promise = new Promise<WorkerRecord>((resolvePromise, rejectPromise) => {
			resolve = resolvePromise;
			reject = rejectPromise;
		});
		const timer = setTimeout(
			() => this.#failPending(sessionKey, new Error("Session worker startup timed out")),
			WORKER_STARTUP_TIMEOUT_MS,
		);
		timer.unref();
		const pending = {
			sessionKey,
			peerId,
			token,
			pluginManifestPaths: Object.freeze([...pluginManifestPaths]),
			child,
			timer,
			promise,
			resolve,
			reject,
		};
		this.#pending.set(sessionKey, pending);
		this.#notifyWorkerCountChanged();
		child.once("error", (error) => this.#failPending(sessionKey, error));
		child.once("exit", (code, signal) => this.#childExited(pending, code, signal));
		return promise;
	}

	#handleCoordinatorEvent(event: CoordinatorConnectionEvent): void {
		if (this.#detached) return;
		if (event.type === "peer_disconnected") {
			this.#markDiscovered(event.peerId);
			const worker = this.#workersByPeer.get(event.peerId);
			if (worker) {
				this.#removeWorker(
					worker,
					worker.expectedStop
						? undefined
						: new Error(`Session worker ${worker.metadata.id} disconnected unexpectedly`),
				);
			}
			const pending = this.#pendingPeer(event.peerId);
			if (pending) this.#failPending(pending.sessionKey, new Error("Session worker disconnected during startup"));
			return;
		}
		if (event.type !== "message" || !Check(SessionWorkerEventSchema, event.payload)) return;
		const message: SessionWorkerEvent = event.payload;
		if (message.type === "worker_failed") {
			const pending = this.#pending.get(message.sessionKey);
			if (pending?.peerId === event.from && pending.token === message.token) {
				this.#failPending(message.sessionKey, new Error(`Session worker failed: ${message.message}`));
			}
			return;
		}
		if (message.type === "demand_applied" || message.type === "demand_rejected") {
			const pending = this.#pendingDemand.get(message.requestId);
			if (
				!pending ||
				pending.worker.peerId !== event.from ||
				pending.worker.token !== message.token ||
				pending.worker.metadata.path !== message.sessionKey ||
				(message.type === "demand_applied" &&
					(pending.attachmentId !== message.attachmentId || pending.attached !== message.attached))
			) {
				return;
			}
			this.#pendingDemand.delete(message.requestId);
			clearTimeout(pending.timer);
			if (message.type === "demand_applied") pending.resolve();
			else pending.reject(new Error(`Session worker rejected demand: ${message.message}`));
			return;
		}
		if (message.type === "chord") {
			const entry = this.#links.get(scopeKey(message.scope));
			if (
				entry?.worker.peerId === event.from &&
				entry.worker.token === message.token &&
				entry.worker.metadata.path === message.sessionKey
			) {
				if (message.frame.t === "bye") {
					this.#links.delete(scopeKey(message.scope));
					entry.link.close(message.frame.reason);
				} else entry.link.send(message.frame);
			}
			return;
		}
		this.#recordReadyWorker(event.from, message);
	}

	#recordReadyWorker(peerId: string, message: Extract<SessionWorkerEvent, { type: "worker_ready" }>): void {
		if (
			message.sessionKey !== message.metadata.path ||
			message.sessionId !== message.metadata.id ||
			!isAbsolute(message.metadata.cwd) ||
			!isAbsolute(message.metadata.path)
		) {
			return;
		}
		this.#markDiscovered(peerId);
		if (this.#retiredPeers.has(peerId)) return;
		const pending = this.#pending.get(message.sessionKey);
		const recorded = this.#workersByPeer.get(peerId);
		if (
			recorded &&
			(recorded.token !== message.token ||
				recorded.pid !== message.pid ||
				recorded.metadata.path !== message.sessionKey)
		)
			return;
		if (
			pending &&
			(pending.peerId !== peerId || pending.token !== message.token || pending.child.pid !== message.pid)
		) {
			return;
		}
		if (message.serviceProtocolVersion !== SESSION_WORKER_SERVICE_PROTOCOL_VERSION) {
			if (recorded) {
				recorded.stopping = true;
				recorded.expectedStop = true;
				this.#closeWorkerLinks(recorded, "Session worker service protocol is incompatible");
			}
			const stopped = this.#retireIncompatibleWorker(peerId, message, pending?.child);
			if (pending) {
				this.#pending.delete(message.sessionKey);
				clearTimeout(pending.timer);
				this.#notifyWorkerCountChanged();
				const error = new Error("Session worker service protocol is incompatible");
				void stopped.then(
					() => pending.reject(error),
					(stopError: unknown) => pending.reject(new AggregateError([error, stopError], error.message)),
				);
			}
			return;
		}
		if (pending && !sameStrings(message.pluginManifestPaths, pending.pluginManifestPaths)) {
			this.#failPending(message.sessionKey, new Error("Session worker started with stale plugin packages"));
			return;
		}
		const existing = this.#workersBySession.get(message.sessionKey);
		if (existing && existing.peerId !== peerId) {
			void this.#coordinator.send(peerId, { type: "shutdown" }).catch(() => {});
			return;
		}
		if ([...this.#retiring.values()].some((retiring) => retiring.metadata.path === message.sessionKey)) {
			// Only a replacement launched after the ownership fence may take this Session.
			if (!pending) return;
		}
		if (existing) return;
		let resolveTerminated!: (error: Error | undefined) => void;
		const terminated = new Promise<Error | undefined>((resolve) => {
			resolveTerminated = resolve;
		});
		const worker: WorkerRecord = {
			peerId,
			metadata: message.metadata,
			pid: message.pid,
			token: message.token,
			pluginManifestPaths: Object.freeze([...message.pluginManifestPaths]),
			terminated,
			resolveTerminated,
			attachmentIds: new Set(),
			expectedStop: false,
			stopping: false,
		};
		this.#workersBySession.set(message.sessionKey, worker);
		this.#workersByPeer.set(peerId, worker);
		for (const [retiringPeer, retiring] of this.#retiring) {
			if (retiring.metadata.path === message.sessionKey) this.#retiring.delete(retiringPeer);
		}
		this.workerPids.set(message.sessionId, message.pid);
		if (pending) {
			this.#pending.delete(message.sessionKey);
			clearTimeout(pending.timer);
			pending.resolve(worker);
		}
		this.#notifyWorkerCountChanged();
	}

	#retireIncompatibleWorker(
		peerId: string,
		message: Extract<SessionWorkerEvent, { type: "worker_ready" }>,
		child: ChildProcess | undefined,
	): Promise<void> {
		// Keep the fence, including failures, for this manager's lifetime. Late readiness cannot revive it.
		this.#retiredPeers.add(peerId);
		const stopped = Promise.resolve().then(async () => {
			await this.#coordinator.send(peerId, { type: "shutdown" }).catch(() => {});
			await this.#waitForIncompatibleWorkerExit(message.pid, child);
			if (this.#detached || this.#coordinator.wasReplaced) throw new Error("Experimental server was replaced");
			// A disconnected socket and a successful signal are not proof that ownership was released.
			// Acquire the same lock as the worker, reclaiming a stale lock only after process exit.
			const release = await lockfile.lock(message.metadata.path, {
				realpath: true,
				stale: 2_000,
				update: 1_000,
				retries: { retries: 320, factor: 1, minTimeout: 25, maxTimeout: 25, maxRetryTime: 8_000 },
			});
			await release();
			const recorded = this.#workersByPeer.get(peerId);
			if (recorded) this.#removeWorker(recorded, undefined);
		});
		this.#retiring.set(peerId, { metadata: message.metadata, stopped });
		void stopped.catch(() => {});
		return stopped;
	}

	async #waitForIncompatibleWorkerExit(pid: number, child: ChildProcess | undefined): Promise<void> {
		let deadline = Date.now() + WORKER_SHUTDOWN_TIMEOUT_MS;
		let killed = false;
		while (true) {
			if (this.#detached || this.#coordinator.wasReplaced) throw new Error("Experimental server was replaced");
			if (child) {
				if (child.exitCode !== null || child.signalCode !== null) return;
			} else {
				try {
					process.kill(pid, 0);
				} catch (error) {
					if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
					throw error;
				}
			}
			if (Date.now() >= deadline) {
				// An adopted PID has no child handle: never risk signalling a reused process ID.
				if (!child || killed) throw new Error("Incompatible Session worker did not exit after shutdown");
				try {
					child.kill("SIGKILL");
				} catch (error) {
					if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
				}
				killed = true;
				deadline = Date.now() + WORKER_SHUTDOWN_TIMEOUT_MS;
			}
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, WORKER_EXIT_POLL_MS);
				timer.unref();
			});
		}
	}

	#childExited(pending: PendingLaunch, code: number | null, signal: NodeJS.Signals | null): void {
		if (this.#pending.get(pending.sessionKey) === pending) {
			this.#failPending(
				pending.sessionKey,
				new Error(`Session worker exited before readiness (${signal ?? code ?? "unknown"})`),
			);
			return;
		}
		const worker = this.#workersByPeer.get(pending.peerId);
		if (worker) {
			this.#removeWorker(
				worker,
				worker.expectedStop
					? undefined
					: new Error(`Session worker ${worker.metadata.id} exited unexpectedly (${signal ?? code ?? "unknown"})`),
			);
		}
	}

	#failPending(sessionKey: string, error: Error): void {
		const pending = this.#pending.get(sessionKey);
		if (!pending) return;
		this.#pending.delete(sessionKey);
		clearTimeout(pending.timer);
		this.#notifyWorkerCountChanged();
		if (pending.child.exitCode === null && pending.child.signalCode === null) pending.child.kill("SIGKILL");
		pending.reject(error);
	}

	#rejectDemand(requestId: string, error: Error): void {
		const pending = this.#pendingDemand.get(requestId);
		if (!pending) return;
		this.#pendingDemand.delete(requestId);
		clearTimeout(pending.timer);
		pending.reject(error);
	}

	async #reconcileDemandTimeout(requestId: string): Promise<void> {
		const pending = this.#pendingDemand.get(requestId);
		if (!pending) return;
		this.#pendingDemand.delete(requestId);
		clearTimeout(pending.timer);
		const timeoutError = new Error("Session worker demand update timed out");
		try {
			await this.#applyDemand(pending.worker, pending.attachmentId, false, false, BACKGROUND_CONTEXT);
			if (pending.attached) pending.reject(timeoutError);
			else pending.resolve();
		} catch (cleanupError) {
			try {
				await this.#stopWorker(pending.worker, BACKGROUND_CONTEXT);
			} catch (stopError) {
				pending.reject(
					new AggregateError(
						[timeoutError, cleanupError, stopError],
						"Session worker demand reconciliation and termination failed",
					),
				);
				return;
			}
			pending.reject(
				new AggregateError(
					[timeoutError, cleanupError],
					"Session worker demand reconciliation failed; worker was terminated",
				),
			);
		}
	}

	#removeWorker(worker: WorkerRecord, error: Error | undefined): void {
		if (this.#workersByPeer.get(worker.peerId) !== worker) return;
		this.#closeWorkerLinks(worker, "Session worker disconnected");
		for (const pending of [...this.#pendingDemand.values()]) {
			if (pending.worker === worker) {
				this.#rejectDemand(pending.requestId, new Error("Session worker disconnected during demand update"));
			}
		}
		this.#workersByPeer.delete(worker.peerId);
		this.#workersBySession.delete(worker.metadata.path);
		if (this.workerPids.get(worker.metadata.id) === worker.pid) this.workerPids.delete(worker.metadata.id);
		worker.resolveTerminated(error);
		this.#notifyWorkerCountChanged();
	}

	#closeWorkerLinks(worker: WorkerRecord, reason: string): void {
		for (const [key, entry] of this.#links) {
			if (entry.worker !== worker) continue;
			this.#links.delete(key);
			entry.link.close(reason);
		}
	}
	#notifyWorkerCountChanged(): void {
		this.#onWorkerCountChanged?.(this.#workersBySession.size + this.#pending.size);
	}

	#pendingPeer(peerId: string): PendingLaunch | undefined {
		return [...this.#pending.values()].find((pending) => pending.peerId === peerId);
	}

	#markDiscovered(peerId: string): void {
		if (!this.#discoveryPeers?.delete(peerId) || this.#discoveryPeers.size !== 0) return;
		this.#resolveDiscovery?.();
	}

	#detachState(): void {
		this.#removeListener();
		for (const entry of this.#links.values()) entry.link.close("Experimental server detached");
		this.#links.clear();
		for (const pending of this.#pendingDemand.values()) {
			clearTimeout(pending.timer);
			pending.resolve();
		}
		this.#pendingDemand.clear();
		this.#pending.clear();
		this.#retiring.clear();
		this.#retiredPeers.clear();
		this.#workersByPeer.clear();
		this.#workersBySession.clear();
		this.workerPids.clear();
		this.#discoveryPeers = undefined;
		this.#resolveDiscovery?.();
		this.#resolveDiscovery = undefined;
	}
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function scopeKey(scope: WorkerOperationScope): string {
	return `${scope.serverConnectionId}\0${scope.attachmentId}`;
}
