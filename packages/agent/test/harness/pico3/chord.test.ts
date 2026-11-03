import assert from "node:assert/strict";
import { createHost, memoryLinkPair, replicatedState } from "@earendil-works/chord";
import { applyImmutable } from "@earendil-works/chord/delta";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	fauxAssistantMessage,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { onTestFinished, test, vi } from "vitest";
import {
	attachChordView,
	createPicoConversationService,
	createPicoHarnessFacet,
	PicoConversationService,
	type PublishedConversationView,
} from "../../../src/harness/pico3/chord.ts";
import { Harness } from "../../../src/harness/pico3/harness.ts";
import { MemoryStorage } from "../../../src/harness/pico3/memory.ts";
import type { Envelope, JsonObject, Models } from "../../../src/harness/pico3/types.ts";
import { ctx, fake, Gate, open, sleep, tool } from "./helpers.ts";

test("conversation observation reports loaded and newly committed conversations off the Session line", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const ids: number[] = [];
	const stop = env.h.onConversation((conversation) => ids.push(conversation.id));
	onTestFinished(stop);
	assert.deepEqual(ids, [env.root.id]);
	const child = await env.h.createConversation({}, ctx);
	assert.deepEqual(ids, [env.root.id, child.id]);
	stop();
	await env.h.createConversation({}, ctx);
	assert.deepEqual(ids, [env.root.id, child.id]);
});

test("Chord bridge publishes exactly once per Pico envelope and converges to a fresh snapshot", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const raw = await env.root.watch(ctx);
	const envelopes: Envelope[] = [];
	raw.start((envelope) => envelopes.push(envelope));
	const bridge = await attachChordView(env.root, replicatedState, ctx);
	onTestFinished(() => bridge.close());
	const service = createPicoConversationService(env.h, env.root, bridge.view);
	const deliveries: { sequence: number; events: PublishedConversationView["commit"]["events"] }[] = [];
	const unsubscribe = bridge.view.subscribe((value, _context, delivery) => {
		if (delivery.kind === "update") deliveries.push({ sequence: delivery.sequence, events: value.commit.events });
	});
	onTestFinished(unsubscribe);

	await (await env.root.send({ content: "hello" }, ctx)).wait(ctx);
	await env.root.waitForIdle(ctx);
	await sleep(0);
	assert.equal(deliveries.length, envelopes.length);
	assert.deepEqual(
		deliveries.map((delivery) => delivery.sequence),
		deliveries.map((_, index) => index + 1),
	);
	assert.deepEqual(
		deliveries.map((delivery) => delivery.events),
		envelopes.map((envelope) => envelope.events),
	);
	const invalidPatches: JsonObject[] = [
		{ threshold: "not-a-number" },
		{ selectedTools: "not-an-array" },
		{ retry: 5 },
		{ model: null },
		{ steeringMode: "sometimes" },
	];
	for (const patch of invalidPatches) await assert.rejects(service.configSet(patch, ctx), /invalid config value/);
	await assert.rejects(
		service.fork("start", { rewindable: { threshold: "not-a-number" } } as never, ctx),
		/invalid rewindable config value/,
	);
	await service.configSet({ threshold: 123, selectedTools: ["bash"], steeringMode: "all" }, ctx);
	assert.equal((await env.root.config.get(ctx)).threshold, 123);
	const foreign = await env.h.createConversation({}, ctx);
	const foreignInput = await foreign.send({ content: "foreign" }, ctx);
	await assert.rejects(service.inputAbort(foreignInput.id, ctx), /outside conversation/);
	await foreignInput.wait(ctx);
	const fresh = await env.root.watch(ctx);
	fresh.stop();
	const { commit: _commit, publication: _publication, ...published } = bridge.view.value;
	assert.deepEqual(published, fresh.view);
	raw.stop();
});

