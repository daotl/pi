import { AI_TELEMETRY_SCHEMA } from "@earendil-works/pi-ai/models";
import type {
	ExactTelemetryAttributes,
	SchemaTelemetrySpan,
	TelemetrySchemaDefinition,
	TelemetrySchemaSpanEndAttributes,
	TelemetrySchemaSpanEventAttributes,
	TelemetrySchemaSpanEventName,
	TelemetrySchemaSpanName,
	TelemetrySchemaSpanStartAttributes,
	TelemetrySchemaSpanUnion,
	TelemetrySpan,
} from "@earendil-works/pi-telemetry";
import { type Context, withTelemetry } from "./context.ts";

export type {
	AttributeValue,
	ExactTelemetryAttributes,
	SchemaTelemetrySpan,
	SpanAttributes,
	SpanOptions,
	SpanStatus,
	TelemetryAttributeDefinition,
	TelemetryAttributeMetadata,
	TelemetryAttributeType,
	TelemetryContext,
	TelemetryEventAttributeDefinition,
	TelemetryEventDefinition,
	TelemetryParentDefinition,
	TelemetrySchemaDefinition,
	TelemetrySchemaSpanEndAttributes,
	TelemetrySchemaSpanEventAttributes,
	TelemetrySchemaSpanEventName,
	TelemetrySchemaSpanName,
	TelemetrySchemaSpanStartAttributes,
	TelemetrySchemaSpanUnion,
	TelemetrySpan,
	TelemetrySpanDefinition,
	TelemetryStartAttributeDefinition,
	TypedSpanStarter,
} from "@earendil-works/pi-telemetry";

export { AI_TELEMETRY_SCHEMA };

export type AiSpanName = TelemetrySchemaSpanName<typeof AI_TELEMETRY_SCHEMA>;
export type AiSpanStartAttributes<Name extends AiSpanName> = TelemetrySchemaSpanStartAttributes<
	typeof AI_TELEMETRY_SCHEMA,
	Name
>;
export type AiSpanEndAttributes<Name extends AiSpanName> = TelemetrySchemaSpanEndAttributes<
	typeof AI_TELEMETRY_SCHEMA,
	Name
>;
export type AiSpanAttributes<Name extends AiSpanName> = AiSpanStartAttributes<Name> & AiSpanEndAttributes<Name>;
export type AiSpanEventName<Name extends AiSpanName> = TelemetrySchemaSpanEventName<typeof AI_TELEMETRY_SCHEMA, Name>;
export type AiSpanEventAttributes<
	Name extends AiSpanName,
	EventName extends AiSpanEventName<Name>,
> = TelemetrySchemaSpanEventAttributes<typeof AI_TELEMETRY_SCHEMA, Name, EventName>;
export type AiTelemetrySpan<Name extends AiSpanName> = SchemaTelemetrySpan<typeof AI_TELEMETRY_SCHEMA, Name>;
export type AiSpan = TelemetrySchemaSpanUnion<typeof AI_TELEMETRY_SCHEMA>;

export function startAiSpan<Name extends AiSpanName, const Attributes extends AiSpanStartAttributes<Name>, Result>(
	name: Name,
	attributes: ExactTelemetryAttributes<AiSpanStartAttributes<Name>, Attributes>,
	callback: (span: AiTelemetrySpan<Name>, context: Context) => Result | Promise<Result>,
	context: Context,
): Promise<Result> {
	return context.telemetry.startSpan({ name, attributes }, (span) =>
		callback(span as AiTelemetrySpan<Name>, withTelemetry(span, context)),
	);
}

const HOOK_NAMES = [
	"before_run",
	"before_drive",
	"before_run_end",
	"transform_context",
	"before_request",
	"before_payload",
	"after_response",
	"before_tool",
	"after_tool",
	"before_compaction",
	"before_navigation",
] as const;

