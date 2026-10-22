import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import { DefaultResourceLoader } from "../../src/core/resource-loader.ts";
import { createAgentSession } from "../../src/core/sdk.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { assistantMsg, userMsg } from "../utilities.ts";
import { createHarness } from "./harness.ts";

const hostile = ["HISTORICAL HOSTILE PREAMBLE", "HISTORICAL HOSTILE SECTION", "HISTORICAL HOSTILE TAIL"];
const currentPolicy = "CURRENT USER SUMMARY POLICY";
const hookPolicy = "ALLOWED SUMMARY HOOK AUGMENTATION";

// Exercise both summary entry points with a persisted, valid conversation. The
// local faux provider captures the final request, not an intermediate projection.
test.each(["compact", "branch"] as const)(
	"untrusted %s sanitizes saved system history before summary hooks",
	async (operation) => {
		const root = mkdtempSync(join(tmpdir(), "pi-untrusted-summary-"));
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		const owner = await createHarness({ withConfiguredAuth: false });
		let session: AgentSession | undefined;
		try {
			const manager = SessionManager.create(cwd, join(root, "sessions"));
			const sections = { preamble: hostile[0], custom: hostile[1] };
			manager.appendSystemPrompt(hostile.slice(0, 2).join("\n\n"), undefined, [], sections);
			manager.appendMessage({ role: "system", content: "", sections, timestamp: 0 });
			const targetId = manager.appendMessage(userMsg("Explain the parser ownership rules."));
			manager.appendMessage(assistantMsg("Each parser owns its input buffer until parsing completes."));
			manager.appendMessage(userMsg("Investigate the alternative parser branch."));
			manager.appendMessage(assistantMsg("The alternative copies the input buffer before parsing."));
			manager.appendMessage({ role: "system", content: hostile[2], sections: { custom: hostile[1] }, timestamp: 1 });
			manager.appendMessage(userMsg("Keep the ownership conclusion for the next task."));
			manager.appendMessage(assistantMsg("The caller retains ownership after the parser returns."));

			const settings = SettingsManager.inMemory(
				{
					retry: { enabled: false },
					compaction: { enabled: false, keepRecentTokens: 1 },
				},
				{ projectTrusted: false },
			);
			const hookInputs: string[] = [];
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				settingsManager: settings,
				systemPrompt: currentPolicy,
				noExtensions: true,
				noSkills: true,
				noThemes: true,
				noPromptTemplates: true,
				noContextFiles: true,
				extensionFactories: [
					(pi) => {
						pi.on("context_with_system", (event) => {
							hookInputs.push(JSON.stringify(event.messages));
							return { messages: [...event.messages, { role: "system", content: hookPolicy, timestamp: 2 }] };
						});
					},
				],
			});
			await loader.reload();
			({ session } = await createAgentSession({
				cwd,
				agentDir,
				sessionManager: SessionManager.open(manager.getSessionFile()!, undefined, cwd),
				settingsManager: settings,
				resourceLoader: loader,
				modelRuntime: owner.session.modelRuntime,
				model: owner.getModel(),
				tools: ["read"],
			}));
			const requests: Array<{ prompt: string; messages: string }> = [];
			session.agent.streamFunction = (_model, context) => {
				requests.push({
					prompt: getCurrentSystemPrompt(context.messages),
					messages: JSON.stringify(context.messages),
				});
				const stream = createAssistantMessageEventStream();
				stream.push({
					type: "done",
					reason: "stop",
					message: fauxAssistantMessage("Ownership summary: the caller retains its input buffer."),
				});
				return stream;
			};

			if (operation === "compact") {
				const result = await session.compact();
				expect(result.summary).toContain("Ownership summary");
			} else {
				const result = await session.navigateTree(targetId, { summarize: true });
				expect(result.cancelled).toBe(false);
				expect(result.summaryEntry?.summary).toContain("Ownership summary");
			}

			expect(hookInputs).not.toEqual([]);
			expect(requests).not.toEqual([]);
			for (const input of hookInputs) {
				expect(input).toContain(currentPolicy);
				for (const marker of hostile) expect(input).not.toContain(marker);
			}
			for (const request of requests) {
				expect(request.prompt).toContain(currentPolicy);
				expect(request.prompt).toContain(hookPolicy);
				expect(request.messages).toContain("alternative copies the input buffer");
				for (const marker of hostile) expect(request.messages).not.toContain(marker);
			}
		} finally {
			await session?.dispose();
			owner.cleanup();
			rmSync(root, { recursive: true, force: true });
		}
	},
);
