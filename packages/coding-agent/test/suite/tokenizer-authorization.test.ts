import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, normalizeContext, toToolDeclaration } from "@earendil-works/pi-ai";
import { streamSimple as streamNative } from "@earendil-works/pi-ai/api/openai-completions";
import { afterEach, expect, it, vi } from "vitest";
import type { CompactionEntry, SessionManager } from "../../src/core/session-manager.ts";
import { createHarness, type HarnessOptions } from "./harness.ts";
import { createNativeTokenizerFixture, privateMarker } from "./tokenizer-fixture.ts";

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
	vi.unstubAllGlobals();
});

async function nativeFixture(options: HarnessOptions = {}) {
	const fixture = await createNativeTokenizerFixture(options);
	cleanups.push(fixture.cleanup);
	return fixture;
}

function checkpoint(manager: SessionManager): CompactionEntry {
	const entry = manager.getBranch().findLast((entry) => entry.type === "compaction");
	if (entry?.type !== "compaction") throw new Error("Missing committed checkpoint");
	return entry;
}

it("retains native summary and full chat-template counting", async () => {
	const fixture = await nativeFixture();
	await fixture.session.compact({ keepRecentMessages: 2 });
	expect(checkpoint(fixture.manager).summaryTokens).toBe(42);
	expect(fixture.session.getContextUsage()?.tokens).toBe(100);
	const full = fixture.uploads.find((request) => request.url.endsWith("/chat/completions/input_tokens"));
	expect(full?.authorization).toBe("Bearer offline-tokenizer-key");
	expect(JSON.parse(full!.body)).toMatchObject({
		model: "local",
		messages: expect.arrayContaining([expect.objectContaining({ role: "user" })]),
	});
	expect(fixture.summaries).toHaveLength(1);
});

it.each(["payload", "headers", "host", "stream", "provider"] as const)(
	"does not bypass %s policy for any tokenizer upload",
	async (policy) => {
		const fixture = await nativeFixture({
			extensionFactories: [
				(pi) => {
					if (policy === "payload")
						pi.on("before_provider_request", (event) =>
							JSON.parse(JSON.stringify(event.payload).replaceAll(privateMarker, "REDACTED")),
						);
					if (policy === "headers")
						pi.on("before_provider_headers", (event) => {
							event.headers.Authorization = null;
						});
				},
			],
		});
		if (policy === "host")
			fixture.session.agent.onPayload = (payload) =>
				JSON.parse(JSON.stringify(payload).replaceAll(privateMarker, "REDACTED"));
		if (policy === "stream") {
			const stream = fixture.session.agent.streamFunction;
			fixture.session.agent.streamFunction = (...args) => stream(...args);
		}
		if (policy === "provider") {
			const stream = fixture.provider.streamSimple;
			fixture.provider.streamSimple = (...args) => stream(...args);
		}
		await fixture.session.compact({ keepRecentTokens: 1 });
		expect(fixture.summaries).toHaveLength(1);
		if (policy === "headers") expect(fixture.summaries[0].authorization).toBeNull();
		if (policy === "payload" || policy === "host") expect(fixture.summaries[0].body).not.toContain(privateMarker);
		expect(fixture.uploads).toEqual([]);
		expect(checkpoint(fixture.manager).summaryTokens).toBeUndefined();
	},
);

it.each(["transform", "converter"] as const)(
	"proves complete history before fragment counting under %s redaction",
	async (policy) => {
		const fixture = await nativeFixture();
		const redact = (messages: AgentMessage[]) =>
			messages.some((message) => message.role === "system")
				? messages.filter((message) => !JSON.stringify(message).includes(privateMarker))
				: messages;
		if (policy === "transform") {
			const transform = fixture.session.agent.transformContext;
			fixture.session.agent.transformContext = async (messages, signal) =>
				redact(transform ? await transform(messages, signal) : messages);
		} else {
			const convert = fixture.session.agent.convertToLlm;
			fixture.session.agent.convertToLlm = (messages) => convert(redact(messages));
		}
		await fixture.session.compact({ keepRecentTokens: 30 });
		expect(fixture.summaries).toHaveLength(1);
		expect(fixture.summaries[0].body).not.toContain(privateMarker);
		for (const upload of fixture.uploads) expect(upload.body).not.toContain(privateMarker);
		expect(fixture.uploads.some((upload) => upload.url.endsWith("/chat/completions/input_tokens"))).toBe(true);
	},
);

