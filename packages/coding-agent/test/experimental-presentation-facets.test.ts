import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHost, local, method } from "@earendil-works/chord";
import { Type } from "typebox";
import { afterEach, describe, expect, test } from "vitest";
import {
	activateBuiltinClientServices,
	type ClientRuntime,
	openClientRuntime,
} from "../src/experimental/client-runtime.ts";
import {
	createPresentationFacetData,
	type LoadedPluginFacets,
	loadPresentationFacets,
	loadSessionPluginFacets,
} from "../src/experimental/plugins/bundled.ts";
import {
	createServerPluginPackage,
	readFacetBundleManifest,
	restoreServerPluginPackageProfile,
} from "../src/experimental/plugins/package.ts";
import { type RunningServer, startServer } from "../src/experimental/server.ts";

const runtimes = new Set<ClientRuntime>();
const runningServers = new Set<RunningServer>();
const directories = new Set<string>();

const GenerationProbe = local("test.presentation-generation", {
	version: 1,
	input: Type.Object({}),
	members: { read: method(undefined, Type.String()) },
});

function presentationSource(generation: string): string {
	return `import { defineFacet, local, method } from "@earendil-works/chord";
import { Type } from "typebox";
const Probe = local("test.presentation-generation", {
	version: 1, input: Type.Object({}), members: { read: method(undefined, Type.String()) },
});
export default defineFacet(({ serve }) => serve(Probe, () => ({ read: () => ${JSON.stringify(generation)} })));
`;
}

async function readPresentationGeneration(loaded: LoadedPluginFacets): Promise<string> {
	const host = createHost({ name: "presentation", self: null });
	try {
		await host.load(loaded.facets);
		const probe = await host.get(GenerationProbe, {});
		return await host.root((ctx) => probe.read(ctx));
	} finally {
		await host.close();
	}
}

afterEach(async () => {
	await Promise.allSettled([...runtimes].map((runtime) => runtime.dispose()));
	await Promise.allSettled([...runningServers].map((server) => server.close()));
	await Promise.allSettled([...directories].map((directory) => rm(directory, { force: true, recursive: true })));
	runtimes.clear();
	runningServers.clear();
	directories.clear();
});

