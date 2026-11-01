import type { Connection } from "./connection.ts";
import { ChordError } from "./errors.ts";
import type { HostImpl, PluginRef } from "./host.ts";
import {
	beginReload,
	endReload,
	type Reload,
	type ReloadOptions,
	type ReloadReport,
	type ReloadTransaction,
	reloadError,
} from "./reload.ts";
import { type Frame, toWireError } from "./wire.ts";

// Cross-host reload, coordinated by the server (the host without a parent):
//   server: prepare itself and send `prepare` to every synced child host; collect votes
//   all ok: the server installs its new code version, sends `commit` to every child, and only then starts what may make
// new-code-version calls (tasks, listener and registry callbacks). Links are FIFO, so a child commits before it
//           can receive any frame of a root started in the new code version.
//   any failure or missed vote deadline: `abort` everywhere; each host rolls back to where it was.
// Clients (browsers) are not participants: they see shape/reset pushes, or `upgrade_required`.
// A child that connects behind the server's code version is fenced and reconciled with the same protocol.

let reloadSeq = 0;
const RECONCILE_DEADLINE = 30_000;

const modulesFor = (remote: ReloadOptions["remote"], hostName: string | undefined): string[] => {
	let best: [string, readonly string[]] | undefined;
	for (const entry of Object.entries(remote ?? {})) {
		if (hostName?.startsWith(entry[0]) && (best === undefined || entry[0].length > best[0].length)) best = entry;
	}
	return [...(best?.[1] ?? [])];
};

/** A vote, or its rejection after `deadline` milliseconds. */
function awaitVote(connection: Connection, id: number, deadline: number): Promise<unknown> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const vote = new Promise<unknown>((resolve, reject) => {
		connection.votes.set(id, { resolve, reject });
		timer = setTimeout(() => {
			connection.votes.delete(id);
			reject(new ChordError("aborted", `votes missing after ${deadline} ms`, { reason: "vote_deadline" }));
		}, deadline);
	});
	const settled = vote.finally(() => clearTimeout(timer));
	settled.catch(() => {});
	return settled;
}

/** Phase receipts are registered before prepare is sent; disconnect rejects them like votes. */
function awaitPhase(
	connection: Connection,
	id: number,
	phase: "declared" | "materialized",
	deadline: number,
): Promise<void> {
	const key = `${id}:${phase}`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const ready = new Promise<void>((resolve, reject) => {
		connection.preparations.set(key, { resolve: () => resolve(), reject });
		timer = setTimeout(() => {
			connection.preparations.delete(key);
			reject(new ChordError("aborted", `${phase} missing after ${deadline} ms`, { reason: "vote_deadline" }));
		}, deadline);
	});
	const settled = ready.finally(() => clearTimeout(timer));
	settled.catch(() => {});
	return settled;
}

/** Keep the child in the transaction until rollback finishes, or fence it by disconnecting on a missed receipt. */
async function abortChild(connection: Connection, id: number, deadline: number): Promise<void> {
	if (!connection.open) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const aborted = new Promise<unknown>((resolve, reject) => {
		connection.abortions.set(id, { resolve, reject });
		timer = setTimeout(() => {
			// Settle the deadline failure before close rejects outstanding receipts as unavailable.
			reject(new ChordError("aborted", `rollback missing after ${deadline} ms`, { reason: "vote_deadline" }));
			connection.link.close("reload rollback deadline");
		}, deadline);
	});
	aborted.catch(() => {});
	try {
		connection.send({ t: "abort", reload: id });
		await aborted;
	} catch (error) {
		if (connection.open) connection.link.close("reload rollback failed");
		throw error;
	} finally {
		clearTimeout(timer);
		connection.abortions.delete(id);
	}
}

