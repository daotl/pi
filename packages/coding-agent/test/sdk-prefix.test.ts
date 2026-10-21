import { fauxAssistantMessage, type Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createHarness } from "./suite/harness.ts";

describe("SDK request prefix ownership", () => {
	it("prefixes string history and preserves text metadata without changing stored messages", async () => {
		const harness = await createHarness();
		let created: Awaited<ReturnType<typeof createAgentSession>> | undefined;
		try {
			harness.settingsManager.setIncomingMessagePrefix("[first] ");
			const manager = SessionManager.inMemory(harness.tempDir);
			const history: Message[] = [
				{ role: "user", content: "string history", timestamp: 1 },
				{
					role: "user",
					content: [
						{ type: "text", text: "block history", textSignature: "metadata" },
						{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
					],
					timestamp: 2,
				},
			];
			for (const message of history) manager.appendMessage(message);
			created = await createAgentSession({
				cwd: harness.tempDir,
				agentDir: harness.tempDir,
				model: harness.getModel(),
				modelRuntime: harness.session.modelRuntime,
				settingsManager: harness.settingsManager,
				sessionManager: manager,
				resourceLoader: harness.session.resourceLoader,
				noTools: "all",
			});
			const session = created.session;
			expect(await session.agent.convertToLlm(history)).toEqual([
				{ ...history[0], content: "[first] string history" },
				{
					...history[1],
					content: [
						{ type: "text", text: "[first] block history", textSignature: "metadata" },
						{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
					],
				},
			]);
			const requests: Message[][] = [];
			harness.setResponses(
				["one", "two"].map((answer) => (context) => {
					requests.push(structuredClone(context.messages));
					return fauxAssistantMessage(answer);
				}),
			);
			await session.prompt("new question");
			harness.settingsManager.setIncomingMessagePrefix("[live] ");
			await session.prompt("next question");
			expect(requests[0].filter((message) => message.role === "user")[0]).toMatchObject({
				content: "[first] string history",
			});
			expect(requests[1].filter((message) => message.role === "user").map((message) => message.content)).toEqual([
				"[live] string history",
				[
					{ type: "text", text: "[live] block history", textSignature: "metadata" },
					{ type: "image", data: "aGVsbG8=", mimeType: "image/png" },
				],
				[{ type: "text", text: "[live] new question" }],
				[{ type: "text", text: "[live] next question" }],
			]);
			expect(session.messages.filter((message) => message.role === "user").slice(0, 2)).toEqual(history);
		} finally {
			created?.session.dispose();
			harness.cleanup();
		}
	});
});