const EVENT_TYPES = [
	"run_start",
	"run_resume",
	"run_suspend",
	"operation_abort",
	"run_end",
	"fault",
	"handler_error",
	"turn_start",
	"turn_end",
	"retry_scheduled",
	"retry_start",
	"retry_end",
	"message_start",
	"message_update",
	"message_end",
	"tool_start",
	"tool_update",
	"tool_end",
	"entry_added",
	"queue_update",
	"value_update",
	"config_update",
	"compaction_start",
	"compaction_end",
	"navigation_start",
	"navigation_end",
	"lane_created",
	"usage",
] as const;

const operationStartAttributes = {
	"pi.session.id": {
		type: "string",
		required: true,
		cardinality: "high",
		description: "Session id",
	},
	"pi.lane.name": {
		type: "string",
		required: true,
		cardinality: "high",
		description: "Lane name",
	},
	"pi.operation.id": {
		type: "string",
		required: true,
		cardinality: "high",
		description: "Durable operation id",
	},
	"pi.operation.recovery": {
		type: "boolean",
		required: true,
		description: "Whether this invocation resumes durable work",
	},
} as const;

const operationErrorAttributes = {
	"pi.error.code": {
		type: "string",
		cardinality: "low",
		description: "Stable operation error code",
	},
	"pi.error.type": {
		type: "string",
		cardinality: "low",
		description: "Low-cardinality operation error class",
	},
} as const;