export async function runClusterReload(
	host: HostImpl,
	plugins: readonly PluginRef[],
	options: ReloadOptions,
): Promise<ReloadReport> {
	// Participants are the children in step now. Fenced children (behind, being reconciled) reconcile to the new code
	// version afterwards; a child whose hello arrives while the reload runs is synced or reconciled once it ends
	// (`HostImpl.peerHello`).
	const synced = [...host.connections].filter(
		(connection) =>
			connection.role === "downstream" && connection.peer.kind === "host" && connection.open && connection.synced,
	);
	const codeVersion = host.peekNextCodeVersion();
	const id = ++reloadSeq;
	const participants = synced.filter((connection) => connection.open);
	const deadline = options.voteDeadline ?? (options.gateDeadline ?? 5000) + (options.retireDeadline ?? 5000) + 5000;
	const phases = new Map<string, Promise<unknown>>();
	const transaction: ReloadTransaction = {
		id: `${host.name}:${codeVersion}:${id}`,
		participants: [host.name, ...participants.map((connection) => connection.name!)],
		async barrier(phase) {
			await phases.get(phase);
			for (const connection of participants) connection.send({ t: "advance", reload: id, phase });
		},
	};
	const reload = await beginReload(host, plugins, options, codeVersion, transaction);
	for (const connection of participants) connection.transaction = transaction.id;
	let aborting: Promise<PromiseSettledResult<void>[]> | undefined;
	const abortParticipants = (): Promise<PromiseSettledResult<void>[]> => {
		aborting ??= Promise.allSettled(participants.map((connection) => abortChild(connection, id, deadline)));
		return aborting;
	};
	try {
		// Retire first: its `retire` frames reach every child before `prepare` (FIFO), so a child never retires a code
		// version this host still runs roots of.
		await reload.waitForRetirement();
		if (participants.some((connection) => !connection.open))
			throw new ChordError("unavailable", "reload participant disconnected during retirement");
		for (const phase of ["declared", "materialized"] as const) {
			const ready = Promise.all(participants.map((connection) => awaitPhase(connection, id, phase, deadline)));
			ready.catch(() => {});
			phases.set(phase, ready);
		}
		// Participant identity is fixed for the transaction; a lost link fails its receipts.
		const votes = participants.map((connection) => {
			const name = connection.name ?? "child";
			const vote = awaitVote(connection, id, deadline);
			connection.send({
				t: "prepare",
				reload: id,
				transaction: transaction.id,
				participants: transaction.participants,
				codeVersion,
				plugins: modulesFor(options.remote, name),
				options: {
					remove: modulesFor(options.remoteRemove, name),
					gateDeadline: options.gateDeadline,
					retireDeadline: options.retireDeadline,
				},
			});
			return vote.then(
				(report) => [name, report as ReloadReport | undefined] as const,
				(error: unknown) => {
					const cause = reloadError(error);
					throw new ChordError(cause.code, `${name}: ${cause.message}`, { cause, reason: cause.reason });
				},
			);
		});
		const preparing = [reload.prepare(), ...votes];
		try {
			await Promise.all(preparing);
		} catch (error) {
			const rollback = reload.rollback();
			for (const connection of participants) {
				// Settle outstanding votes too: their timers and rejection handlers must not outlive this operation.
				connection.votes.get(id)?.reject(error);
				for (const phase of ["declared", "materialized"]) {
					connection.preparations.get(`${id}:${phase}`)?.reject(error);
					connection.preparations.delete(`${id}:${phase}`);
				}
				connection.votes.delete(id);
			}
			// Rollback aborts immediately, then waits for in-flight preparation before restoring the old runtime.
			await Promise.allSettled([...preparing, rollback, abortParticipants()]);
			throw error;
		}
		let report: ReloadReport;
		try {
			report = reload.commit(() => {
				for (const connection of participants) {
					connection.send({ t: "commit", reload: id });
					connection.peerCodeVersion = codeVersion;
				}
			});
		} catch (error) {
			if (host.failed === undefined) {
				await Promise.allSettled([reload.rollback(), abortParticipants()]);
			}
			throw error;
		}
		const children: Record<string, ReloadReport> = {};
		for (const [name, child] of await Promise.all(votes)) {
			if (child !== undefined) children[name] = child;
		}
		host.rememberRemoteModules(options.remote, options.remoteRemove, Object.values(children));
		return { ...report, children };
	} catch (error) {
		if (host.failed === undefined) {
			await Promise.allSettled([reload.rollback(), abortParticipants()]);
		}
		throw error;
	} finally {
		endReload(host);
		for (const connection of participants) {
			for (const phase of ["declared", "materialized"]) {
				connection.preparations.get(`${id}:${phase}`)?.reject(new ChordError("aborted", "reload ended"));
				connection.preparations.delete(`${id}:${phase}`);
			}
		}
		for (const connection of participants)
			if (connection.transaction === transaction.id) connection.transaction = undefined;
	}
}

