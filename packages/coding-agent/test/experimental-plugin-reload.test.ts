import { createHost, defineFacet, hostNamed, local, method, remote } from "@earendil-works/chord";
import type { AgentLane, LaneSnapshot } from "@earendil-works/pi-agent-core";
import { createRoutedLinkPair } from "@earendil-works/pi-server";
import { Type } from "typebox";
import { describe, expect, test } from "vitest";
import type { LoadedPluginFacets } from "../src/experimental/plugins/bundled.ts";
import { SessionPlugins } from "../src/experimental/services/plugins.ts";
import { createSessionWorkerServices } from "../src/experimental/services/worker.ts";

const ReloadRuntime = local("test.reload-runtime", { version: 1, input: Type.Object({}) });
const ReloadProbe = remote("test.reload-probe", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: { active: { methods: { generation: method(undefined, Type.Integer()) } } },
});

describe("experimental plugin reload", () => {
	test("cuts over native facet implementations and disposes retired plugin resources", async () => {
		const activations: number[] = [];
		const disposals: number[] = [];
		const closedResources: number[] = [];
		let generation = 0;
		const facetLoader = async (): Promise<LoadedPluginFacets> => {
			const current = ++generation;
			return {
				facets: [
					{
						name: "reloadable-session-plugin",
						...defineFacet(({ serve }) => {
							serve(
								ReloadRuntime,
								(_input, _principal, self) => {
									self.resource("activation", {
										version: current,
										open: () => {
											activations.push(current);
											return current;
										},
										close: (value) => {
											closedResources.push(value);
										},
									});
									return {};
								},
								{ lifetime: "host" },
							);
							serve(ReloadProbe, () => ({ variant: "active", generation: () => current }));
						}),
					},
				],
				async dispose() {
					disposals.push(current);
				},
			};
		};
		const snapshot: LaneSnapshot = {
			lane: "main",
			transcript: [],
			tipId: null,
			configuration: { model: { provider: "test", modelId: "model" }, thinkingLevel: "off", activeToolNames: [] },
			stats: {
				messageCount: 0,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			},
			operation: null,
			queues: [],
			faulted: false,
		};
		const lane = {
			async watch() {
				return {
					snapshot,
					start() {},
					async resnapshot() {
						return snapshot;
					},
					unsubscribe() {},
				};
			},
			async getModel() {
				return undefined;
			},
			async getThinkingLevel() {
				return "off" as const;
			},
		} as unknown as AgentLane;
		const scope = { serverConnectionId: "server-1", attachmentId: "attachment-1" };
		const [link, tunnel] = createRoutedLinkPair();
		const services = await createSessionWorkerServices({
			lane,
			modelRuntime: undefined,
			facetLoader,
			async publish(publishedScope, frame) {
				expect(publishedScope).toEqual(scope);
				tunnel.send(frame);
			},
		});
		const client = createHost({ name: "test-presentation", kind: "client", self: null });
		try {
			services.attach(scope);
			tunnel.receive((frame) => services.receive(scope, frame));
			client.connect(link, { principal: null });
			const plugins = await client.get(SessionPlugins, {});
			const probe = await client.get(ReloadProbe, {});
			expect(activations).toEqual([1]);
			await expect(client.root((ctx) => probe.generation(ctx))).resolves.toBe(1);
			await client.root((ctx) => plugins.reload(ctx));
			await expect(client.root((ctx) => probe.generation(ctx))).resolves.toBe(2);
			expect(activations).toEqual([1, 2]);
			expect(disposals).toEqual([1]);
			expect(closedResources).toEqual([1]);
			probe.release();
			plugins.release();
		} finally {
			await client.close();
			await services.dispose();
		}
		expect(disposals).toEqual([1, 2]);
		expect(closedResources).toEqual([1, 2]);
	});
});
