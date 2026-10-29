import assert from "node:assert/strict";
import { createHost, memoryLinkPair, replicatedState } from "@earendil-works/chord";
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