export const HARNESS_TELEMETRY_SCHEMA = {
	version: 1,
	spans: {
		"pi.harness.run": {
			description: "One admitted in-process run invocation",
			parents: { kind: "root_or_external" },
			startAttributes: {
				...operationStartAttributes,
				"pi.operation.kind": {
					type: "string",
					required: true,
					values: ["run"],
					description: "Run operation kind",
				},
			},
			endAttributes: {
				"pi.operation.outcome": {
					type: "string",
					values: ["completed", "aborted", "failed", "suspended"],
					description: "Run invocation outcome",
				},
				...operationErrorAttributes,
			},
			status: { default: "ok", errorWhen: "The run fails or throws" },
		},
		"pi.harness.compaction": {
			description: "One admitted in-process manual compaction invocation",
			parents: { kind: "root_or_external" },
			startAttributes: {
				...operationStartAttributes,
				"pi.operation.kind": {
					type: "string",
					required: true,
					values: ["compaction"],
					description: "Compaction operation kind",
				},
			},
			endAttributes: {
				"pi.operation.outcome": {
					type: "string",
					values: ["completed", "declined", "aborted", "failed"],
					description: "Compaction invocation outcome",
				},
				...operationErrorAttributes,
			},
			status: { default: "ok", errorWhen: "The compaction fails or throws" },
		},
		"pi.harness.navigation": {
			description: "One admitted in-process navigation invocation",
			parents: { kind: "root_or_external" },
			startAttributes: {
				...operationStartAttributes,
				"pi.operation.kind": {
					type: "string",
					required: true,
					values: ["navigation"],
					description: "Navigation operation kind",
				},
			},
			endAttributes: {
				"pi.operation.outcome": {
					type: "string",
					values: ["completed", "declined", "aborted", "failed"],
					description: "Navigation invocation outcome",
				},
				...operationErrorAttributes,
			},
			status: { default: "ok", errorWhen: "The navigation fails or throws" },
		},
		"pi.harness.checkpoint": {
			description: "One run checkpoint",
			parents: { kind: "spans", spans: ["pi.harness.run"] },
			startAttributes: {
				"pi.lane.name": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Lane name",
				},
				"pi.operation.id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Durable operation id",
				},
				"pi.checkpoint.kind": {
					type: "string",
					required: true,
					values: ["normal", "abort_reconcile"],
					description: "Checkpoint purpose",
				},
			},
			endAttributes: {},
			status: { default: "ok", errorWhen: "Checkpoint work throws" },
		},
		"pi.harness.turn": {
			description: "One assistant response and its tool batch",
			parents: { kind: "spans", spans: ["pi.harness.run"] },
			startAttributes: {
				"pi.lane.name": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Lane name",
				},
				"pi.operation.id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Durable operation id",
				},
				"pi.turn.id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Invocation-local turn id",
				},
			},
			endAttributes: {},
			status: { default: "ok", errorWhen: "Turn work throws" },
		},
		"pi.harness.step": {
			description: "One durable retry attempt",
			parents: {
				kind: "spans",
				spans: ["pi.harness.turn", "pi.harness.checkpoint", "pi.harness.compaction", "pi.harness.navigation"],
			},
			startAttributes: {
				"pi.lane.name": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Lane name",
				},
				"pi.operation.id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Durable operation id",
				},
				"pi.step.kind": {
					type: "string",
					required: true,
					values: ["assistant", "compaction", "branch_summary"],
					description: "Retryable step kind",
				},
				"pi.step.attempt": {
					type: "number",
					required: true,
					description: "One-based durable attempt number",
				},
				"pi.compaction.reason": {
					type: "string",
					required: false,
					values: ["manual", "threshold", "overflow"],
					description: "Compaction trigger",
				},
			},
			endAttributes: {
				"pi.step.outcome": {
					type: "string",
					values: ["succeeded", "retry", "failed", "aborted", "deferred", "overflow"],
					description: "Attempt outcome",
				},
			},
			status: { default: "ok", errorWhen: "The attempt retries, fails, or throws" },
		},
		"pi.harness.tool": {
			description: "One raw phase-2 tool execution",
			parents: { kind: "spans", spans: ["pi.harness.turn", "pi.harness.run"] },
			startAttributes: {
				"pi.lane.name": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Lane name",
				},
				"pi.operation.id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Durable operation id",
				},
				"pi.turn.id": {
					type: "string",
					required: false,
					cardinality: "high",
					description: "Invocation-local live turn id",
				},
				"pi.tool.name": {
					type: "string",
					required: true,
					description: "Tool name",
				},
				"pi.tool.call_id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Tool call id",
				},
				"pi.tool.replay": {
					type: "string",
					required: true,
					values: ["never", "safe"],
					description: "Declared replay policy",
				},
				"pi.tool.recovery": {
					type: "boolean",
					required: true,
					description: "Whether this is recovery execution",
				},
			},
			endAttributes: {
				"pi.tool.is_error": {
					type: "boolean",
					description: "Whether raw phase-2 execution returned an error",
				},
			},
			status: { default: "ok", errorWhen: "Raw phase-2 execution returns an error" },
		},
		"pi.harness.hook": {
			description: "One registered hook handler invocation",
			parents: { kind: "any" },
			startAttributes: {
				"pi.lane.name": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Lane name",
				},
				"pi.operation.id": {
					type: "string",
					required: false,
					cardinality: "high",
					description: "Durable operation id when accepted",
				},
				"pi.hook.name": {
					type: "string",
					required: true,
					values: HOOK_NAMES,
					description: "Hook name",
				},
				"pi.hook.registration_id": {
					type: "string",
					required: false,
					description: "Optional hook registration metadata",
				},
			},
			endAttributes: {
				"pi.hook.outcome": {
					type: "string",
					values: ["completed", "skipped", "blocked", "failed"],
					description: "Handler outcome",
				},
			},
			status: { default: "ok", errorWhen: "The handler throws" },
		},
		"pi.harness.sleep": {
			description: "One retry delay",
			parents: {
				kind: "spans",
				spans: [
					"pi.harness.run",
					"pi.harness.compaction",
					"pi.harness.navigation",
					"pi.harness.turn",
					"pi.harness.checkpoint",
				],
			},
			startAttributes: {
				"pi.operation.id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Durable operation id",
				},
				"pi.sleep.delay_ms": {
					type: "number",
					required: true,
					description: "Requested delay in milliseconds",
				},
			},
			endAttributes: {
				"pi.sleep.outcome": {
					type: "string",
					values: ["elapsed", "aborted"],
					description: "Delay outcome",
				},
			},
			status: { default: "ok", errorWhen: "Sleep work throws" },
		},
		"pi.harness.event_handler": {
			description: "One passive event listener invocation",
			parents: { kind: "any" },
			startAttributes: {
				"pi.event.type": {
					type: "string",
					required: true,
					cardinality: "low",
					values: EVENT_TYPES,
					description: "Delivered harness event type",
				},
				"pi.lane.name": {
					type: "string",
					required: false,
					cardinality: "high",
					description: "Lane name for lane-scoped events",
				},
			},
			endAttributes: {},
			status: { default: "ok", errorWhen: "The listener throws" },
		},
		"pi.session.write": {
			description: "One committed session transaction",
			parents: { kind: "any" },
			startAttributes: {
				"pi.session.id": {
					type: "string",
					required: true,
					cardinality: "high",
					description: "Session id",
				},
				"pi.lane.name": {
					type: "string",
					required: false,
					cardinality: "high",
					description: "Lane name when supplied by the caller",
				},
				"pi.operation.id": {
					type: "string",
					required: false,
					cardinality: "high",
					description: "Durable operation id when supplied by the caller",
				},
				"pi.session.item_count": {
					type: "number",
					required: true,
					description: "Number of writes in the transaction",
				},
				"pi.session.item_kinds": {
					type: "string[]",
					required: true,
					elementValues: ["entry", "usage", "value", "list"],
					description: "Distinct write kinds in the transaction",
				},
			},
			endAttributes: {
				"pi.session.first_seq": {
					type: "number",
					description: "First committed sequence in the transaction",
				},
				"pi.session.last_seq": {
					type: "number",
					description: "Last committed sequence in the transaction",
				},
			},
			status: { default: "ok", errorWhen: "Storage rejects the transaction" },
		},
	},
} as const satisfies TelemetrySchemaDefinition;

