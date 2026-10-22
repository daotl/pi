import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createHarness } from "./harness.ts";

it.each(["turn_end", "agent_before_settle"] as const)(
	"does not advertise a completed assistant behind system patches as runnable at %s",
	async (boundary) => {
		let observed: boolean | undefined;
		let requested = false;
		let patched = false;
		const manager = SessionManager.inMemory();
		const harness = await createHarness({
			sessionManager: manager,
			settings: { retry: { enabled: false }, compaction: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("turn_end", () => {
						if (patched) return;
						patched = true;
						// The runner rebuilds canonical preview after each handler, before the observer below.
						manager.appendMessage({ role: "system", content: "new policy", timestamp: 2 });
					});
					if (boundary === "turn_end")
						pi.on("turn_end", (event) => {
							observed = event.context.canContinue;
							if (!requested) {
								requested = true;
								return { continue: true };
							}
						});
					else
						pi.on("agent_before_settle", (event) => {
							observed = event.context.canContinue;
							if (!requested) {
								requested = true;
								return { continue: true };
							}
						});
				},
			],
		});
		try {
			harness.setResponses([fauxAssistantMessage("completed answer"), fauxAssistantMessage("must not regenerate")]);
			await harness.session.prompt("question");
			expect(observed).toBe(false);
			expect(harness.faux.state.callCount).toBe(1);
			expect(harness.session.getLastAssistantText()).toBe("completed answer");
			expect(harness.session.isIdle).toBe(true);
		} finally {
			await harness.session.abort();
			harness.cleanup();
		}
	},
);
