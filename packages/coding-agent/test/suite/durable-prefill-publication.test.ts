import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { getUsageTotals } from "../../src/core/usage-totals.ts";
import { createHarness, getMessageText } from "./harness.ts";

it.each(["success", "mismatch"] as const)(
	"keeps the original prefix and suffix durable while a continuation is held (%s)",
	async (outcome) => {
		const cwd = mkdtempSync(join(tmpdir(), "pi-durable-prefill-"));
		const manager = SessionManager.create(cwd, join(cwd, "sessions"));
		const harness = await createHarness({
			cwd,
			sessionManager: manager,
			fauxApi: "openai-completions",
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
		});
		const started = Promise.withResolvers<void>();
		const stream = createAssistantMessageEventStream();
		let running: Promise<void> | undefined;
		try {
			harness.setResponses([fauxAssistantMessage("raw partial", { stopReason: "aborted" })]);
			await harness.session.prompt("original request");
			const prefix = manager
				.getBranch()
				.find((entry) => entry.type === "message" && entry.message.role === "assistant");
			if (!prefix) throw new Error("Expected prefix");
			manager.appendContextEdit(prefix.id, { content: [{ type: "text", text: "edited partial" }] });
			const hidden = manager.appendCustomMessageEntry("suffix", "hidden suffix", false);
			manager.appendContextEdit(hidden, null);
			manager.appendMessage({ role: "system", content: "trailing policy", timestamp: 2 });
			manager.appendCompaction("checkpoint", prefix.id, 100);
			manager.appendUsage("suffix", "faux", "faux-1", {
				input: 7,
				output: 3,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 10,
				cost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, total: 1 },
			});
			harness.session.refreshContext();
			const original = structuredClone(manager.getEntries());
			const selected = manager.getLeafId();
			const bytes = readFileSync(manager.getSessionFile()!);
			const beforeUsage = getUsageTotals(manager.getEntries());
			const terminalUsage = {
				input: 11,
				output: 7,
				cacheRead: 3,
				cacheWrite: 2,
				totalTokens: 23,
				cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
			};
			let request: string[] = [];
			harness.session.agent.streamFunction = (_model, context) => {
				request = context.messages.map(getMessageText);
				started.resolve();
				return stream;
			};
			running = harness.session.continue();
			await Promise.race([
				started.promise,
				running.then(() => {
					throw new Error("Continuation ended before provider startup");
				}),
			]);
			expect(readFileSync(manager.getSessionFile()!)).toEqual(bytes);
			const held = SessionManager.open(manager.getSessionFile()!);
			expect(held.getEntries()).toEqual(original);
			expect(held.getLeafId()).toBe(selected);
			expect(request.filter((text) => text === "edited partial")).toEqual(["edited partial"]);
			expect(request.at(-1)).toBe("edited partial");
			expect(request).not.toContain("hidden suffix");
			stream.push({
				type: "done",
				reason: "stop",
				message: {
					...fauxAssistantMessage(outcome === "success" ? "edited partial completed" : "mismatched terminal"),
					usage: terminalUsage,
				},
			});
			await running;
			for (const current of [manager, SessionManager.open(manager.getSessionFile()!)]) {
				const projection = current.buildSessionContext().messages;
				expect(projection.filter((message) => message.role === "assistant").map(getMessageText)).toEqual([
					outcome === "success" ? "edited partial completed" : "edited partial",
				]);
				expect(projection.map(getMessageText)).not.toContain("hidden suffix");
				expect(projection.map(getMessageText)).toContain("trailing policy");
				const activeCheckpoint = current.getBranch().find((entry) => entry.type === "compaction");
				const activeAssistant = current
					.getBranch()
					.find(
						(entry) =>
							entry.type === "message" && entry.message.role === "assistant" && !entry.message.errorMessage,
					);
				expect(activeCheckpoint?.type === "compaction" ? activeCheckpoint.firstKeptEntryId : undefined).toBe(
					activeAssistant?.id,
				);
				expect(getUsageTotals(current.getEntries())).toEqual({
					input: beforeUsage.input + 11,
					output: beforeUsage.output + 7,
					cacheRead: beforeUsage.cacheRead + 3,
					cacheWrite: beforeUsage.cacheWrite + 2,
					cost: beforeUsage.cost + 10,
				});
			}
		} finally {
			stream.end(fauxAssistantMessage("", { stopReason: "aborted" }));
			await harness.session.abort();
			await running?.catch(() => {});
			harness.cleanup();
			rmSync(cwd, { recursive: true, force: true });
		}
	},
);
