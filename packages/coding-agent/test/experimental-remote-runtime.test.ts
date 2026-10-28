import { lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostNamed, method, remote } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Client, ServerError as ClientServerError } from "@earendil-works/pi-client";
import { createUnixTransportFactory } from "@earendil-works/pi-client/unix";
import { Type } from "typebox";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ExampleFacetService } from "../examples/plugins/pi-example-plugin/src/contract.ts";
import { runClient } from "../src/experimental/client.ts";
import { activateBuiltinClientServices, openClientRuntime } from "../src/experimental/client-runtime.ts";
import { loadPresentationFacets } from "../src/experimental/plugins/bundled.ts";
import * as processRuntime from "../src/experimental/process.ts";
import { type RunningServer, startServer } from "../src/experimental/server.ts";
import { AgentController } from "../src/experimental/services/agent-controller.ts";
import {
	createServerServiceSource,
	createSessionServiceSource,
	type SessionAttachmentState,
} from "../src/experimental/services/connection.ts";
import { Models } from "../src/experimental/services/models.ts";
import { SessionPlugins } from "../src/experimental/services/plugins.ts";
import { SessionDirectory, SessionManagement } from "../src/experimental/services/sessions.ts";
import { Transcript } from "../src/experimental/services/transcript.ts";
import {
	configureExperimentalWorkerModel,
	createExperimentalSessions,
	readExperimentalSessionState,
} from "./experimental-session-support.ts";
import { KeyedProbe } from "./fixtures/keyed-service.ts";

const servers = new Set<RunningServer>();
const clients = new Set<Client>();
const directories = new Set<string>();
const fauxWorkerEntryUrl = new URL("fixtures/faux-session-worker.ts", import.meta.url);
const realSpawnInternalProcess = processRuntime.spawnInternalProcess;
const sessionWorkerModel = { provider: "anthropic", model: "claude-sonnet-4-5" } as const;
const SecondPluginService = remote("test.second-plugin", {
	version: 1,
	input: Type.Object({}),
	host: hostNamed("session"),
	variants: { active: { methods: { read: method(undefined, Type.String()) } } },
});
let agentDir: string;

// These tests spawn real session-worker processes that resolve an anthropic
// model, so cloud providers must be registered for the duration even though
// they run offline against a synthetic key. Enable them file-wide and restore
// afterward.
const previousCloudDisabled = process.env.PI_DISABLE_CLOUD_PROVIDERS;

beforeAll(() => {
	process.env.PI_DISABLE_CLOUD_PROVIDERS = "0";
});

afterAll(() => {
	if (previousCloudDisabled === undefined) delete process.env.PI_DISABLE_CLOUD_PROVIDERS;
	else process.env.PI_DISABLE_CLOUD_PROVIDERS = previousCloudDisabled;
});

beforeEach(async () => {
	agentDir = await mkdtemp(join("/tmp", "pi-experimental-agent-"));
	directories.add(agentDir);
	await configureExperimentalWorkerModel(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	await createExperimentalSessions(join(agentDir, "experimental", "sessions"), ["demo-1", "demo-2"]);
});

async function makeServer(): Promise<{ directory: string; runtime: RunningServer }> {
	const directory = await mkdtemp(join("/tmp", "pes-"));
	directories.add(directory);
	const runtime = await startServer({ ...sessionWorkerModel, directory });
	servers.add(runtime);
	return { directory, runtime };
}

async function attachSession(client: Client, sessionId: string): Promise<void> {
	const services = createServerServiceSource(client);
	try {
		await services.host.root(async (ctx) => {
			const management = await ctx.get(SessionManagement, {});
			await management.attach(sessionId, ctx);
		});
	} finally {
		await services.dispose(BACKGROUND_CONTEXT);
	}
}

async function attachClient(runtime: RunningServer, sessionId: string): Promise<Client> {
	const client = await Client.connect({
		serverId: runtime.serverId,
		transportFactory: createUnixTransportFactory({ path: runtime.socketPath }),
	});
	clients.add(client);
	await attachSession(client, sessionId);
	return client;
}

afterEach(async () => {
	await Promise.all([...clients].map((client) => client.dispose()));
	clients.clear();
	await Promise.all([...servers].map((server) => server.close()));
	servers.clear();
	vi.unstubAllEnvs();
	await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true })));
	directories.clear();
});

