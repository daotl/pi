import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { AgentSessionRuntime } from "../../src/core/agent-session-runtime.ts";
import { runRpcMode } from "../../src/modes/rpc/rpc-mode.ts";
import { createHarness } from "../suite/harness.ts";

// Real handler/session; extension summaries keep process-boundary retention deterministic.
globalThis.fetch = async () => {
	throw new Error("Network forbidden in compact RPC fixture");
};
const harness = await createHarness({
	settings: { compaction: { keepRecentTokens: 1 }, retry: { enabled: false } },
	extensionFactories: [
		(pi) => {
			pi.on("session_before_compact", (event) => ({
				compaction: {
					summary: `Summary: ${event.customInstructions ?? "default"}`,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
				},
			}));
		},
	],
});
for (let turn = 1; turn <= 3; turn++) {
	harness.sessionManager.appendMessage({ role: "user", content: `question ${turn}`, timestamp: turn * 2 });
	harness.sessionManager.appendMessage(fauxAssistantMessage(`answer ${turn}`, { timestamp: turn * 2 + 1 }));
}
harness.session.refreshContext();
const runtime = new AgentSessionRuntime(
	harness.session,
	{
		cwd: harness.tempDir,
		agentDir: harness.tempDir,
		modelRuntime: harness.session.modelRuntime,
		settingsManager: harness.settingsManager,
		resourceLoader: harness.session.resourceLoader,
		diagnostics: [],
	},
	async () => {
		throw new Error("Session replacement forbidden in compact RPC fixture");
	},
);
process.on("exit", () => harness.cleanup());
await runRpcMode(runtime);
