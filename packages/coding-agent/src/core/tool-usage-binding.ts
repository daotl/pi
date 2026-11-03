import { basename, dirname, join } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import { canonicalizePath } from "../utils/paths.ts";
import type { ToolDefinition } from "./extensions/types.ts";
import { SessionManager, type UsageEntry } from "./session-manager.ts";

/** Internal capability, kept enumerable so extension definition spreads preserve it. */
export const TOOL_USAGE_BINDER = Symbol("toolUsageBinder");

export type ToolUsageRecorder = (kind: string, provider: string, model: string, usage: Usage) => void;
export type ToolUsageRecorderFactory = () => ToolUsageRecorder;

export interface ToolUsageBinding {
	[TOOL_USAGE_BINDER]: (createRecorder: ToolUsageRecorderFactory, definition: ToolDefinition) => ToolDefinition;
}

/** Bind a fresh definition without changing a reusable extension's definition or options. */
export function bindToolUsage(definition: ToolDefinition, createRecorder: ToolUsageRecorderFactory): ToolDefinition {
	const bindable = definition as ToolDefinition & Partial<ToolUsageBinding>;
	return bindable[TOOL_USAGE_BINDER]?.(createRecorder, definition) ?? definition;
}

interface ToolUsageIdentity {
	readonly key: string;
	readonly file: string | undefined;
	readonly sessionId: string;
	readonly cwd: string;
	readonly sessionDir: string;
}

interface PendingToolUsage {
	ancestorIds: readonly string[];
	/** Pending receipts cannot reload an in-memory destination after its recorder is collected. */
	inMemoryManager: SessionManager | undefined;
	kind: string;
	provider: string;
	model: string;
	usage: Usage;
	notificationId: number | undefined;
}

/** Private persistence ownership; only adopting an AgentSession changes the file's writer. */
export interface ToolUsageManagerOwner {
	readonly id: number;
	readonly manager: SessionManager;
	readonly identity: ToolUsageIdentity;
	notification?: { id: number; notify: (entry: UsageEntry) => void };
}

interface ToolUsageLedger {
	identity: ToolUsageIdentity;
	manager: WeakRef<SessionManager>;
	owner?: WeakRef<ToolUsageManagerOwner>;
	ownerId?: number;
	pending: PendingToolUsage[];
	draining: boolean;
}

const toolUsageLedgers = new Map<string, ToolUsageLedger>();
let nextToolUsageOwnerId = 0;
let nextToolUsageNotificationId = 0;
const toolUsageOwnerCleanup = new FinalizationRegistry<{ key: string; ownerId: number }>(({ key, ownerId }) => {
	const ledger = toolUsageLedgers.get(key);
	if (!ledger || ledger.ownerId !== ownerId) return;
	ledger.owner = undefined;
	ledger.ownerId = undefined;
	if (ledger.pending.length === 0) toolUsageLedgers.delete(key);
});

function toolUsageIdentity(manager: SessionManager): ToolUsageIdentity {
	const path = manager.isPersisted() ? manager.getSessionFile() : undefined;
	const file = path ? canonicalizePath(join(canonicalizePath(dirname(path)), basename(path))) : undefined;
	const sessionId = manager.getSessionId();
	return {
		key: JSON.stringify([file ?? null, sessionId]),
		file,
		sessionId,
		cwd: manager.getCwd(),
		sessionDir: manager.getSessionDir(),
	};
}

function toolUsageLedger(identity: ToolUsageIdentity, manager: WeakRef<SessionManager>): ToolUsageLedger {
	let ledger = toolUsageLedgers.get(identity.key);
	if (!ledger) {
		ledger = { identity, manager, pending: [], draining: false };
		toolUsageLedgers.set(identity.key, ledger);
	}
	return ledger;
}

export function adoptToolUsageManager(manager: SessionManager): ToolUsageManagerOwner {
	const identity = toolUsageIdentity(manager);
	const owner: ToolUsageManagerOwner = { id: ++nextToolUsageOwnerId, manager, identity };
	const ledger = toolUsageLedger(identity, new WeakRef(manager));
	ledger.manager = new WeakRef(manager);
	ledger.owner = new WeakRef(owner);
	ledger.ownerId = owner.id;
	toolUsageOwnerCleanup.register(owner, { key: identity.key, ownerId: owner.id }, owner);
	return owner;
}

