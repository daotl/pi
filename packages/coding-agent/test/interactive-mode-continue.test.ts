import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

type ContinueHost = {
	session: {
		isCompacting: boolean;
		isStreaming: boolean;
		agent: { state: { messages: unknown[]; model: { api: string; compat?: Record<string, unknown> } } };
		continue(): Promise<void>;
	};
	chatContainer: { clear(): void };
	renderInitialMessages(): void;
	showStatus(message: string): void;
	showError(message: string): void;
};

const handleContinueCommand = Reflect.get(InteractiveMode.prototype, "handleContinueCommand") as (
	this: ContinueHost,
) => Promise<void>;

/** Runs /continue on a session ending with a partial response that cannot be continued. */
async function statusFor(
	model: { api: string; compat?: Record<string, unknown> },
	last = fauxAssistantMessage("Partial response", { stopReason: "length" }),
): Promise<string | undefined> {
	const showStatus = vi.fn();
	const host: ContinueHost = {
		session: {
			isCompacting: false,
			isStreaming: false,
			agent: {
				state: {
					messages: [
						{ role: "user", content: "Hello", timestamp: 0 },
						fauxAssistantMessage("Complete response"),
						last,
					],
					model,
				},
			},
			continue: async () => {
				throw new Error("Cannot continue from message role: assistant");
			},
		},
		chatContainer: { clear: () => {} },
		renderInitialMessages: () => {},
		showStatus,
		showError: vi.fn(),
	};
	await handleContinueCommand.call(host);
	return showStatus.mock.calls.at(-1)?.[0];
}

describe("InteractiveMode /continue", () => {
	test("explains that resuming needs prefill support on an OpenAI-compatible model without it", async () => {
		expect(await statusFor({ api: "openai-completions" })).toContain("needs prefill support");
	});

	test("explains that resuming needs prefill support on other APIs", async () => {
		expect(await statusFor({ api: "anthropic-messages" })).toContain("needs prefill support");
	});

	test("asks for a new message after a completed response on a model without prefill support", async () => {
		expect(await statusFor({ api: "openai-completions" }, fauxAssistantMessage("Done"))).toBe(
			"Last message is from assistant. Send a message first or use /new to start fresh.",
		);
	});

	test("asks for a new message when the model supports prefill continuation", async () => {
		expect(await statusFor({ api: "openai-completions", compat: { supportsPrefillContinuation: true } })).toBe(
			"Last message is from assistant. Send a message first or use /new to start fresh.",
		);
	});
});
