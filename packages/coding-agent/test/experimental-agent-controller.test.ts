import { createHost } from "@earendil-works/chord";
import {
	type AgentLane,
	Closed,
	type RunResult as HarnessRunResult,
	InvalidMessage,
	LaneBusy,
	UnknownSkill,
	UnknownTemplate,
} from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentController } from "../src/experimental/services/agent-controller.ts";
import { createAgentController } from "../src/experimental/services/agent-controller-provider.ts";

const admissionErrors = [
	[
		new LaneBusy({
			lane: "main",
			operationId: "operation-1",
			operationKind: "run",
			message: "busy",
		}),
		"lane_busy",
		"operation-1",
	],
	[new InvalidMessage({ lane: "main", reason: "invalid", message: "invalid" }), "invalid_message", null],
	[new UnknownSkill({ name: "skill", message: "unknown" }), "unknown_skill", null],
	[new UnknownTemplate({ name: "template", message: "unknown" }), "unknown_template", null],
	[new Closed({ message: "closed" }), "closed", null],
] as const satisfies readonly [Extract<HarnessRunResult, { ok: false }>["error"], string, string | null][];

const completed = {
	operationId: "operation-1",
	kind: "run" as const,
	status: "completed" as const,
	fromTipId: null,
	tipId: "entry-1",
	startedAt: 1,
	endedAt: 2,
};
let host = createHost({ name: "session", self: "test" });
afterEach(async () => {
	await host.close();
	host = createHost({ name: "session", self: "test" });
});

describe("AgentController service", () => {
	test("provides the presentation-safe AgentLane command surface", async () => {
		const prompt = vi.fn(async () => ({ ok: true as const, value: completed }));
		const requestAbort = vi.fn(async () => ({
			ok: true as const,
			value: { operationId: "operation-1", newlyRequested: true, steer: [], followUp: [] },
		}));
		const steer = vi.fn(async () => ({ ok: true as const, value: { entryId: "queue-1" } }));
		const followUp = vi.fn(async () => ({ ok: true as const, value: { entryId: "queue-2" } }));
		const lane = { prompt, requestAbort, steer, followUp } as unknown as AgentLane;
		host.serve(AgentController, () => ({ variant: "active", ...createAgentController(lane) }));
		try {
			const controller = await host.get(AgentController, {});
			await expect(host.root((ctx) => controller.prompt({ message: "hello", images: null }, ctx))).resolves.toEqual({
				accepted: true,
				operationId: "operation-1",
				error: null,
			});
			await host.root((ctx) => controller.requestAbort("operation-1", ctx));
			await expect(host.root((ctx) => controller.steer({ message: "later", images: null }, ctx))).resolves.toEqual({
				accepted: true,
				entryId: "queue-1",
				error: null,
			});
			await expect(
				host.root((ctx) => controller.followUp({ message: "after", images: null }, ctx)),
			).resolves.toEqual({ accepted: true, entryId: "queue-2", error: null });
			controller.release();
		} finally {
			await host.close();
		}
	});

	test("wraps queue, resume, compaction, and navigation lane operations", async () => {
		const nextRun = vi.fn(async () => ({ ok: true as const, value: { entryId: "queue-3" } }));
		const cancelQueued = vi.fn(async () => ({ ok: true as const, value: { kind: "cancelled" as const } }));
		const resume = vi.fn(async () => ({ ok: true as const, value: completed }));
		const compact = vi.fn(async () => ({
			ok: true as const,
			value: { compaction: { ...completed, operationId: "compact-1", kind: "compaction" as const } },
		}));
		const navigateTree = vi.fn(async () => ({
			ok: true as const,
			value: { navigation: { ...completed, operationId: "navigation-1", kind: "navigation" as const } },
		}));
		const controller = createAgentController({
			nextRun,
			cancelQueued,
			resume,
			compact,
			navigateTree,
		} as unknown as AgentLane);

		await expect(host.root((ctx) => controller.nextRun({ message: "next", images: null }, ctx))).resolves.toEqual({
			accepted: true,
			entryId: "queue-3",
			error: null,
		});
		await expect(host.root((ctx) => controller.cancelQueued("queue-3", ctx))).resolves.toEqual({
			outcome: "cancelled",
		});
		await expect(host.root((ctx) => controller.resume(ctx))).resolves.toMatchObject({ operationId: "operation-1" });
		await expect(host.root((ctx) => controller.compact({ customInstructions: "short" }, ctx))).resolves.toMatchObject(
			{
				operationId: "compact-1",
			},
		);
		await expect(
			host.root((ctx) =>
				controller.navigate(
					{ targetId: "entry-1", summarize: true, label: "branch", customInstructions: null },
					ctx,
				),
			),
		).resolves.toMatchObject({ operationId: "navigation-1" });
	});

	test("reports accepted successful and failed operations", async () => {
		const success = createAgentController({
			prompt: async () => ({ ok: true, value: completed }),
		} as unknown as AgentLane);
		await expect(host.root((ctx) => success.prompt({ message: "hello", images: null }, ctx))).resolves.toEqual({
			accepted: true,
			operationId: "operation-1",
			error: null,
		});

		const failed = createAgentController({
			prompt: async () => ({
				ok: true,
				value: {
					...completed,
					operationId: "operation-2",
					status: "failed",
					error: { code: "provider", message: "failed", details: { status: 500 } },
				},
			}),
		} as unknown as AgentLane);
		await expect(host.root((ctx) => failed.prompt({ message: "hello", images: null }, ctx))).resolves.toEqual({
			accepted: true,
			operationId: "operation-2",
			error: { code: "provider", message: "failed" },
		});
	});

	test("bounds unexpected private adapter failures", async () => {
		const controller = createAgentController({
			prompt: async () => {
				throw new Error("private credentials path");
			},
		} as unknown as AgentLane);
		await expect(
			host.root((ctx) => controller.prompt({ message: "hello", images: null }, ctx)),
		).rejects.toMatchObject({
			code: "unavailable",
			reason: "internal_error",
			message: "unavailable/internal_error: Internal session error",
		});
	});

	test.each(admissionErrors)("maps admission error %# to a stable response", async (error, code, operationId) => {
		const controller = createAgentController({
			prompt: async () => ({ ok: false, error }),
		} as unknown as AgentLane);
		await expect(host.root((ctx) => controller.prompt({ message: "hello", images: null }, ctx))).resolves.toEqual({
			accepted: false,
			operationId,
			error: { code, message: error.message },
		});
	});
});
