import * as fs from "node:fs";
import { accessSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AssistantImages,
	type ClassifierModel,
	type ClassifierResult,
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentSystemPrompt,
	getCurrentTools,
	type ImageModel,
	type ImagesContext,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ToolResultMessage, Usage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ToolDefinition } from "../../src/core/extensions/types.ts";
import { type CustomEntry, SessionManager } from "../../src/core/session-manager.ts";
import {
	adoptToolUsageManager,
	createToolUsageRecorderFactory,
	releaseToolUsageManager,
} from "../../src/core/tool-usage-binding.ts";
import { createReadTool } from "../../src/core/tools/read.ts";
import { createToolDefinitionFromAgentTool } from "../../src/core/tools/tool-definition-wrapper.ts";
import { getUsageCostBreakdown, getUsageTotals } from "../../src/core/usage-totals.ts";
import { readCodemodeStore } from "../../src/extensions/codemode/execute.ts";
import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import {
	CODEMODE_STORE_ENTRY_TYPE,
	type CodemodeToolDetails,
	type codemodeSchema,
	createCodemodeTool,
	createCodemodeToolDefinition,
} from "../../src/extensions/codemode/tool.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, getToolResult, type Harness, type HarnessOptions } from "./harness.ts";

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return {
		...actual,
		appendFileSync: vi.fn(actual.appendFileSync),
		fsyncSync: vi.fn(actual.fsyncSync),
	};
});

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const echoSchema = Type.Object({ text: Type.String({ description: "Text to echo" }) });
const echoTool: AgentTool<typeof echoSchema> = {
	name: "echo",
	label: "Echo",
	description: "Echo text back.\n\nSecond paragraph.",
	parameters: echoSchema,
	execute: async (_id, params) => ({
		content: [{ type: "text", text: `echo: ${params.text}` }],
		details: {},
	}),
};

const statsTool: AgentTool = {
	name: "stats",
	label: "Stats",
	description: "Return structured stats",
	parameters: Type.Object({}),
	outputSchema: Type.Object({ files: Type.Number(), names: Type.Array(Type.String()) }),
	execute: async () => ({
		content: [{ type: "text", text: "2 files" }],
		details: {},
		structuredContent: { files: 2, names: ["a", "b"] },
	}),
};