export function releaseToolUsageManager(owner: ToolUsageManagerOwner): void {
	owner.notification = undefined;
	toolUsageOwnerCleanup.unregister(owner);
	const ledger = toolUsageLedgers.get(owner.identity.key);
	if (!ledger || ledger.ownerId !== owner.id) return;
	ledger.owner = undefined;
	ledger.ownerId = undefined;
	if (ledger.pending.length === 0) toolUsageLedgers.delete(owner.identity.key);
}

export function setToolUsageNotification(owner: ToolUsageManagerOwner, notify: (entry: UsageEntry) => void): void {
	owner.notification = { id: ++nextToolUsageNotificationId, notify };
}

function drainToolUsage(ledger: ToolUsageLedger, notify: boolean): void {
	if (ledger.draining) return;
	ledger.draining = true;
	try {
		while (ledger.pending.length > 0) {
			const receipt = ledger.pending[0];
			const owner = ledger.owner?.deref();
			const adopted = owner && toolUsageIdentity(owner.manager).key === ledger.identity.key ? owner : undefined;
			// An inspection-only open never takes ownership. With no live owner, reload the file
			// for every publication rather than rewriting the dispatch manager's stale snapshot.
			const manager =
				adopted?.manager ??
				(ledger.identity.file
					? SessionManager.open(ledger.identity.file, ledger.identity.sessionDir, ledger.identity.cwd)
					: (receipt.inMemoryManager ?? ledger.manager.deref()));
			if (!manager || toolUsageIdentity(manager).key !== ledger.identity.key) {
				throw new Error("Tool usage session is no longer available");
			}
			// Resolve against this attempt's writer: edits may remove more of the original
			// lineage between failed publications, and replacement branches never own the call.
			const parentId = receipt.ancestorIds.find((id) => manager.getEntry(id) !== undefined) ?? null;
			const entry = manager.appendUsageAt(parentId, receipt.kind, receipt.provider, receipt.model, receipt.usage);
			// Publication owns the charge now, even if refreshing a disposed view or notifying fails.
			ledger.pending.shift();
			if (!adopted && ledger.identity.file) {
				const previous = ledger.manager.deref();
				if (previous && toolUsageIdentity(previous).key === ledger.identity.key) {
					previous.setSessionFile(ledger.identity.file);
				}
			}
			const notification = adopted?.notification;
			if (
				notify &&
				adopted &&
				ledger.owner?.deref() === adopted &&
				notification &&
				notification.id === receipt.notificationId
			) {
				notification.notify(entry);
			}
		}
	} finally {
		ledger.draining = false;
		if (ledger.pending.length === 0 && !ledger.owner?.deref()) toolUsageLedgers.delete(ledger.identity.key);
	}
}

export function flushToolUsage(owner: ToolUsageManagerOwner, notify: boolean): void {
	const ledger = toolUsageLedgers.get(owner.identity.key);
	if (ledger) drainToolUsage(ledger, notify);
}

/** Reusable definitions stay weak; only dispatched recorders retain in-memory session data. */
export function createToolUsageRecorderFactory(owner: ToolUsageManagerOwner): ToolUsageRecorderFactory {
	const managerRef = new WeakRef(owner.manager);
	const notificationId = owner.notification?.id;
	return () => {
		const manager = managerRef.deref();
		if (!manager) throw new Error("Tool usage session is no longer available");
		return createToolUsageRecorder(manager, managerRef, notificationId);
	};
}

function createToolUsageRecorder(
	manager: SessionManager,
	managerRef: WeakRef<SessionManager>,
	notificationId: number | undefined,
): ToolUsageRecorder {
	const identity = toolUsageIdentity(manager);
	const inMemoryManager = identity.file ? undefined : manager;
	const ancestorIds = manager
		.getBranch()
		.map((entry) => entry.id)
		.reverse();
	return (kind, provider, model, usage) => {
		const ledger = toolUsageLedger(identity, managerRef);
		ledger.pending.push({
			ancestorIds,
			inMemoryManager,
			kind,
			provider,
			model,
			usage: structuredClone(usage),
			notificationId,
		});
		drainToolUsage(ledger, true);
	};
}