it.each(["payload", "headers", "host", "stream", "context", "converter", "none"] as const)(
	"revalidates late %s policy after a transient preparation upload",
	async (policy) => {
		let activate = () => {};
		const fixture = await nativeFixture({
			settings: { compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
			extensionFactories: [
				(pi) => {
					activate = () => {
						if (policy === "payload")
							pi.on("before_provider_request", (event) => ({ ...(event.payload as object), messages: [] }));
						if (policy === "headers")
							pi.on("before_provider_headers", (event) => {
								event.headers.Authorization = null;
							});
					};
				},
			],
		});
		let first = true;
		fixture.setTokenizer(async (url) => {
			if (first) {
				first = false;
				activate();
				if (policy === "host")
					fixture.session.agent.onPayload = (payload) => ({ ...(payload as object), messages: [] });
				if (policy === "stream") {
					const stream = fixture.session.agent.streamFunction;
					fixture.session.agent.streamFunction = (...args) => stream(...args);
				}
				const redact = (messages: AgentMessage[]) =>
					messages.some((message) => message.role === "system")
						? messages.filter((message) => !JSON.stringify(message).includes(privateMarker))
						: messages;
				if (policy === "context") {
					const transform = fixture.session.agent.transformContext;
					fixture.session.agent.transformContext = async (messages, signal) =>
						redact(transform ? await transform(messages, signal) : messages);
				}
				if (policy === "converter") {
					const convert = fixture.session.agent.convertToLlm;
					fixture.session.agent.convertToLlm = (messages) => convert(redact(messages));
				}
				return new Response("retry", { status: 503 });
			}
			return url.endsWith("/tokenize") ? Response.json({ tokens: [1] }) : Response.json({ input_tokens: 100 });
		});
		await fixture.session.compact({ keepRecentTokens: 1 });
		expect(fixture.summaries).toHaveLength(1);
		const firstBody = fixture.uploads[0]?.body;
		expect(firstBody).toBeDefined();
		if (policy === "none") expect(fixture.uploads.slice(1).map((upload) => upload.body)).toContain(firstBody);
		else if (policy === "context" || policy === "converter") {
			for (const upload of fixture.uploads.slice(1)) expect(upload.body).not.toContain(privateMarker);
			expect(fixture.summaries[0].body).not.toContain(privateMarker);
		} else expect(fixture.uploads).toHaveLength(1);
	},
);

it.each(["transform", "converter"] as const)(
	"isolates canonical retained messages from in-place %s counting",
	async (policy) => {
		const fixture = await nativeFixture();
		const mutate = (messages: AgentMessage[]) => {
			for (const message of messages) if (message.role === "user") message.content = "safe replacement";
			return messages;
		};
		if (policy === "transform") {
			const transform = fixture.session.agent.transformContext;
			fixture.session.agent.transformContext = async (messages, signal) =>
				mutate(transform ? await transform(messages, signal) : messages);
		} else {
			const convert = fixture.session.agent.convertToLlm;
			fixture.session.agent.convertToLlm = (messages) => convert(mutate(messages));
		}
		const before = structuredClone(fixture.manager.getEntries());
		await fixture.session.compact({ keepRecentMessages: 2 });
		for (const original of before) expect(fixture.manager.getEntry(original.id)).toEqual(original);
	},
);

it.each(["faux", "openai-completions"])("never dispatches HTTP for a scripted %s compaction", async (api) => {
	const harness = await createHarness({ fauxApi: api, settings: { retry: { enabled: false } } });
	cleanups.push(harness.cleanup);
	harness.session.agent.onPayload = undefined;
	for (let index = 0; index < 4; index++) {
		harness.sessionManager.appendMessage({ role: "user", content: `question ${index}`, timestamp: index });
		harness.sessionManager.appendMessage(fauxAssistantMessage(`answer ${index}`));
	}
	harness.session.refreshContext();
	harness.setResponses([fauxAssistantMessage("offline checkpoint")]);
	const urls: string[] = [];
	vi.stubGlobal("fetch", async (input: string | URL | Request) => {
		urls.push(String(input));
		return new Response("unexpected", { status: 404 });
	});
	await harness.session.compact({ keepRecentTokens: 1 });
	expect(checkpoint(harness.sessionManager).summary).toContain("offline checkpoint");
	expect(urls).toEqual([]);
});

it.each(["auth", "converter"] as const)("rechecks history policy after awaited %s work", async (gate) => {
	const fixture = await nativeFixture();
	const started = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	let active = false;
	const transform = fixture.session.agent.transformContext;
	fixture.session.agent.transformContext = async (messages, signal) => {
		const transformed = transform ? await transform(messages, signal) : messages;
		return active ? transformed.filter((message) => !JSON.stringify(message).includes(privateMarker)) : transformed;
	};
	let waiting = true;
	const realAuth = fixture.session.modelRuntime.getAuth.bind(fixture.session.modelRuntime);
	const gatedAuth = vi.spyOn(fixture.session.modelRuntime, "getAuth").mockImplementation(async (model, options) => {
		if (gate === "auth" && waiting) {
			waiting = false;
			started.resolve();
			await released.promise;
		}
		return realAuth(model, options);
	});
	if (gate === "converter") {
		const convert = fixture.session.agent.convertToLlm;
		fixture.session.agent.convertToLlm = async (messages) => {
			const converted = await convert(messages);
			if (waiting) {
				waiting = false;
				started.resolve();
				await released.promise;
			}
			return converted;
		};
	}
	const running = fixture.session.compact({ keepRecentTokens: 1 });
	const outcome = running.then(
		(result) => ({ result }),
		(error: unknown) => ({ error }),
	);
	try {
		await Promise.race([
			started.promise,
			outcome.then(() => {
				throw new Error("Authorization gate did not start");
			}),
		]);
		active = true;
		released.resolve();
		expect(await outcome).toMatchObject({ result: { summary: "safe checkpoint" } });
		for (const upload of fixture.uploads) expect(upload.body).not.toContain(privateMarker);
		expect(fixture.summaries[0].body).not.toContain(privateMarker);
	} finally {
		released.resolve();
		await outcome;
		gatedAuth.mockRestore();
	}
});

it.each(["manual", "automatic"] as const)(
	"never counts a policy-filtered extension checkpoint during %s compaction",
	async (mode) => {
		const fixture = await nativeFixture({
			settings: { compaction: { enabled: true, keepRecentTokens: 1 }, retry: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("context_with_system", (event) => ({
						messages: event.messages.filter(
							(message) => !JSON.stringify(message).includes("PRIVATE_EXTENSION_SUMMARY"),
						),
					}));
					pi.on("session_before_compact", (event) => ({
						compaction: {
							summary: "PRIVATE_EXTENSION_SUMMARY",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					}));
				},
			],
		});
		if (mode === "manual") await fixture.session.compact({ keepRecentMessages: 2 });
		else {
			fixture.owner.settingsManager.setCompactionEnabled(true);
			fixture.setResponses([
				fauxAssistantMessage("", { stopReason: "error", errorMessage: "maximum context length exceeded" }),
			]);
			await fixture.session.prompt("overflow");
		}
		expect(checkpoint(fixture.manager).summary).toBe("PRIVATE_EXTENSION_SUMMARY");
		expect(checkpoint(fixture.manager).summaryTokens).toBeUndefined();
		for (const upload of fixture.uploads) expect(upload.body).not.toContain("PRIVATE_EXTENSION_SUMMARY");
	},
);

it("keeps policy removal of system and tools authoritative for chat counting", async () => {
	const fixture = await nativeFixture({ initialActiveToolNames: ["read"] });
	fixture.manager.appendMessage({
		role: "system",
		content: "",
		toolsAdded: fixture.session.agent.state.tools.map(toToolDeclaration),
		timestamp: 29,
	});
	fixture.session.refreshContext();
	const transform = fixture.session.agent.transformContext;
	fixture.session.agent.transformContext = async (messages, signal) =>
		(transform ? await transform(messages, signal) : messages).filter((message) => message.role !== "system");
	await fixture.session.compact({ keepRecentMessages: 2 });
	const full = fixture.uploads.find((request) => request.url.endsWith("/chat/completions/input_tokens"));
	expect(full).toBeDefined();
	const body = JSON.parse(full!.body);
	expect(body.tools).toBeUndefined();
	expect(fixture.session.agent.state.tools.map((tool) => tool.name)).toContain("read");
	expect(body.messages.some((message: { role: string }) => message.role === "system")).toBe(false);
	expect(full!.body).not.toContain("toolsAdded");
});

it("retains multimodal content and effective tools in chat-template counting", async () => {
	const fixture = await nativeFixture({ initialActiveToolNames: ["read"] });
	const selected = fixture.session.model;
	if (!selected || selected.api !== "openai-completions") throw new Error("Missing native model");
	const model = {
		...selected,
		api: "openai-completions" as const,
		samplingParams: { chat_template_kwargs: { enable_thinking: false, custom_prompt: "wire-format" } },
	};
	await fixture.session.setModel(model);
	fixture.manager.appendMessage({
		role: "system",
		content: "",
		toolsAdded: fixture.session.agent.state.tools.map(toToolDeclaration),
		timestamp: 29,
	});
	fixture.manager.appendMessage({
		...fauxAssistantMessage({
			type: "toolCall",
			id: "retained-read",
			name: "read",
			arguments: { path: "image.png" },
		}),
		api: model.api,
		provider: model.provider,
		model: model.id,
		stopReason: "toolUse",
	});
	fixture.manager.appendMessage({
		role: "toolResult",
		toolCallId: "retained-read",
		toolName: "read",
		content: [{ type: "text", text: "retained tool output" }],
		isError: false,
		timestamp: 29,
	});
	fixture.manager.appendMessage({
		role: "user",
		content: [
			{ type: "text", text: "retained image" },
			{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
		],
		timestamp: 30,
	});
	fixture.session.refreshContext();
	await fixture.session.compact({ keepRecentMessages: 4 });
	const full = fixture.uploads.find((request) => request.url.endsWith("/chat/completions/input_tokens"));
	expect(full).toBeDefined();
	const counted = JSON.parse(full!.body);
	expect(counted.messages).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ role: "tool", tool_call_id: "retained-read", content: "retained tool output" }),
			expect.objectContaining({
				role: "assistant",
				tool_calls: [
					expect.objectContaining({
						type: "function",
						function: { name: "read", arguments: '{"path":"image.png"}' },
					}),
				],
			}),
			expect.objectContaining({
				role: "user",
				content: [
					{ type: "text", text: "retained image" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
				],
			}),
		]),
	);
	expect(counted.tools).toEqual([
		expect.objectContaining({
			type: "function",
			function: expect.objectContaining({ name: "read", parameters: expect.objectContaining({ type: "object" }) }),
		}),
	]);
	expect(counted.chat_template_kwargs).toEqual(model.samplingParams.chat_template_kwargs);
	const messages = await fixture.session.agent.convertForRequest(
		structuredClone(fixture.session.agent.state.messages),
	);
	const result = await streamNative(model, normalizeContext({ messages }), {
		apiKey: "offline-tokenizer-key",
	}).result();
	expect(result.stopReason).toBe("stop");
	const inference = JSON.parse(fixture.summaries.at(-1)!.body);
	expect(counted.messages).toEqual(inference.messages);
	expect(counted.tools).toEqual(inference.tools);
	expect(counted.chat_template_kwargs).toEqual(inference.chat_template_kwargs);
	expect(fixture.session.getContextUsage()?.tokens).toBe(100);
});