test("Chord publication failure closes only the bridge and never rejects the persisted writer", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	let reported: Error | undefined;
	const failures: Error[] = [];
	let publicationAttempts = 0;
	const raw = await env.root.watch(ctx);
	const bridge = await attachChordView(
		{ watch: async () => raw },
		(initial) => {
			const state = replicatedState(initial);
			return {
				get value() {
					return state.value;
				},
				subscribe: (listener) => state.subscribe(listener),
				change() {
					publicationAttempts++;
					throw new Error("publish failed");
				},
				replace() {
					publicationAttempts++;
					throw new Error("publish failed");
				},
			};
		},
		ctx,
		{
			onFailure: (error) => {
				reported = error;
				failures.push(error);
			},
		},
	);
	onTestFinished(() => bridge.close());
	const input = await env.root.send({ content: "persist anyway" }, ctx);
	assert.equal((await input.wait(ctx)).status, "done");
	await sleep(0);
	assert.equal(bridge.closed, true);
	assert.match(reported?.message ?? "", /publish failed/);
	assert.equal(raw.closed, true);
	assert.deepEqual(failures, [reported]);
	const attemptsAtFailure = publicationAttempts;
	bridge.close();
	await env.root.write({ kind: "after.publication.failure" }, ctx);
	await sleep(0);
	assert.equal(publicationAttempts, attemptsAtFailure, "a failed bridge must never attempt another publication");
	assert.deepEqual(failures, [reported]);
});

test("an unexpected raw watch stop publishes one terminal fault and no later commits", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const raw = await env.root.watch(ctx);
	const failures: Error[] = [];
	const bridge = await attachChordView({ watch: async () => raw }, replicatedState, ctx, {
		onFailure: (error) => {
			assert.equal(raw.closed, true);
			failures.push(error);
		},
	});
	onTestFinished(() => bridge.close());
	const publications: PublishedConversationView[] = [];
	onTestFinished(
		bridge.view.subscribe((value, _context, delivery) => {
			if (delivery.kind === "update") publications.push(structuredClone(value));
		}),
	);
	raw.stop();
	await raw.ended;
	await sleep(0);
	assert.equal(bridge.closed, true);
	assert.deepEqual(bridge.view.value.publication, { status: "failed", error: "Pico view watch stopped" });
	assert.deepEqual(
		publications.map((value) => value.publication),
		[bridge.view.value.publication],
	);
	assert.deepEqual(bridge.view.value.commit.events, []);
	assert.equal(failures.length, 1);
	assert.equal(failures[0]!.message, "Pico view watch stopped");
	const terminal = structuredClone(bridge.view.value);
	raw.stop();
	bridge.close();
	await env.root.write({ kind: "after.unexpected.stop" }, ctx);
	await sleep(0);
	assert.deepEqual(bridge.view.value, terminal);
	assert.equal(publications.length, 1);
	assert.equal(failures.length, 1);
});

test("startup queue overflow faults the bridge without publishing a buffered prefix or later commits", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const raw = await env.root.watch(ctx);
	for (let index = 0; index < 3; index++) {
		await env.root.write({ kind: "startup.buffered", data: { index } }, ctx);
	}
	const failures: Error[] = [];
	const publications: PublishedConversationView[] = [];
	const bridge = await attachChordView(
		{ watch: async () => raw },
		(initial) => {
			const state = replicatedState(initial);
			onTestFinished(
				state.subscribe((value, _context, delivery) => {
					if (delivery.kind === "update") publications.push(structuredClone(value));
				}),
			);
			return state;
		},
		ctx,
		{
			capacity: 2,
			onFailure: (error) => {
				assert.equal(raw.closed, true);
				failures.push(error);
			},
		},
	);
	onTestFinished(() => bridge.close());
	await sleep(0);
	assert.equal(raw.closed, true);
	assert.equal(bridge.closed, true);
	assert.deepEqual(bridge.view.value.publication, {
		status: "failed",
		error: "Pico-to-Chord view queue exceeded 2 envelopes",
	});
	assert.deepEqual(bridge.view.value.entries, raw.view.entries);
	assert.deepEqual(bridge.view.value.commit.events, []);
	assert.deepEqual(
		publications.map((value) => value.publication),
		[bridge.view.value.publication],
	);
	assert.equal(failures.length, 1);
	assert.equal(failures[0]!.message, "Pico-to-Chord view queue exceeded 2 envelopes");
	const terminal = structuredClone(bridge.view.value);
	await env.root.write({ kind: "after.startup.overflow" }, ctx);
	await sleep(0);
	assert.deepEqual(bridge.view.value, terminal);
	assert.equal(publications.length, 1);
	assert.equal(failures.length, 1);
});

