import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolvePath } from "../utils/paths.ts";
import {
	CURRENT_SESSION_VERSION,
	type SessionHeader,
	type SessionManager,
	type UsageEntry,
} from "./session-manager.ts";

type TrailingEntries = (parentId: string | null, timestamp: string) => readonly object[];

/** Serialize selected ancestry, its usage-only side chains and optional export-only entries, preserving selection. */
export function serializeSessionBranch(
	sessionManager: SessionManager,
	createTrailingEntries?: TrailingEntries,
): string {
	const timestamp = new Date().toISOString();
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: sessionManager.getSessionId(),
		timestamp,
		cwd: sessionManager.getCwd(),
	};
	const entries: object[] = [header];
	const branch = sessionManager.getBranch();
	const storedEntries = sessionManager.getEntries();
	const included = new Set(branch.map((entry) => entry.id));
	const usageByParent = new Map<string | null, UsageEntry[]>();
	for (const entry of storedEntries) {
		if (entry.type !== "usage") continue;
		const siblings = usageByParent.get(entry.parentId);
		if (siblings) siblings.push(entry);
		else usageByParent.set(entry.parentId, [entry]);
	}
	// Only usage-only descendants of the selected lineage belong to this branch's export.
	const parents: (string | null)[] = branch.length > 0 ? branch.map((entry) => entry.id) : [null];
	for (let index = 0; index < parents.length; index++) {
		for (const entry of usageByParent.get(parents[index]) ?? []) {
			if (included.has(entry.id)) continue;
			included.add(entry.id);
			parents.push(entry.id);
		}
	}
	let parentId: string | null = null;
	const written = new Set<string>();
	for (const entry of branch) {
		entries.push({ ...entry, parentId });
		written.add(entry.id);
		parentId = entry.id;
	}
	for (const entry of storedEntries) {
		if (!included.has(entry.id) || written.has(entry.id)) continue;
		entries.push(entry);
		written.add(entry.id);
		parentId = entry.id;
	}
	const selected = sessionManager.getLeafId();
	const trailing = createTrailingEntries?.(selected, timestamp) ?? [];
	entries.push(...trailing);
	if (trailing.length === 0 && parentId !== selected) entries.push({ type: "leaf", leafId: selected });
	return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

/** Write the current session branch and optional export-only entries as JSONL. */
export function exportSessionToJsonl(
	sessionManager: SessionManager,
	outputPath?: string,
	createTrailingEntries?: TrailingEntries,
): string {
	const filePath = resolvePath(
		outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
		process.cwd(),
	);
	const dir = dirname(filePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, serializeSessionBranch(sessionManager, createTrailingEntries));
	return filePath;
}
