import assert from "node:assert/strict";
import { createHost, replicatedState } from "@earendil-works/chord";
import { onTestFinished, test } from "vitest";
import {
	attachChordView,
	createPicoConversationService,
	createPicoHarnessFacet,
	PicoConversationService,
	type PublishedConversationView,
} from "../../../src/harness/pico3/chord.ts";
import { Harness } from "../../../src/harness/pico3/harness.ts";
import { MemoryStorage } from "../../../src/harness/pico3/memory.ts";
import type { Envelope, JsonObject } from "../../../src/harness/pico3/types.ts";
import { ctx, fake, open, sleep } from "./helpers.ts";

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
	const { commit: _commit, ...published } = bridge.view.value;
	assert.deepEqual(published, fresh.view);
	raw.stop();
});

test("Chord publication failure closes only the bridge and never rejects the persisted writer", async () => {
	const env = await open({});
	onTestFinished(() => env.close());
	let reported: Error | undefined;
	const bridge = await attachChordView(
		env.root,
		(initial) => {
			const state = replicatedState(initial);
			return {
				get value() {
					return state.value;
				},
				subscribe: (listener) => state.subscribe(listener),
				change() {
					throw new Error("publish failed");
				},
				replace() {
					throw new Error("publish failed");
				},
			};
		},
		ctx,
		{
			onFailure: (error) => {
				reported = error;
			},
		},
	);
	onTestFinished(() => bridge.close());
	const input = await env.root.send({ content: "persist anyway" }, ctx);
	assert.equal((await input.wait(ctx)).status, "done");
	await sleep(0);
	assert.equal(bridge.closed, true);
	assert.match(reported?.message ?? "", /publish failed/);
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