it.each(["summary", "final-context"] as const)(
	"rechecks context policy after awaited %s finalization conversion",
	async (phase) => {
		const marker = "PRIVATE_FINALIZATION_GATE";
		const fixture = await nativeFixture({
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", (event) => ({
						compaction: {
							summary: marker,
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					}));
				},
			],
		});
		const started = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		let active = false;
		let waiting = true;
		const transform = fixture.session.agent.transformContext;
		fixture.session.agent.transformContext = async (messages, signal) => {
			const transformed = transform ? await transform(messages, signal) : messages;
			return active
				? transformed.filter(
						(message) =>
							!JSON.stringify(message).includes(marker) && !JSON.stringify(message).includes(privateMarker),
					)
				: transformed;
		};
		const convert = fixture.session.agent.convertToLlm;
		fixture.session.agent.convertToLlm = async (messages) => {
			const converted = await convert(messages);
			const committed = fixture.manager.getBranch().some((entry) => entry.type === "compaction");
			if (
				waiting &&
				messages.some((message) => message.role === "compactionSummary") &&
				committed === (phase === "final-context")
			) {
				waiting = false;
				started.resolve();
				await released.promise;
			}
			return converted;
		};
		const running = fixture.session.compact({ keepRecentMessages: 2 });
		const outcome = running.then(
			(result) => ({ result }),
			(error: unknown) => ({ error }),
		);
		try {
			await Promise.race([
				started.promise,
				outcome.then(() => {
					throw new Error("Finalization conversion gate did not start");
				}),
			]);
			const accepted = fixture.uploads.length;
			active = true;
			released.resolve();
			expect(await outcome).toMatchObject({ result: { summary: marker } });
			for (const upload of fixture.uploads.slice(accepted)) {
				expect(upload.body).not.toContain(marker);
				expect(upload.body).not.toContain(privateMarker);
			}
		} finally {
			released.resolve();
			await outcome;
		}
	},
);