/** Combined typed span vocabulary for model-owned AI telemetry and agent-owned harness telemetry. */
export const AGENT_TELEMETRY_SCHEMAS = [AI_TELEMETRY_SCHEMA, HARNESS_TELEMETRY_SCHEMA] as const;

export type HarnessSpanName = TelemetrySchemaSpanName<typeof HARNESS_TELEMETRY_SCHEMA>;
export type HarnessSpanStartAttributes<Name extends HarnessSpanName> = TelemetrySchemaSpanStartAttributes<
	typeof HARNESS_TELEMETRY_SCHEMA,
	Name
>;
export type HarnessSpanEndAttributes<Name extends HarnessSpanName> = TelemetrySchemaSpanEndAttributes<
	typeof HARNESS_TELEMETRY_SCHEMA,
	Name
>;
export type HarnessSpanAttributes<Name extends HarnessSpanName> = HarnessSpanStartAttributes<Name> &
	HarnessSpanEndAttributes<Name>;
export type HarnessSpanEventName<Name extends HarnessSpanName> = TelemetrySchemaSpanEventName<
	typeof HARNESS_TELEMETRY_SCHEMA,
	Name
>;
export type HarnessSpanEventAttributes<
	Name extends HarnessSpanName,
	EventName extends HarnessSpanEventName<Name>,
> = TelemetrySchemaSpanEventAttributes<typeof HARNESS_TELEMETRY_SCHEMA, Name, EventName>;
export type HarnessTelemetrySpan<Name extends HarnessSpanName> = SchemaTelemetrySpan<
	typeof HARNESS_TELEMETRY_SCHEMA,
	Name
>;
export type HarnessSpan = TelemetrySchemaSpanUnion<typeof HARNESS_TELEMETRY_SCHEMA>;

export function startHarnessSpan<
	Name extends HarnessSpanName,
	const Attributes extends HarnessSpanStartAttributes<Name>,
	Result,
>(
	name: Name,
	attributes: ExactTelemetryAttributes<HarnessSpanStartAttributes<Name>, Attributes>,
	callback: (span: HarnessTelemetrySpan<Name>, context: Context) => Result | Promise<Result>,
	context: Context,
): Promise<Result> {
	return context.telemetry.startSpan({ name, attributes }, (span: TelemetrySpan) =>
		callback(span as HarnessTelemetrySpan<Name>, withTelemetry(span, context)),
	);
}
