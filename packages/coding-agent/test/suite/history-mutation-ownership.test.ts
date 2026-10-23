import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { createHarness } from "./harness.ts";

it.each(
	(["deleteMessage", "softDeleteMessage"] as const).flatMap((method) =>
		(["stream", "compact", "tree"] as const).map((owner) => ({ method, owner })),
	),
)("rejects $method of an existing message while a real $owner owns the session", async ({ method, owner }) => {
	const started = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const stream = createAssistantMessageEventStream();
	const harness = await createHarness({
		settings: { retry: { enabled: false }, compaction: { enabled: false, keepRecentTokens: 1, reserveTokens: 512 } },
		extensionFactories:
			owner === "stream"
				? undefined
				: [
						(pi) => {
							if (owner === "compact") {
								pi.on("session_before_compact", async () => {
									started.resolve();
									await release.promise;
									return { cancel: true };
								});
							} else {
								pi.on("session_before_tree", async () => {
									started.resolve();
									await release.promise;
									return { cancel: true };
								});
							}
						},
					],
	});
	let outcome: Promise<{ result: unknown } | { error: unknown }> | undefined;
	try {
		harness.setResponses([fauxAssistantMessage("first answer"), fauxAssistantMessage("second answer")]);
		await harness.session.prompt("first question");
		const target = harness.sessionManager.getLeafId()!;
		await harness.session.prompt("second question");
		if (owner === "stream")
			harness.session.agent.streamFunction = () => {
				started.resolve();
				return stream;
			};
		const running =
			owner === "stream"
				? harness.session.prompt("held request")
				: owner === "compact"
					? harness.session.compact({ keepRecentMessages: 1 })
					: harness.session.navigateTree(target, { summarize: true });
		outcome = running.then(
			(result) => ({ result }),
			(error: unknown) => ({ error }),
		);
		await Promise.race([
			started.promise,
			outcome.then(() => {
				throw new Error("Ownership gate absent");
			}),
		]);
		const targetEntry = harness.sessionManager.getEntry(target);
		expect(targetEntry).toMatchObject({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
		});
		expect(targetEntry?.deletedAt).toBeUndefined();
		const entries = structuredClone(harness.sessionManager.getEntries());
		const leaf = harness.sessionManager.getLeafId();
		const messages = structuredClone(harness.session.messages);
		const eventCount = harness.events.length;
		expect(() => harness.session[method](target)).toThrow(
			owner === "stream" ? /agent is running/ : /compaction is in progress/,
		);
		expect(harness.sessionManager.getEntries()).toEqual(entries);
		expect(harness.sessionManager.getLeafId()).toBe(leaf);
		expect(harness.session.messages).toEqual(messages);
		expect(harness.events.slice(eventCount)).toEqual([]);
		release.resolve();
		stream.push({ type: "done", reason: "stop", message: fauxAssistantMessage("held completed") });
		const completed = await outcome;
		if (owner === "compact") {
			expect(completed).toHaveProperty("error", expect.any(Error));
			expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
				aborted: true,
				errorMessage: undefined,
			});
		} else if (owner === "tree") expect(completed).toEqual({ result: { cancelled: true } });
		else {
			expect(completed).toEqual({ result: undefined });
			expect(harness.session.getLastAssistantText()).toBe("held completed");
		}
		expect(harness.session.isIdle).toBe(true);
		expect(harness.session[method](target)).toBe(true);
		expect(harness.session.getCopyableMessagesContaining("first answer")).toEqual([]);
	} finally {
		release.resolve();
		if (owner === "stream" && harness.session.isStreaming) {
			stream.end(fauxAssistantMessage("", { stopReason: "aborted" }));
		}
		await outcome?.catch(() => {});
		await harness.session.abort();
		harness.cleanup();
	}
});
