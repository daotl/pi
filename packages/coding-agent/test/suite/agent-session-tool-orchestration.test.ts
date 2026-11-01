import { fauxAssistantMessage, fauxToolCall, getCurrentTools, type TranscriptContext } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionAPI } from "../../src/core/extensions/types.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createCodemodeExtension } from "../../src/extensions/codemode/index.ts";
import { createToolSearchExtension } from "../../src/extensions/tool-search/index.ts";
import { createHarness, type Harness } from "./harness.ts";

/**
 * A tool that calls other tools, built only on the extension API: its own name, exposure, loadout
 * hook, and ctx.executeTool(). Codemode and tool search use the same mechanisms.
 */
function orchestratorExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "echo",
		label: "echo",
		description: "Echo text.",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_id, { text }) => ({ content: [{ type: "text", text: `echo: ${text}` }], details: {} }),
	});
	pi.registerTool({
		name: "helper",
		label: "helper",
		description: "Only reachable from other tools.",
		parameters: Type.Object({}),
		exposure: "codemode",
		execute: async () => ({ content: [{ type: "text", text: "helped" }], details: {} }),
	});
	pi.registerTool({
		name: "run_tools",
		label: "run_tools",
		description: "Runs tools.",
		parameters: Type.Object({}),
		exposure: "model-only",
		prepareLoadout: (loadout) => ({
			descriptions: {
				run_tools: `Runs tools: ${loadout.callable.map((tool) => tool.name).join(", ")}`,
				echo: "Echo text (also callable from run_tools).",
			},
			hiddenDeclarations: ["echo"],
		}),
		execute: async (_id, _params, _signal, _onUpdate, ctx) => {
			const helper = await ctx.executeTool("helper", {});
			const echo = await ctx.executeTool("echo", { text: "hi" });
			const self = await ctx.executeTool("run_tools", {});
			const text = [helper, echo, self]
				.map((outcome) => (outcome.result.content[0] as { text: string }).text)
				.join(" | ");
			return { content: [{ type: "text", text }], details: {} };
		},
	});
}

