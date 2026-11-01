import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { type ConversationId, createRegistry, type Extension, Harness, type ToolExecutionApi, type Tx } from "../../packages/durable/src/index.ts";
import { openNodeSqliteStorage } from "../../packages/durable/src/storage/sqlite/node.ts";
import { Corpus } from "./github.ts";
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
		runningTasks: new Map(), retriages: new Map(),
		harness: { commit, snapshot: async () => state, conversation: async () => undefined, createConversation: async () => ({
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

test("retriage aborts and joins the paid run before admitting its replacement at concurrency one", async () => {
	const issue: IssueState = { status: "queued", attempt: 0, conversationId: 0, error: "", result: null, triagedAt: "", decision: { priority: "p1", category: "maintainer", at: "saved" } };
	const state = { inboxSince: "", issues: { 1: issue } };
	const tx = { doc: async () => state } as unknown as Tx;
	const commit = async <T>(change: (transaction: Tx) => T | Promise<T>): Promise<T> => change(tx);
	const firstStarted = Promise.withResolvers<void>();
	const secondStarted = Promise.withResolvers<void>();
	const abortStarted = Promise.withResolvers<void>();
	const finishAbort = Promise.withResolvers<void>();
	const firstSettled = Promise.withResolvers<{ status: "answered" }>();
	const secondSettled = Promise.withResolvers<{ status: "answered" }>();
	let submitted = 0;
	let inFlight = 0;
	let peak = 0;
	let triage!: Triage;
	const conversations = [1, 2].map((id) => ({
		id,
		submit: async () => {
			submitted++;
			peak = Math.max(peak, ++inFlight);
			(id === 1 ? firstStarted : secondStarted).resolve();
			return { wait: async () => { await (id === 1 ? firstSettled : secondSettled).promise; inFlight--; return { status: "answered" }; } };
		},
		abort: async () => {
			assert.equal(id, 1);
			abortStarted.resolve();
			await finishAbort.promise;
			firstSettled.resolve({ status: "answered" });
		},
	}));
	let created = 0;
	triage = Object.assign(Object.create(Triage.prototype), {
		options: { concurrency: 1, scriptDir: fileURLToPath(new URL(".", import.meta.url)), corpus: { get: () => ({}) } as unknown as Corpus, model: { provider: "local", modelId: "local" } },
		categories: [], queue: [], active: 0, runningAttempts: new Set(), runningTasks: new Map(), retriages: new Map(), conversations: new Map(),
		harness: { commit, snapshot: async () => state, createConversation: async () => conversations[created++], conversation: async (id: number) => conversations.find((candidate) => candidate.id === id) },
		formatIssue: () => "issue",
	}) as Triage;
	const prototype = Triage.prototype as unknown as { enqueue(this: Triage, number: number): void; extension(this: Triage): Extension };
	prototype.enqueue.call(triage, 1);
	await firstStarted.promise;
	const replacement = triage.retriage(1);
	await abortStarted.promise;
	assert.equal(submitted, 1);
	assert.equal(inFlight, 1);
	const submit = prototype.extension.call(triage).tools?.find((tool) => tool.name === "submit_triage");
	assert.ok(submit?.execute);
	const stale = await submit.execute(recommendation, { conversationId: 1 as ConversationId, commit } as unknown as ToolExecutionApi, BACKGROUND_CONTEXT);
	assert.deepEqual(stale?.control, { terminate: true });
	assert.equal(issue.result, null);
	finishAbort.resolve();
	await replacement;
	await secondStarted.promise;
	assert.equal(peak, 1);
	assert.equal(submitted, 2);
	assert.equal(issue.attempt, 1);
	assert.equal(issue.conversationId, 2);
	assert.deepEqual(issue.decision, { priority: "p1", category: "maintainer", at: "saved" });
	const fresh = await submit.execute({ ...recommendation, summary: "new advice" }, { conversationId: 2 as ConversationId, commit } as unknown as ToolExecutionApi, BACKGROUND_CONTEXT);
	assert.deepEqual(fresh?.control, { terminate: true });
	assert.equal((issue.result as TriageResult | null)?.summary, "new advice");
	secondSettled.resolve({ status: "answered" });
	const tasks = Reflect.get(triage, "runningTasks") as Map<number, Set<Promise<void>>>;
	await Promise.all(tasks.get(1) ?? []);
	assert.equal(triage.queueSize().running, 0);
});

test("restart recovery cannot reclaim a triage completed after the runner's snapshot", { timeout: 10_000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-issues-recovery-"));
	let harness: Harness | undefined;
	t.after(async () => {
		try { await harness?.close(BACKGROUND_CONTEXT); }
		finally { await rm(directory, { recursive: true, force: true }); }
	});
	const corpusPath = join(directory, "corpus.json");
	await writeFile(corpusPath, JSON.stringify({ syncedAt: "2026-01-01T00:00:00Z", issues: { 1: {
		number: 1, title: "Recovered issue", body: "A reproducible bug", state: "open", stateReason: null,
		labels: ["bug"], author: "author", association: "NONE", createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z", comments: 0,
	} } }));
	const triage = new Triage({
		dataDir: directory, scriptDir: fileURLToPath(new URL(".", import.meta.url)), corpus: new Corpus(corpusPath, 1),
		model: { provider: "faux", modelId: "faux-1" }, thinkingLevel: "off", concurrency: 1, inboxDays: 1,
	});
	const prototype = Triage.prototype as unknown as {
		extension(this: Triage): Extension;
		update(this: Triage, number: number, change: (issue: IssueState) => void): Promise<void>;
		run(this: Triage, number: number): Promise<void>;
	};
	const faux = fauxProvider();
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(prototype.extension.call(triage));
	harness = await Harness.open(await openNodeSqliteStorage(join(directory, "triage.sqlite")), { models, registry, settings: {} }, BACKGROUND_CONTEXT);
	Reflect.set(triage, "harness", harness);
	const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "faux", modelId: "faux-1" } } }, BACKGROUND_CONTEXT);
	await prototype.update.call(triage, 1, (issue) => {
		issue.status = "running";
		issue.conversationId = conversation.id;
	});
	const conversations = Reflect.get(triage, "conversations") as Map<number, number>;
	conversations.set(conversation.id, 1);
	const generating = Promise.withResolvers<void>();
	faux.setResponses([(_request, options) => {
		const response = Promise.withResolvers<AssistantMessage>();
		generating.resolve();
		options!.signal!.addEventListener("abort", () => response.reject(options!.signal!.reason), { once: true });
		return response.promise;
	}]);
	const submission = await conversation.submit({ type: "input", content: "Triage issue 1", requestId: "triage:1:0" }, BACKGROUND_CONTEXT);
	await generating.promise;
	await harness.close(BACKGROUND_CONTEXT);

	const recoveredResult = { ...recommendation, category: triage.categories[0]!.name, summary: "recovered advice" };
	faux.setResponses([fauxAssistantMessage(fauxToolCall("submit_triage", recoveredResult), { stopReason: "toolUse" })]);
	harness = await Harness.open(await openNodeSqliteStorage(join(directory, "triage.sqlite")), { models, registry, settings: {} }, BACKGROUND_CONTEXT);
	Reflect.set(triage, "harness", harness);
	const readState = triage.state.bind(triage);
	const snapshotRead = Promise.withResolvers<void>();
	const releaseSnapshot = Promise.withResolvers<void>();
	triage.state = async () => {
		const snapshot = await readState();
		snapshotRead.resolve();
		await releaseSnapshot.promise;
		return snapshot;
	};
	const run = prototype.run.call(triage, 1);
	try {
		await snapshotRead.promise;
		harness.resume();
		const recovered = await harness.submission(submission.id, BACKGROUND_CONTEXT);
		assert.ok(recovered);
		assert.equal((await recovered.wait(BACKGROUND_CONTEXT)).status, "done");
		assert.equal((await readState()).issues[1]!.status, "done");
	} finally {
		releaseSnapshot.resolve();
		await run;
	}
	const final = (await readState()).issues[1]!;
	assert.equal(final.status, "done", "the stale recovery runner must not overwrite the recorded recommendation with failure");
	assert.equal(final.error, "");
	assert.deepEqual(final.result, recoveredResult);
	assert.equal(faux.state.callCount, 2, "recovery must not make another model request");
});
