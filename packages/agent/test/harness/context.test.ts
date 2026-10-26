import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT, TODO_CONTEXT, withTelemetry } from "../../src/harness/context.ts";
import { InMemoryTelemetryContext, NOOP_TELEMETRY_CONTEXT } from "../../src/index.ts";

describe("harness Context telemetry", () => {
	it("uses no-op telemetry when none is attached", () => {
		expect(BACKGROUND_CONTEXT.telemetry).toBe(NOOP_TELEMETRY_CONTEXT);
		expect(TODO_CONTEXT.telemetry).toBe(NOOP_TELEMETRY_CONTEXT);
	});

	it("carries telemetry as an ordinary context value", async () => {
		const telemetry = new InMemoryTelemetryContext();

		await telemetry.startSpan({ name: "parent" }, async (span) => {
			const childContext = withTelemetry(span, BACKGROUND_CONTEXT);
			await childContext.telemetry.startSpan({ name: "child" }, () => undefined);
		});

		const spans = telemetry.getSpans();
		expect(spans.map((span) => span.name)).toEqual(["parent", "child"]);
		expect(spans[1]?.parentId).toBe(spans[0]?.id);
	});
});
