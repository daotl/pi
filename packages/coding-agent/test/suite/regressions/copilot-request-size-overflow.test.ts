import { fauxAssistantMessage, fauxToolCall, type ImageContent } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../harness.ts";

const COPILOT_413 = 'github-copilot API error (413): {"message":"failed to parse request","code":""}';
const REQUEST_LIMIT = 32 * 1024 * 1024;
const RECENT_PROMPT = "Continue the task using the recent notes.";

function seedImageHistory(harness: Harness, imageData: string | readonly string[]): void {
	const timestamp = Date.now() - 10_000;
	const model = harness.getModel();
	harness.sessionManager.appendMessage({ role: "user", content: "Review the old images", timestamp });
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage(fauxToolCall("read", { path: "old-images" }, { id: "read-images" }), {
			stopReason: "toolUse",
			timestamp,
		}),
		provider: model.provider,
		api: model.api,
		model: model.id,
	});
	harness.sessionManager.appendMessage({
		role: "toolResult",
		toolCallId: "read-images",
		toolName: "read",
		content: Array.from(
			{ length: 89 },
			(_, index): ImageContent => ({
				type: "image",
				mimeType: "image/png",
				data: typeof imageData === "string" ? imageData : imageData[index]!,
			}),
		),
		isError: false,
		timestamp,
	});
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage("Finished reviewing the old images", { timestamp }),
		provider: model.provider,
		api: model.api,
		model: model.id,
	});
	// Keep a completed recent turn so recovery does not summarize the entire current
	// request when it omits the failed assistant attempt. The old images are outside
	// the default 20k-token retained tail.
	harness.sessionManager.appendMessage({
		role: "user",
		content: `Recent task notes: ${"x".repeat(80_000)}`,
		timestamp,
	});
	harness.sessionManager.appendMessage({
		...fauxAssistantMessage("Ready to continue", { timestamp }),
		provider: model.provider,
		api: model.api,
		model: model.id,
	});
	harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