it("does not upload a retained fragment mutated while complete-history conversion awaits", async () => {
	const marker = "PRIVATE_MUTATED_FRAGMENT";
	const fixture = await nativeFixture();
	const started = Promise.withResolvers<void>();
	const released = Promise.withResolvers<void>();
	let waiting = true;
	const convert = fixture.session.agent.convertToLlm;
	fixture.session.agent.convertToLlm = async (messages) => {
		if (waiting) {
			waiting = false;
			started.resolve();
			await released.promise;
		}
		return convert(messages.filter((message) => !JSON.stringify(message).includes(marker)));
	};
	const running = fixture.session.compact({ keepRecentTokens: 1 });
	const outcome = running.then(
		(result) => ({ result }),
		(error: unknown) => ({ error }),
	);
	try {
		await Promise.race([
			started.promise,
			outcome.then(() => {
				throw new Error("Fragment gate did not start");
			}),
		]);
		const entry = fixture.manager
			.getBranch()
			.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
		if (entry?.type !== "message" || entry.message.role !== "assistant")
			throw new Error("Missing retained assistant");
		entry.message.content = [{ type: "text", text: marker }];
		released.resolve();
		expect(await outcome).toMatchObject({ result: { summary: "safe checkpoint" } });
		for (const upload of fixture.uploads) expect(upload.body).not.toContain(marker);
	} finally {
		released.resolve();
		await outcome;
	}
});