describe("AgentSession tool orchestration", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it.each([false, true])(
		"declares an inactive late tool selected by +name with builtins disabled=%s",
		async (builtinless) => {
			const harness = await createHarness({
				initialActiveToolNames: builtinless ? [] : undefined,
				defaultToolModifiers: ["+late_tool"],
				extensionFactories: [
					(pi) => {
						pi.on("session_start", () => {
							pi.registerTool({
								name: "late_tool",
								label: "Late tool",
								description: "Explicitly selected late tool",
								parameters: Type.Object({}),
								defaultActive: false,
								execute: async () => ({ content: [{ type: "text", text: "late result" }], details: {} }),
							});
						});
					},
				],
			});
			harnesses.push(harness);
			await harness.session.bindExtensions({});
			let declared: string[] | undefined;
			harness.setResponses([
				(context) => {
					declared = getCurrentTools(context.messages).map((tool) => tool.name);
					return fauxAssistantMessage("late tool loadout received");
				},
			]);
			await harness.session.prompt("inspect late tool selection");
			expect(declared).toEqual(builtinless ? ["late_tool"] : ["read", "bash", "edit", "write", "late_tool"]);
		},
	);

	it.each(["selected", "replaced", "next run"] as const)(
		"declares late initial tools only while the %s pending loadout applies",
		async (selection) => {
			let registerLate: (() => void) | undefined;
			const harness = await createHarness({
				initialActiveToolNames: ["read", "write", "late_tool"],
				extensionFactories: [
					(pi) => {
						registerLate = () => {
							pi.registerTool({
								name: "late_tool",
								label: "Late tool",
								description: "Initial late tool",
								parameters: Type.Object({}),
								defaultActive: false,
								execute: async () => ({ content: [{ type: "text", text: "late result" }], details: {} }),
							});
						};
					},
				],
			});
			harnesses.push(harness);
			await harness.session.bindExtensions({});
			if (selection === "replaced") harness.session.setActiveToolsByName(["read"]);
			if (selection === "next run") {
				harness.setResponses([fauxAssistantMessage("first run completed without late tools")]);
				await harness.session.prompt("start before registration");
			}
			if (!registerLate) throw new Error("Missing late tool registration");
			registerLate();
			let declared: string[] | undefined;
			harness.setResponses([
				(context) => {
					declared = getCurrentTools(context.messages).map((tool) => tool.name);
					return fauxAssistantMessage("loadout received");
				},
			]);
			await harness.session.prompt("inspect late initial selection");
			expect(declared).toEqual(
				selection === "selected"
					? ["read", "write", "late_tool"]
					: selection === "replaced"
						? ["read"]
						: ["read", "write"],
			);
		},
	);

	it.each(["late_tool", "mcp__server__lookup"])(
		"keeps restored removals out of requests when %s connects after session_start",
		async (name) => {
			const manager = SessionManager.inMemory();
			manager.appendMessage({
				role: "system",
				content: "",
				toolsAdded: ["read", name, "mcp__server__selected"].map((toolName) => ({
					name: toolName,
					description: toolName,
					parameters: Type.Object({}),
				})),
				timestamp: 0,
			});
			manager.appendMessage({
				role: "system",
				content: "",
				toolsRemoved: [{ name }],
				timestamp: 1,
			});
			let connect: (() => void) | undefined;
			const harness = await createHarness({
				sessionManager: manager,
				extensionFactories: [
					(pi) => {
						pi.on("session_start", () => {
							connect = () => {
								for (const toolName of [name, "mcp__server__selected", "new_tool"]) {
									pi.registerTool({
										name: toolName,
										label: toolName,
										description: "Late direct tool",
										parameters: Type.Object({}),
										...(toolName === "mcp__server__selected" ? { defaultActive: false } : {}),
										execute: async () => ({ content: [{ type: "text", text: "connected" }], details: {} }),
									});
								}
							};
						});
					},
				],
			});
			harnesses.push(harness);
			harness.session.refreshContext();
			await harness.session.bindExtensions({});
			expect(harness.session.getActiveToolNames()).toEqual(["read"]);
			if (!connect) throw new Error("Missing connection callback");
			connect();
			const expected = ["read", "mcp__server__selected", "new_tool"];
			expect(harness.session.getActiveToolNames()).toEqual(expected);
			expect(harness.session.getCallableToolNames()).toEqual(expected);
			// Explicit activation must still override the restored removal, even across another refresh.
			harness.session.setActiveToolsByName([...expected, name]);
			connect();
			expect(harness.session.getActiveToolNames()).toEqual([...expected, name]);
			harness.session.setActiveToolsByName(expected);
			let declared: string[] | undefined;
			harness.setResponses([
				(context) => {
					declared = getCurrentTools(context.messages).map((tool) => tool.name);
					return fauxAssistantMessage("restored tools received");
				},
			]);
			await harness.session.prompt("inspect restored tools");
			expect(declared).toEqual(expected);
		},
	);

	it.each(["branch", "replacement", "next run"] as const)(
		"drops abandoned restored removals at the %s boundary",
		async (boundary) => {
			const manager = SessionManager.inMemory();
			const unmentioned = manager.appendMessage({
				role: "system",
				content: "",
				toolsAdded: ["read", "write"].map((name) => ({ name, description: name, parameters: Type.Object({}) })),
				timestamp: 0,
			});
			manager.appendMessage({
				role: "system",
				content: "",
				toolsAdded: [{ name: "late_tool", description: "late tool", parameters: Type.Object({}) }],
				timestamp: 1,
			});
			manager.appendMessage({ role: "system", content: "", toolsRemoved: [{ name: "late_tool" }], timestamp: 2 });
			let registerLate: (() => void) | undefined;
			const harness = await createHarness({
				sessionManager: manager,
				extensionFactories: [
					(pi) => {
						registerLate = () => {
							pi.registerTool({
								name: "late_tool",
								label: "Late tool",
								description: "Late direct tool",
								parameters: Type.Object({}),
								execute: async () => ({ content: [{ type: "text", text: "late result" }], details: {} }),
							});
						};
					},
				],
			});
			harnesses.push(harness);
			harness.session.refreshContext();
			await harness.session.bindExtensions({});
			expect(harness.session.getActiveToolNames()).toEqual(["read", "write"]);
			if (boundary === "branch") await harness.session.navigateTree(unmentioned, { summarize: false });
			else if (boundary === "replacement") harness.session.setActiveToolsByName(["read"]);
			else {
				harness.setResponses([fauxAssistantMessage("completed before registration")]);
				await harness.session.prompt("start the next run");
			}
			if (!registerLate) throw new Error("Missing registration callback");
			registerLate();
			const expected = boundary === "replacement" ? ["read", "late_tool"] : ["read", "write", "late_tool"];
			expect(harness.session.getActiveToolNames()).toEqual(expected);
			expect(harness.session.getCallableToolNames()).toEqual(expected);
			let declared: string[] | undefined;
			harness.setResponses([
				(context) => {
					declared = getCurrentTools(context.messages).map((tool) => tool.name);
					return fauxAssistantMessage("current tools received");
				},
			]);
			await harness.session.prompt("inspect current tools");
			expect(declared).toEqual(expected);
		},
	);

	// #22: invocation modifiers must survive every selected-branch restoration path.
	it.each(["navigate", "swipe", "regenerate"] as const)(
		"keeps invocation tool modifiers across repeated %s restoration and provider requests",
		async (operation) => {
			const manager = SessionManager.inMemory();
			const policy = manager.appendMessage({
				role: "system",
				content: "",
				toolsAdded: ["read", "write"].map((name) => ({ name, description: name, parameters: Type.Object({}) })),
				timestamp: 0,
			});
			const anchor = manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
			manager.appendMessage(fauxAssistantMessage("first", { timestamp: 2 }));
			manager.branch(anchor);
			manager.appendMessage(fauxAssistantMessage("second", { timestamp: 3 }));
			const harness = await createHarness({ sessionManager: manager, defaultToolModifiers: ["-write", "+grep"] });
			harnesses.push(harness);
			const { session } = harness;
			expect(session.getActiveToolNames()).toEqual(["read", "grep"]);
			const group = session.getSwipeGroup();
			if (!group) throw new Error("Expected assistant swipe versions");
			for (let pass = 0; pass < 2; pass++) {
				if (operation === "navigate") await session.navigateTree(policy, { summarize: false });
				else if (operation === "swipe")
					expect(session.goToSwipeVersion({ ...group, currentIndex: -1 }, pass)).toBe(true);
				else session.prepareSwipeRegeneration(group);
				expect(session.getActiveToolNames()).toEqual(["read", "grep"]);
				expect(session.getCallableToolNames()).toEqual(["read", "grep"]);
				let declared: string[] | undefined;
				harness.setResponses([
					(context) => {
						declared = getCurrentTools(context.messages).map((tool) => tool.name);
						return fauxAssistantMessage("correct loadout");
					},
				]);
				await session.prompt("check tools");
				expect(declared).toEqual(["read", "grep"]);
				expect(session.messages.at(-1)).toMatchObject({
					role: "assistant",
					stopReason: "stop",
					content: [{ type: "text", text: "correct loadout" }],
				});
				expect(session.getActiveToolNames()).toEqual(["read", "grep"]);
			}
		},
	);

	it.each(["added", "removed"] as const)(
		"ignores soft-deleted tools %s deltas on resume and navigation through compaction",
		async (change) => {
			const manager = SessionManager.inMemory();
			manager.appendMessage({
				role: "system",
				content: "",
				toolsAdded: (change === "removed" ? ["read", "bash"] : ["read"]).map((name) => ({
					name,
					description: name,
					parameters: Type.Object({}),
				})),
				timestamp: 0,
			});
			const deleted = manager.appendMessage({
				role: "system",
				content: "",
				...(change === "added"
					? { toolsAdded: [{ name: "bash", description: "bash", parameters: Type.Object({}) }] }
					: { toolsRemoved: [{ name: "bash" }] }),
				timestamp: 1,
			});
			manager.softDeleteUnits([{ entryId: deleted }]);
			const retained = manager.appendMessage({ role: "user", content: "retained question", timestamp: 2 });
			const checkpoint = manager.appendCompaction("saved summary", retained, 100);
			manager.appendMessage({ role: "user", content: "later question", timestamp: 3 });
			const harness = await createHarness({ sessionManager: manager });
			harnesses.push(harness);
			const expected = change === "removed" ? ["read", "bash"] : ["read"];
			for (const navigate of [false, true]) {
				if (navigate) await harness.session.navigateTree(checkpoint, { summarize: false });
				expect(harness.session.getActiveToolNames()).toEqual(expected);
				expect(harness.session.getCallableToolNames()).toEqual(expected);
				let declared: string[] | undefined;
				harness.setResponses([
					(context) => {
						declared = getCurrentTools(context.messages).map((tool) => tool.name);
						return fauxAssistantMessage("visible policy restored");
					},
				]);
				await harness.session.prompt("check visible tools");
				expect(declared).toEqual(expected);
			}
		},
	);

	it("supports tools that call other tools under any name through the extension API", async () => {
		const toolCalls: string[] = [];
		const harness = await createHarness({
			initialActiveToolNames: [],
			extensionFactories: [
				orchestratorExtension,
				(pi) => {
					pi.on("tool_call", (event) => {
						toolCalls.push(`${event.toolName}:${event.parentToolCallId ?? "top"}`);
					});
				},
			],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});

		expect(harness.session.getActiveToolNames()).toEqual(["echo", "run_tools"]);
		expect(harness.session.getCallableToolNames()).toEqual(["echo", "helper"]);
		const find = (name: string) => harness.session.agent.state.tools.find((tool) => tool.name === name);
		expect(find("run_tools")?.description).toBe("Runs tools: echo, helper");
		expect(find("echo")?.description).toBe("Echo text (also callable from run_tools).");

		const requestTools: string[][] = [];
		harness.setResponses([
			(context: TranscriptContext) => {
				requestTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
				return fauxAssistantMessage([fauxToolCall("run_tools", {})], { stopReason: "toolUse" });
			},
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");

		// echo stays active, but its declaration is left out of requests.
		expect(requestTools[0]).toEqual(["run_tools"]);
		const result = harness.session.messages.find(
			(message): message is ToolResultMessage => message.role === "toolResult",
		);
		if (!result) throw new Error("No tool result");
		expect(result.content).toEqual([{ type: "text", text: "helped | echo: hi | Tool run_tools not found" }]);
		const parent = result.toolCallId;
		expect(toolCalls).toEqual(["run_tools:top", `helper:${parent}`, `echo:${parent}`]);
		expect(result.nestedCalls?.calls.map((call) => [call.id, call.name, call.status])).toEqual([
			[`${parent}/1`, "helper", "ok"],
			[`${parent}/2`, "echo", "ok"],
			[`${parent}/3`, "run_tools", "error"],
		]);
		// The record is persisted with the session.
		const persisted = harness.sessionManager
			.getBranch()
			.find((entry) => entry.type === "message" && entry.message.role === "toolResult");
		expect(persisted?.type === "message" && persisted.message).toMatchObject({ nestedCalls: result.nestedCalls });
	});

	it("registers codemode and tool_search inactive until they are named", async () => {
		const extensionFactories = [createCodemodeExtension(), createToolSearchExtension()];
		const plain = await createHarness({ extensionFactories });
		harnesses.push(plain);
		expect(plain.session.getAllTools().map((tool) => tool.name)).toEqual(
			expect.arrayContaining(["codemode", "tool_search"]),
		);
		expect(plain.session.getActiveToolNames()).toEqual(["read", "bash", "edit", "write"]);

		// --tools and the defaultTools setting name them explicitly.
		const allowed = await createHarness({ allowedToolNames: ["read", "codemode"], extensionFactories });
		harnesses.push(allowed);
		expect(allowed.session.getActiveToolNames()).toEqual(["read", "codemode"]);
		const initial = await createHarness({ initialActiveToolNames: ["tool_search"], extensionFactories });
		harnesses.push(initial);
		expect(initial.session.getActiveToolNames()).toEqual(["tool_search"]);
	});

	it("leaves results without nested calls unchanged", async () => {
		const harness = await createHarness({ initialActiveToolNames: [], extensionFactories: [orchestratorExtension] });
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "x" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.prompt("go");
		const result = harness.session.messages.find((message) => message.role === "toolResult");
		expect(result && "nestedCalls" in result).toBe(false);
	});
});