describe("Copilot request-size overflow recovery", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("compacts an image-heavy history and retries after the real 413", async () => {
		const harness = await createHarness({
			provider: "github-copilot",
			models: [{ id: "faux-copilot", contextWindow: 1_000_000 }],
		});
		harnesses.push(harness);
		// Synthetic base64 only; no image decoding or network calls are involved.
		const imageData = "A".repeat(384 * 1024);
		seedImageHistory(harness, imageData);
		harness.setResponses([
			(context) => {
				expect(Buffer.byteLength(JSON.stringify(context))).toBeGreaterThan(REQUEST_LIMIT);
				// Throwing produces the zero-usage error seen in the affected session.
				throw new Error(COPILOT_413);
			},
			(context) => {
				expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(REQUEST_LIMIT);
				// Fitting images remain available to the summary, unlike the final retry.
				const images = context.messages.flatMap((message) =>
					Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : [],
				);
				expect(images.length).toBeGreaterThan(0);
				expect(images.length).toBeLessThan(89);
				expect(images.every((image) => image.data === imageData)).toBe(true);
				expect(JSON.stringify(context)).toContain("Review the old images");
				return fauxAssistantMessage("The old images have been reviewed. Continue with the recent task.");
			},
			(context) => {
				expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(REQUEST_LIMIT);
				return fauxAssistantMessage("Continued after compaction");
			},
		]);

		await harness.session.prompt(RECENT_PROMPT);

		expect(harness.faux.state.callCount).toBe(3);
		expect(harness.eventsOfType("compaction_start")).toEqual([{ type: "compaction_start", reason: "overflow" }]);
		expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
			reason: "overflow",
			aborted: false,
			willRetry: true,
		});
		// The session continued to a final answer instead of dying on the 413.
		expect(harness.session.getLastAssistantText()).toBe("Continued after compaction");
	});

	it("summarizes the newest fitting image suffix in order without rewriting persisted image payloads", async () => {
		const harness = await createHarness({
			provider: "github-copilot",
			models: [{ id: "faux-copilot", contextWindow: 1_000_000 }],
		});
		harnesses.push(harness);
		const imagePayloads = Array.from({ length: 89 }, (_, index) =>
			`${index < 44 ? "old" : "recent"}-${String(index).padStart(3, "0")}:`.padEnd(384 * 1024, "A"),
		);
		seedImageHistory(harness, imagePayloads);
		const persistedImages = () =>
			harness.sessionManager
				.getEntries()
				.flatMap((entry) =>
					entry.type === "message" &&
					entry.message.role === "toolResult" &&
					entry.message.toolCallId === "read-images"
						? entry.message.content.filter((block): block is ImageContent => block.type === "image")
						: [],
				);
		const originalImages = imagePayloads.map((data) => ({ type: "image", mimeType: "image/png", data }));
		expect(persistedImages()).toEqual(originalImages);
		harness.setResponses([
			(context) => {
				expect(Buffer.byteLength(JSON.stringify(context))).toBeGreaterThan(REQUEST_LIMIT);
				throw new Error(COPILOT_413);
			},
			(context) => {
				const summaryBytes = Buffer.byteLength(JSON.stringify(context));
				expect(summaryBytes).toBeLessThan(REQUEST_LIMIT);
				const images = context.messages.flatMap((message) =>
					Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : [],
				);
				expect(images.length).toBeGreaterThan(0);
				expect(images.length).toBeLessThan(imagePayloads.length);
				const firstRetained = imagePayloads.length - images.length;
				expect(images.map((image) => image.data)).toEqual(imagePayloads.slice(firstRetained));
				// One more older image would exceed the bound: keep the largest recent suffix, not an arbitrary subset.
				expect(
					summaryBytes + Buffer.byteLength(JSON.stringify(originalImages[firstRetained - 1])) + 1,
				).toBeGreaterThanOrEqual(REQUEST_LIMIT);
				expect(persistedImages()).toEqual(originalImages);
				return fauxAssistantMessage("Retained the newest image evidence in chronological order.");
			},
			(context) => {
				expect(Buffer.byteLength(JSON.stringify(context))).toBeLessThan(REQUEST_LIMIT);
				return fauxAssistantMessage("Continued with the recent images summarized");
			},
		]);

		await harness.session.prompt(RECENT_PROMPT);

		expect(harness.faux.state.callCount).toBe(3);
		expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
			reason: "overflow",
			aborted: false,
			willRetry: true,
		});
		expect(harness.session.getLastAssistantText()).toBe("Continued with the recent images summarized");
		expect(persistedImages()).toEqual(originalImages);
	});

	it("rejects recovery before dispatch when system instructions alone exceed the context byte bound", async () => {
		const harness = await createHarness({
			provider: "github-copilot",
			models: [{ id: "faux-copilot", contextWindow: 1_000_000 }],
		});
		harnesses.push(harness);
		seedImageHistory(harness, "small-fitting-image");
		const convert = harness.session.agent.convertToLlm;
		const oversizedPolicy = "P".repeat(REQUEST_LIMIT);
		harness.session.agent.convertToLlm = async (messages) =>
			(await convert(messages)).map((message) =>
				message.role === "system" ? { ...message, content: oversizedPolicy } : message,
			);
		harness.setResponses([
			(context) => {
				expect(Buffer.byteLength(JSON.stringify(context))).toBeGreaterThan(REQUEST_LIMIT);
				throw new Error(COPILOT_413);
			},
		]);

		await harness.session.prompt(RECENT_PROMPT);

		expect(harness.faux.state.callCount).toBe(1);
		expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
			reason: "overflow",
			aborted: false,
			willRetry: false,
			errorMessage: expect.stringContaining("converted history exceeds the recovery context byte budget"),
		});
		expect(harness.sessionManager.getEntries().some((entry) => entry.type === "compaction")).toBe(false);
	});
});