it.each(["preparation", "summary", "final-context"] as const)(
	"revokes a replaced converter while the %s transform recheck awaits",
	async (phase) => {
		const fixture = await nativeFixture();
		const started = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		const transform = fixture.session.agent.transformContext;
		let matching = 0;
		let waiting = true;
		fixture.session.agent.transformContext = async (messages, signal) => {
			const transformed = transform ? await transform(messages, signal) : messages;
			const summary = messages.some((message) => message.role === "compactionSummary");
			const committed = fixture.manager.getBranch().some((entry) => entry.type === "compaction");
			const selected = phase === "preparation" ? !summary : summary && committed === (phase === "final-context");
			if (selected && ++matching === 2 && waiting) {
				waiting = false;
				started.resolve();
				await released.promise;
			}
			return transformed;
		};
		const running = fixture.session.compact(
			phase === "preparation" ? { keepRecentTokens: 1 } : { keepRecentMessages: 2 },
		);
		const outcome = running.then(
			(result) => ({ result }),
			(error: unknown) => ({ error }),
		);
		try {
			await Promise.race([
				started.promise,
				outcome.then(() => {
					throw new Error("Transform recheck gate did not start");
				}),
			]);
			const accepted = fixture.uploads.length;
			const convert = fixture.session.agent.convertToLlm;
			fixture.session.agent.convertToLlm = (messages) =>
				convert(
					messages.filter(
						(message) => !JSON.stringify(message).includes(privateMarker) && message.role !== "compactionSummary",
					),
				);
			released.resolve();
			expect(await outcome).toMatchObject({ result: { summary: "safe checkpoint" } });
			for (const upload of fixture.uploads.slice(accepted)) {
				expect(upload.body).not.toContain(privateMarker);
				if (phase === "summary") expect(upload.body).not.toBe(JSON.stringify({ content: "safe checkpoint" }));
			}
		} finally {
			released.resolve();
			await outcome;
		}
	},
);