/**
 * Brings a child that connected behind this host's code version up to it: a reload of the child's modules (the ones
 * cluster reloads gave its name) to this host's current code version, prepared, voted and committed like a cluster
 * reload. Until then the child is fenced: nothing is routed to it. The child's old code is never relabeled as a newer
 * code version.
 */
export async function reconcileChild(host: HostImpl, connection: Connection): Promise<void> {
	for (;;) {
		if (!connection.open) return;
		// Not during a reload of this host: the child is not one of its participants, so whatever it would be synced to
		// now may be superseded by that reload's commit. Recheck once it ended.
		if (host.reloading) {
			await host.whenReloadEnded();
			continue;
		}
		const codeVersion = host.current.id;
		if (connection.peerCodeVersion === codeVersion) {
			connection.markSynced(codeVersion);
			host.announceRetired(connection);
			return;
		}
		// Before `prepare`: the child's prepare first retires its previous code version, which waits for this permission.
		host.announceRetired(connection);
		const id = ++reloadSeq;
		const vote = awaitVote(connection, id, RECONCILE_DEADLINE);
		const transaction = `${host.name}:reconcile:${id}`;
		connection.transaction = transaction;
		const additions = new Map<string, string>();
		const removed = new Set<string>();
		for (const operation of host.remoteHistory) {
			for (const name of modulesFor(operation.remove, connection.name)) {
				removed.add(name);
				additions.delete(name);
			}
			for (const module of modulesFor(operation.remote, connection.name)) {
				const name = host.moduleNames.get(module) ?? module;
				additions.set(name, module);
				removed.delete(name);
			}
		}
		const phases = (["declared", "materialized"] as const).map((phase) =>
			awaitPhase(connection, id, phase, RECONCILE_DEADLINE).then(() =>
				connection.send({ t: "advance", reload: id, phase }),
			),
		);
		for (const phase of phases) phase.catch(() => {});
		connection.send({
			t: "prepare",
			reload: id,
			transaction,
			participants: [host.name, connection.name!],
			codeVersion,
			plugins: [...additions.values()],
			options: { remove: [...removed] },
		});
		let report: ReloadReport | undefined;
		try {
			[report] = await Promise.all([vote as Promise<ReloadReport | undefined>, ...phases]);
		} finally {
			for (const phase of ["declared", "materialized"]) {
				connection.preparations.get(`${id}:${phase}`)?.reject(new ChordError("aborted", "reconciliation ended"));
				connection.preparations.delete(`${id}:${phase}`);
			}
		}
		if (host.current.id !== codeVersion) {
			await abortChild(connection, id, RECONCILE_DEADLINE);
			connection.transaction = undefined;
			continue;
		}
		connection.send({ t: "commit", reload: id });
		for (const [module, name] of report?.moduleNames ?? []) host.moduleNames.set(module, name);
		connection.finishCandidates(transaction, true);
		connection.transaction = undefined;
		connection.peerCodeVersion = codeVersion;
	}
}

/** One prepare the child received, registered before its first await so an abort or disconnect is never lost. */
interface ChildOperation {
	readonly id: number;
	reload: Reload | undefined;
	state: "loading" | "preparing" | "prepared" | "rolling-back";
	cancelled: boolean;
	readonly barriers: Map<string, { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void }>;
}

/**
 * The child side: prepare and vote, then wait for the server's commit or abort. An abort or a lost parent link can
 * arrive at any point: while loading modules, while preparing (pending opens close themselves when they complete),
 * or after the vote. The operation is unwound once its pending work settles, and the reload slot is freed.
 */
export class ChildReloads {
	readonly #host: HostImpl;
	#operation: ChildOperation | undefined;

	constructor(host: HostImpl) {
		this.#host = host;
	}