test("intentional bridge close stops the raw watch without fault publication or later delivery", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const raw = await env.root.watch(ctx);
	const failures: Error[] = [];
	const bridge = await attachChordView({ watch: async () => raw }, replicatedState, ctx, {
		onFailure: (error) => failures.push(error),
	});
	onTestFinished(() => bridge.close());
	const publications: PublishedConversationView[] = [];
	onTestFinished(
		bridge.view.subscribe((value, _context, delivery) => {
			if (delivery.kind === "update") publications.push(structuredClone(value));
		}),
	);
	const beforeClose = structuredClone(bridge.view.value);
	bridge.close();
	bridge.close();
	assert.equal(raw.closed, true);
	assert.equal(bridge.closed, true);
	assert.deepEqual(await raw.ended, { reason: "stopped" });
	await env.root.write({ kind: "after.intentional.close" }, ctx);
	await sleep(0);
	assert.deepEqual(bridge.view.value, beforeClose);
	assert.deepEqual(publications, []);
	assert.deepEqual(failures, []);
});

test("projection failure faults a held native Chord conversation without rejecting durable writes", async () => {
	const harness = await Harness.open(new MemoryStorage(), { models: fake({ respond: () => ({ text: "ok" }) }) }, ctx);
	const root = await harness.createConversation({}, ctx);
	const env = { h: harness, root, close: () => harness.close(ctx) };
	onTestFinished(() => env.close());
	const namespace = env.h.namespace<{ fail: boolean }>(
		"test.chord-projection",
		{ sticky: { fail: false } },
		{
			view: (slice) => {
				if (slice.fail) throw new Error("projection failed");
				return { ok: true };
			},
		},
	);
	const host = createHost({ name: "harness", self: null });
	onTestFinished(() => host.close());
	await host.install(createPicoHarnessFacet(env.h));
	const ref = await host.get(PicoConversationService, { conversationId: env.root.id });
	onTestFinished(() => ref.release());
	assert.deepEqual(ref.view.value.publication, { status: "live" });
	await env.root.commit((tx) => {
		tx.plugins(namespace).fail = true;
	}, ctx);
	await sleep(0);
	assert.deepEqual(ref.view.value.publication, { status: "failed", error: "projection failed" });
	assert.equal((await env.root.sticky(ctx)).plugins[namespace.id]?.fail, true);
	await host.root((call) => ref.write({ kind: "note", data: { afterFailure: true } }, call));
	assert.ok(
		(await env.h.entries({ conversationId: env.root.id, limit: 100 }, ctx)).some(
			(entry) => entry.data?.afterFailure === true,
		),
	);
	await env.root.commit((tx) => {
		tx.plugins(namespace).fail = false;
	}, ctx);
	await sleep(0);
	assert.equal(ref.view.value.publication.status, "failed");
	const fresh = await attachChordView(env.root, replicatedState, ctx);
	onTestFinished(() => fresh.close());
	assert.deepEqual(fresh.view.value.publication, { status: "live" });
	assert.ok(fresh.view.value.entries.some((entry) => entry.data?.afterFailure === true));
});

test("native Chord conversation objects retain keyed config and conversation scope", async () => {
	const harness = await Harness.open(new MemoryStorage(), { models: fake({ respond: () => ({ text: "ok" }) }) }, ctx);
	onTestFinished(() => harness.close(ctx));
	const root = await harness.root(ctx);
	const host = createHost({ name: "harness", self: { kind: "harness" } });
	onTestFinished(() => host.close());
	await host.install(createPicoHarnessFacet(harness));
	const child = await harness.createConversation({}, ctx);
	const first = await host.get(PicoConversationService, { conversationId: root.id });
	const second = await host.get(PicoConversationService, { conversationId: child.id });
	onTestFinished(() => {
		first.release();
		second.release();
	});
	await host.root((call) => first.configSet({ threshold: 123 }, call));
	assert.equal((await root.config.get(ctx)).threshold, 123);
	assert.notEqual((await child.config.get(ctx)).threshold, 123);
	await host.root((call) => first.write({ kind: "note", data: { message: "through Chord" } }, call));
	const entries = await host.root((call) => first.entries({ conversationId: child.id, limit: 100 }, call));
	assert.ok(entries.some((entry) => entry.kind === "note" && entry.data?.message === "through Chord"));
	assert.ok(entries.every((entry) => entry.conversationId === root.id));
	await sleep(0);
	assert.equal(first.view.value.conversation.id, root.id);
	assert.equal(second.view.value.conversation.id, child.id);
});