it.each(["sdk-compact", "sdk-branch", "sdk-bug-report", "wrapped-sdk-compact"] as const)(
	"preserves resolved auth header suppression for %s requests",
	async (operation) => {
		const fixture = await nativeFixture();
		const resolveAuth = fixture.session.modelRuntime.getAuth.bind(fixture.session.modelRuntime);
		vi.spyOn(fixture.session.modelRuntime, "getAuth").mockImplementation(async (model, options) => {
			const result = await resolveAuth(model, options);
			if (!result) throw new Error("Missing fixture auth");
			return { ...result, auth: { ...result.auth, headers: { ...result.auth.headers, authorization: null } } };
		});
		if (operation === "wrapped-sdk-compact") {
			const sdkStream = fixture.session.agent.streamFunction;
			fixture.session.agent.streamFunction = (...args) => sdkStream(...args);
		}
		if (operation === "sdk-branch") {
			const target = fixture.manager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (!target) throw new Error("Missing earlier branch target");
			const result = await fixture.session.navigateTree(target.id, { summarize: true });
			expect(result.summaryEntry?.summary).toContain("safe checkpoint");
		} else if (operation === "sdk-bug-report") {
			await expect(fixture.session.summarizeForBugReport({ signal: new AbortController().signal })).resolves.toBe(
				"safe checkpoint",
			);
		} else {
			expect((await fixture.session.compact({ keepRecentMessages: 2 })).summary).toContain("safe checkpoint");
		}
		expect(fixture.summaries.map((request) => request.authorization)).toEqual([null]);
		for (const request of fixture.summaries) {
			expect(request.body.toLowerCase()).not.toContain("authorization");
			expect(request.body).not.toContain("offline-tokenizer-key");
		}
		if (operation === "sdk-compact") {
			expect(fixture.uploads.find((request) => request.url.endsWith("/tokenize"))?.authorization).toBeNull();
			expect(
				fixture.uploads.find((request) => request.url.endsWith("/chat/completions/input_tokens"))?.authorization,
			).toBeNull();
			expect(fixture.session.getContextUsage()?.tokens).toBe(100);
		}
	},
);