	handle(connection: Connection, frame: Extract<Frame, { t: "prepare" | "advance" | "commit" | "abort" }>): void {
		if (frame.t === "prepare") {
			if (this.#operation !== undefined) {
				const error = new ChordError("unavailable", "a reload is already running", { reason: "reload_running" });
				connection.send({ t: "vote", reload: frame.reload, error: toWireError(error) });
				return;
			}
			const operation: ChildOperation = {
				id: frame.reload,
				reload: undefined,
				state: "loading",
				cancelled: false,
				barriers: new Map(
					(["declared", "materialized"] as const).map((phase) => {
						const barrier = Promise.withResolvers<void>();
						barrier.promise.catch(() => {});
						return [phase, barrier];
					}),
				),
			};
			connection.transaction = frame.transaction;
			connection.transactionParticipants = frame.participants;
			this.#operation = operation;
			this.#run(operation, connection, frame).catch((error: unknown) => this.#host.report(error));
			return;
		}
		const operation = this.#operation;
		if (operation === undefined || operation.id !== frame.reload) {
			// A failed prepare has already unwound before voting no; its abort is already complete.
			if (frame.t === "abort") connection.send({ t: "aborted", reload: frame.reload });
			return;
		}
		if (frame.t === "advance") {
			operation.barriers.get(frame.phase)?.resolve();
			return;
		}
		if (frame.t === "abort") {
			this.#cancel(operation, connection);
			return;
		}
		if (operation.cancelled || operation.state !== "prepared") return;
		try {
			operation.reload?.commit();
		} catch (error) {
			// The parent has already committed. Rolling back and serving the old code would silently split versions.
			this.#host.fail(error);
			connection.link.close("reload commit failed");
			void operation.reload?.rollback().catch((cleanup: unknown) => this.#host.report(cleanup));
		} finally {
			connection.transaction = undefined;
			connection.transactionParticipants = [];
			this.#operation = undefined;
			endReload(this.#host);
		}
	}

	/** The parent link died: nobody will commit, so roll back (now, or once pending work settles). */
	parentLost(): void {
		if (this.#operation !== undefined) this.#cancel(this.#operation);
	}

	#cancel(operation: ChildOperation, connection?: Connection): void {
		if (operation.cancelled) return;
		operation.cancelled = true;
		for (const barrier of operation.barriers.values()) barrier.reject(new ChordError("aborted", "reload aborted"));
		if (operation.state !== "prepared") {
			// Loading or preparing: #run retains ownership and acknowledges only after unwind.
			operation.reload?.rollback().catch((error: unknown) => this.#host.report(error));
			return;
		}
		operation.state = "rolling-back";
		void operation.reload
			?.rollback()
			.catch((error: unknown) => this.#host.report(error))
			.finally(() => {
				if (this.#operation === operation) this.#operation = undefined;
				if (connection !== undefined) {
					connection.transaction = undefined;
					connection.transactionParticipants = [];
				}
				endReload(this.#host);
				if (connection?.open) connection.send({ t: "aborted", reload: operation.id });
			});
	}

	async #run(
		operation: ChildOperation,
		connection: Connection,
		frame: Extract<Frame, { t: "prepare" }>,
	): Promise<void> {
		const cancelled = (): ChordError =>
			new ChordError("aborted", "reload aborted by the server", { reason: "aborted" });
		try {
			operation.reload = await beginReload(this.#host, frame.plugins, frame.options, frame.codeVersion, {
				id: frame.transaction,
				participants: frame.participants,
				async barrier(phase) {
					connection.send({ t: "prepared", reload: frame.reload, phase });
					await operation.barriers.get(phase)!.promise;
				},
			});
			if (operation.cancelled) throw cancelled();
			operation.state = "preparing";
			await operation.reload.prepare();
			if (operation.cancelled) throw cancelled();
			operation.state = "prepared";
			connection.send({
				t: "vote",
				reload: frame.reload,
				report: {
					...operation.reload.summary(),
					moduleNames: frame.plugins.map((module, index) => [module, operation.reload!.facets[index]!.name]),
				},
			});
		} catch (error) {
			if (operation.reload !== undefined) {
				await operation.reload.rollback().catch((cleanup: unknown) => this.#host.report(cleanup));
				endReload(this.#host);
			}
			connection.transaction = undefined;
			connection.transactionParticipants = [];
			if (this.#operation === operation) this.#operation = undefined;
			if (!operation.cancelled) connection.send({ t: "vote", reload: frame.reload, error: toWireError(error) });
			else if (connection.open) connection.send({ t: "aborted", reload: frame.reload });
		}
	}
}