describe("server-selected presentation facets", () => {
	test("rejects local plugin paths for Radius servers", async () => {
		await expect(
			openClientRuntime({
				command: "client",
				connect: { transport: "radius", serverId: randomUUID() },
				pluginPackages: ["./local-plugin"],
			}),
		).rejects.toThrow("only be configured on a local Unix server");
	});

	test("restores plugin package selections for later server generations", async () => {
		const directory = await mkdtemp("/tmp/pi-presentation-profile-");
		directories.add(directory);
		const serverId = randomUUID();
		const packagePaths = [join(directory, "first-plugin"), join(directory, "second-plugin")];
		await expect(restoreServerPluginPackageProfile(directory, serverId, packagePaths)).resolves.toEqual(packagePaths);
		await expect(restoreServerPluginPackageProfile(directory, serverId)).resolves.toEqual(packagePaths);
		await expect(restoreServerPluginPackageProfile(directory, serverId, [])).resolves.toEqual([]);
		await expect(restoreServerPluginPackageProfile(directory, serverId)).resolves.toEqual([]);
	});

	test("builds conventional plugin entries into the server-owned plugin cache", async () => {
		const directory = await mkdtemp("/tmp/pi-presentation-package-");
		directories.add(directory);
		const serverId = randomUUID();
		const packagePath = join(directory, "pi-example-plugin");
		await mkdir(join(packagePath, "src"), { recursive: true });
		await writeFile(
			join(packagePath, "package.json"),
			`${JSON.stringify({
				name: "@earendil-works/test-plugin",
				version: "1.0.0",
				peerDependencies: {
					"@earendil-works/chord": "^1.4.0",
					"@earendil-works/pi-coding-agent": "^0.84.4",
				},
			})}\n`,
		);
		const sourcePath = join(packagePath, "src", "tui.ts");
		await writeFile(sourcePath, presentationSource("built-a"));
		const plugin = createServerPluginPackage(directory, serverId, packagePath);

		const first = await plugin.build();
		expect(first).toHaveLength(1);
		expect(plugin.manifestPath).toMatch(
			new RegExp(`/plugin-builds/${serverId}/pi-example-plugin-[a-f0-9]{12}/pi-plugin-facets\\.json$`, "u"),
		);
		expect(first[0]?.plugin).toEqual({ id: "@earendil-works/test-plugin", version: "1.0.0" });
		const firstLoaded = await loadPresentationFacets(createPresentationFacetData(first));
		expect(await readPresentationGeneration(firstLoaded)).toBe("built-a");
		await firstLoaded.dispose();
		await expect(
			loadPresentationFacets(
				createPresentationFacetData(
					first.map((artifact) => ({ ...artifact, source: `${artifact.source}\n// corrupted` })),
				),
			),
		).rejects.toThrow("integrity");

		await writeFile(sourcePath, presentationSource("built-b"));
		const second = await plugin.build();
		const secondLoaded = await loadPresentationFacets(createPresentationFacetData(second));
		expect(await readPresentationGeneration(secondLoaded)).toBe("built-b");
		await secondLoaded.dispose();

		const secondPackagePath = join(directory, "second-plugin");
		await mkdir(join(secondPackagePath, "src"), { recursive: true });
		await Promise.all([
			writeFile(
				join(secondPackagePath, "package.json"),
				`${JSON.stringify({
					name: "@earendil-works/second-test-plugin",
					version: "1.0.0",
					peerDependencies: { "@earendil-works/chord": "^1.4.0" },
				})}\n`,
			),
			writeFile(
				join(secondPackagePath, "src", "tui.ts"),
				'import { defineFacet } from "@earendil-works/chord"; export default defineFacet(() => {});\n',
			),
		]);
		const running = await startServer({
			directory: join(directory, "server"),
			sessionDir: join(directory, "sessions"),
		});
		runningServers.add(running);
		const runtime = await openClientRuntime({
			command: "client",
			connect: { transport: "unix", path: running.socketPath },
			pluginPackages: [packagePath, secondPackagePath],
		});
		runtimes.add(runtime);
		const activated = await activateBuiltinClientServices(runtime.servers[0]!);
		const sessionId = randomUUID();
		await activated.server.host.root((ctx) => activated.management.create({ id: sessionId }, ctx));
		const presentationPlugins = await activated.server.host.root((ctx) =>
			activated.plugins.prepareSession({ sessionId, packagePaths: [packagePath, secondPackagePath] }, ctx),
		);
		await expect(restoreServerPluginPackageProfile(join(directory, "server"), running.serverId)).resolves.toEqual([]);
		const serverLoaded = await loadPresentationFacets(presentationPlugins);
		expect(serverLoaded.facets.map(({ name }) => name)).toEqual([
			"@earendil-works/test-plugin/tui",
			"@earendil-works/second-test-plugin/tui",
		]);
		expect(await readPresentationGeneration(serverLoaded)).toBe("built-b");
		await serverLoaded.dispose();

		await writeFile(sourcePath, presentationSource("built-c"));
		const data = await activated.server.host.root((ctx) => activated.plugins.reload(ctx));
		const reloaded = await loadPresentationFacets(data);
		expect(await readPresentationGeneration(reloaded)).toBe("built-c");
		await reloaded.dispose();
	});

	test("loads override-only facet entries selected by package metadata", async () => {
		const directory = await mkdtemp("/tmp/pi-presentation-override-");
		directories.add(directory);
		const packagePath = join(directory, "custom-plugin");
		await mkdir(join(packagePath, "src"), { recursive: true });
		await writeFile(
			join(packagePath, "package.json"),
			JSON.stringify({
				name: "test-custom-plugin",
				chord: { facets: { session: "./src/worker.ts", tui: "./src/view.ts" } },
			}),
		);
		await writeFile(join(packagePath, "src", "worker.ts"), presentationSource("session-override"));
		await writeFile(join(packagePath, "src", "view.ts"), presentationSource("tui-override"));
		const plugin = createServerPluginPackage(directory, randomUUID(), packagePath);
		const artifacts = await plugin.build();
		const presentation = await loadPresentationFacets(createPresentationFacetData(artifacts));
		try {
			expect(await readPresentationGeneration(presentation)).toBe("tui-override");
		} finally {
			await presentation.dispose();
		}
		const session = await loadSessionPluginFacets([plugin.manifestPath]);
		try {
			expect(await readPresentationGeneration(session)).toBe("session-override");
		} finally {
			await session.dispose();
		}
	});

	test("does not build or distribute an explicitly disabled conventional facet", async () => {
		const directory = await mkdtemp("/tmp/pi-presentation-disabled-");
		directories.add(directory);
		const packagePath = join(directory, "disabled-plugin");
		await mkdir(join(packagePath, "src"), { recursive: true });
		await writeFile(
			join(packagePath, "package.json"),
			JSON.stringify({ name: "test-disabled-plugin", chord: { facets: { tui: false } } }),
		);
		await writeFile(join(packagePath, "src", "session.ts"), presentationSource("session-default"));
		await writeFile(join(packagePath, "src", "tui.ts"), "This disabled file must never be bundled.");
		const plugin = createServerPluginPackage(directory, randomUUID(), packagePath);
		expect(await plugin.build()).toEqual([]);
		expect(Object.keys((await readFacetBundleManifest(plugin.manifestPath)).entries)).toEqual(["session"]);
		const session = await loadSessionPluginFacets([plugin.manifestPath]);
		try {
			expect(await readPresentationGeneration(session)).toBe("session-default");
		} finally {
			await session.dispose();
		}
	});

	test("builds the example plugin package without a package-owned build script", async () => {
		const directory = await mkdtemp("/tmp/pi-example-plugin-");
		directories.add(directory);
		const serverId = randomUUID();
		const packagePath = fileURLToPath(new URL("../examples/plugins/pi-example-plugin", import.meta.url));
		const plugin = createServerPluginPackage(directory, serverId, packagePath);

		const artifacts = await plugin.build();
		const manifest = await readFacetBundleManifest(plugin.manifestPath);
		expect(manifest.plugin).toEqual({ id: "@earendil-works/pi-example-plugin", version: "1.0.0" });
		expect(Object.keys(manifest.entries)).toEqual(["session", "tui"]);
		const loaded = await loadPresentationFacets(createPresentationFacetData(artifacts));
		expect(loaded.facets.map(({ name }) => name)).toEqual(["@earendil-works/pi-example-plugin/tui"]);
		await loaded.dispose();
	});
});