test.each([16 * 1024, 64 * 1024])(
	"native Chord streaming retains raw revisions without adding prefix scans beyond the %i-character source baseline",
	async (prefixSize) => {
		const marker = `native-raw-${prefixSize}:`;
		const chunks = [
			marker + "x".repeat(prefixSize - marker.length),
			...Array.from({ length: 8 }, () => "y".repeat(256)),
		];
		const gates = chunks.map(() => new Gate());
		const finish = new Gate();
		const progress = chunks.map(() => Promise.withResolvers<void>());
		const modelsFor = (streamGates: Gate[], streamFinish: Gate): Models => {
			const fallback = fake({ respond: () => ({ text: "finished" }) });
			let requests = 0;
			return {
				...fallback,
				async *stream(model, request, context): AsyncIterable<AssistantMessageEvent> {
					if (requests++ > 0) {
						yield* fallback.stream(model, request, context);
						return;
					}
					const partial: AssistantMessage = {
						...fauxAssistantMessage(""),
						api: model.api,
						provider: model.provider,
						model: model.id,
						content: [],
					};
					yield { type: "start", partial };
					const call: ToolCall = { type: "toolCall", id: "native-raw-call", name: "write", arguments: {} };
					partial.content = [call];
					yield { type: "toolcall_start", contentIndex: 0, partial };
					for (const [index, rawDelta] of chunks.entries()) {
						await streamGates[index]!.wait(context);
						call.raw = (call.raw ?? "") + rawDelta;
						// JSON whitespace reaches the generation size flush; raw tokens are independent of JSON arguments.
						yield { type: "toolcall_delta", contentIndex: 0, delta: " ".repeat(256), rawDelta, partial };
					}
					await streamFinish.wait(context);
					call.arguments = { v: "ok" };
					yield { type: "toolcall_end", contentIndex: 0, toolCall: call, partial };
					yield { type: "done", reason: "toolUse", message: { ...partial, stopReason: "toolUse" } };
				},
			};
		};
		const countPrefixReads = async (run: () => Promise<void>) => {
			const reads: number[] = [];
			const slice = String.prototype.slice;
			const spy = vi.spyOn(String.prototype, "slice").mockImplementation(function (
				this: string,
				start?: number,
				end?: number,
			) {
				if (start === 0 && end !== undefined && end >= prefixSize && this.length > end && this.startsWith(marker))
					reads.push(end);
				return slice.call(this, start, end);
			});
			try {
				await run();
			} finally {
				spy.mockRestore();
			}
			return { reads: reads.length, characters: reads.reduce((total, length) => total + length, 0) };
		};
		const lengths = chunks.map((_, index) => chunks.slice(0, index + 1).join("").length);
		const sourceGates = chunks.map(() => new Gate());
		const sourceFinish = new Gate();
		const sourceProgress = chunks.map(() => Promise.withResolvers<void>());
		const source = await open({ models: modelsFor(sourceGates, sourceFinish), tools: [tool("write")] });
		onTestFinished(async () => {
			for (const gate of sourceGates) gate.open();
			sourceFinish.open();
			await source.close();
		});
		const sourceWatch = await source.root.watch(ctx);
		onTestFinished(() => sourceWatch.stop());
		let sourceView = sourceWatch.view;
		sourceWatch.start((envelope) => {
			sourceView = applyImmutable(sourceView, envelope.ops);
			const block = sourceView.turn?.message?.content[0];
			if (block?.type !== "toolCall") return;
			const index = lengths.indexOf(block.raw?.length ?? 0);
			if (index >= 0) sourceProgress[index]!.resolve();
		});
		const sourcePrefixReads = await countPrefixReads(async () => {
			const input = await source.root.send({ content: "stream raw tool tokens" }, ctx);
			for (const [index, gate] of sourceGates.entries()) {
				gate.open();
				await sourceProgress[index]!.promise;
				const block = sourceView.turn?.message?.content[0];
				assert.ok(block?.type === "toolCall");
				assert.equal(block.raw, chunks.slice(0, index + 1).join(""));
			}
			sourceFinish.open();
			assert.equal((await input.wait(ctx)).status, "done");
			await source.root.waitForIdle(ctx);
			await sleep(0);
		});
		const env = await open({ models: modelsFor(gates, finish), tools: [tool("write")] });
		const provider = createHost({ name: "harness", self: null });
		const client = createHost({ name: "presentation", kind: "client", self: null });
		onTestFinished(async () => {
			for (const gate of gates) gate.open();
			finish.open();
			await client.close();
			await provider.close();
			await env.close();
		});
		await provider.install(createPicoHarnessFacet(env.h));
		const [up, down] = memoryLinkPair();
		provider.accept(down, { principal: null });
		client.connect(up, { principal: null });
		const ref = await client.get(PicoConversationService, { conversationId: env.root.id });
		onTestFinished(() => ref.release());
		const held = ref.view;
		const raw = await env.root.watch(ctx);
		onTestFinished(() => raw.stop());
		const envelopes: Envelope[] = [];
		raw.start((envelope) => envelopes.push(envelope));
		const deliveries: PublishedConversationView[] = [];
		let replica = held.value;
		const replicas: PublishedConversationView[] = [];
		onTestFinished(
			held.events((event) => {
				if (event.type === "snap") return;
				replica = event.type === "ops" ? applyImmutable(replica, event.ops) : event.value;
				replicas.push(replica);
				const value = event.value;
				deliveries.push(value);
				const block = value.turn?.message?.content[0];
				if (block?.type !== "toolCall") return;
				const index = lengths.indexOf(block.raw?.length ?? 0);
				if (index >= 0) progress[index]!.resolve();
			}),
		);
		const retained: PublishedConversationView[] = [];
		const nativePrefixReads = await countPrefixReads(async () => {
			const input = await env.root.send({ content: "stream raw tool tokens" }, ctx);
			for (const [index, gate] of gates.entries()) {
				gate.open();
				await progress[index]!.promise;
				const value = held.value;
				const block = value.turn?.message?.content[0];
				assert.ok(block?.type === "toolCall");
				assert.equal(block.raw, chunks.slice(0, index + 1).join(""));
				assert.deepEqual(value.publication, { status: "live" });
				retained.push(value);
			}
			finish.open();
			assert.equal((await input.wait(ctx)).status, "done");
			await env.root.waitForIdle(ctx);
			await sleep(0);
		});
		assert.equal(ref.view, held);
		for (const [index, value] of retained.entries()) {
			const block = value.turn?.message?.content[0];
			assert.ok(block?.type === "toolCall");
			assert.equal(block.raw, chunks.slice(0, index + 1).join(""), "published revisions remain immutable");
		}
		assert.equal(deliveries.length, envelopes.length, "one native publication per Pico envelope");
		assert.deepEqual(replicas, deliveries, "native event batches reproduce each published revision in order");
		assert.deepEqual(
			deliveries.map((value) => value.commit.events),
			envelopes.map(({ events }) => events),
		);
		const fresh = await env.root.watch(ctx);
		fresh.stop();
		const { commit: _commit, publication, ...published } = held.value;
		assert.deepEqual(published, fresh.view);
		assert.deepEqual(publication, { status: "live" });
		assert.deepEqual(
			nativePrefixReads,
			sourcePrefixReads,
			"native publication must add zero prefix scans or scanned characters beyond the source-only baseline",
		);
	},
);