const screenshotTool: AgentTool = {
	name: "screenshot",
	label: "Screenshot",
	description: "Return a screenshot",
	parameters: Type.Object({}),
	execute: async () => ({
		content: [
			{ type: "text", text: "captured" },
			{ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
		],
		details: {},
	}),
};

function usage(input: number, cost: number): Usage {
	return {
		input,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input,
		cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
	};
}

const codemodeResult = (harness: Harness) => getToolResult(harness, "codemode");

/** The output after the script header, which is checked on the way. */
function resultText(message: ToolResultMessage): string {
	const [header, ...items] = message.content;
	expect(header).toEqual({
		type: "text",
		text: expect.stringMatching(/^Script (completed|failed)\nWall time \d+\.\d seconds\nOutput:\n$/),
	});
	return items.map((block) => (block.type === "text" ? block.text : `<${block.type}>`)).join("\n");
}

const TINY_PNG_LABEL = /^\[Image saved to (\S+\.png) \(image\/png, \d+B\)\]$/;

/**
 * Replace the `[Image saved to ...]` labels in `text` with `<saved>` after checking that each file
 * holds the tiny PNG, and remove the files.
 */
function checkSavedImages(text: string): string {
	return text
		.split("\n")
		.map((line) => {
			const path = TINY_PNG_LABEL.exec(line)?.[1];
			if (!path) return line;
			try {
				expect(readFileSync(path).toString("base64")).toBe(TINY_PNG_BASE64);
			} finally {
				rmSync(path, { force: true });
			}
			return "<saved>";
		})
		.join("\n");
}

describe("AgentSession codemode tool", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	async function setup(extensionFactories?: HarnessOptions["extensionFactories"]) {
		// Registered by an extension so they run with the session's tool context, next to the built-in codemode.
		const registerTools = (pi: ExtensionAPI) => {
			for (const tool of [echoTool as AgentTool, statsTool, screenshotTool]) {
				pi.registerTool(createToolDefinitionFromAgentTool(tool));
			}
		};
		const harness = await createHarness({
			initialActiveToolNames: ["codemode"],
			extensionFactories: [createCodemodeExtension(), registerTools, ...(extensionFactories ?? [])],
		});
		harnesses.push(harness);
		return harness;
	}

	it("presents callable tools per codemode.mode", async () => {
		const harness = await setup();
		const description = (name: string) =>
			harness.session.agent.state.tools.find((tool) => tool.name === name)?.description ?? "";
		const requestTools: string[][] = [];
		const requestPrompts: string[] = [];
		const record = (context: TranscriptContext) => {
			requestTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
			requestPrompts.push(getCurrentSystemPrompt(context.messages));
			return fauxAssistantMessage("ok");
		};

		// on: declared tools say how scripts call them and are not listed again in codemode.
		harness.session.setActiveToolsByName(["read", "echo", "codemode"]);
		expect(description("echo")).toContain("Codemode: `tools.echo(args)` resolves to");
		expect(description("echo")).not.toContain("codemode tool declaration:");
		expect(description("codemode")).not.toContain("### `echo`");
		harness.setResponses([record]);
		await harness.session.prompt("on");
		expect(requestTools[0]).toEqual(expect.arrayContaining(["read", "echo", "codemode"]));
		expect(requestPrompts[0]).toContain("\n- read: ");

		// only: codemode lists echo, which stays active but is left out of requests.
		harness.settingsManager.applyOverrides({ codemode: { mode: "only" } });
		harness.session.setActiveToolsByName(["read", "echo", "codemode"]);
		expect(description("echo")).not.toContain("Codemode: `tools.echo");
		expect(description("codemode")).toContain("### `echo`");
		expect(description("codemode")).not.toContain("### `stats`");
		harness.setResponses([record]);
		await harness.session.prompt("only");
		expect(requestTools[1]).toContain("codemode");
		expect(requestTools[1]).not.toContain("echo");
		expect(requestTools[1]).not.toContain("read");
		// The prompt's tool list matches the declarations: hidden tools are not listed (#10192).
		expect(requestPrompts[1]).not.toContain("\n- read: ");
		expect(requestPrompts[1]).toContain("\n- codemode: ");
		expect(harness.session.systemPrompt).not.toContain("\n- read: ");
		// Hidden tools' guidelines move from the rules to their codemode sections (#10343).
		expect(requestPrompts[1]).not.toContain("Use read to examine files");
		expect(description("codemode")).toContain("- Use read to examine files instead of cat or sed.");

		// Without codemode, tools keep their plain descriptions.
		harness.session.setActiveToolsByName(["echo"]);
		expect(description("echo")).toBe("Echo text back.\n\nSecond paragraph.");
	});

	// #10343
	it("shows the guidelines of tools that do not fit the inline budget through describeTool()", async () => {
		const harness = await setup();
		harness.settingsManager.applyOverrides({ codemode: { mode: "only", inlineBudget: 0 } });
		harness.session.setActiveToolsByName(["read", "codemode"]);
		const codemode = harness.session.agent.state.tools.find((tool) => tool.name === "codemode");
		expect(codemode?.description).not.toContain("### `read`");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("codemode", { code: 'text(await describeTool("read"))' })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		expect(resultText(codemodeResult(harness))).toContain("- Use read to examine files instead of cat or sed.");
	});

	it("runs nested calls in parallel and returns only the script result", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("codemode", {
						code: `
							const [a, b, stats] = await Promise.all([
								tools.echo({ text: "one" }),
								tools.echo({ text: "two" }),
								tools.stats({}),
							]);
							console.log("files", stats.files);
							text(ALL_TOOLS.map((tool) => tool.name).join(","));
							return { a, b, names: stats.names };
						`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = codemodeResult(harness);
		expect(result.isError).toBe(false);
		expect(resultText(result)).toBe(
			'==> text 1/2 <==\necho,stats,screenshot\n==> text 2/2 <==\n{"a":"echo: one","b":"echo: two","names":["a","b"]}\n<console_output>\nfiles 2\n</console_output>',
		);
		const details = result.details as unknown as CodemodeToolDetails;
		expect(details.calls.map((call) => [call.name, call.status])).toEqual([
			["echo", "ok"],
			["echo", "ok"],
			["stats", "ok"],
		]);
		expect(details.calls.every((call) => call.id.startsWith(`${result.toolCallId}/`))).toBe(true);
		// Nested calls never become transcript tool results; their events carry the parent id.
		const toolResults = harness.session.messages.filter((message) => message.role === "toolResult");
		expect(toolResults).toHaveLength(1);
	});

	it("routes nested calls through extension hooks", async () => {
		const harness = await setup([
			(pi) => {
				pi.on("tool_call", (event) => {
					if (event.toolName === "echo" && (event.input as { text: string }).text === "forbidden") {
						return { block: true, reason: "echo of forbidden text is blocked" };
					}
					return undefined;
				});
				pi.on("tool_result", (event) => {
					if (event.toolName === "stats") {
						return { content: [{ type: "text", text: "redacted" }] };
					}
					return undefined;
				});
			},
		]);
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("codemode", {
						code: `
							let blocked;
							try {
								await tools.echo({ text: "forbidden" });
							} catch (error) {
								blocked = error.message;
							}
							const stats = await tools.stats({});
							return { blocked, stats };
						`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = codemodeResult(harness);
		// Replacing content without replacing structured content drops the structured result.
		expect(JSON.parse(resultText(result))).toEqual({
			blocked: "echo of forbidden text is blocked",
			stats: "redacted",
		});
		const details = result.details as unknown as CodemodeToolDetails;
		expect(details.calls.map((call) => call.status)).toEqual(["error", "ok"]);
	});

	it("adds the usage of nested results to the codemode result", async () => {
		const billedTool: AgentTool = {
			name: "billed",
			label: "Billed",
			description: "Run a model",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "ran" }], details: {}, usage: usage(100, 0.25) }),
		};
		const harness = await setup([(pi) => pi.registerTool(createToolDefinitionFromAgentTool(billedTool))]);
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("codemode", {
						code: `await tools.billed({}); await tools.billed({}); await tools.echo({ text: "x" });`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = codemodeResult(harness);
		expect(result.usage).toMatchObject({ input: 200, totalTokens: 200, cost: { total: 0.5 } });
		// The usage is persisted with the result, so session totals count it.
		const persisted = harness.sessionManager
			.getEntries()
			.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
		expect(
			persisted?.type === "message" && persisted.message.role === "toolResult" && persisted.message.usage,
		).toEqual(result.usage);
		expect(harness.session.getSessionStats().cost).toBe(0.5);
	});

	it("keeps structured content that tool_result handlers replace along with the content", async () => {
		const harness = await setup([
			(pi) => {
				pi.on("tool_result", (event) =>
					event.toolName === "stats"
						? { content: [{ type: "text", text: "0 files" }], structuredContent: { files: 0, names: [] } }
						: undefined,
				);
				// A later handler that only touches details keeps what the first one set.
				pi.on("tool_result", (event) => (event.toolName === "stats" ? { details: { audited: true } } : undefined));
			},
		]);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("codemode", { code: "return await tools.stats({});" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		expect(JSON.parse(resultText(codemodeResult(harness)))).toEqual({ files: 0, names: [] });
	});

	// Saved images: https://github.com/earendil-works/pi/issues/10310
	it("attaches only the images the script passes to image(), in output order, each after its saved path", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("codemode", {
						code: `
							// Tools without an outputSchema resolve to their text; images are not passed on.
							const shot = await tools.screenshot({});
							text(shot);
							image("data:image/png;base64,${TINY_PNG_BASE64}");
							image("data:image/png;base64,${TINY_PNG_BASE64}");
							text("after");
						`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = codemodeResult(harness);
		// The same image shown twice is saved once, so both labels name one file.
		const lines = resultText(result).split("\n");
		expect(lines).toEqual([
			"==> text 1/2 <==",
			"captured",
			lines[2],
			"<image>",
			lines[2],
			"<image>",
			"==> text 2/2 <==",
			"after",
		]);
		expect(checkSavedImages(lines[2])).toBe("<saved>");
		expect(result.content[2]).toEqual({ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" });
	});

	it("saves images where routed tools can read and copy the original bytes", async () => {
		let remoteRoot = "";
		const toRemote = (path: string) => join(remoteRoot, path);
		const harness = await createHarness({
			initialActiveToolNames: ["codemode", "read", "copy_image"],
			extensionFactories: [
				createCodemodeExtension({
					saveImage: async (bytes, extension) => {
						const path = `/remote-tmp/image${extension}`;
						mkdirSync(toRemote("/remote-tmp"), { recursive: true });
						writeFileSync(toRemote(path), bytes);
						return path;
					},
				}),
				(pi) => {
					pi.registerTool(
						createToolDefinitionFromAgentTool(
							createReadTool("/workspace", {
								autoResizeImages: false,
								operations: {
									access: async (path) => accessSync(toRemote(path)),
									readFile: async (path) => readFileSync(toRemote(path)),
									detectImageMimeType: async () => "image/png",
								},
							}),
						),
					);
					pi.registerTool({
						name: "copy_image",
						label: "Copy image",
						description: "Copy a file inside the routed filesystem",
						parameters: Type.Object({ source: Type.String(), destination: Type.String() }),
						async execute(_id, { source, destination }) {
							copyFileSync(toRemote(source), toRemote(destination));
							return { content: [{ type: "text", text: "copied" }], details: undefined };
						},
					});
				},
			],
		});
		harnesses.push(harness);
		remoteRoot = join(harness.tempDir, "remote-root");
		mkdirSync(remoteRoot);
		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("codemode", { code: `image("data:image/png;base64,${TINY_PNG_BASE64}");` })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("show the fixture");
		const path = TINY_PNG_LABEL.exec(resultText(codemodeResult(harness)).split("\n")[0])?.[1];
		if (!path) throw new Error("No saved image path");
		try {
			harness.setResponses([
				fauxAssistantMessage(
					[
						fauxToolCall("codemode", {
							code: `const image = await tools.read({ path: ${JSON.stringify(path)} });
							text(image.data);
							await tools.copy_image({ source: ${JSON.stringify(path)}, destination: "/copied.png" });`,
						}),
					],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);
			await harness.session.prompt("reuse the saved image");
			expect(resultText(codemodeResult(harness))).toBe(TINY_PNG_BASE64);
			expect(readFileSync(toRemote("/copied.png"))).toEqual(Buffer.from(TINY_PNG_BASE64, "base64"));
		} finally {
			// Also remove the host temp file when this regression is run against the unfixed implementation.
			if (path !== "/remote-tmp/image.png") rmSync(path, { force: true });
		}
	});

	it("reports a routed image save failure without advertising an inaccessible host file", async () => {
		const harness = await createHarness({
			initialActiveToolNames: ["codemode"],
			extensionFactories: [
				createCodemodeExtension({
					saveImage: async () => {
						throw new Error("remote filesystem unavailable");
					},
				}),
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage(
				[fauxToolCall("codemode", { code: `image("data:image/png;base64,${TINY_PNG_BASE64}");` })],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("show the fixture");
		const result = codemodeResult(harness);
		try {
			expect(resultText(result)).toContain("could not be saved: remote filesystem unavailable]");
			expect(resultText(result)).not.toContain("[Image saved to ");
			expect(result.content.at(-1)).toEqual({ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" });
		} finally {
			checkSavedImages(resultText(result));
		}
	});

	it("marks where each text item starts and puts console lines last in one text block", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("codemode", {
						code: 'text("one\\ntwo");\nconsole.log("a");\nconsole.log("b");\ntext("three\\n");\nreturn 4;',
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		// Providers join adjacent text blocks with nothing or a newline, so the output is one block.
		const result = codemodeResult(harness);
		expect(result.content).toHaveLength(2);
		expect(resultText(result)).toBe(
			"==> text 1/3 <==\none\ntwo\n==> text 2/3 <==\nthree\n==> text 3/3 <==\n4\n<console_output>\na\nb\n</console_output>",
		);
	});

	it("reports script failures as results that keep partial output and the calls that ran", async () => {
		const harness = await setup();
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("codemode", {
						code: `text("partial");\nconsole.log("log");\nawait tools.echo({ text: "x" });\nthrow new Error("boom");`,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage("done"),
		]);

		await harness.session.prompt("go");

		const result = codemodeResult(harness);
		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toMatch(/^Script failed\n/);
		const text = resultText(result);
		expect(text).toMatch(/^partial\n<console_output>\nlog\n<\/console_output>\nScript error:\nError: boom\n/);
		expect(text).toContain("codemode.js:4");
		expect(text).toContain("Tool calls made before the failure (they are not undone): echo (ok)");
		expect((result.details as unknown as CodemodeToolDetails).calls.map((call) => call.name)).toEqual(["echo"]);
	});
});

describe("codemode options and store", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	// No tools override: the session builds its own codemode tool, including the store writer.
	async function setup() {
		const harness = await createHarness({
			initialActiveToolNames: ["codemode"],
			extensionFactories: [createCodemodeExtension()],
		});
		harnesses.push(harness);
		return harness;
	}

	async function run(harness: Harness, code: string): Promise<ToolResultMessage> {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		return codemodeResult(harness);
	}

	function storeEntries(harness: Harness): unknown[] {
		return harness.sessionManager
			.getBranch()
			.filter(
				(entry): entry is CustomEntry => entry.type === "custom" && entry.customType === CODEMODE_STORE_ENTRY_TYPE,
			)
			.map((entry) => entry.data);
	}

	const increment = `const next = (load("count") ?? 0) + 1;\nstore("count", next);\nreturn next;`;

	it("applies the timeout_ms option and rejects invalid options", async () => {
		const harness = await setup();
		const timedOut = await run(harness, '// @options: {"timeout_ms": 200}\nwhile (true) {}');
		expect(timedOut.isError).toBe(true);
		expect(resultText(timedOut)).toContain("Script error:\nScript timed out");

		const invalid = await run(harness, '// @options: {"yield": 1}\ntext(1)');
		expect(invalid.isError).toBe(true);
		expect(invalid.content).toEqual([
			{
				type: "text",
				text: "@options only supports `max_output_tokens` and `timeout_ms`; got `yield`",
			},
		]);

		// #10631: a misplaced options line fails before the script runs instead of running without a deadline.
		const misplaced = await run(harness, '// count\n// @options: {"timeout_ms": 200}\nwhile (true) {}');
		expect(misplaced.isError).toBe(true);
		expect(misplaced.content).toEqual([
			{
				type: "text",
				text: "The // @options: line must be the first line of the input; found one on line 2",
			},
		]);
	});

	it("limits script memory so runaway allocations fail inside the script", async () => {
		const harness = await setup();
		const result = await run(
			harness,
			'// @options: {"timeout_ms": 30000}\nlet a = [];\ntry { while (true) a.push("x".repeat(1 << 20) + a.length); } catch (error) { const n = a.length; a = null; return { n, error: String(error) }; }',
		);
		expect(result.isError).toBe(false);
		const { n, error } = JSON.parse(resultText(result)) as { n: number; error: string };
		expect(error).toContain("out of memory");
		// Each entry holds at least 1 MiB, so the limit stops the script well before wasm32's 4 GiB.
		expect(n).toBeLessThan(512);
	});

	it("truncates output to the token budget and spills the full text", async () => {
		const harness = await setup();
		const result = await run(
			harness,
			`// @options: {"max_output_tokens": 30}\nfor (let i = 0; i < 100; i++) text("row " + i);\nimage("data:image/png;base64,${TINY_PNG_BASE64}");`,
		);
		const details = result.details as unknown as CodemodeToolDetails;
		const path = details.fullOutputPath;
		if (!path) throw new Error("No spill file");
		try {
			const text = resultText(result);
			expect(text).toMatch(/^Warning: truncated output/);
			expect(text).toContain("row 0\n");
			expect(text).toContain("tokens truncated");
			expect(text).toContain("row 99\n");
			expect(text).not.toContain("row 50\n");
			expect(text).toContain(`[Full output: ${path} (read with offset/limit)]`);
			// Images follow the truncated text, each after the path it was saved to.
			expect(result.content.at(-1)).toEqual({ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" });
			expect(checkSavedImages(text.split("\n").at(-2) ?? "")).toBe("<saved>");
			expect(readFileSync(path, "utf8")).toBe(
				Array.from({ length: 100 }, (_, i) => `==> text ${i + 1}/100 <==\nrow ${i}`).join("\n"),
			);
		} finally {
			rmSync(path, { force: true });
		}

		const small = await run(harness, "return { ok: true };");
		expect((small.details as unknown as CodemodeToolDetails).fullOutputPath).toBeUndefined();
	});

	// #10678: joining the text items was quadratic, about 10 s here for the item limit.
	it("formats output at the item limit in linear time", async () => {
		const harness = await setup();
		const startedAt = performance.now();
		const result = await run(harness, 'for (let i = 0; i < 100000; i++) text("");');
		const elapsed = performance.now() - startedAt;
		rmSync((result.details as unknown as CodemodeToolDetails).fullOutputPath ?? "", { force: true });
		expect(result.isError).toBe(false);
		expect(resultText(result)).toContain("==> text 100000/100000 <==");
		expect(elapsed).toBeLessThan(5000);
	});

	it("resolves bash calls to structured results, also for non-zero exit codes", async () => {
		const harness = await createHarness({
			initialActiveToolNames: ["codemode", "bash"],
			extensionFactories: [createCodemodeExtension()],
		});
		harnesses.push(harness);
		const result = await run(
			harness,
			'const r = await tools.bash({ command: "echo out; exit 3" });\ntext(JSON.stringify([r.output, r.exit_code, typeof r.wall_time_seconds]));',
		);
		expect(result.isError).toBe(false);
		expect(resultText(result)).toBe('["out\\n",3,"number"]');
	});

	// https://github.com/earendil-works/pi/issues/10251
	it("resolves read calls to text for text files and to image blocks that image() shows", async () => {
		const harness = await createHarness({
			initialActiveToolNames: ["codemode", "read"],
			extensionFactories: [createCodemodeExtension()],
		});
		harnesses.push(harness);
		writeFileSync(join(harness.tempDir, "notes.txt"), "hello");
		writeFileSync(join(harness.tempDir, "pixel.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
		const result = await run(
			harness,
			'text(await tools.read({ path: "notes.txt" }));\nconst shot = await tools.read({ path: "pixel.png" });\ntext(shot.note);\nimage(shot);',
		);
		expect(result.isError).toBe(false);
		expect(checkSavedImages(resultText(result))).toBe(
			"==> text 1/2 <==\nhello\n==> text 2/2 <==\nRead image file [image/png]\n<saved>\n<image>",
		);
		expect(result.content.at(-1)).toEqual({ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" });
	});

	it("persists store() writes as custom entries for later calls", async () => {
		const harness = await setup();
		expect(resultText(await run(harness, increment))).toBe("1");
		expect(resultText(await run(harness, increment))).toBe("2");
		expect(storeEntries(harness)).toEqual([
			{ set: { count: 1 }, delete: [] },
			{ set: { count: 2 }, delete: [] },
		]);
		const appended = harness
			.eventsOfType("entry_appended")
			.filter((event) => event.entry.type === "custom" && event.entry.customType === CODEMODE_STORE_ENTRY_TYPE);
		expect(appended).toHaveLength(2);

		expect(resultText(await run(harness, 'store("count", undefined);\nreturn load("count") === undefined;'))).toBe(
			"true",
		);
		expect(storeEntries(harness).at(-1)).toEqual({ set: {}, delete: ["count"] });
	});

	it("appends nothing for failed scripts or scripts without writes", async () => {
		const harness = await setup();
		expect((await run(harness, 'store("count", 5);\nthrow new Error("boom");')).isError).toBe(true);
		expect((await run(harness, 'return load("count") ?? "missing";')).isError).toBe(false);
		expect(storeEntries(harness)).toEqual([]);
	});

	it("runs without a session, starting from an empty store", async () => {
		const tool = createCodemodeTool();
		const result = await tool.execute("direct", { code: increment });
		expect(result.content[1]).toEqual({ type: "text", text: "1" });
	});

	it("loads the values written on the current branch", async () => {
		const harness = await setup();
		await run(harness, increment);
		const firstPrompt = harness.sessionManager.getBranch().find((entry) => entry.type === "message");
		if (!firstPrompt) throw new Error("No first prompt entry");
		expect(resultText(await run(harness, increment))).toBe("2");

		// Branch from the first prompt: the store entries written after it are on another path.
		harness.sessionManager.branch(firstPrompt.id);
		expect(resultText(await run(harness, increment))).toBe("1");
	});

	it("folds store entries from the root, ignoring malformed data", () => {
		const entry = (data: unknown, customType = CODEMODE_STORE_ENTRY_TYPE): CustomEntry => ({
			type: "custom",
			customType,
			data,
			id: Math.random().toString(36).slice(2),
			parentId: null,
			timestamp: new Date(0).toISOString(),
		});
		expect(
			readCodemodeStore([
				entry({ set: { a: 1, b: { c: 2 } }, delete: [] }),
				entry({ set: { a: 3 }, delete: ["b"] }),
				entry({ set: { z: 1 } }),
				entry({ set: { other: 1 }, delete: [] }, "other-extension"),
			]),
		).toEqual({ a: 3 });
	});
});

describe("codemode models", () => {
	const harnesses: Harness[] = [];

	beforeEach(async () => {
		const actual = await vi.importActual<typeof fs>("fs");
		vi.mocked(fs.appendFileSync).mockReset().mockImplementation(actual.appendFileSync);
		vi.mocked(fs.fsyncSync).mockReset().mockImplementation(actual.fsyncSync);
	});

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
		vi.restoreAllMocks();
	});

	const scorerModel: ClassifierModel<"test-classifier"> = {
		type: "classifier",
		id: "judge",
		name: "Judge",
		api: "test-classifier",
		provider: "scorer",
		baseUrl: "https://classifier.test/v1",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		headers: { "X-Secret": "hunter2" },
	};

	const painterModel: ImageModel<"test-images"> = {
		type: "image",
		id: "painter",
		name: "Painter",
		api: "test-images",
		provider: "scorer",
		baseUrl: "https://images.test/v1",
		input: ["text", "image"],
		output: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};

	const imageRejection = `painter rejected ${"x".repeat(600)}`;
	const classifierRejection = `classifier rejected ${"x".repeat(600)}`;

	interface ClassifyObservation {
		baseUrl: string;
		apiKey: string | undefined;
		text: unknown;
	}

	interface ImagesObservation {
		baseUrl: string;
		apiKey: string | undefined;
		input: ImagesContext["input"];
	}

	async function setup(
		options: {
			classifierRelease?: Promise<void>;
			imageRelease?: Promise<void>;
			onModelCall?: (signal: AbortSignal | undefined) => void;
			codemodeDefinition?: ToolDefinition<typeof codemodeSchema, CodemodeToolDetails | undefined>;
			harnessOptions?: HarnessOptions;
		} = {},
	) {
		const codemodeDefinition = options.codemodeDefinition;
		const harness = await createHarness({
			...options.harnessOptions,
			initialActiveToolNames: ["codemode"],
			extensionFactories: [
				codemodeDefinition
					? (pi) => pi.registerTool({ ...codemodeDefinition, defaultActive: false })
					: createCodemodeExtension(),
				...(options.harnessOptions?.extensionFactories ?? []),
			],
		});
		harnesses.push(harness);
		const observed: ClassifyObservation[] = [];
		const imageRequests: ImagesObservation[] = [];
		let active = 0;
		let maxActive = 0;
		harness.session.modelRuntime.registerProvider("scorer", {
			apiKey: "secret-key",
			models: [scorerModel, painterModel],
			images: {
				"test-images": {
					generateImages: async (model, context, providerOptions): Promise<AssistantImages> => {
						imageRequests.push({ baseUrl: model.baseUrl, apiKey: providerOptions?.apiKey, input: context.input });
						options.onModelCall?.(providerOptions?.signal);
						await options.imageRelease;
						const prompt = context.input.find((block) => block.type === "text")?.text;
						const base = { api: model.api, provider: model.provider, model: model.id, timestamp: 0 };
						if (prompt === "explode") {
							return { ...base, output: [], stopReason: "error", errorMessage: "painter exploded" };
						}
						return {
							...base,
							output: [
								{ type: "text", text: `painted ${prompt}` },
								{ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
							],
							usage: usage(100, 0.04),
							stopReason: "stop",
						};
					},
				},
			},
			classifiers: {
				"test-classifier": {
					classify: async (model, context, providerOptions): Promise<ClassifierResult> => {
						active++;
						maxActive = Math.max(maxActive, active);
						options.onModelCall?.(providerOptions?.signal);
						await options.classifierRelease;
						active--;
						const text = context.state.text;
						observed.push({ baseUrl: model.baseUrl, apiKey: providerOptions?.apiKey, text });
						if (text === "explode") {
							return {
								api: model.api,
								provider: model.provider,
								model: model.id,
								answers: {},
								stopReason: "error",
								errorMessage: "classifier exploded",
								timestamp: 0,
							};
						}
						return {
							api: model.api,
							provider: model.provider,
							model: model.id,
							answers: { approved: { type: "bool", probability: text === "good" ? 0.9 : 0.1 } },
							usage: usage(300, 0.001),
							stopReason: "stop",
							timestamp: 0,
						};
					},
				},
			},
		});
		harness.session.setActiveToolsByName(["codemode"]);
		return { harness, observed, imageRequests, maxActive: () => maxActive };
	}

	async function run(harness: Harness, code: string): Promise<ToolResultMessage> {
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("codemode", { code })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		return codemodeResult(harness);
	}

	const questions = `{ approved: { type: "bool", instructions: "Approval?", criteria: { true: "yes", false: "no" } } }`;

	for (const operation of ["classify", "generateImages"] as const) {
		it(`isolates ${operation} receipts and notifications for independent in-memory managers with the same custom ID across re-adoption`, async () => {
			const id = `same-memory-${operation}`;
			const managerA = SessionManager.inMemory(process.cwd(), { id });
			const managerB = SessionManager.inMemory(process.cwd(), { id });
			expect(managerA).not.toBe(managerB);
			expect(managerA.getSessionId()).toBe(managerB.getSessionId());
			for (const manager of [managerA, managerB]) {
				expect(manager.isPersisted()).toBe(false);
				expect(manager.getSessionFile()).toBeUndefined();
			}
			const release = Promise.withResolvers<void>();
			const started = Promise.withResolvers<void>();
			const parentsA: string[] = [];
			const parentsB: string[] = [];
			const captureParent = (manager: SessionManager, parents: string[]) => {
				const parent = manager.getLeafId();
				if (!parent) throw new Error("Expected a model dispatch parent");
				parents.push(parent);
			};
			const expected = operation === "classify" ? usage(300, 0.001) : usage(100, 0.04);
			const model = operation === "classify" ? scorerModel : painterModel;
			const call =
				operation === "classify"
					? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
					: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
			const checkOwner = (harness: Harness, parents: string[], previousReceipts = 0) => {
				const receipts = harness.sessionManager.getEntries().filter((entry) => entry.type === "usage");
				expect(receipts).toEqual(
					parents.map((parentId) =>
						expect.objectContaining({
							parentId,
							kind: "codemode",
							provider: model.provider,
							model: model.id,
							usage: expected,
						}),
					),
				);
				expect(getUsageTotals(harness.sessionManager.getEntries()).cost).toBeCloseTo(
					expected.cost.total * parents.length,
					10,
				);
				expect(
					getUsageCostBreakdown(harness.sessionManager.getEntries()).filter((entry) =>
						entry.key.startsWith("scorer/"),
					),
				).toEqual([
					{
						key: `${model.provider}/${model.id}`,
						cost: expected.cost.total * parents.length,
						tokens: expected.totalTokens * parents.length,
					},
				]);
				expect(harness.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage")).toEqual(
					receipts.slice(previousReceipts).map((entry) => ({ type: "entry_appended", entry })),
				);
			};
			const { harness: originalA } = await setup({
				classifierRelease: operation === "classify" ? release.promise : undefined,
				imageRelease: operation === "generateImages" ? release.promise : undefined,
				onModelCall: () => {
					captureParent(managerA, parentsA);
					started.resolve();
				},
				harnessOptions: { sessionManager: managerA },
			});
			const pendingA = run(originalA, `await ${call};`);
			try {
				await started.promise;
				// B is adopted only after A has dispatched, and receives its own charge first.
				const { harness: originalB } = await setup({
					onModelCall: () => captureParent(managerB, parentsB),
					harnessOptions: { sessionManager: managerB },
				});
				expect((await run(originalB, `await ${call};`)).isError).toBe(false);
				expect(parentsA).toHaveLength(1);
				expect(parentsB).toHaveLength(1);
				expect(managerA.getEntry(parentsB[0])).toBeUndefined();
				expect(managerB.getEntry(parentsA[0])).toBeUndefined();
				checkOwner(originalB, parentsB);
				const branchB = structuredClone(managerB.getBranch());
				const projectionB = structuredClone(managerB.buildSessionProjection());
				const messagesB = structuredClone(originalB.session.messages);
				release.resolve();
				const resultA = await pendingA;
				expect(resultA.isError).toBe(false);
				expect(resultA.usage).toBeUndefined();
				checkOwner(originalA, parentsA);
				checkOwner(originalB, parentsB);
				expect(managerB.getBranch()).toEqual(branchB);
				expect(managerB.buildSessionProjection()).toEqual(projectionB);
				expect(originalB.session.messages).toEqual(messagesB);

				originalA.session.dispose();
				originalB.session.dispose();
				const { harness: resumedA } = await setup({
					onModelCall: () => captureParent(managerA, parentsA),
					harnessOptions: { sessionManager: managerA },
				});
				const { harness: resumedB } = await setup({
					onModelCall: () => captureParent(managerB, parentsB),
					harnessOptions: { sessionManager: managerB },
				});
				// Re-adopting B still must not claim A's new receipts or its notifications.
				expect((await run(resumedA, `await ${call};`)).isError).toBe(false);
				checkOwner(resumedA, parentsA, 1);
				checkOwner(resumedB, parentsB, 1);
				// Releasing A must not release the unrelated, same-ID owner B.
				resumedA.session.dispose();
				expect((await run(resumedB, `await ${call};`)).isError).toBe(false);
				for (const harness of [resumedA, resumedB]) {
					harness.session.flushPendingPersistence();
					harness.session.flushPendingUsage();
					harness.session.flushPendingUsage();
				}
				expect(parentsA).toHaveLength(2);
				expect(parentsB).toHaveLength(2);
				checkOwner(resumedA, parentsA, 1);
				checkOwner(resumedB, parentsB, 1);
				for (const [original, manager, parents] of [
					[originalA, managerA, parentsA],
					[originalB, managerB, parentsB],
				] as const) {
					const firstReceipt = manager.getEntries().find((entry) => entry.type === "usage");
					expect(firstReceipt?.parentId).toBe(parents[0]);
					expect(original.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage")).toEqual([
						{ type: "entry_appended", entry: firstReceipt },
					]);
				}
			} finally {
				release.resolve();
				await Promise.allSettled([pendingA, originalA.session.abort()]);
			}
		});
	}

	it("strongly retains an in-flight in-memory receipt sink after its session owner is released", async () => {
		setFlagsFromString("--expose-gc");
		let collect: () => void;
		try {
			collect = runInNewContext("gc");
		} finally {
			setFlagsFromString("--no-expose-gc");
		}
		const { managerRef, sessionId, parentId, record } = (() => {
			const manager = SessionManager.inMemory();
			const parentId = manager.appendMessage({ role: "user", content: "paid dispatch", timestamp: 0 });
			const owner = adoptToolUsageManager(manager);
			const record = createToolUsageRecorderFactory(owner)();
			releaseToolUsageManager(owner);
			return { managerRef: new WeakRef(manager), sessionId: manager.getSessionId(), parentId, record };
		})();
		// A task boundary clears WeakRef's same-job keep-alive before exercising real collection.
		for (let attempt = 0; attempt < 3; attempt++) {
			const nextTask = Promise.withResolvers<void>();
			setImmediate(nextTask.resolve);
			await nextTask.promise;
			collect();
		}
		const retained = managerRef.deref();
		expect(retained, "an unresolved paid call must retain its in-memory receipt destination").toBeDefined();
		expect(() => record("codemode", "scorer", "judge", usage(300, 0.001))).not.toThrow();
		expect(retained?.getSessionId()).toBe(sessionId);
		expect(retained?.getEntries().filter((entry) => entry.type === "usage")).toEqual([
			expect.objectContaining({ parentId, provider: "scorer", model: "judge", usage: usage(300, 0.001) }),
		]);
		expect(getUsageTotals(retained?.getEntries() ?? []).cost).toBe(0.001);
	});

	it("runs the model help examples without file-reading tools", async () => {
		const { harness, observed, imageRequests } = await setup();
		const codemode = harness.session.agent.state.tools.find((tool) => tool.name === "codemode");
		expect(harness.session.agent.state.tools.map((tool) => tool.name)).toEqual(["codemode"]);
		const outputs: string[] = [];
		for (const match of codemode?.description.matchAll(/```js\n([\s\S]*?)\n```/g) ?? []) {
			const result = await run(harness, match[1]);
			expect(result.isError).toBe(false);
			outputs.push(checkSavedImages(resultText(result)));
		}
		expect(outputs).toEqual([
			expect.stringContaining('"approved":{"type":"bool","probability":0.9}'),
			"painted a fox\n<saved>\n<image>",
		]);
		expect(observed.map((entry) => entry.text)).toEqual(["good"]);
		expect(imageRequests.map((entry) => entry.input)).toEqual([[{ type: "text", text: "a fox" }]]);

		const plain = createCodemodeTool();
		const result = await plain.execute("plain-models", { code: "return typeof models;" });
		expect(result.content[1]).toEqual({ type: "text", text: "undefined" });
	});

	it("lists models and classifies with catalog auth, ignoring script-supplied fields", async () => {
		const release = Promise.withResolvers<void>();
		const { harness, observed, maxActive } = await setup({ classifierRelease: release.promise });
		const pending = run(
			harness,
			`
			const [model] = await models.getAvailableOfType("classifier", "scorer");
			const listed = await models.getModelsOfType("classifier");
			const same = await models.getModelOfType("classifier", "scorer", "judge");
			const texts = ["good", "bad", "good", "bad", "good", "bad"];
			const results = await Promise.all(
				texts.map((text) => models.classify({ ...model, baseUrl: "https://evil.test" }, { state: { text }, questions: ${questions} })),
			);
			return {
				id: model.id,
				headers: "headers" in model,
				listed: listed.some((entry) => entry.provider === "scorer" && entry.id === "judge"),
				same: same.id,
				missing: (await models.getModelOfType("classifier", "scorer", "nope")) === undefined,
				probabilities: results.map((r) => r.answers.approved.probability),
				cost: results[0].usage.cost.total,
			};
		`,
		);
		try {
			await vi.waitFor(() => expect(maxActive()).toBe(4));
		} finally {
			release.resolve();
			await pending;
		}
		const result = await pending;
		expect(result.isError).toBe(false);
		expect(JSON.parse(resultText(result))).toEqual({
			id: "judge",
			headers: false,
			listed: true,
			same: "judge",
			missing: true,
			probabilities: [0.9, 0.1, 0.9, 0.1, 0.9, 0.1],
			cost: 0.001,
		});
		expect(observed).toHaveLength(6);
		expect(
			observed.every((entry) => entry.baseUrl === "https://classifier.test/v1" && entry.apiKey === "secret-key"),
		).toBe(true);
		// Six classifications with at most four in flight.
		expect(maxActive()).toBe(4);
		const details = result.details as unknown as CodemodeToolDetails;
		expect(details.calls.map((call) => [call.name, call.args, call.status, call.cost])).toEqual(
			Array.from({ length: 6 }, () => ["models.classify", "scorer/judge", "ok", 0.001]),
		);
		// Each classification has its own durable, model-attributed receipt. The aggregate tool
		// result must not bill those same calls again.
		expect(result.usage).toBeUndefined();
		const receipts = harness.sessionManager.getEntries().filter((entry) => entry.type === "usage");
		expect(receipts).toHaveLength(6);
		expect(receipts.every((entry) => entry.provider === "scorer" && entry.model === "judge")).toBe(true);
		expect(receipts.reduce((total, entry) => total + entry.usage.totalTokens, 0)).toBe(1800);
		expect(harness.session.getSessionStats().cost).toBeCloseTo(0.006, 10);
		expect(
			getUsageCostBreakdown(harness.sessionManager.getEntries()).filter((entry) => entry.key.startsWith("scorer/")),
		).toEqual([{ key: "scorer/judge", cost: 0.006, tokens: 1800 }]);
	});

	it("generates images with catalog auth and attaches them through image()", async () => {
		const { harness, imageRequests } = await setup();
		const result = await run(
			harness,
			`
			const [model] = await models.getAvailableOfType("image", "scorer");
			const reference = { type: "image", data: "${TINY_PNG_BASE64}", mimeType: "image/png" };
			const generated = await models.generateImages(
				{ ...model, baseUrl: "https://evil.test" },
				{ input: [{ type: "text", text: "a fox" }, reference] },
			);
			for (const block of generated.output) {
				if (block.type === "image") image(block);
				else text(block.text);
			}
			const failed = await models.generateImages(model, { input: [{ type: "text", text: "explode" }] });
			const attempt = async (fn) => { try { await fn(); return "ok"; } catch (error) { return error.message; } };
			return {
				id: model.id,
				stopReason: generated.stopReason,
				failed: [failed.stopReason, failed.errorMessage],
				wrongType: await attempt(() => models.generateImages({ provider: "scorer", id: "judge" }, { input: [] })),
			};
		`,
		);
		expect(result.isError).toBe(false);
		const [header, text, ...rest] = checkSavedImages(resultText(result)).split("\n");
		expect(header).toBe("==> text 1/2 <==");
		expect(text).toBe("painted a fox");
		expect(rest[0]).toBe("<saved>");
		expect(rest[1]).toBe("<image>");
		expect(rest[2]).toBe("==> text 2/2 <==");
		expect(JSON.parse(rest.slice(3).join("\n"))).toEqual({
			id: "painter",
			stopReason: "stop",
			failed: ["error", "painter exploded"],
			wrongType:
				'"scorer/judge" is a classifier model, not an image model. List the image models you can use with models.getAvailableOfType("image").',
		});
		expect(result.content[2]).toEqual({ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" });
		expect(imageRequests.map((request) => [request.baseUrl, request.apiKey])).toEqual([
			["https://images.test/v1", "secret-key"],
			["https://images.test/v1", "secret-key"],
		]);
		expect(imageRequests[0].input).toEqual([
			{ type: "text", text: "a fox" },
			{ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" },
		]);
		const details = result.details as unknown as CodemodeToolDetails;
		expect(details.calls.map((call) => [call.name, call.args, call.status, call.cost, call.error])).toEqual([
			["models.generateImages", "scorer/painter", "ok", 0.04, undefined],
			["models.generateImages", "scorer/painter", "error", undefined, "painter exploded"],
		]);
		expect(result.usage).toBeUndefined();
		expect(harness.session.getSessionStats().cost).toBeCloseTo(0.04, 10);
		expect(
			getUsageCostBreakdown(harness.sessionManager.getEntries()).find((entry) => entry.key === "scorer/painter"),
		).toEqual({ key: "scorer/painter", cost: 0.04, tokens: 100 });
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "usage")).toEqual([
			expect.objectContaining({ provider: "scorer", model: "painter", usage: usage(100, 0.04) }),
		]);
	});

	it("keeps nested tool usage on the result without duplicating independent model receipts", async () => {
		const { harness } = await setup({
			harnessOptions: {
				extensionFactories: [
					(pi) =>
						pi.registerTool({
							name: "billed",
							label: "Billed",
							description: "Run a billed nested tool",
							parameters: Type.Object({}),
							exposure: "codemode",
							execute: async () => ({
								content: [{ type: "text", text: "ran" }],
								details: {},
								usage: usage(100, 0.25),
							}),
						}),
				],
			},
		});
		const result = await run(
			harness,
			`
			await tools.billed({});
			await models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} });
			await models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] });
		`,
		);
		expect(result.isError).toBe(false);
		expect(result.usage).toEqual(usage(100, 0.25));
		expect(harness.session.getSessionStats().cost).toBeCloseTo(0.291, 10);
		expect(
			getUsageCostBreakdown(harness.sessionManager.getEntries()).filter(
				(entry) => entry.key === "Tools/summaries" || entry.key.startsWith("scorer/"),
			),
		).toEqual([
			{ key: "Tools/summaries", cost: 0.25, tokens: 100 },
			{ key: "scorer/painter", cost: 0.04, tokens: 100 },
			{ key: "scorer/judge", cost: 0.001, tokens: 300 },
		]);
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "usage")).toHaveLength(2);
	});

	it("publishes rejected model calls and preserves script error handling", async () => {
		const { harness } = await setup();
		vi.spyOn(harness.session.modelRuntime, "generateImages").mockRejectedValue(new Error(imageRejection));
		vi.spyOn(harness.session.modelRuntime, "classify").mockRejectedValue(new Error(classifierRejection));
		const result = await run(
			harness,
			`
			const imageModel = await models.getModelOfType("image", "scorer", "painter");
			const classifierModel = await models.getModelOfType("classifier", "scorer", "judge");
			const attempt = async (fn) => { try { await fn(); return "ok"; } catch (error) { return error.message; } };
			const imageError = await attempt(() => models.generateImages(imageModel, { input: [{ type: "text", text: "reject" }] }));
			const classifierError = await attempt(() => models.classify(classifierModel, { state: { text: "reject" }, questions: ${questions} }));
			return { imageError, classifierError, continued: true };
		`,
		);
		expect(result.isError).toBe(false);
		expect(JSON.parse(resultText(result))).toEqual({
			imageError: imageRejection,
			classifierError: classifierRejection,
			continued: true,
		});
		const updates = harness
			.eventsOfType("tool_execution_update")
			.filter((event) => event.toolName === "codemode")
			.flatMap((event) => {
				const details = event.partialResult.details as CodemodeToolDetails | undefined;
				return details?.calls ?? [];
			});
		for (const name of ["models.generateImages", "models.classify"]) {
			const transitions = updates.filter((call) => call.name === name);
			const statuses = transitions
				.map((call) => call.status)
				.filter((status, index, all) => index === 0 || status !== all[index - 1]);
			expect(statuses).toEqual(["running", "error"]);
			expect(transitions.find((call) => call.status === "error")).toEqual(
				expect.objectContaining({
					durationMs: expect.any(Number),
					error: `${(name === "models.generateImages" ? imageRejection : classifierRejection).slice(0, 497)}...`,
				}),
			);
		}
		let details = result.details as unknown as CodemodeToolDetails;
		expect(details.calls).toEqual([
			expect.objectContaining({
				name: "models.generateImages",
				status: "error",
				durationMs: expect.any(Number),
				error: `${imageRejection.slice(0, 497)}...`,
			}),
			expect.objectContaining({
				name: "models.classify",
				status: "error",
				durationMs: expect.any(Number),
				error: `${classifierRejection.slice(0, 497)}...`,
			}),
		]);

		const failed = await run(
			harness,
			`const model = await models.getModelOfType("image", "scorer", "painter");
			await models.generateImages(model, { input: [{ type: "text", text: "reject" }] });`,
		);
		expect(failed.isError).toBe(true);
		expect(resultText(failed)).toContain("Script error:\nError: painter rejected");
		expect(resultText(failed)).toContain(
			"Tool calls made before the failure (they are not undone): models.generateImages (error)",
		);
		details = failed.details as unknown as CodemodeToolDetails;
		expect(details.calls).toEqual([
			expect.objectContaining({
				name: "models.generateImages",
				status: "error",
				durationMs: expect.any(Number),
				error: `${imageRejection.slice(0, 497)}...`,
			}),
		]);
	});

	for (const operation of ["classify", "generateImages"] as const) {
		it(`publishes cancelled ${operation} rejections without replacing the script abort`, async () => {
			const { harness } = await setup();
			let callSignal: AbortSignal | undefined;
			const release = Promise.withResolvers<void>();
			const rejection = `${operation} cancelled ${"x".repeat(600)}`;
			vi.spyOn(harness.session.modelRuntime, operation).mockImplementation(
				async (_model: unknown, _context: unknown, options?: { signal?: AbortSignal }) => {
					const signal = options?.signal;
					if (!signal) throw new Error("Expected the sandbox call signal");
					callSignal = signal;
					signal.addEventListener("abort", () => release.resolve(), { once: true });
					await release.promise;
					throw new Error(rejection);
				},
			);
			const code =
				operation === "classify"
					? `const model = await models.getModelOfType("classifier", "scorer", "judge");
					await models.classify(model, { state: { text: "pending" }, questions: ${questions} });`
					: `const model = await models.getModelOfType("image", "scorer", "painter");
					await models.generateImages(model, { input: [{ type: "text", text: "pending" }] });`;
			const pending = run(harness, code);
			try {
				await vi.waitFor(() => expect(callSignal?.aborted).toBe(false));
				const abort = harness.session.abort();
				const [result] = await Promise.all([pending, abort]);
				expect(callSignal?.aborted).toBe(true);
				expect(result.isError).toBe(true);
				expect(resultText(result)).toContain("Script aborted");
				expect(resultText(result)).not.toContain(`Error: ${operation} cancelled`);
				expect(harness.eventsOfType("agent_settled")).toEqual([{ type: "agent_settled", aborted: true }]);
				const expectedCall = expect.objectContaining({
					name: `models.${operation}`,
					status: "cancelled",
					durationMs: expect.any(Number),
					error: `${rejection.slice(0, 497)}...`,
				});
				expect((result.details as unknown as CodemodeToolDetails).calls).toEqual([expectedCall]);
				const updates = harness
					.eventsOfType("tool_execution_update")
					.filter((event) => event.toolName === "codemode")
					.flatMap((event) => (event.partialResult.details as CodemodeToolDetails | undefined)?.calls ?? []);
				expect(
					updates
						.map((call) => call.status)
						.filter((status, index, all) => index === 0 || status !== all[index - 1]),
				).toEqual(["running", "cancelled"]);
				expect(updates.at(-1)).toEqual(expectedCall);
			} finally {
				release.resolve();
				await Promise.allSettled([pending, harness.session.abort()]);
			}
		});
	}

	for (const operation of ["classify", "generateImages"] as const) {
		for (const termination of ["return", "abort"] as const) {
			it(`persists late ${operation} usage exactly once after script ${termination} and reopen`, async () => {
				const cwd = mkdtempSync(join(tmpdir(), "pi-codemode-late-usage-"));
				const manager = SessionManager.create(cwd, join(cwd, "sessions"));
				const release = Promise.withResolvers<void>();
				const started = Promise.withResolvers<void>();
				let callSignal: AbortSignal | undefined;
				const { harness } = await setup({
					classifierRelease: operation === "classify" ? release.promise : undefined,
					imageRelease: operation === "generateImages" ? release.promise : undefined,
					onModelCall: (signal) => {
						callSignal = signal;
						started.resolve();
					},
					harnessOptions: {
						cwd,
						sessionManager: manager,
						extensionFactories: [
							(pi) =>
								pi.registerTool({
									name: "wait_for_dispatch",
									label: "Wait for dispatch",
									description: "Wait until the model provider has started",
									parameters: Type.Object({}),
									exposure: "codemode",
									execute: async () => {
										await started.promise;
										return { content: [{ type: "text", text: "dispatched" }], details: {} };
									},
								}),
						],
					},
				});
				const call =
					operation === "classify"
						? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
						: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
				const code =
					termination === "return"
						? `${call}; await tools.wait_for_dispatch({}); return "finished";`
						: `await ${call};`;
				let settled = false;
				const pending = run(harness, code).then((result) => {
					settled = true;
					return result;
				});
				let abort: Promise<void> | undefined;
				try {
					await vi.waitFor(() => expect(callSignal).toBeDefined());
					if (termination === "abort") abort = harness.session.abort();
					// Completion must not join a provider that ignores its cancellation signal.
					await vi.waitFor(() => expect(settled).toBe(true));
					const result = await pending;
					await abort;
					expect(callSignal?.aborted).toBe(true);
					expect(result.isError).toBe(termination === "abort");
					expect(resultText(result)).toContain(termination === "abort" ? "Script aborted" : "finished");
					expect(harness.session.getSessionStats().cost).toBe(0);
					const sessionFile = manager.getSessionFile();
					if (!sessionFile) throw new Error("Expected a persisted session");
					const messageCount = harness.session.messages.length;
					const beforeUsage = getUsageTotals(manager.getEntries());
					release.resolve();
					const expectedUsage = operation === "classify" ? usage(300, 0.001) : usage(100, 0.04);
					await vi.waitFor(() => {
						expect(harness.session.getSessionStats().cost).toBe(expectedUsage.cost.total);
						expect(getUsageTotals(manager.getEntries()).input - beforeUsage.input).toBe(expectedUsage.input);
					});
					expect(harness.session.messages).toHaveLength(messageCount);
					expect(result.usage).toBeUndefined();
					const model = operation === "classify" ? scorerModel : painterModel;
					for (const current of [manager, SessionManager.open(sessionFile)]) {
						const receipts = current.getEntries().filter((entry) => entry.type === "usage");
						expect(receipts).toHaveLength(1);
						expect(receipts[0]).toMatchObject({
							provider: model.provider,
							model: model.id,
							usage: expectedUsage,
						});
						expect(getUsageTotals(current.getEntries())).toEqual({
							input: beforeUsage.input + expectedUsage.input,
							output: beforeUsage.output,
							cacheRead: beforeUsage.cacheRead,
							cacheWrite: beforeUsage.cacheWrite,
							cost: beforeUsage.cost + expectedUsage.cost.total,
						});
						expect(
							getUsageCostBreakdown(current.getEntries()).filter((entry) => entry.key.startsWith("scorer/")),
						).toEqual([
							{
								key: `${model.provider}/${model.id}`,
								cost: expectedUsage.cost.total,
								tokens: expectedUsage.totalTokens,
							},
						]);
					}
					expect(harness.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage")).toEqual([
						{
							type: "entry_appended",
							entry: expect.objectContaining({
								provider: model.provider,
								model: model.id,
								usage: expectedUsage,
							}),
						},
					]);
				} finally {
					release.resolve();
					await Promise.allSettled([pending, abort, harness.session.abort()]);
					rmSync(cwd, { recursive: true, force: true });
				}
			});
		}
	}

	for (const operation of ["classify", "generateImages"] as const) {
		for (const replacement of [false, true]) {
			it.each(["nearest", "none"] as const)(
				`reattaches late ${operation} usage to %s original ancestor after abort and physical shred (same-file replacement: ${replacement})`,
				async (survivor) => {
					const cwd = mkdtempSync(join(tmpdir(), "pi-codemode-shredded-usage-"));
					const manager = SessionManager.create(cwd, join(cwd, "sessions"));
					const release = Promise.withResolvers<void>();
					const started = Promise.withResolvers<void>();
					let callSignal: AbortSignal | undefined;
					const {
						harness: original,
						observed,
						imageRequests,
					} = await setup({
						classifierRelease: operation === "classify" ? release.promise : undefined,
						imageRelease: operation === "generateImages" ? release.promise : undefined,
						onModelCall: (signal) => {
							callSignal = signal;
							started.resolve();
						},
						harnessOptions: { cwd, sessionManager: manager },
					});
					const call =
						operation === "classify"
							? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
							: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
					const pending = run(original, `await ${call};`);
					try {
						await started.promise;
						const lineage = structuredClone(manager.getBranch());
						const dispatchParent = lineage.at(-1)!;
						await original.session.abort();
						expect((await pending).isError).toBe(true);
						expect(callSignal?.aborted).toBe(true);
						const file = manager.getSessionFile()!;
						let current = original;
						if (replacement) {
							original.session.dispose();
							({ harness: current } = await setup({
								harnessOptions: { cwd, sessionManager: SessionManager.open(file, undefined, cwd) },
							}));
						}
						const active = current.sessionManager;
						// Remove an ancestor as well as the dispatch parent, so recovery cannot
						// reconstruct the original lineage from the surviving tree.
						const shredRoot = survivor === "none" ? lineage[0] : lineage.at(-2)!;
						expect(active.removeEntriesWithDescendants([shredRoot.id])).toBeGreaterThan(0);
						expect(active.getEntry(dispatchParent.id)).toBeUndefined();
						const expectedParent =
							[...lineage].reverse().find((entry) => active.getEntry(entry.id) !== undefined)?.id ?? null;
						if (survivor === "none") expect(expectedParent).toBeNull();
						else expect(expectedParent).not.toBeNull();
						current.session.refreshContext();
						current.setResponses([fauxAssistantMessage("new branch answer")]);
						await current.session.prompt("new branch question before receipt");
						const selected = active.getLeafId();
						const branch = structuredClone(active.getBranch());
						const projection = structuredClone(active.buildSessionProjection());
						const removedIds = lineage.filter((entry) => !active.getEntry(entry.id)).map((entry) => entry.id);
						const expected = operation === "classify" ? usage(300, 0.001) : usage(100, 0.04);
						const model = operation === "classify" ? scorerModel : painterModel;
						release.resolve();
						await vi.waitFor(() => {
							expect(active.getEntries().filter((entry) => entry.type === "usage")).toEqual([
								expect.objectContaining({
									parentId: expectedParent,
									provider: model.provider,
									model: model.id,
									usage: expected,
								}),
							]);
						});
						for (const owner of [active, SessionManager.open(file, undefined, cwd)]) {
							for (const id of removedIds) expect(owner.getEntry(id)).toBeUndefined();
							expect(owner.getLeafId()).toBe(selected);
							expect(owner.getBranch()).toEqual(branch);
							expect(owner.buildSessionProjection()).toEqual(projection);
							expect(owner.getEntries().filter((entry) => entry.type === "usage")).toEqual([
								expect.objectContaining({
									parentId: expectedParent,
									provider: model.provider,
									model: model.id,
									usage: expected,
								}),
							]);
						}
						// Both pre-admission flushing and later receipts must remain usable.
						current.setResponses([fauxAssistantMessage("prompt after late receipt")]);
						await expect(current.session.prompt("continue after shred")).resolves.toBeUndefined();
						expect((await run(current, `await ${call};`)).isError).toBe(false);
						current.session.flushPendingPersistence();
						current.session.flushPendingUsage();
						for (const owner of [active, SessionManager.open(file, undefined, cwd)]) {
							const receipts = owner.getEntries().filter((entry) => entry.type === "usage");
							expect(receipts).toHaveLength(2);
							expect(receipts[0]).toMatchObject({ parentId: expectedParent, usage: expected });
							expect(receipts[1]).toMatchObject({ provider: model.provider, model: model.id, usage: expected });
							expect(
								getUsageCostBreakdown(owner.getEntries()).filter((entry) => entry.key.startsWith("scorer/")),
							).toEqual([
								{
									key: `${model.provider}/${model.id}`,
									cost: expected.cost.total * 2,
									tokens: expected.totalTokens * 2,
								},
							]);
						}
						expect(operation === "classify" ? observed : imageRequests).toHaveLength(replacement ? 1 : 2);
					} finally {
						release.resolve();
						await Promise.allSettled([pending, original.session.abort()]);
						rmSync(cwd, { recursive: true, force: true });
					}
				},
			);
		}
	}

	for (const operation of ["classify", "generateImages"] as const) {
		it(`restores the conversational swipe tail instead of a detached late ${operation} receipt`, async () => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-codemode-swipe-usage-"));
			const manager = SessionManager.create(cwd, join(cwd, "sessions"));
			const release = Promise.withResolvers<void>();
			const started = Promise.withResolvers<void>();
			const { harness } = await setup({
				classifierRelease: operation === "classify" ? release.promise : undefined,
				imageRelease: operation === "generateImages" ? release.promise : undefined,
				onModelCall: () => started.resolve(),
				harnessOptions: {
					cwd,
					sessionManager: manager,
					extensionFactories: [
						(pi) =>
							pi.registerTool({
								name: "wait_for_dispatch",
								label: "Wait for dispatch",
								description: "Wait until the model provider has started",
								parameters: Type.Object({}),
								exposure: "codemode",
								execute: async () => {
									await started.promise;
									return { content: [{ type: "text", text: "dispatched" }], details: {} };
								},
							}),
					],
				},
			});
			const call =
				operation === "classify"
					? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
					: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
			try {
				harness.setResponses([fauxAssistantMessage("original version")]);
				await harness.session.prompt("versioned question");
				const originalGroup = harness.session.getSwipeGroup()!;
				const originalVersion = originalGroup.versions[originalGroup.currentIndex];
				expect((await run(harness, `${call}; await tools.wait_for_dispatch({}); return "detached";`)).isError).toBe(
					false,
				);
				harness.setResponses([fauxAssistantMessage("later conversational answer")]);
				await harness.session.prompt("later conversational question");
				manager.appendCustomEntry("retained-tail-state", { retained: true });
				manager.appendSystemPrompt("retained tail policy");
				harness.session.refreshContext();
				const selected = manager.getLeafId();
				const branch = structuredClone(manager.getBranch());
				const projection = structuredClone(manager.buildSessionProjection());
				const messages = structuredClone(harness.session.messages);
				expect(branch.some((entry) => entry.type === "message" && entry.message.role === "toolResult")).toBe(true);
				manager.branch(originalGroup.anchorEntryId);
				harness.session.refreshContext();
				harness.setResponses([fauxAssistantMessage("alternative version")]);
				await harness.session.continue();
				const group = harness.session.getSwipeGroup()!;
				const originalIndex = group.versions.findIndex((entry) => entry.id === originalVersion.id);
				expect(group.versions).toHaveLength(2);
				expect(originalIndex).toBeGreaterThanOrEqual(0);
				const alternativeLeaf = manager.getLeafId();
				// Only Date is faked: provider/sandbox scheduling keeps its real timers.
				const latest = Math.max(...manager.getEntries().map((entry) => Date.parse(entry.timestamp)));
				vi.useFakeTimers({ toFake: ["Date"], now: latest + 1000 });
				release.resolve();
				await vi.waitFor(() =>
					expect(manager.getEntries().filter((entry) => entry.type === "usage")).toHaveLength(1),
				);
				vi.useRealTimers();
				expect(manager.getLeafId()).toBe(alternativeLeaf);
				expect(harness.session.goToSwipeVersion(group, originalIndex)).toBe(true);
				expect(manager.getLeafId()).toBe(selected);
				expect(manager.getBranch()).toEqual(branch);
				expect(manager.buildSessionProjection()).toEqual(projection);
				expect(harness.session.messages).toEqual(messages);
				const reopened = SessionManager.open(manager.getSessionFile()!, undefined, cwd);
				expect(reopened.getEntries().filter((entry) => entry.type === "usage")).toHaveLength(1);
				const { harness: resumed } = await setup({ harnessOptions: { cwd, sessionManager: reopened } });
				const resumedGroup = resumed.session.getSwipeGroup()!;
				expect(resumed.session.goToSwipeVersion(resumedGroup, originalIndex)).toBe(true);
				expect(reopened.getLeafId()).toBe(selected);
				expect(reopened.getBranch()).toEqual(branch);
				expect(reopened.buildSessionProjection()).toEqual(projection);
			} finally {
				vi.useRealTimers();
				release.resolve();
				await harness.session.abort();
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}

	for (const operation of ["classify", "generateImages"] as const) {
		it(`keeps late ${operation} receipts on the original manager after definition reuse and branch replacement`, async () => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-codemode-rebound-usage-"));
			const manager = SessionManager.create(cwd, join(cwd, "sessions"));
			const release = Promise.withResolvers<void>();
			const started = Promise.withResolvers<void>();
			const definition = createCodemodeToolDefinition({ models: true });
			const { harness: original } = await setup({
				codemodeDefinition: definition,
				classifierRelease: operation === "classify" ? release.promise : undefined,
				imageRelease: operation === "generateImages" ? release.promise : undefined,
				onModelCall: () => started.resolve(),
				harnessOptions: { cwd, sessionManager: manager },
			});
			const call =
				operation === "classify"
					? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
					: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
			const pending = run(original, `await ${call};`);
			try {
				await started.promise;
				const dispatchParent = manager.getLeafId();
				await original.session.abort();
				expect((await pending).isError).toBe(true);
				const sessionFile = manager.getSessionFile();
				if (!sessionFile) throw new Error("Expected the original session file");
				const branchPoint = manager.getBranch().find((entry) => entry.type === "message");
				if (!branchPoint) throw new Error("Expected an original prompt");
				manager.branch(branchPoint.id);
				const replacementLeaf = manager.appendCustomEntry("replacement-branch", {});
				original.session.dispose();
				// Rebinding the exact same definition must not redirect the old executor's callback.
				const { harness: replacement } = await setup({ codemodeDefinition: definition });
				expect((await run(replacement, `await ${call};`)).isError).toBe(false);
				const expected = operation === "classify" ? usage(300, 0.001) : usage(100, 0.04);
				expect(replacement.session.getSessionStats().cost).toBe(expected.cost.total);
				const replacementEventCount = replacement.eventsOfType("entry_appended").length;
				// Even a listener accidentally retained by a host must not receive disposed-owner events.
				original.session.subscribe((event) => original.events.push(event));
				release.resolve();
				await vi.waitFor(() => expect(getUsageTotals(manager.getEntries()).cost).toBe(expected.cost.total));
				const model = operation === "classify" ? scorerModel : painterModel;
				for (const current of [manager, SessionManager.open(sessionFile)]) {
					expect(current.getEntries().filter((entry) => entry.type === "usage")).toEqual([
						expect.objectContaining({
							parentId: dispatchParent,
							provider: model.provider,
							model: model.id,
							usage: expected,
						}),
					]);
					expect(current.getLeafId()).toBe(replacementLeaf);
					expect(current.getBranch().some((entry) => entry.type === "usage")).toBe(false);
				}
				expect(replacement.session.getSessionStats().cost).toBe(expected.cost.total);
				expect(replacement.sessionManager.getEntries().filter((entry) => entry.type === "usage")).toHaveLength(1);
				expect(replacement.eventsOfType("entry_appended")).toHaveLength(replacementEventCount);
				expect(original.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage")).toEqual([]);
			} finally {
				release.resolve();
				await Promise.allSettled([pending, original.session.abort()]);
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}

	for (const operation of ["classify", "generateImages"] as const) {
		it(`persists late ${operation} usage after reload without notifying the replacement runtime`, async () => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-codemode-reloaded-usage-"));
			const manager = SessionManager.create(cwd, join(cwd, "sessions"));
			const release = Promise.withResolvers<void>();
			const started = Promise.withResolvers<void>();
			const factories = [createCodemodeExtension()];
			let extensions = await createTestExtensionsResult(factories, cwd);
			const resourceLoader = {
				...createTestResourceLoader(),
				getExtensions: () => extensions,
				reload: async () => {
					extensions = await createTestExtensionsResult(factories, cwd);
				},
			};
			const { harness } = await setup({
				classifierRelease: operation === "classify" ? release.promise : undefined,
				imageRelease: operation === "generateImages" ? release.promise : undefined,
				onModelCall: () => started.resolve(),
				harnessOptions: { cwd, sessionManager: manager, resourceLoader },
			});
			const call =
				operation === "classify"
					? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
					: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
			const pending = run(harness, `await ${call};`);
			try {
				await started.promise;
				await harness.session.abort();
				expect((await pending).isError).toBe(true);
				const sessionFile = manager.getSessionFile();
				if (!sessionFile) throw new Error("Expected the original session file");
				const originalRunner = harness.session.extensionRunner;
				await harness.session.reload();
				expect(harness.session.extensionRunner).not.toBe(originalRunner);
				const expected = operation === "classify" ? usage(300, 0.001) : usage(100, 0.04);
				const model = operation === "classify" ? scorerModel : painterModel;
				release.resolve();
				await vi.waitFor(() => expect(getUsageTotals(manager.getEntries()).cost).toBe(expected.cost.total));
				for (const current of [manager, SessionManager.open(sessionFile)]) {
					expect(current.getEntries().filter((entry) => entry.type === "usage")).toEqual([
						expect.objectContaining({ provider: model.provider, model: model.id, usage: expected }),
					]);
				}
				expect(harness.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage")).toEqual([]);
			} finally {
				release.resolve();
				await Promise.allSettled([pending, harness.session.abort()]);
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}

	for (const operation of ["classify", "generateImages"] as const) {
		it(`preserves same-file replacement history when late ${operation} usage arrives before an atomic rewrite`, async () => {
			const cwd = mkdtempSync(join(tmpdir(), "pi-codemode-same-file-usage-"));
			const manager = SessionManager.create(cwd, join(cwd, "sessions"));
			const release = Promise.withResolvers<void>();
			const started = Promise.withResolvers<void>();
			let callSignal: AbortSignal | undefined;
			const {
				harness: original,
				observed,
				imageRequests,
			} = await setup({
				classifierRelease: operation === "classify" ? release.promise : undefined,
				imageRelease: operation === "generateImages" ? release.promise : undefined,
				onModelCall: (signal) => {
					callSignal = signal;
					started.resolve();
				},
				harnessOptions: { cwd, sessionManager: manager },
			});
			const call =
				operation === "classify"
					? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
					: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
			let settled = false;
			const pending = run(original, `await ${call};`).then((result) => {
				settled = true;
				return result;
			});
			try {
				await started.promise;
				const dispatchParent = manager.getLeafId();
				const abort = original.session.abort();
				await vi.waitFor(() => expect(settled).toBe(true));
				await abort;
				expect((await pending).isError).toBe(true);
				expect(callSignal?.aborted).toBe(true);
				original.session.dispose();
				const file = manager.getSessionFile()!;
				const reopened = SessionManager.open(file, undefined, cwd);
				expect(reopened).not.toBe(manager);
				const { harness: replacement } = await setup({ harnessOptions: { cwd, sessionManager: reopened } });
				const root = reopened.getBranch().find((entry) => entry.type === "message")!;
				reopened.branch(root.id);
				replacement.setResponses([fauxAssistantMessage("new runtime answer")]);
				await replacement.session.prompt("new runtime question");
				const newHistory = structuredClone(reopened.getEntries());
				const selected = reopened.getLeafId();
				const projection = structuredClone(reopened.buildSessionProjection());
				const branch = structuredClone(reopened.getBranch());
				const replacementEvents = replacement.eventsOfType("entry_appended").length;
				original.session.subscribe((event) => original.events.push(event));
				const expected = operation === "classify" ? usage(300, 0.001) : usage(100, 0.04);
				const model = operation === "classify" ? scorerModel : painterModel;
				release.resolve();
				await vi.waitFor(() => {
					const receipts = readFileSync(file, "utf8")
						.trim()
						.split("\n")
						.map((line) => JSON.parse(line))
						.filter((entry) => entry.type === "usage");
					expect(receipts).toHaveLength(1);
				});
				const check = (current: SessionManager) => {
					for (const entry of newHistory) expect(current.getEntry(entry.id)).toEqual(entry);
					expect(current.getLeafId()).toBe(selected);
					expect(current.getBranch()).toEqual(branch);
					expect(current.buildSessionProjection()).toEqual(projection);
					expect(current.getEntries().filter((entry) => entry.type === "usage")).toEqual([
						expect.objectContaining({
							parentId: dispatchParent,
							provider: model.provider,
							model: model.id,
							usage: expected,
						}),
					]);
					expect(
						getUsageCostBreakdown(current.getEntries()).filter((entry) => entry.key.startsWith("scorer/")),
					).toEqual([
						{ key: `${model.provider}/${model.id}`, cost: expected.cost.total, tokens: expected.totalTokens },
					]);
				};
				check(reopened);
				check(SessionManager.open(file, undefined, cwd));
				const receipt = reopened.getEntries().find((entry) => entry.type === "usage")!;
				// A subsequent full-file commit must start from the receipt-bearing active manager.
				reopened.editMessages((draft) => {
					draft.appendCustomEntry("after-receipt-rewrite", { retained: true });
				});
				for (const current of [reopened, SessionManager.open(file, undefined, cwd)]) {
					for (const entry of newHistory) expect(current.getEntry(entry.id)).toEqual(entry);
					expect(current.getEntries().filter((entry) => entry.type === "usage")).toEqual([receipt]);
					expect(current.getLeafId()).toBe(reopened.getLeafId());
				}
				expect(operation === "classify" ? observed : imageRequests).toHaveLength(1);
				expect(replacement.eventsOfType("entry_appended")).toHaveLength(replacementEvents);
				expect(original.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage")).toEqual([]);
			} finally {
				release.resolve();
				await Promise.allSettled([pending, original.session.abort()]);
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}

	for (const operation of ["classify", "generateImages"] as const) {
		for (const replacement of [false, true]) {
			it.each(["partial-append", "complete-append", "fsync"] as const)(
				`retries delivered late ${operation} usage after one actual %s failure (same-file replacement: ${replacement})`,
				async (stage) => {
					const actual = await vi.importActual<typeof fs>("fs");
					const cwd = mkdtempSync(join(tmpdir(), "pi-codemode-retry-usage-"));
					const manager = SessionManager.create(cwd, join(cwd, "sessions"));
					const release = Promise.withResolvers<void>();
					const started = Promise.withResolvers<void>();
					const failed = Promise.withResolvers<void>();
					let providerCalls = 0;
					const {
						harness: original,
						observed,
						imageRequests,
					} = await setup({
						classifierRelease: operation === "classify" ? release.promise : undefined,
						imageRelease: operation === "generateImages" ? release.promise : undefined,
						onModelCall: () => {
							providerCalls++;
							started.resolve();
						},
						harnessOptions: { cwd, sessionManager: manager },
					});
					const call =
						operation === "classify"
							? `models.classify({ provider: "scorer", id: "judge" }, { state: { text: "good" }, questions: ${questions} })`
							: 'models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }] })';
					let settled = false;
					const pending = run(original, `await ${call};`).then((result) => {
						settled = true;
						return result;
					});
					try {
						await started.promise;
						const dispatchParent = manager.getLeafId();
						const abort = original.session.abort();
						await vi.waitFor(() => expect(settled).toBe(true));
						await abort;
						const result = await pending;
						expect(result.isError).toBe(true);
						expect(result.usage).toBeUndefined();
						const file = manager.getSessionFile()!;
						const bytes = readFileSync(file);
						const entries = structuredClone(manager.getEntries());
						const selected = manager.getLeafId();
						const projection = structuredClone(manager.buildSessionProjection());
						const failure = new Error(`injected actual receipt ${stage} failure`);
						if (stage === "fsync") {
							vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
								failed.resolve();
								throw failure;
							});
						} else {
							vi.mocked(fs.appendFileSync).mockImplementationOnce((path, data) => {
								if (typeof data !== "string") throw new Error("Expected a serialized receipt batch");
								actual.appendFileSync(path, stage === "partial-append" ? data.slice(0, 60) : data);
								failed.resolve();
								throw failure;
							});
						}
						release.resolve();
						await failed.promise;
						expect(operation === "classify" ? observed : imageRequests).toHaveLength(1);
						expect(manager.getEntries()).toEqual(entries);
						expect(manager.getLeafId()).toBe(selected);
						expect(manager.buildSessionProjection()).toEqual(projection);
						expect(readFileSync(file)).toEqual(bytes);
						let current = original;
						if (replacement) {
							original.session.dispose();
							original.session.subscribe((event) => original.events.push(event));
							const reopened = SessionManager.open(file, undefined, cwd);
							({ harness: current } = await setup({ harnessOptions: { cwd, sessionManager: reopened } }));
						}
						// Retry persistence of the delivered receipt, never the paid model call.
						current.session.flushPendingPersistence();
						current.session.flushPendingUsage();
						current.session.flushPendingPersistence();
						const expected = operation === "classify" ? usage(300, 0.001) : usage(100, 0.04);
						const model = operation === "classify" ? scorerModel : painterModel;
						for (const owner of [current.sessionManager, SessionManager.open(file, undefined, cwd)]) {
							for (const entry of entries) expect(owner.getEntry(entry.id)).toEqual(entry);
							expect(owner.getLeafId()).toBe(selected);
							expect(owner.buildSessionProjection()).toEqual(projection);
							expect(owner.getEntries().filter((entry) => entry.type === "usage")).toEqual([
								expect.objectContaining({
									parentId: dispatchParent,
									provider: model.provider,
									model: model.id,
									usage: expected,
								}),
							]);
							expect(
								getUsageCostBreakdown(owner.getEntries()).filter((entry) => entry.key.startsWith("scorer/")),
							).toEqual([
								{
									key: `${model.provider}/${model.id}`,
									cost: expected.cost.total,
									tokens: expected.totalTokens,
								},
							]);
						}
						expect(providerCalls).toBe(1);
						expect(operation === "classify" ? observed : imageRequests).toHaveLength(1);
						expect(
							current.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage"),
						).toEqual([]);
						if (replacement) {
							expect(
								original.eventsOfType("entry_appended").filter((event) => event.entry.type === "usage"),
							).toEqual([]);
						}
					} finally {
						release.resolve();
						await Promise.allSettled([pending, original.session.abort()]);
						rmSync(cwd, { recursive: true, force: true });
					}
				},
			);
		}
	}

	it("notes generated images that the script did not show", async () => {
		const { harness } = await setup();
		const result = await run(
			harness,
			`
			const [model] = await models.getAvailableOfType("image", "scorer");
			const generated = await models.generateImages(model, { input: [{ type: "text", text: "a fox" }] });
			return generated.stopReason;
		`,
		);
		expect(result.isError).toBe(false);
		expect(resultText(result)).toBe(
			"stop\nNote: models.generateImages() returned 1 image that the script did not show. Show each image block of result.output with image(block).",
		);
	});

	it("reports provider errors as results and invalid arguments as exceptions", async () => {
		const { harness } = await setup();
		const result = await run(
			harness,
			`
			const model = await models.getModelOfType("classifier", "scorer", "judge");
			const failed = await models.classify(model, { state: { text: "explode" }, questions: ${questions} });
			const textOnly = await models.classify(model, {
				state: { text: "good" },
				images: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
				questions: ${questions},
			});
			const attempt = async (fn) => { try { await fn(); return "ok"; } catch (error) { return error.message; } };
			return {
				failed: [failed.stopReason, failed.errorMessage],
				textOnly: [textOnly.stopReason, textOnly.errorMessage],
				badClassifierImage: await attempt(() =>
					models.classify(model, { state: {}, images: [{ data: "aW1hZ2U=" }], questions: ${questions} }),
				),
				badType: await attempt(() => models.getModelsOfType("video")),
				unknown: await attempt(() => models.classify({ provider: "scorer", id: "nope" }, {})),
				noModel: await attempt(() => models.classify("judge", {})),
				undefinedModel: await attempt(() => models.classify(undefined, {})),
				noState: await attempt(() => models.classify(model, { questions: ${questions} })),
				badQuestion: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "choice", instructions: "Kind?", criteria: ["a", "b"] } } }),
				),
				badImage: await attempt(() => models.generateImages({ provider: "scorer", id: "painter" }, { prompt: "a fox" })),
				arrayModel: await attempt(() => models.classify(["scorer", "judge"], {})),
				arrayContext: await attempt(() => models.classify(model, [])),
				arrayState: await attempt(() => models.classify(model, { state: [], questions: ${questions} })),
				arrayQuestions: await attempt(() => models.classify(model, { state: {}, questions: [] })),
				arrayQuestion: await attempt(() => models.classify(model, { state: {}, questions: { kind: [] } })),
				noInstructions: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "bool", criteria: { true: "y", false: "n" } } } }),
				),
				badBool: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "bool", instructions: "Ok?", criteria: ["y", "n"] } } }),
				),
				badKind: await attempt(() =>
					models.classify(model, { state: {}, questions: { kind: { type: "rank", instructions: "Rank?" } } }),
				),
				arrayImagesContext: await attempt(() => models.generateImages({ provider: "scorer", id: "painter" }, [])),
				badImageBlock: await attempt(() =>
					models.generateImages({ provider: "scorer", id: "painter" }, { input: [{ type: "text", text: "a fox" }, { type: "image", data: "aW1hZ2U=" }] }),
				),
				badSplit: await attempt(() => models.getModelOfType("classifier", "scorer/judge")),
			};
		`,
		);
		expect(result.isError).toBe(false);
		const value = JSON.parse(resultText(result));
		expect(value.failed).toEqual(["error", "classifier exploded"]);
		expect(value.textOnly).toEqual(["error", "Model scorer/judge does not accept image input"]);
		expect(value.badClassifierImage).toContain(
			"models.classify() context.images[0] must be an image block, got { data }.",
		);
		expect(value.badType).toContain('Unknown model type "video"');
		expect(value.unknown).toBe(
			'Unknown classifier model "scorer/nope". List the classifier models you can use with models.getAvailableOfType("classifier").',
		);
		expect(value.noModel).toContain(
			"models.classify() expects a classifier model as its first argument, got a string.",
		);
		expect(value.undefinedModel).toContain(
			"models.getModelOfType() returns undefined for an unknown provider or id.",
		);
		expect(value.noState).toContain("models.classify() context.state must be an object, got undefined.");
		expect(value.noState).toContain("codemode.md");
		expect(value.badQuestion).toContain(
			'context.questions.kind is a "choice" question, so criteria must map each label to its meaning.',
		);
		expect(value.badImage).toContain(
			"models.generateImages() context.input must be a non-empty array of blocks, got undefined.",
		);
		expect(value.badSplit).toContain("The provider and the id are separate arguments");
		expect(value.arrayModel).toContain(
			"models.classify() expects a classifier model as its first argument, got an array.",
		);
		expect(value.arrayContext).toContain(
			"models.classify() expects a context object as its second argument, got an empty array.",
		);
		expect(value.arrayState).toContain("models.classify() context.state must be an object, got an empty array.");
		expect(value.arrayQuestions).toContain(
			"models.classify() context.questions must map question IDs to questions, got an empty array.",
		);
		expect(value.arrayQuestion).toContain(
			"models.classify() context.questions.kind must be a question object, got an empty array.",
		);
		expect(value.noInstructions).toContain("models.classify() context.questions.kind.instructions must be a string.");
		expect(value.badBool).toContain(
			'context.questions.kind is a "bool" question, so criteria must be { true: string, false: string }.',
		);
		expect(value.badKind).toContain('context.questions.kind.type must be "choice", "score", or "bool", got "rank".');
		expect(value.arrayImagesContext).toContain(
			"models.generateImages() expects a context object as its second argument, got an empty array.",
		);
		expect(value.badImageBlock).toContain(
			"models.generateImages() context.input[1] must be a text or image block, got { type, data }.",
		);
		const details = result.details as unknown as CodemodeToolDetails;
		expect(details.calls.map((call) => [call.name, call.status, call.error])).toEqual([
			["models.classify", "error", "classifier exploded"],
			["models.classify", "error", "Model scorer/judge does not accept image input"],
		]);
		expect(result.usage).toBeUndefined();
	});
});
