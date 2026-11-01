import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost, defineFacet, hostNamed, local, method, remote } from "@earendil-works/chord";
import type { AgentLane, LaneSnapshot } from "@earendil-works/pi-agent-core";
import { createRoutedLinkPair } from "@earendil-works/pi-server";
import { Type } from "typebox";
import { describe, expect, test, vi } from "vitest";
import { type LoadedPluginFacets, loadSessionPluginFacets } from "../src/experimental/plugins/bundled.ts";
import { createServerPluginPackage } from "../src/experimental/plugins/package.ts";
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
	test("loads bundled relative CommonJS helpers that require Node builtins", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-plugin-commonjs-"));
		const packagePath = join(directory, "plugin");
		const host = createHost({ name: "commonjs-plugin", self: null });
		let loaded: LoadedPluginFacets | undefined;
		const Probe = local("test.commonjs-plugin", {
			version: 1,
			input: Type.Object({}),
			members: { read: method(undefined, Type.String()) },
		});
		try {
			await mkdir(join(packagePath, "src"), { recursive: true });
			await writeFile(join(packagePath, "package.json"), JSON.stringify({ name: "test-commonjs-plugin" }));
			await writeFile(
				join(packagePath, "src", "helper.cjs"),
				'module.exports = require("node:path").basename("/tmp/commonjs-plugin-value");\n',
			);
			await writeFile(
				join(packagePath, "src", "session.ts"),
				`import { defineFacet, local, method } from "@earendil-works/chord";
import { Type } from "typebox";
import value from "./helper.cjs";
const Probe = local("test.commonjs-plugin", {
	version: 1, input: Type.Object({}), members: { read: method(undefined, Type.String()) },
});
export default defineFacet(({ serve }) => serve(Probe, () => ({ read: () => value })));
`,
			);
			const plugin = createServerPluginPackage(directory, randomUUID(), packagePath);
			await plugin.build();
			loaded = await loadSessionPluginFacets([plugin.manifestPath]);
			await host.load(loaded.facets);
			const probe = await host.get(Probe, {});
			try {
				expect(await host.root((ctx) => probe.read(ctx))).toBe("commonjs-plugin-value");
			} finally {
				probe.release();
			}
		} finally {
			await host.close();
			await loaded?.dispose();
			await rm(directory, { force: true, recursive: true });
		}
	});

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
	test.each([0, 1, 2])(
		"disposal aborts candidate activation before joining reload (failed loader generation: %s)",
		async (failedGeneration) => {
			const entered = Promise.withResolvers<void>();
			let aborted = false;
			let generation = 0;
			const disposed: number[] = [];
			const closed: number[] = [];
			const lane = {
				async watch() {
					const snapshot: LaneSnapshot = {
						lane: "main",
						transcript: [],
						tipId: null,
						configuration: {
							model: { provider: "test", modelId: "model" },
							thinkingLevel: "off",
							activeToolNames: [],
						},
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
				facetLoader: async () => {
					const current = ++generation;
					return {
						facets: [
							{
								name: "cooperative-reload",
								...defineFacet(({ serve }) => {
									serve(
										ReloadRuntime,
										(_input, _principal, self) => {
											self.resource("activation", {
												version: current,
												open: async ({ signal }) => {
													if (current === 2) {
														entered.resolve();
														await new Promise<void>((resolve) => {
															const abort = () => {
																aborted = true;
																resolve();
															};
															if (signal.aborted) abort();
															else signal.addEventListener("abort", abort, { once: true });
														});
													}
													return current;
												},
												close: (value) => {
													expect(disposed).not.toContain(value);
													closed.push(value);
												},
											});
											return {};
										},
										{ lifetime: "host" },
									);
								}),
							},
						],
						async dispose() {
							disposed.push(current);
							if (current === failedGeneration) throw new Error(`loader ${current} cleanup failed`);
						},
					};
				},
				async publish(_scope, frame) {
					tunnel.send(frame);
				},
			});
			const client = createHost({ name: "reload-disposal-client", kind: "client", self: null });
			try {
				services.attach(scope);
				tunnel.receive((frame) => services.receive(scope, frame));
				client.connect(link, { principal: null });
				const plugins = await client.get(SessionPlugins, {});
				const reloading = client.root((ctx) => plugins.reload(ctx)).catch((error: unknown) => error);
				await entered.promise;
				const disposing = services.dispose().then(
					() => undefined,
					(error: unknown) => error,
				);
				await vi.waitFor(() => expect(aborted).toBe(true));
				const error = await disposing;
				if (failedGeneration) expect(error).toMatchObject({ message: `loader ${failedGeneration} cleanup failed` });
				else expect(error).toBeUndefined();
				expect(disposed.sort()).toEqual([1, 2]);
				expect(closed.sort()).toEqual([1, 2]);
				expect(await reloading).toBeInstanceOf(Error);
				plugins.release();
			} finally {
				await client.close();
			}
		},
	);
});