test("remote conversation validation rejects malformed messages and edits without committing history", async () => {
	const harness = await Harness.open(new MemoryStorage(), { models: fake({ respond: () => ({ text: "ok" }) }) }, ctx);
	const root = await harness.root(ctx);
	const provider = createHost({ name: "harness", self: null });
	const client = createHost({ name: "presentation", kind: "client", self: null });
	onTestFinished(async () => {
		try {
			await client.close();
		} finally {
			try {
				await provider.close();
			} finally {
				await harness.close(ctx);
			}
		}
	});
	await provider.install(createPicoHarnessFacet(harness));
	const [upstream, downstream] = memoryLinkPair();
	provider.accept(downstream, { principal: "presentation", kind: "client" });
	let wireArgs: unknown;
	let overrideArgs = false;
	client.connect(
		{
			get closed() {
				return upstream.closed;
			},
			send(frame) {
				return upstream.send(frame.t === "call" && overrideArgs ? { ...frame, args: wireArgs } : frame);
			},
			receive: (handler) => upstream.receive(handler),
			onClose: (handler) => upstream.onClose(handler),
			close: (reason) => upstream.close(reason),
		},
		{ principal: "harness" },
	);
	const ref = await client.get(PicoConversationService, { conversationId: root.id });
	const original = await root.context(ctx);
	const assistant = {
		role: "assistant" as const,
		content: [{ type: "text" as const, text: "valid" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "fake-1",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: 1,
	};
	overrideArgs = true;
	for (const malformed of [
		{ kind: "bad", model: [{ role: "assistant", content: null }] },
		{ kind: "bad", model: [{ ...assistant, content: [{ type: "text", text: 42 }] }] },
		{
			kind: "bad",
			model: [{ ...assistant, content: [{ type: "toolCall", id: "call", name: "tool", arguments: null }] }],
		},
		{ kind: "bad", model: [{ role: "user", content: [{ type: "image", data: "base64" }], timestamp: 1 }] },
		{ kind: "bad", edits: [null] },
		{ kind: "bad", edits: [{ target: 0, action: "delete" }] },
		{ kind: "bad", edits: [{ target: 0, action: "replace", messages: [{ ...assistant, content: null }] }] },
	]) {
		wireArgs = malformed;
		await assert.rejects(
			client.root((call) => ref.write({ kind: "valid" }, call)),
			{ code: "invalid", reason: "args" },
		);
		assert.deepEqual(await root.context(ctx), original);
	}
	for (const constrainedSampling of [
		null,
		[],
		{ type: "grammar", variants: [] },
		true,
		"json_schema",
		{},
		{ type: "unsupported" },
		{ type: "json_schema" },
		{ type: "json_schema", strict: "sometimes" },
		{ type: "json_schema", strict: true },
		{ type: "grammar" },
		{ type: "grammar", variants: null },
		{ type: "grammar", variants: "grammar" },
		{ type: "grammar", variants: { openai_lark: 42 } },
		{ type: "grammar", variants: { openai_regex: false } },
	]) {
		wireArgs = {
			kind: "bad-sampling",
			model: [
				{
					role: "system",
					content: "instructions",
					timestamp: 1,
					toolsAdded: [{ name: "tool", description: "a tool", parameters: {}, constrainedSampling }],
				},
			],
		};
		await assert.rejects(
			client.root((call) => ref.write({ kind: "valid" }, call)),
			{ code: "invalid", reason: "args" },
		);
		assert.deepEqual(await root.context(ctx), original);
	}
	for (const content of [
		null,
		[{ type: "text", text: null }],
		[{ type: "image", data: "base64" }],
		[{ type: "toolCall" }],
	]) {
		wireArgs = { content };
		await assert.rejects(
			client.root((call) => ref.send({ content: "valid" }, call)),
			{ code: "invalid", reason: "args" },
		);
		assert.deepEqual(await root.context(ctx), original);
	}
	overrideArgs = false;
	await client.root((call) => ref.write({ kind: "valid", model: [assistant] }, call));
	const committed = await root.context(ctx);
	assert.deepEqual(committed.messages, [...original.messages, assistant]);
	const target = committed.entries.at(-1)!.id;
	const replacement = {
		role: "user" as const,
		content: [{ type: "text" as const, text: "replacement" }],
		timestamp: 2,
	};
	await assert.rejects(
		client.root((call) =>
			ref.write({ kind: "edit", edits: [{ target, action: "replace", messages: [replacement] }] }, call),
		),
		/edits are core only/,
	);
	assert.deepEqual(await root.context(ctx), committed);
	const toolAssistant = {
		...assistant,
		content: [
			{ type: "thinking" as const, thinking: "plan", thinkingSignature: "signature" },
			{ type: "toolCall" as const, id: "call", name: "tool", arguments: { value: [null, true, 1] } },
		],
		stopReason: "toolUse" as const,
	};
	const samplingConfigurations = [
		false,
		{ type: "json_schema", strict: "prefer" },
		{ type: "json_schema", strict: "require" },
		{ type: "grammar", variants: {} },
		{ type: "grammar", variants: { openai_lark: 'start: "ok"' } },
		{ type: "grammar", variants: { openai_regex: "^ok$" } },
		{ type: "grammar", variants: { openai_lark: 'start: "ok"', openai_regex: "^ok$" } },
	] as const;
	const messages = [
		{
			role: "system" as const,
			content: "instructions",
			timestamp: 3,
			toolsAdded: [
				{
					name: "tool",
					description: "a tool",
					parameters: { type: "object" },
				},
				...samplingConfigurations.map((constrainedSampling, index) => ({
					name: `constrained-tool-${index}`,
					description: "a constrained tool",
					parameters: { type: "object" },
					constrainedSampling,
				})),
			],
		},
		replacement,
		toolAssistant,
		{
			role: "toolResult" as const,
			toolCallId: "call",
			toolName: "tool",
			isError: false,
			timestamp: 4,
			content: [{ type: "image" as const, data: "base64", mimeType: "image/png" }],
			details: null,
		},
	];
	await client.root((call) => ref.write({ kind: "valid-unions", model: messages }, call));
	assert.deepEqual((await root.context(ctx)).messages, [...original.messages, assistant, ...messages]);
});

test("a wide namespace commit keeps held Chord views live through the tracker root fallback", async () => {
	const harness = await Harness.open(new MemoryStorage(), { models: fake({ respond: () => ({ text: "ok" }) }) }, ctx);
	onTestFinished(() => harness.close(ctx));
	const fields = Object.fromEntries(Array.from({ length: 4200 }, (_, index) => [`field${index}`, 0]));
	const namespace = harness.namespace<Record<string, number>>(
		"test.wide-chord-view",
		{ sticky: fields },
		{ view: (slice) => ({ ...slice }) },
	);
	const conversation = await harness.createConversation({}, ctx);
	const host = createHost({ name: "harness", self: null });
	onTestFinished(() => host.close());
	await host.install(createPicoHarnessFacet(harness));
	const ref = await host.get(PicoConversationService, { conversationId: conversation.id });
	onTestFinished(() => ref.release());
	const held = ref.view;
	const initial = held.value;
	const raw = await conversation.watch(ctx);
	onTestFinished(() => raw.stop());
	const envelopes: Envelope[] = [];
	raw.start((envelope) => envelopes.push(envelope));
	const deliveries: PublishedConversationView[] = [];
	let replica = initial;
	const replicas: PublishedConversationView[] = [];
	onTestFinished(
		held.events((event) => {
			if (event.type === "snap") return;
			replica = event.type === "ops" ? applyImmutable(replica, event.ops) : event.value;
			replicas.push(replica);
			deliveries.push(event.value);
		}),
	);
	await conversation.commit((tx) => {
		const slice = tx.plugins(namespace);
		for (let index = 0; index < 4200; index++) slice[`field${index}`] = 1;
	}, ctx);
	await sleep(0);
	assert.ok(envelopes.some((envelope) => envelope.ops.some((op) => op[0] === "r")));
	assert.deepEqual(ref.view.value.publication, { status: "live" });
	assert.equal(deliveries.length, envelopes.length);
	const fresh = await conversation.watch(ctx);
	fresh.stop();
	const { commit, publication: _publication, ...published } = ref.view.value;
	assert.deepEqual(published, fresh.view);
	assert.deepEqual(commit.events, envelopes.at(-1)!.events);
	await conversation.commit((tx) => {
		tx.plugins(namespace).field0 = 2;
	}, ctx);
	await sleep(0);
	assert.deepEqual(ref.view.value.publication, { status: "live" });
	const next = await conversation.watch(ctx);
	next.stop();
	const { commit: _nextCommit, publication: _nextPublication, ...nextPublished } = ref.view.value;
	assert.deepEqual(nextPublished, next.view);
	assert.equal(ref.view, held);
	assert.equal((initial.plugins[namespace.id] as Record<string, number>).field0, 0);
	assert.equal((deliveries[0]!.plugins[namespace.id] as Record<string, number>).field0, 1);
	assert.equal(deliveries.length, envelopes.length);
	assert.deepEqual(replicas, deliveries, "native root fallback and later event batches remain ordered");
	assert.deepEqual(
		deliveries.map((value) => value.commit.events),
		envelopes.map((envelope) => envelope.events),
	);
	assert.deepEqual(
		deliveries.map((value) => value.publication),
		deliveries.map(() => ({ status: "live" })),
	);
});

test("linked Pico writes preserve reserved JSON data names without aliasing or prototype pollution", async () => {
	const harness = await Harness.open(new MemoryStorage(), { models: fake({ respond: () => ({ text: "ok" }) }) }, ctx);
	const conversation = await harness.createConversation({}, ctx);
	const provider = createHost({ name: "harness", self: null });
	const client = createHost({ name: "presentation", kind: "client", self: null });
	onTestFinished(async () => {
		await client.close();
		await provider.close();
		await harness.close(ctx);
	});
	await provider.install(createPicoHarnessFacet(harness));
	const [up, down] = memoryLinkPair();
	provider.accept(down, { principal: null });
	client.connect(up, { principal: null });
	const ref = await client.get(PicoConversationService, { conversationId: conversation.id });
	const data = JSON.parse(
		'{"constructor":"recorded","prototype":"value","__proto__":{"polluted":true},"nested":{"constructor":"nested"}}',
	);
	await ref.write({ kind: "review.reserved-json", data });
	const entries = await harness.entries({ conversationId: conversation.id, limit: 100 }, ctx);
	const notes = entries.filter((entry) => entry.kind === "review.reserved-json");
	assert.equal(notes.length, 1);
	const stored = notes[0];
	assert.deepEqual(stored.data, data);
	assert.notEqual(stored.data, data);
	assert.notEqual(stored.data!.nested, data.nested);
	assert.equal(Object.hasOwn(stored.data!, "__proto__"), true);
	assert.equal(Object.getPrototypeOf(stored.data), Object.prototype);
	assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("a bridge root replacement applies trailing ops and that envelope's events in one publication", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	const raw = await env.root.watch(ctx);
	let publish: (envelope: Envelope) => void = () => {};
	const bridge = await attachChordView(
		{
			watch: async () => ({
				get view() {
					return raw.view;
				},
				get revision() {
					return raw.revision;
				},
				get closed() {
					return raw.closed;
				},
				ended: raw.ended,
				start: (listener) => {
					publish = listener;
				},
				stop: () => raw.stop(),
			}),
		},
		replicatedState,
		ctx,
	);
	onTestFinished(() => bridge.close());
	const deliveries: PublishedConversationView[] = [];
	onTestFinished(
		bridge.view.subscribe((value, _context, delivery) => {
			if (delivery.kind === "update") deliveries.push(structuredClone(value));
		}),
	);
	const replacement = structuredClone(raw.view);
	replacement.plugins = { replaced: true };
	const events: Envelope["events"] = [{ type: "turn.started", inputs: [] }];
	publish({
		revision: 1,
		ops: [
			["r", replacement as never],
			["s", ["plugins", "afterRoot"], "applied"],
		],
		events,
	});
	await sleep(0);
	assert.equal(deliveries.length, 1);
	assert.deepEqual(bridge.view.value.plugins, { replaced: true, afterRoot: "applied" });
	assert.deepEqual(bridge.view.value.publication, { status: "live" });
	assert.deepEqual(bridge.view.value.commit.events, events);
});
