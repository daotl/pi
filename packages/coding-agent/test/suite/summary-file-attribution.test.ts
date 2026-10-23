import { fauxAssistantMessage, type ToolCall } from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { createNativeTokenizerFixture, type NativeTokenizerFixture } from "./tokenizer-fixture.ts";

const fixtures: NativeTokenizerFixture[] = [];
afterEach(() => {
	while (fixtures.length) fixtures.pop()?.cleanup();
});

it.each(["compact", "branch"] as const)(
	"does not reinsert a context-filtered path through %s metadata",
	async (operation) => {
		const privatePath = "/private/customer/FILTERED_FILE.ts";
		const publicPath = "/project/public-file.ts";
		const current = await createNativeTokenizerFixture({
			extensionFactories: [
				(pi) => {
					pi.on("context_with_system", (event) => ({
						messages: event.messages.filter((message) => !JSON.stringify(message).includes(privatePath)),
					}));
				},
			],
		});
		fixtures.push(current);
		const target = current.manager.getLeafId();
		if (!target) throw new Error("Missing branch target");
		for (const [index, path] of [privatePath, publicPath].entries()) {
			const call: ToolCall = { type: "toolCall", id: `read-${index}`, name: "read", arguments: { path } };
			current.manager.appendMessage({
				...fauxAssistantMessage(call),
				api: "openai-completions",
				provider: "tokenizer-native",
				model: "local",
				stopReason: "toolUse",
			});
			current.manager.appendMessage({
				role: "toolResult",
				toolCallId: call.id,
				toolName: "read",
				content: [{ type: "text", text: "file output" }],
				isError: false,
				timestamp: 30 + index,
			});
		}
		current.manager.appendMessage({ role: "user", content: "latest question", timestamp: 40 });
		current.manager.appendMessage({
			...fauxAssistantMessage("latest answer"),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
		});
		current.session.refreshContext();
		if (operation === "compact") await current.session.compact({ keepRecentMessages: 2 });
		else await current.session.navigateTree(target, { summarize: true });
		expect(current.summaries).toHaveLength(1);
		expect(current.summaries[0].body).not.toContain(privatePath);
		expect(current.summaries[0].body).toContain(publicPath);
		const entry = current.manager
			.getBranch()
			.findLast((entry) => entry.type === (operation === "compact" ? "compaction" : "branch_summary"));
		if (!entry || (entry.type !== "compaction" && entry.type !== "branch_summary"))
			throw new Error("Missing generated checkpoint");
		expect(entry.summary).not.toContain(privatePath);
		expect(entry.details).toEqual({ readFiles: [publicPath], modifiedFiles: [] });
		for (const upload of current.uploads) expect(upload.body).not.toContain(privatePath);
	},
);

it.each(["compact", "branch"] as const)(
	"excludes provider-filtered interrupted calls and opaque nested metadata from %s files",
	async (operation) => {
		const current = await createNativeTokenizerFixture();
		fixtures.push(current);
		const target = current.manager.getLeafId();
		if (!target) throw new Error("Missing branch target");
		for (const [index, stopReason] of (["error", "aborted", "toolUse"] as const).entries()) {
			const path = `/project/${stopReason}-file.ts`;
			const call: ToolCall = { type: "toolCall", id: `call-${index}`, name: "read", arguments: { path } };
			current.manager.appendMessage({
				...fauxAssistantMessage(call),
				api: "openai-completions",
				provider: "tokenizer-native",
				model: "local",
				stopReason,
			});
			current.manager.appendMessage({
				role: "toolResult",
				toolCallId: call.id,
				toolName: "read",
				content: [{ type: "text", text: "output" }],
				isError: false,
				timestamp: 30 + index,
				nestedCalls: {
					complete: true,
					calls: [
						{
							id: `nested-${index}`,
							name: "read",
							arguments: { path: "/private/NESTED_METADATA.ts" },
							status: "ok",
						},
					],
				},
			});
		}
		current.manager.appendMessage({ role: "user", content: "latest input", timestamp: 40 });
		current.manager.appendMessage({
			...fauxAssistantMessage("latest answer"),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
		});
		current.session.refreshContext();
		if (operation === "compact") await current.session.compact({ keepRecentMessages: 2 });
		else await current.session.navigateTree(target, { summarize: true });
		const entry = current.manager
			.getBranch()
			.findLast((entry) => entry.type === (operation === "compact" ? "compaction" : "branch_summary"));
		if (!entry || (entry.type !== "compaction" && entry.type !== "branch_summary"))
			throw new Error("Missing checkpoint");
		expect(entry.details).toEqual({ readFiles: ["/project/toolUse-file.ts"], modifiedFiles: [] });
		expect(entry.summary).not.toContain("NESTED_METADATA");
		expect(entry.summary).not.toContain("error-file");
		expect(entry.summary).not.toContain("aborted-file");
	},
);