describe("experimental durable server composition", () => {
	test("uses PI_SERVER_DIR and PI_SERVER_ID", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-server-dir-"));
		directories.add(directory);
		const serverId = "00000000-0000-4000-8000-000000000001";
		vi.stubEnv("PI_SERVER_DIR", directory);
		vi.stubEnv("PI_SERVER_ID", serverId);
		const runtime = await startServer();
		servers.add(runtime);

		expect(runtime.serverId).toBe(serverId);
		expect(runtime.socketPath).toBe(join(directory, `${serverId}.sock`));
		expect((await lstat(directory)).mode & 0o777).toBe(0o700);
		const publicSocket = await lstat(runtime.socketPath);
		const controlSocket = await lstat(join(directory, `control-${runtime.serverId}.sock`));
		expect(publicSocket.isSocket()).toBe(true);
		expect(publicSocket.mode & 0o777).toBe(0o600);
		expect(controlSocket.isSocket()).toBe(true);
		expect(controlSocket.mode & 0o777).toBe(0o600);
		const entries = await readdir(directory);
		expect(entries).toHaveLength(3);
		expect(entries.every((entry) => !entry.startsWith("."))).toBe(true);
		expect(entries).toContain(`${serverId}.sock`);
		expect(entries).toContain(`control-${serverId}.sock`);
		expect(entries).toContainEqual(expect.stringMatching(new RegExp(`^server-${serverId}-[0-9a-f]{12}\\.sock$`)));
		await expect(runClient({ command: "client" })).resolves.toMatchObject({
			kind: "list",
			sessions: [{ sessionId: "demo-1" }, { sessionId: "demo-2" }],
		});
	});

	test("rejects a provider without a model", async () => {
		const directory = await mkdtemp(join("/tmp", "pes-"));
		directories.add(directory);
		await expect(startServer({ directory, provider: "anthropic" })).rejects.toThrow("provider requires a model");
	});

	test("preserves an existing Session model when the server default changes", async () => {
		await writeFile(
			join(agentDir, "settings.json"),
			JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-opus-4-6" }),
		);
		const directory = await mkdtemp(join("/tmp", "pes-"));
		directories.add(directory);
		const first = await startServer({ directory });
		servers.add(first);
		const firstClient = await attachClient(first, "demo-1");
		await firstClient.dispose();
		clients.delete(firstClient);
		await expect.poll(() => first.workerPids.has("demo-1")).toBe(false);
		await first.close();

		const second = await startServer({ ...sessionWorkerModel, directory });
		servers.add(second);
		const secondClient = await attachClient(second, "demo-1");
		await secondClient.dispose();
		clients.delete(secondClient);
		await expect.poll(() => second.workerPids.has("demo-1")).toBe(false);
		const state = await readExperimentalSessionState(second.sessionDir, "demo-1");
		expect(state.model).toEqual({ provider: "anthropic", modelId: "claude-opus-4-6" });
	});

	test("rejects model options when discovery selects an existing server", async () => {
		const { directory } = await makeServer();
		await expect(runClient({ command: "client", model: "anthropic/claude-opus-4-6" }, { directory })).rejects.toThrow(
			"Model selection is only valid when automatically activating a new server",
		);
	});

	test("rechecks an auto-discovered server after a version mismatch", async () => {
		const { directory, runtime } = await makeServer();
		const connect = Client.connect.bind(Client);
		vi.spyOn(Client, "connect")
			.mockRejectedValueOnce(new ClientServerError({ code: "version", message: "stale server" }))
			.mockImplementation((options) => connect(options));
		const clientRuntime = await openClientRuntime({ command: "client" }, { directory });
		try {
			expect(clientRuntime.servers.map(({ route }) => route.serverId)).toEqual([runtime.serverId]);
		} finally {
			await clientRuntime.dispose();
		}
	});

	test("serializes concurrent cold activation and retires after both clients leave", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-auto-server-"));
		directories.add(directory);
		const serverId = "00000000-0000-4000-8000-000000000001";
		vi.stubEnv("PI_SERVER_DIR", directory);
		vi.stubEnv("PI_SERVER_ID", serverId);

		const results = await Promise.all([runClient({ command: "client" }), runClient({ command: "client" })]);
		expect(results).toEqual([
			{
				kind: "list",
				sessions: [
					{ serverId, sessionId: "demo-1" },
					{ serverId, sessionId: "demo-2" },
				],
			},
			{
				kind: "list",
				sessions: [
					{ serverId, sessionId: "demo-1" },
					{ serverId, sessionId: "demo-2" },
				],
			},
		]);
		expect(await pathExists(join(directory, `${serverId}.sock`))).toBe(true);
		await expect.poll(() => pathExists(join(directory, `${serverId}.sock`)), { timeout: 5_000 }).toBe(false);
		await expect.poll(() => pathExists(join(directory, `control-${serverId}.sock`)), { timeout: 5_000 }).toBe(false);
	});

	test("passes client plugin packages to a cold server and restores them for its next generation", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-auto-plugin-"));
		directories.add(directory);
		const nativeTemp = join(directory, "native-temp");
		const linkedTemp = join(directory, "linked-temp");
		await mkdir(nativeTemp);
		await symlink(nativeTemp, linkedTemp, "dir");
		// Native ESM canonicalizes parent URLs; plugin externals must still resolve through the application.
		vi.stubEnv("TMPDIR", linkedTemp);
		vi.stubEnv("TMP", linkedTemp);
		vi.stubEnv("TEMP", linkedTemp);
		const serverId = "00000000-0000-4000-8000-000000000001";
		const packagePath = fileURLToPath(new URL("../examples/plugins/pi-example-plugin", import.meta.url));
		vi.stubEnv("PI_SERVER_DIR", directory);
		vi.stubEnv("PI_SERVER_ID", serverId);

		const first = await openClientRuntime({ command: "client", ...sessionWorkerModel });
		try {
			const activated = await activateBuiltinClientServices(first.servers[0]!);
			const presentationPlugins = await activated.server.host.root((ctx) =>
				activated.plugins.prepareSession({ sessionId: "demo-1", packagePaths: [packagePath] }, ctx),
			);
			await activated.server.host.root((ctx) => activated.management.attach("demo-1", ctx));
			const loaded = await loadPresentationFacets(presentationPlugins);
			expect(loaded.facets.map(({ name }) => name)).toEqual(["@earendil-works/pi-example-plugin/tui"]);
			await loaded.dispose();
		} finally {
			await first.dispose();
		}
		await expect.poll(() => pathExists(join(directory, `${serverId}.sock`)), { timeout: 5_000 }).toBe(false);

		const second = await openClientRuntime({ command: "client", ...sessionWorkerModel });
		try {
			const activated = await activateBuiltinClientServices(second.servers[0]!);
			const presentationPlugins = await activated.server.host.root((ctx) =>
				activated.plugins.prepareSession({ sessionId: "demo-1", packagePaths: null }, ctx),
			);
			await activated.server.host.root((ctx) => activated.management.attach("demo-1", ctx));
			const loaded = await loadPresentationFacets(presentationPlugins);
			expect(loaded.facets.map(({ name }) => name)).toEqual(["@earendil-works/pi-example-plugin/tui"]);
			await loaded.dispose();
		} finally {
			await second.dispose();
		}
	});

	test("retires a cold server after its only Session attachment disconnects", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-auto-session-"));
		directories.add(directory);
		const serverId = "00000000-0000-4000-8000-000000000001";
		vi.stubEnv("PI_SERVER_DIR", directory);
		vi.stubEnv("PI_SERVER_ID", serverId);

		await expect(runClient({ command: "client", sessionId: "demo-1", ...sessionWorkerModel })).resolves.toEqual({
			kind: "attached",
			serverId,
			sessionId: "demo-1",
		});
		await expect.poll(() => pathExists(join(directory, `${serverId}.sock`)), { timeout: 5_000 }).toBe(false);
		await expect.poll(() => pathExists(join(directory, `control-${serverId}.sock`)), { timeout: 5_000 }).toBe(false);
	});

	test("runs and discovers multiple logical servers from one directory", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-multi-server-"));
		directories.add(directory);
		const firstId = "00000000-0000-4000-8000-000000000001";
		const secondId = "00000000-0000-4000-8000-000000000002";
		const [first, second] = await Promise.all([
			startServer({ directory, serverId: firstId }),
			startServer({ directory, serverId: secondId }),
		]);
		servers.add(first);
		servers.add(second);

		expect((await lstat(join(directory, `control-${firstId}.sock`))).isSocket()).toBe(true);
		expect((await lstat(join(directory, `control-${secondId}.sock`))).isSocket()).toBe(true);
		await expect(runClient({ command: "client" }, { directory })).resolves.toEqual({
			kind: "list",
			sessions: [
				{ serverId: firstId, sessionId: "demo-1" },
				{ serverId: firstId, sessionId: "demo-2" },
				{ serverId: secondId, sessionId: "demo-1" },
				{ serverId: secondId, sessionId: "demo-2" },
			],
		});

		await first.close();
		await expect.poll(() => pathExists(first.socketPath)).toBe(false);
		await expect(runClient({ command: "client" }, { directory })).resolves.toEqual({
			kind: "list",
			sessions: [
				{ serverId: secondId, sessionId: "demo-1" },
				{ serverId: secondId, sessionId: "demo-2" },
			],
		});
	});

	test("hydrates and mutates server Session services across framed clients", async () => {
		const { runtime } = await makeServer();
		const firstClient = await Client.connect({
			serverId: runtime.serverId,
			transportFactory: createUnixTransportFactory({ path: runtime.socketPath }),
		});
		const secondClient = await Client.connect({
			serverId: runtime.serverId,
			transportFactory: createUnixTransportFactory({ path: runtime.socketPath }),
		});
		clients.add(firstClient);
		clients.add(secondClient);
		const errors: Error[] = [];
		const firstServices = createServerServiceSource(firstClient, { onError: (error) => errors.push(error) });
		const secondServices = createServerServiceSource(secondClient, { onError: (error) => errors.push(error) });
		expect(firstServices.connection.value).toMatchObject({ status: "connected" });
		expect(secondServices.connection.value).toMatchObject({ status: "connected" });
		const firstDirectory = await firstServices.host.get(SessionDirectory, {});
		const secondDirectory = await secondServices.host.get(SessionDirectory, {});
		const firstManagement = await firstServices.host.get(SessionManagement, {});
		const secondManagement = await secondServices.host.get(SessionManagement, {});

		await Promise.all([firstServices.host.ready(), secondServices.host.ready()]);
		expect(firstDirectory.state.value?.sessions.map(({ sessionId }) => sessionId)).toEqual(["demo-1", "demo-2"]);
		expect(secondDirectory.state.value).toEqual(firstDirectory.state.value);
		await firstServices.host.root((ctx) => firstManagement.create({ id: "demo-3" }, ctx));
		await vi.waitFor(() => {
			expect(firstDirectory.state.value?.sessions.map(({ sessionId }) => sessionId)).toContain("demo-3");
			expect(secondDirectory.state.value).toEqual(firstDirectory.state.value);
		});

		await Promise.all([
			firstServices.host.root((ctx) => firstManagement.attach("demo-1", ctx)),
			secondServices.host.root((ctx) => secondManagement.attach("demo-1", ctx)),
		]);
		expect(firstClient.attachment?.sessionId).toBe("demo-1");
		expect(secondClient.attachment?.sessionId).toBe("demo-1");
		await firstServices.host.root((ctx) => firstManagement.remove("demo-1", ctx));
		await vi.waitFor(() => {
			expect(firstClient.attachment).toBeUndefined();
			expect(secondClient.attachment).toBeUndefined();
			expect(firstDirectory.state.value?.sessions.map(({ sessionId }) => sessionId)).not.toContain("demo-1");
			expect(secondDirectory.state.value).toEqual(firstDirectory.state.value);
		});
		await secondServices.host.root((ctx) => secondManagement.detach(ctx));
		expect(errors).toEqual([]);

		await Promise.all([firstServices.dispose(BACKGROUND_CONTEXT), secondServices.dispose(BACKGROUND_CONTEXT)]);
	});

	test("preserves the active shared host after retired sources disconnect again", async () => {
		const { runtime } = await makeServer();
		const client = await Client.connect({
			serverId: runtime.serverId,
			transportFactory: createUnixTransportFactory({ path: runtime.socketPath }),
		});
		clients.add(client);

		for (const retireWhileConnected of [true, false]) {
			const retired = createServerServiceSource(client);
			if (!retireWhileConnected) client.disconnect();
			await retired.dispose(BACKGROUND_CONTEXT);
			await retired.dispose(BACKGROUND_CONTEXT);
			if (retireWhileConnected) client.disconnect();
			await client.reconnect();

			const active = createServerServiceSource(client);
			client.disconnect();
			await client.reconnect();
			const concurrent = createServerServiceSource(client);
			try {
				const directory = await active.host.get(SessionDirectory, {});
				const sameDirectory = await concurrent.host.get(SessionDirectory, {});
				try {
					await Promise.all([active.host.ready(), concurrent.host.ready()]);
					expect(sameDirectory.state.value).toEqual(directory.state.value);
					expect(directory.state.value?.sessions.map(({ sessionId }) => sessionId)).toEqual(["demo-1", "demo-2"]);
				} finally {
					directory.release();
					sameDirectory.release();
				}
			} finally {
				await concurrent.dispose(BACKGROUND_CONTEXT);
				await active.dispose(BACKGROUND_CONTEXT);
				client.disconnect();
				await client.reconnect();
			}
		}
	});

	test("hydrates and updates the Models service across concurrent framed clients", async () => {
		const { runtime } = await makeServer();
		const firstClient = await attachClient(runtime, "demo-1");
		const workerPid = runtime.workerPids.get("demo-1");
		expect(workerPid).toEqual(expect.any(Number));
		const secondClient = await attachClient(runtime, "demo-1");
		expect(runtime.workerPids.get("demo-1")).toBe(workerPid);
		const errors: Error[] = [];
		const firstServices = createSessionServiceSource(firstClient, { onError: (error) => errors.push(error) });
		const secondServices = createSessionServiceSource(secondClient, { onError: (error) => errors.push(error) });
		const firstModels = await firstServices.host.get(Models, {});
		const secondModels = await secondServices.host.get(Models, {});

		await Promise.all([firstServices.host.ready(), secondServices.host.ready()]);
		expect(firstServices.attachment.value).toEqual({ status: "attached", sessionId: "demo-1" });
		expect(secondServices.attachment.value).toEqual({ status: "attached", sessionId: "demo-1" });
		expect(firstModels.state.value?.configuration.model).toEqual({
			provider: "anthropic",
			modelId: "claude-sonnet-4-5",
		});
		expect(secondModels.state.value).toEqual(firstModels.state.value);
		const previousThinking = firstModels.state.value!.configuration.thinkingLevel;
		await firstServices.host.root((ctx) => firstModels.cycleThinking(ctx));
		await vi.waitFor(() => {
			expect(firstModels.state.value!.configuration.thinkingLevel).not.toBe(previousThinking);
			expect(secondModels.state.value).toEqual(firstModels.state.value);
		});
		expect(errors).toEqual([]);

		await Promise.all([firstServices.dispose(BACKGROUND_CONTEXT), secondServices.dispose(BACKGROUND_CONTEXT)]);
	});

	test("loads conventional Session facets from multiple configured plugin packages", async () => {
		const directory = await mkdtemp(join("/tmp", "pes-plugin-"));
		directories.add(directory);
		const secondPackagePath = join(directory, "second-plugin");
		await mkdir(join(secondPackagePath, "src"), { recursive: true });
		await Promise.all([
			writeFile(
				join(secondPackagePath, "package.json"),
				`${JSON.stringify({
					name: "@earendil-works/second-session-plugin",
					version: "1.0.0",
					peerDependencies: { "@earendil-works/chord": "^1.4.0" },
				})}\n`,
			),
			writeFile(
				join(secondPackagePath, "src", "session.ts"),
				'import { defineFacet, remote, method, hostNamed } from "@earendil-works/chord"; import { Type } from "typebox"; const Service = remote("test.second-plugin", { version: 1, input: Type.Object({}), host: hostNamed("session"), variants: { active: { methods: { read: method(undefined, Type.String()) } } } }); export default defineFacet(({serve}) => { serve(Service, () => ({variant:"active", read: () => "second"})); });\n',
			),
		]);
		const runtime = await startServer({ ...sessionWorkerModel, directory });
		servers.add(runtime);
		const clientRuntime = await openClientRuntime({ command: "client" }, { directory });
		const activated = await activateBuiltinClientServices(clientRuntime.servers[0]!);
		await activated.server.host.root((ctx) =>
			activated.plugins.prepareSession(
				{
					sessionId: "demo-1",
					packagePaths: [
						fileURLToPath(new URL("../examples/plugins/pi-example-plugin", import.meta.url)),
						secondPackagePath,
					],
				},
				ctx,
			),
		);
		await activated.server.host.root((ctx) => activated.management.attach("demo-1", ctx));
		const services = createSessionServiceSource(clientRuntime.servers[0]!.client, {});
		try {
			await services.host.ready();
			await expect(
				services.host.root(async (ctx) => {
					const example = await ctx.get(ExampleFacetService, {});
					return example.greet({ name: "Armin" }, ctx);
				}),
			).resolves.toMatchObject({ workerActivations: 1 });
			await expect(
				services.host.root(async (ctx) => {
					const second = await ctx.get(SecondPluginService, {});
					return second.read(ctx);
				}),
			).resolves.toBe("second");
		} finally {
			await services.dispose(BACKGROUND_CONTEXT);
			await clientRuntime.dispose();
		}
	});

	test("uses the most recently selected model for a new Session", async () => {
		const directory = await mkdtemp(join("/tmp", "pes-model-default-"));
		directories.add(directory);
		const runtime = await startServer({ directory });
		servers.add(runtime);
		const firstClient = await attachClient(runtime, "demo-1");
		const firstServices = createSessionServiceSource(firstClient);
		const firstModels = await firstServices.host.get(Models, {});
		await firstServices.host.ready();
		await firstServices.host.root((ctx) =>
			firstModels.select({ provider: "anthropic", modelId: "claude-opus-4-6" }, ctx),
		);
		await firstServices.dispose(BACKGROUND_CONTEXT);
		await firstClient.dispose();
		clients.delete(firstClient);
		await expect.poll(() => runtime.workerPids.has("demo-1")).toBe(false);

		const secondClient = await attachClient(runtime, "demo-2");
		const secondServices = createSessionServiceSource(secondClient);
		const secondModels = await secondServices.host.get(Models, {});
		await secondServices.host.ready();
		expect(secondModels.state.value?.configuration.model).toEqual({
			provider: "anthropic",
			modelId: "claude-opus-4-6",
		});
		await secondServices.dispose(BACKGROUND_CONTEXT);
	});

	test("composes management attachment with Session service hydration", async () => {
		const { runtime } = await makeServer();
		const clientRuntime = await openClientRuntime({
			command: "client",
			connect: { transport: "unix", path: runtime.socketPath },
		});
		try {
			const server = await activateBuiltinClientServices(clientRuntime.servers[0]!);
			await server.server.host.root((ctx) =>
				server.plugins.prepareSession({ sessionId: "demo-1", packagePaths: null }, ctx),
			);
			await server.server.host.root((ctx) => server.management.attach("demo-1", ctx));

			expect(server.session.attachment.value).toEqual({ status: "attached", sessionId: "demo-1" });
			expect(server.models.state.value?.configuration.model).toEqual({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
			});
		} finally {
			await clientRuntime.dispose();
		}
	});

	test("keeps attached capabilities usable after a rejected Session switch", async () => {
		const { runtime } = await makeServer();
		const clientRuntime = await openClientRuntime({
			command: "client",
			connect: { transport: "unix", path: runtime.socketPath },
		});
		try {
			const server = await activateBuiltinClientServices(clientRuntime.servers[0]!);
			await server.server.host.root((ctx) => server.management.attach("demo-1", ctx));
			const attachment = server.client.attachment;
			const models = server.models;
			const agent = server.agent;
			const transcript = server.transcript;
			await expect(
				server.server.host.root((ctx) => server.management.attach("missing-session", ctx)),
			).rejects.toBeDefined();
			expect(server.client.attachment).toEqual(attachment);
			expect(server.models).toBe(models);
			expect(server.agent).toBe(agent);
			expect(server.transcript).toBe(transcript);
			await expect(server.server.host.root((ctx) => models.getThinkingLevels(ctx))).resolves.toContain("off");
			await expect(server.server.host.root((ctx) => agent.cancelQueued("missing-entry", ctx))).resolves.toEqual({
				outcome: "not_found",
			});
			expect(transcript.state.value.snapshot).toMatchObject({ lane: "main", operation: null });
		} finally {
			await clientRuntime.dispose();
		}
	});

	test("releases partially acquired replacement capabilities when hydration fails", async ({ onTestFinished }) => {
		const { runtime } = await makeServer();
		const clientRuntime = await openClientRuntime({
			command: "client",
			connect: { transport: "unix", path: runtime.socketPath },
		});
		try {
			const runtimeServer = clientRuntime.servers[0]!;
			const releaseCounts: Array<() => number> = [];
			const get = runtimeServer.server.host.get.bind(runtimeServer.server.host);
			let rejectReplacement = false;
			const failingGet = vi
				.spyOn(runtimeServer.server.host, "get")
				.mockImplementation(async (contract, input, options) => {
					if (
						rejectReplacement &&
						contract.name === AgentController.name &&
						runtimeServer.client.attachment?.sessionId === "demo-2"
					)
						throw new Error("replacement agent acquisition failed");
					const reference = await get(contract, input, options);
					if (contract.name === Models.name) {
						const release = vi.spyOn(reference, "release");
						onTestFinished(() => release.mockRestore());
						releaseCounts.push(() => release.mock.calls.length);
					}
					return reference;
				});
			onTestFinished(() => failingGet.mockRestore());
			const server = await activateBuiltinClientServices(runtimeServer);
			await server.server.host.root((ctx) => server.management.attach("demo-1", ctx));
			rejectReplacement = true;
			await expect(server.server.host.root((ctx) => server.management.attach("demo-2", ctx))).rejects.toThrow(
				"replacement agent acquisition failed",
			);
			expect(server.client.attachment?.sessionId).toBe("demo-2");
			expect(releaseCounts.map((count) => count())).toEqual([1, 1]);
			expect(() => server.models).toThrow("No Session is attached");
			rejectReplacement = false;
			await server.server.host.root((ctx) => server.management.attach("demo-2", ctx));
			await expect(server.server.host.root((ctx) => server.models.getThinkingLevels(ctx))).resolves.toContain("off");
		} finally {
			await clientRuntime.dispose();
		}
	});

	test("fences superseded attachment hydration by attachment generation", async ({ onTestFinished }) => {
		const { runtime } = await makeServer();
		const client = await Client.connect({
			serverId: runtime.serverId,
			transportFactory: createUnixTransportFactory({ path: runtime.socketPath }),
		});
		clients.add(client);
		const errors: Error[] = [];
		const services = createSessionServiceSource(client, { onError: (error) => errors.push(error) });
		const states: SessionAttachmentState[] = [];
		const removeStateListener = services.attachment.subscribe((state) => states.push(state));
		let releaseDelay!: () => void;
		const delayed = new Promise<void>((resolve) => {
			releaseDelay = resolve;
		});
		const get = services.host.get.bind(services.host);
		const subscribe = vi.spyOn(services.host, "get").mockImplementation(async (contract, input, options) => {
			if (client.attachment?.sessionId === "demo-2" && contract.name === SessionPlugins.name) await delayed;
			return get(contract, input, options);
		});
		onTestFinished(() => subscribe.mockRestore());

		try {
			await attachSession(client, "demo-2");
			expect(services.attachment.value).toEqual({ status: "attaching", sessionId: "demo-2" });
			await attachSession(client, "demo-1");
			await services.whenAttached("demo-1", BACKGROUND_CONTEXT);
			expect(services.attachment.value).toEqual({ status: "attached", sessionId: "demo-1" });
			const models = await services.host.get(Models, {});
			expect(models.state.value.configuration.model).toEqual({
				provider: "anthropic",
				modelId: "claude-sonnet-4-5",
			});
			models.release();
		} finally {
			releaseDelay();
			removeStateListener();
			await services.dispose(BACKGROUND_CONTEXT);
		}

		const latestAttach = states
			.map((state) => state.status === "attaching" && state.sessionId === "demo-1")
			.lastIndexOf(true);
		expect(latestAttach).toBeGreaterThanOrEqual(0);
		expect(states.slice(latestAttach)).not.toContainEqual({ status: "attached", sessionId: "demo-2" });
		expect(states.slice(latestAttach)).not.toContainEqual({ status: "degraded", sessionId: "demo-2" });
		expect(errors).toEqual([]);
	});

	test("observes keyed service instances and fences replacement generations over framed transport", async ({
		onTestFinished,
	}) => {
		const spawn = vi
			.spyOn(processRuntime, "spawnInternalProcess")
			.mockImplementation((role, args, options) =>
				realSpawnInternalProcess(
					role,
					args,
					role === "session-worker" ? { ...options, entryUrl: fauxWorkerEntryUrl } : options,
				),
			);
		onTestFinished(() => spawn.mockRestore());
		const { runtime } = await makeServer();
		const client = await attachClient(runtime, "demo-1");
		const errors: Error[] = [];
		const services = createSessionServiceSource(client, {
			onError: (error) => errors.push(error),
		});
		await services.whenAttached("demo-1", BACKGROUND_CONTEXT);
		const first = await services.host.get(KeyedProbe, { key: "probe" });
		const other = await services.host.get(KeyedProbe, { key: "other" });
		const observed: string[] = [];
		const stop = first.state.subscribe((state) => observed.push(state.value));
		expect(first.state.value.value).toBe("first");
		await services.host.root((ctx) => first.replace("second", ctx));
		await vi.waitFor(() => expect(observed).toEqual(["first", "second"]));
		expect(other.state.value.value).toBe("first");
		await attachSession(client, "demo-2");
		await services.whenAttached("demo-2", BACKGROUND_CONTEXT);
		await expect(services.host.root((ctx) => first.replace("late", ctx))).rejects.toBeDefined();
		const replacement = await services.host.get(KeyedProbe, { key: "probe" });
		expect(replacement.state.value.value).toBe("first");
		stop();
		first.release();
		other.release();
		replacement.release();
		expect(errors).toEqual([]);
		await services.dispose(BACKGROUND_CONTEXT);
	});

	test("streams prompt events through the worker-owned service provider", async ({ onTestFinished }) => {
		const spawn = vi
			.spyOn(processRuntime, "spawnInternalProcess")
			.mockImplementation((role, args, options) =>
				realSpawnInternalProcess(
					role,
					args,
					role === "session-worker" ? { ...options, entryUrl: fauxWorkerEntryUrl } : options,
				),
			);
		onTestFinished(() => spawn.mockRestore());
		const { directory } = await makeServer();
		const eventTypes: string[] = [];

		const result = await runClient(
			{ command: "client", sessionId: "demo-1", prompt: "question" },
			{
				directory,
				onEvent(event) {
					eventTypes.push(event.type);
				},
			},
		);

		expect(result).toMatchObject({ kind: "prompted", text: "deterministic remote answer" });
		expect(eventTypes).toEqual(
			expect.arrayContaining([
				"run_start",
				"message_start",
				"message_update",
				"message_end",
				"entry_added",
				"run_end",
			]),
		);
	});

	test("replicates terminal operation state after consecutive prompts", async ({ onTestFinished }) => {
		const spawn = vi
			.spyOn(processRuntime, "spawnInternalProcess")
			.mockImplementation((role, args, options) =>
				realSpawnInternalProcess(
					role,
					args,
					role === "session-worker" ? { ...options, entryUrl: fauxWorkerEntryUrl } : options,
				),
			);
		onTestFinished(() => spawn.mockRestore());
		const { runtime } = await makeServer();
		const client = await attachClient(runtime, "demo-1");
		const services = createSessionServiceSource(client);
		const controller = await services.host.get(AgentController, {});
		const transcript = await services.host.get(Transcript, {});
		await services.host.ready();
		await services.host.root(async (ctx) => {
			const plugins = await ctx.get(SessionPlugins, {});
			await plugins.reload(ctx);
		});
		try {
			for (const message of ["first question", "second question"]) {
				const response = await services.host.root((ctx) => controller.prompt({ message, images: null }, ctx));
				expect(response).toMatchObject({ accepted: true, operationId: expect.any(String) });
				await vi.waitFor(() => {
					expect(transcript.state.value?.snapshot).toMatchObject({
						operation: null,
						lastResult: { operationId: response.operationId },
					});
				});
			}
		} finally {
			await services.dispose(BACKGROUND_CONTEXT);
		}
	});

	test("stops an idle Session worker after its client disconnects", async () => {
		const { runtime } = await makeServer();
		const client = await attachClient(runtime, "demo-1");
		const pid = runtime.workerPids.get("demo-1");
		expect(pid).toEqual(expect.any(Number));

		await client.dispose();
		clients.delete(client);
		await expect.poll(() => runtime.workerPids.has("demo-1")).toBe(false);
		expect(processExists(pid!)).toBe(false);
	});

	test("starts one process per attached session and stops them during shutdown", async () => {
		const { runtime } = await makeServer();
		await Promise.all([attachClient(runtime, "demo-1"), attachClient(runtime, "demo-2")]);

		const pids = [...runtime.workerPids.values()];
		expect(pids).toHaveLength(2);
		expect(new Set(pids).size).toBe(2);
		for (const pid of pids) expect(processExists(pid)).toBe(true);

		await runtime.close();
		expect(runtime.workerPids.size).toBe(0);
		await Promise.all(pids.map((pid) => expect.poll(() => processExists(pid)).toBe(false)));
	});

	test("server runtime replaces an exited worker on the next attach", async () => {
		const directory = await mkdtemp(join("/tmp", "pew-"));
		directories.add(directory);
		const runtime = await startServer({ ...sessionWorkerModel, directory });
		servers.add(runtime);
		const client = await attachClient(runtime, "demo-1");
		const firstPid = runtime.workerPids.get("demo-1");
		expect(firstPid).toEqual(expect.any(Number));

		process.kill(firstPid!, "SIGKILL");
		await expect.poll(() => runtime.workerPids.has("demo-1")).toBe(false);
		await attachSession(client, "demo-1");
		const replacementPid = runtime.workerPids.get("demo-1");
		expect(replacementPid).toEqual(expect.any(Number));
		expect(replacementPid).not.toBe(firstPid);
	});

	test("discovers workers after replacing the server", async () => {
		const firstDirectory = await mkdtemp(join("/tmp", "per-"));
		directories.add(firstDirectory);
		const first = await startServer({ ...sessionWorkerModel, directory: firstDirectory });
		servers.add(first);
		await attachClient(first, "demo-1");
		const firstWorkerPid = first.workerPids.get("demo-1");
		expect(firstWorkerPid).toEqual(expect.any(Number));

		const replacement = await startServer({ ...sessionWorkerModel, directory: firstDirectory });
		servers.add(replacement);
		await first.closed;

		expect(replacement.serverId).toBe(first.serverId);
		expect(replacement.workerPids.get("demo-1")).toBe(firstWorkerPid);
		await expect.poll(() => first.workerPids.size).toBe(0);
		expect(processExists(firstWorkerPid!)).toBe(true);

		await expect(runClient({ command: "client" }, { directory: firstDirectory })).resolves.toMatchObject({
			kind: "list",
			sessions: [
				{ serverId: first.serverId, sessionId: "demo-1" },
				{ serverId: first.serverId, sessionId: "demo-2" },
			],
		});
		await attachClient(replacement, "demo-1");
		expect(replacement.workerPids.get("demo-1")).toBe(firstWorkerPid);
		await attachClient(replacement, "demo-2");
		expect(replacement.workerPids.get("demo-2")).toEqual(expect.any(Number));
		expect(replacement.workerPids.get("demo-2")).not.toBe(firstWorkerPid);
	});

	test("retires an unclaimed idle worker after replacement demand expires", async () => {
		const directory = await mkdtemp(join("/tmp", "pi-orphan-worker-"));
		directories.add(directory);
		vi.stubEnv("__PI_SESSION_WORKER_ORPHAN_DEMAND_GRACE_MS", "50");
		const first = await startServer({ ...sessionWorkerModel, directory });
		servers.add(first);
		await attachClient(first, "demo-1");
		const workerPid = first.workerPids.get("demo-1");
		expect(workerPid).toEqual(expect.any(Number));

		const replacement = await startServer({ ...sessionWorkerModel, directory });
		servers.add(replacement);
		await first.closed;
		expect(replacement.workerPids.get("demo-1")).toBe(workerPid);

		await expect.poll(() => replacement.workerPids.has("demo-1"), { timeout: 5_000 }).toBe(false);
		expect(processExists(workerPid!)).toBe(false);
	});

	test("restores tracked sessions that are outside the replacement catalog", async () => {
		const directory = await mkdtemp(join("/tmp", "pet-"));
		const emptySessionDir = await mkdtemp(join("/tmp", "pet-sessions-"));
		directories.add(directory);
		directories.add(emptySessionDir);
		const first = await startServer({ ...sessionWorkerModel, directory });
		servers.add(first);
		await attachClient(first, "demo-1");
		const workerPid = first.workerPids.get("demo-1");

		const replacement = await startServer({
			...sessionWorkerModel,
			directory,
			sessionDir: emptySessionDir,
		});
		servers.add(replacement);
		await first.closed;

		await expect(runClient({ command: "client" }, { directory })).resolves.toEqual({
			kind: "list",
			sessions: [{ serverId: first.serverId, sessionId: "demo-1" }],
		});
		await attachClient(replacement, "demo-1");
		expect(replacement.workerPids.get("demo-1")).toBe(workerPid);
	});

	test("reports missing and ambiguous session selections", async () => {
		const sharedDirectory = await mkdtemp(join("/tmp", "ped-"));
		directories.add(sharedDirectory);
		const firstShared = await startServer({
			...sessionWorkerModel,
			directory: sharedDirectory,
			serverId: "00000000-0000-4000-8000-000000000001",
		});
		const secondShared = await startServer({
			...sessionWorkerModel,
			directory: sharedDirectory,
			serverId: "00000000-0000-4000-8000-000000000002",
		});
		servers.add(firstShared);
		servers.add(secondShared);

		await expect(
			runClient({ command: "client", sessionId: "missing" }, { directory: sharedDirectory }),
		).rejects.toThrow("No discovered server contains session missing");
		await expect(
			runClient({ command: "client", sessionId: "demo-1" }, { directory: sharedDirectory }),
		).rejects.toThrow("Session demo-1 is available from more than one server");
	});
	test("rejects a duplicate session ID within one durable repository", async () => {
		await createExperimentalSessions(
			join(agentDir, "experimental", "sessions"),
			["demo-1"],
			join(agentDir, "other-cwd"),
		);
		const { directory } = await makeServer();

		await expect(runClient({ command: "client", sessionId: "demo-1" }, { directory })).rejects.toMatchObject({
			code: "invalid",
			reason: "session_ambiguous",
		});
	});
});

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}
