import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const codingAgentName = "@earendil-works/pi-coding-agent";

export function smokeTestCodingAgent(directory, runtime = process.execPath) {
	const packageDir = join(directory, "node_modules", codingAgentName);
	const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
	const developmentPackages = ["pi-client", "pi-server", "pi-protocol"].map((name) => `@earendil-works/${name}`);
	const visited = new Set();
	const checkPackages = (modules) => {
		if (!existsSync(modules)) return;
		const real = realpathSync(modules);
		if (visited.has(real)) return;
		visited.add(real);
		for (const entry of readdirSync(modules, { withFileTypes: true })) {
			if (entry.name.startsWith(".")) continue;
			if (entry.name.startsWith("@")) {
				checkPackages(join(modules, entry.name));
				continue;
			}
			const installed = join(modules, entry.name);
			const manifestPath = join(installed, "package.json");
			if (!existsSync(manifestPath)) continue;
			const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (developmentPackages.includes(pkg.name)) throw new Error(`Development-only package installed: ${pkg.name}`);
			for (const name of developmentPackages) {
				if (pkg.dependencies?.[name] || pkg.optionalDependencies?.[name]) {
					throw new Error(`Development-only dependency in ${pkg.name}: ${name}`);
				}
			}
			checkPackages(join(installed, "node_modules"));
		}
	};
	checkPackages(join(directory, "node_modules"));
	for (const path of ["dist/client", "dist/experimental", "dist/cli/experimental", "dist/bundle/client.js", "dist/bundle/coordinator.js"]) {
		if (existsSync(join(packageDir, path))) throw new Error(`Excluded coding-agent artifact: ${path}`);
	}
	const home = mkdtempSync(join(tmpdir(), "pi-coding-agent-smoke-home-"));
	const entry = join(directory, "coding-agent-smoke.mjs");
	const env = {
		PATH: process.env.PATH,
		HOME: home,
		USERPROFILE: home,
		APPDATA: home,
		LOCALAPPDATA: home,
		XDG_CONFIG_HOME: home,
		XDG_CACHE_HOME: home,
		PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
		PI_OFFLINE: "1",
		PI_TELEMETRY: "0",
	};
	for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
		if (process.env[name]) env[name] = process.env[name];
	}
	try {
		writeFileSync(entry, `import assert from "node:assert/strict";
import { createAgentSession, SessionManager, ModelRuntime } from "${codingAgentName}";
assert.equal(typeof createAgentSession, "function");
assert.equal(typeof SessionManager.inMemory, "function");
assert.equal(typeof ModelRuntime.create, "function");
for (const specifier of ${JSON.stringify(["@earendil-works/pi-client", "@earendil-works/pi-server", "@earendil-works/pi-protocol", "@earendil-works/pi-coding-agent/client", "@earendil-works/pi-coding-agent/experimental", "@earendil-works/pi-coding-agent/experimental/plugin"])}) {
  assert.throws(() => import.meta.resolve(specifier), undefined, "Source-only export resolves: " + specifier);
}
`);
		execFileSync(runtime, [entry], { cwd: directory, env, stdio: ["inherit", "pipe", "pipe"], timeout: 30_000 });
		for (const cli of new Set([manifest.bin.pi, "dist/cli.js"])) {
			const output = execFileSync(runtime, [join(packageDir, cli), "--version"], {
				cwd: directory,
				encoding: "utf8",
				env,
				stdio: ["inherit", "pipe", "pipe"],
				timeout: 30_000,
			});
			if (output.trim() !== manifest.version) throw new Error(`Unexpected version from ${cli}: ${output}`);
		}
	} finally {
		rmSync(entry, { force: true });
		rmSync(home, { recursive: true, force: true });
	}
	console.log(`Coding-agent policy smoke tests passed (${runtime}).`);
}
