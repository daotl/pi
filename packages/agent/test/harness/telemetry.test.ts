import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AssistantMessage, createModels, createProvider, type Model } from "@earendil-works/pi-ai";
import {
	createTypedSpanStarter,
	InMemoryTelemetryContext,
	NOOP_TELEMETRY_CONTEXT,
	type TelemetrySchemaDefinition,
	type TelemetrySpan,
} from "@earendil-works/pi-telemetry";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AssistantMessageEventStream } from "../../../ai/src/utils/event-stream.ts";
import { renderAgentTelemetrySchemaMarkdown } from "../../scripts/generate-telemetry-docs.ts";
import { BACKGROUND_CONTEXT, withTelemetry } from "../../src/harness/context.ts";
import {
	AGENT_TELEMETRY_SCHEMAS,
	AI_TELEMETRY_SCHEMA,
	type AiSpanEndAttributes,
	type AiSpanStartAttributes,
	HARNESS_TELEMETRY_SCHEMA,
	type HarnessSpanEndAttributes,
	type HarnessSpanStartAttributes,
	startAiSpan,
	startHarnessSpan,
} from "../../src/harness/telemetry.ts";

describe("agent telemetry schemas", () => {
	it.each(["request", "poll"] as const)("accepts emitted model %s attributes and events", async (operation) => {
		const model: Model<"telemetry-test"> = {
			id: "model",
			name: "Model",
			api: "telemetry-test",
			provider: "test",
			baseUrl: "https://example.test",
			reasoning: true,
			input: ["text"],
			cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
			contextWindow: 1000,
			maxTokens: 100,
		};
		const result: AssistantMessage = {
			role: "assistant",
			api: model.api,
			provider: model.provider,
			model: model.id,
			content: [{ type: "text", text: "hello" }],
			stopReason: "stop",
			timestamp: 0,
			usage: {
				input: 1,
				output: 2,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 3,
				cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0, total: 0.3 },
			},
		};
		const respond = () => {
			const stream = new AssistantMessageEventStream();
			stream.push({ type: "start", partial: result });
			stream.push({ type: "text_end", contentIndex: 0, content: "hello", partial: result });
			stream.push({ type: "done", reason: "stop", message: result });
			stream.end(result);
			return stream;
		};
		const models = createModels();
		models.setProvider(
			createProvider({
				id: model.provider,
				models: [model],
				auth: { apiKey: { name: "Test", resolve: async () => ({ auth: {} }) } },
				api: { stream: respond, streamSimple: respond, fetchDeferred: respond },
			}),
		);
		const telemetry = new InMemoryTelemetryContext();
		await telemetry.startSpan({ name: "caller" }, async (parent) => {
			const stream =
				operation === "poll"
					? models.streamDeferred(
							model,
							{ provider: model.provider, modelId: model.id, api: model.api, id: "handle" },
							{ telemetry: parent },
						)
					: models.streamSimple(model, { messages: [] }, { telemetry: parent, reasoning: "high" });
			for await (const _event of stream) {
				/* Consume the public model stream to completion. */
			}
			expect(await stream.result()).toBe(result);
		});
		await expect.poll(() => telemetry.getSpans().every((span) => span.settled)).toBe(true);
		const emitted = telemetry.getSpans().find((span) => span.name === `pi.ai.${operation}`);
		expect(emitted).toBeDefined();
		if (!emitted) throw new Error("Missing model span");
		const schemas: readonly TelemetrySchemaDefinition[] = AGENT_TELEMETRY_SCHEMAS;
		const definition = schemas.map((schema) => schema.spans[emitted.name]).find((span) => span !== undefined);
		expect(definition, "agent schema must accept the emitted span name").toBeDefined();
		if (!definition) throw new Error(`Undeclared span ${emitted.name}`);
		for (const [name, attribute] of Object.entries(definition.startAttributes)) {
			if (attribute.required) expect(emitted.attributes, `required start attribute ${name}`).toHaveProperty([name]);
		}
		const attributes = { ...definition.startAttributes, ...definition.endAttributes };
		for (const name of Object.keys(emitted.attributes)) expect(attributes).toHaveProperty([name]);
		expect(emitted.events.map((event) => event.name)).toEqual(["pi.ai.first_chunk", "pi.ai.block"]);
		for (const event of emitted.events) {
			const declared = definition.events?.[event.name];
			expect(declared, `declared event ${event.name}`).toBeDefined();
			if (!declared) throw new Error(`Undeclared event ${event.name}`);
			for (const name of Object.keys(event.attributes)) expect(declared.attributes).toHaveProperty([name]);
		}
	});

	it("serializes both schemas and generates the checked-in reference", () => {
		expect(() => JSON.stringify(AI_TELEMETRY_SCHEMA)).not.toThrow();
		expect(() => JSON.stringify(HARNESS_TELEMETRY_SCHEMA)).not.toThrow();
		expect(AGENT_TELEMETRY_SCHEMAS).toEqual([AI_TELEMETRY_SCHEMA, HARNESS_TELEMETRY_SCHEMA]);
		expect(Object.keys(HARNESS_TELEMETRY_SCHEMA.spans)).toEqual([
			"pi.harness.run",
			"pi.harness.compaction",
			"pi.harness.navigation",
			"pi.harness.checkpoint",
			"pi.harness.turn",
			"pi.harness.step",
			"pi.harness.tool",
			"pi.harness.hook",
			"pi.harness.sleep",
			"pi.harness.event_handler",
			"pi.session.write",
		]);
		const actual = readFileSync(resolve(import.meta.dirname, "../../docs/telemetry-schema.md"), "utf8");
		expect(actual).toBe(renderAgentTelemetrySchemaMarkdown());
	});

	it("starts AI-request and harness spans through one composed typed starter", async () => {
		const startSpan = createTypedSpanStarter(NOOP_TELEMETRY_CONTEXT, AGENT_TELEMETRY_SCHEMAS);
		await startSpan(
			"pi.harness.step",
			{
				"pi.lane.name": "main",
				"pi.operation.id": "operation",
				"pi.step.kind": "assistant",
				"pi.step.attempt": 1,
			},
			async (stepSpan, startChildSpan) => {
				stepSpan.setAttributes({ "pi.step.outcome": "succeeded" });
				await startChildSpan(
					"pi.ai.request",
					{
						provider: "provider",
						model: "model",
						api: "api",
					},
					(requestSpan) => {
						requestSpan.setAttributes({ stop: "stop" });
					},
				);
				await startChildSpan("pi.ai.poll", { provider: "provider", model: "model", api: "api" }, (pollSpan) => {
					pollSpan.setAttributes({ stop: "pending" });
					pollSpan.addEvent("pi.ai.first_chunk", {});
				});
			},
		);
	});

	it("infers exact AI start and optional end attributes", async () => {
		type Start = AiSpanStartAttributes<"pi.ai.request">;
		type End = AiSpanEndAttributes<"pi.ai.request">;
		expectTypeOf<Start>().toMatchTypeOf<{
			provider: string;
			model: string;
			api: string;
			reasoning?: string;
		}>();
		expectTypeOf<End["stop"]>().toEqualTypeOf<
			"pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred" | undefined
		>();

		const telemetry: TelemetrySpan = NOOP_TELEMETRY_CONTEXT;
		const context = withTelemetry(telemetry, BACKGROUND_CONTEXT);
		await startAiSpan(
			"pi.ai.request",
			{
				provider: "provider",
				model: "model",
				api: "api",
			},
			(span) => {
				span.setAttributes({ stop: "toolUse" });
				span.addEvent("pi.ai.first_chunk", {});
				span.addEvent("pi.ai.block", { type: "text", index: 0, chars: 5 });
				// @ts-expect-error unknown span events are rejected
				span.addEvent("chunk");
			},
			context,
		);

		const compileTimeFailures = () => {
			const extraAttributes = {
				provider: "provider",
				model: "model",
				api: "api",
				"pi.ai.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startAiSpan("pi.ai.request", extraAttributes, () => {}, context);
			// @ts-expect-error missing required start attributes
			void startAiSpan("pi.ai.request", { provider: "provider" }, () => {}, context);
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});

	it("infers per-span harness literals and optional completion enrichment", async () => {
		type RunStart = HarnessSpanStartAttributes<"pi.harness.run">;
		type RunEnd = HarnessSpanEndAttributes<"pi.harness.run">;
		type WriteStart = HarnessSpanStartAttributes<"pi.session.write">;
		type WriteEnd = HarnessSpanEndAttributes<"pi.session.write">;
		expectTypeOf<RunStart["pi.operation.kind"]>().toEqualTypeOf<"run">();
		expectTypeOf<RunEnd["pi.operation.outcome"]>().toEqualTypeOf<
			"completed" | "aborted" | "failed" | "suspended" | undefined
		>();
		const writeStart = {
			"pi.session.id": "session",
			"pi.session.item_count": 2,
			"pi.session.item_kinds": ["entry", "value", "list"],
		} satisfies WriteStart;
		const writeEnd = {
			"pi.session.first_seq": 1,
			"pi.session.last_seq": 2,
		} satisfies WriteEnd;
		expectTypeOf(writeStart["pi.session.item_count"]).toEqualTypeOf<number>();
		expectTypeOf(writeEnd["pi.session.last_seq"]).toEqualTypeOf<number>();

		const telemetry: TelemetrySpan = NOOP_TELEMETRY_CONTEXT;
		const context = withTelemetry(telemetry, BACKGROUND_CONTEXT);
		await startHarnessSpan(
			"pi.harness.run",
			{
				"pi.session.id": "session",
				"pi.lane.name": "main",
				"pi.operation.id": "operation",
				"pi.operation.kind": "run",
				"pi.operation.recovery": false,
			},
			(span) => {
				span.setAttributes({ "pi.operation.outcome": "completed" });
				span.setAttributes({});
				// @ts-expect-error the harness schema declares no span events
				span.addEvent("result");
			},
			context,
		);

		const compileTimeFailures = () => {
			const extraRunAttributes = {
				"pi.session.id": "session",
				"pi.lane.name": "main",
				"pi.operation.id": "operation",
				"pi.operation.kind": "run",
				"pi.operation.recovery": false,
				"pi.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startHarnessSpan("pi.harness.run", extraRunAttributes, () => {}, context);
			void startHarnessSpan(
				"pi.harness.checkpoint",
				{
					"pi.lane.name": "main",
					"pi.operation.id": "operation",
					"pi.checkpoint.kind": "normal",
				},
				(span) => {
					// @ts-expect-error empty end schemas reject every attribute
					span.setAttributes({ "pi.unknown": true });
				},
				context,
			);
			void startHarnessSpan(
				"pi.harness.run",
				{
					"pi.session.id": "session",
					"pi.lane.name": "main",
					"pi.operation.id": "operation",
					// @ts-expect-error run spans accept only the run operation kind
					"pi.operation.kind": "navigation",
					"pi.operation.recovery": false,
				},
				() => {},
				context,
			);
			// @ts-expect-error missing required run start attributes
			void startHarnessSpan("pi.harness.run", {}, () => {}, context);
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});
});