it.each(["compact", "branch"] as const)(
	"uses the successful retry's converted history for %s file attribution",
	async (operation) => {
		const privatePath = "/private/FIRST_ATTEMPT.ts";
		let redacted = false;
		const current = await createNativeTokenizerFixture({
			settings: { compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("context_with_system", (event) => ({
						messages: redacted
							? event.messages.filter((message) => !JSON.stringify(message).includes(privatePath))
							: event.messages,
					}));
				},
			],
		});
		fixtures.push(current);
		const target = current.manager.getLeafId();
		if (!target) throw new Error("Missing branch target");
		const call: ToolCall = { type: "toolCall", id: "retry-read", name: "read", arguments: { path: privatePath } };
		current.manager.appendMessage({
			...fauxAssistantMessage(call),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
			stopReason: "toolUse",
		});
		current.manager.appendMessage({
			role: "toolResult",
			toolCallId: call.id,
			toolName: "read",
			content: [{ type: "text", text: "output" }],
			isError: false,
			timestamp: 30,
		});
		current.manager.appendMessage({ role: "user", content: "new input", timestamp: 40 });
		current.manager.appendMessage({
			...fauxAssistantMessage("new answer"),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
		});
		current.session.refreshContext();
		current.setResponses([
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
			fauxAssistantMessage("safe retry summary"),
		]);
		const unsubscribe = current.session.subscribe((event) => {
			if (event.type === "summarization_retry_scheduled") redacted = true;
		});
		try {
			if (operation === "compact") await current.session.compact({ keepRecentMessages: 2 });
			else await current.session.navigateTree(target, { summarize: true });
			expect(current.summaries).toHaveLength(2);
			expect(current.summaries[0].body).toContain(privatePath);
			expect(current.summaries[1].body).not.toContain(privatePath);
			const entry = current.manager
				.getBranch()
				.findLast((entry) => entry.type === (operation === "compact" ? "compaction" : "branch_summary"));
			if (!entry || (entry.type !== "compaction" && entry.type !== "branch_summary"))
				throw new Error("Missing checkpoint");
			expect(entry.summary).toContain("safe retry summary");
			expect(entry.summary).not.toContain(privatePath);
			expect(entry.details).toEqual({ readFiles: [], modifiedFiles: [] });
		} finally {
			unsubscribe();
		}
	},
);

it.each(["payload", "headers", "stream", "late-stream"] as const)(
	"omits reconstructed file tags with unprovable %s policy",
	async (policy) => {
		const path = "/project/native-path.ts";
		const current = await createNativeTokenizerFixture({
			extensionFactories: [
				(pi) => {
					if (policy === "payload") pi.on("before_provider_request", (event) => event.payload);
					if (policy === "headers") pi.on("before_provider_headers", () => {});
				},
			],
		});
		fixtures.push(current);
		const call: ToolCall = { type: "toolCall", id: "unprovable", name: "read", arguments: { path } };
		current.manager.appendMessage({
			...fauxAssistantMessage(call),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
			stopReason: "toolUse",
		});
		current.manager.appendMessage({
			role: "toolResult",
			toolCallId: call.id,
			toolName: "read",
			content: [{ type: "text", text: "output" }],
			isError: false,
			timestamp: 30,
		});
		current.manager.appendMessage({ role: "user", content: "latest", timestamp: 40 });
		current.manager.appendMessage({
			...fauxAssistantMessage("answer"),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
		});
		current.session.refreshContext();
		const stream = current.session.agent.streamFunction;
		if (policy === "stream") current.session.agent.streamFunction = (...args) => stream(...args);
		if (policy === "late-stream") {
			const fetch = globalThis.fetch;
			globalThis.fetch = async (input, init) => {
				if (String(input).endsWith("/chat/completions"))
					current.session.agent.streamFunction = (...args) => stream(...args);
				return fetch(input, init);
			};
		}
		await current.session.compact({ keepRecentMessages: 2 });
		expect(current.summaries[0].body).toContain(path);
		const entry = current.manager.getBranch().findLast((entry) => entry.type === "compaction");
		if (entry?.type !== "compaction") throw new Error("Missing checkpoint");
		expect(entry.details).toEqual({ readFiles: [], modifiedFiles: [] });
		expect(entry.summary).not.toContain(path);
	},
);

it.each(["compact", "branch"] as const)(
	"does not authorize a captured custom %s stream after the live stream becomes native",
	async (operation) => {
		const path = "/private/CAPTURED_CUSTOM_STREAM.ts";
		const current = await createNativeTokenizerFixture();
		fixtures.push(current);
		const target = current.manager.getLeafId();
		if (!target) throw new Error("Missing branch target");
		const call: ToolCall = { type: "toolCall", id: "captured-call", name: "read", arguments: { path } };
		current.manager.appendMessage({
			...fauxAssistantMessage(call),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
			stopReason: "toolUse",
		});
		current.manager.appendMessage({
			role: "toolResult",
			toolCallId: call.id,
			toolName: "read",
			content: [{ type: "text", text: "output" }],
			isError: false,
			timestamp: 30,
		});
		current.manager.appendMessage({ role: "user", content: "latest", timestamp: 40 });
		current.manager.appendMessage({
			...fauxAssistantMessage("answer"),
			api: "openai-completions",
			provider: "tokenizer-native",
			model: "local",
		});
		current.session.refreshContext();
		const native = current.session.agent.streamFunction;
		current.session.agent.streamFunction = (model, context, options) =>
			native(
				model,
				{
					...context,
					messages: context.messages.filter((message) => !JSON.stringify(message).includes(path)),
				},
				options,
			);
		const transform = current.session.agent.transformContext;
		current.session.agent.transformContext = async (messages, signal) => {
			current.session.agent.streamFunction = native;
			return transform ? transform(messages, signal) : messages;
		};
		if (operation === "compact") await current.session.compact({ keepRecentMessages: 2 });
		else await current.session.navigateTree(target, { summarize: true });
		expect(current.summaries).toHaveLength(1);
		expect(current.summaries[0].body).not.toContain(path);
		const entry = current.manager
			.getBranch()
			.findLast((entry) => entry.type === (operation === "compact" ? "compaction" : "branch_summary"));
		if (!entry || (entry.type !== "compaction" && entry.type !== "branch_summary"))
			throw new Error("Missing checkpoint");
		expect(entry.details).toEqual({ readFiles: [], modifiedFiles: [] });
		expect(entry.summary).not.toContain(path);
	},
);
