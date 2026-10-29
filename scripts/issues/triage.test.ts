import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId, Extension, ToolExecutionApi, Tx } from "../../packages/durable/src/index.ts";
import type { Corpus } from "./github.ts";
import { type IssueState, Triage, type TriageResult } from "./triage.ts";

const recommendation: TriageResult = {
	category: "bug", confidence: "high", alternative: "", summary: "old advice", signals: [], duplicates: [], suggestion: "none", reason: "old reason",
};

test("retriage clears superseded output atomically and preserves decisions through failure and success", async () => {
	const issue: IssueState = {
		status: "done", attempt: 0, conversationId: 10, error: "", result: recommendation,
		triagedAt: "2026-01-01T00:00:00Z", decision: { priority: "p1", category: "maintainer", at: "2026-01-02T00:00:00Z" },
	};
	const decision = { ...issue.decision! };
	const state = { inboxSince: "2026-01-01", issues: { 1: issue } };
	const tx = { doc: async () => state } as unknown as Tx;
	const commit = async <T>(change: (transaction: Tx) => T | Promise<T>): Promise<T> => change(tx);
	let nextId = 20;
	let started = Promise.withResolvers<void>();
	let settled = Promise.withResolvers<{ status: "answered" }>();
	const context = Object.assign(Object.create(Triage.prototype), {
		options: { concurrency: 0, scriptDir: fileURLToPath(new URL(".", import.meta.url)), corpus: { get: () => ({}) } as unknown as Corpus, model: { provider: "local", modelId: "local" } },
		categories: [], queue: [], active: 0, runningAttempts: new Set<string>(), conversations: new Map<number, number>([[10, 1]]),
		harness: { commit, snapshot: async () => state, createConversation: async () => ({
			id: nextId++, submit: async () => ({ wait: () => { started.resolve(); return settled.promise; } }),
		}) },
		formatIssue: () => "issue",
	}) as Triage;
	const prototype = Triage.prototype as unknown as { run(this: Triage, number: number): Promise<void>; extension(this: Triage): Extension };
	await context.retriage(1);
	assert.equal(issue.status, "queued");
	assert.equal(issue.result, null);
	assert.equal(issue.triagedAt, "");
	assert.equal(issue.attempt, 1);
	assert.equal(issue.conversationId, 0);
	assert.deepEqual(issue.decision, decision);
	const failedRun = prototype.run.call(context, 1);
	await started.promise;
	assert.equal(issue.status, "running");
	assert.equal(issue.result, null);
	settled.resolve({ status: "answered" });
	await failedRun;
	assert.equal(issue.status, "failed");
	assert.match(issue.error, /no triage submitted/);
	assert.equal(issue.result, null);
	assert.equal(issue.triagedAt, "");
	assert.deepEqual(issue.decision, decision);

	await context.retriage(1);
	started = Promise.withResolvers<void>();
	settled = Promise.withResolvers<{ status: "answered" }>();
	const successfulRun = prototype.run.call(context, 1);
	await started.promise;
	assert.equal(issue.status, "running");
	const submit = prototype.extension.call(context).tools?.find((tool) => tool.name === "submit_triage");
	assert.ok(submit?.execute);
	const replacement: TriageResult = { ...recommendation, summary: "replacement advice", suggestion: "p0" };
	await submit.execute(replacement, { conversationId: issue.conversationId as ConversationId, commit } as unknown as ToolExecutionApi, BACKGROUND_CONTEXT);
	assert.equal(issue.status, "done");
	assert.deepEqual(issue.result, replacement);
	assert.ok(Number.isFinite(Date.parse(issue.triagedAt)));
	assert.deepEqual(issue.decision, decision);
	settled.resolve({ status: "answered" });
	await successfulRun;
	assert.equal(issue.status, "done");
});
