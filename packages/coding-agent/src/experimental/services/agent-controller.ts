import { type Ctx as Context, hostNamed, method, remote } from "@earendil-works/chord";
import { Type } from "typebox";

export interface AgentPromptImage {
	type: "image";
	data: string;
	mimeType: string;
}

export interface AgentPromptRequest {
	message: string;
	images: AgentPromptImage[] | null;
}

export interface AgentOperationError {
	code: string;
	message: string;
}

export type AgentOperationResponse =
	| { accepted: true; operationId: string; error: AgentOperationError | null }
	| { accepted: false; operationId: string | null; error: AgentOperationError };

export type AgentQueueResponse =
	| { accepted: true; entryId: string; error: null }
	| { accepted: false; entryId: null; error: AgentOperationError };

export interface AgentCompactionRequest {
	customInstructions: string | null;
}

export interface AgentNavigationRequest {
	targetId: string | null;
	summarize: boolean;
	label: string | null;
	customInstructions: string | null;
}

/** Presentation-safe command facade over the worker-owned main AgentLane. */
export interface AgentController {
	prompt(request: AgentPromptRequest, context: Context): Promise<AgentOperationResponse>;
	requestAbort(operationId: string, context: Context): Promise<void>;
	steer(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	followUp(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	nextRun(request: AgentPromptRequest, context: Context): Promise<AgentQueueResponse>;
	cancelQueued(
		entryId: string,
		context: Context,
	): Promise<{ outcome: "cancelled" | "already_consumed" | "not_found" }>;
	resume(context: Context): Promise<AgentOperationResponse>;
	compact(request: AgentCompactionRequest, context: Context): Promise<AgentOperationResponse>;
	navigate(request: AgentNavigationRequest, context: Context): Promise<AgentOperationResponse>;
}

const prompt = Type.Object({
	message: Type.String(),
	images: Type.Union([
		Type.Array(Type.Object({ type: Type.Literal("image"), data: Type.String(), mimeType: Type.String() })),
		Type.Null(),
	]),
});
const error = Type.Object({ code: Type.String(), message: Type.String() });
const operation = Type.Unsafe<AgentOperationResponse>(
	Type.Union([
		Type.Object({
			accepted: Type.Literal(true),
			operationId: Type.String(),
			error: Type.Union([error, Type.Null()]),
		}),
		Type.Object({ accepted: Type.Literal(false), operationId: Type.Union([Type.String(), Type.Null()]), error }),
	]),
);
const queue = Type.Unsafe<AgentQueueResponse>(
	Type.Union([
		Type.Object({ accepted: Type.Literal(true), entryId: Type.String(), error: Type.Null() }),
		Type.Object({ accepted: Type.Literal(false), entryId: Type.Null(), error }),
	]),
);
export const AgentController = remote("pi.agent-controller", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: {
		active: {
			methods: {
				prompt: method(prompt, operation),
				requestAbort: method(Type.String()),
				steer: method(prompt, queue),
				followUp: method(prompt, queue),
				nextRun: method(prompt, queue),
				cancelQueued: method(
					Type.String(),
					Type.Object({
						outcome: Type.Union([
							Type.Literal("cancelled"),
							Type.Literal("already_consumed"),
							Type.Literal("not_found"),
						]),
					}),
				),
				resume: method(undefined, operation),
				compact: method(Type.Object({ customInstructions: Type.Union([Type.String(), Type.Null()]) }), operation),
				navigate: method(
					Type.Object({
						targetId: Type.Union([Type.String(), Type.Null()]),
						summarize: Type.Boolean(),
						label: Type.Union([Type.String(), Type.Null()]),
						customInstructions: Type.Union([Type.String(), Type.Null()]),
					}),
					operation,
				),
			},
		},
	},
});
