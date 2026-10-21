import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = join(repoRoot, "packages/ai");
const probeFiles = ["test/anthropic-eager-tool-input-e2e.test.ts", "test/anthropic-long-cache-retention-e2e.test.ts"];
const bindingFile = "test/anthropic-thinking-binding-e2e.test.ts";
const bindingName = "Anthropic thinking binding conformance > replays managed effort markers required by signed Fable thinking";
const e2eFiles = [...probeFiles, bindingFile];
const suiteNames = ["Anthropic Messages eager tool input streaming E2E", "Anthropic Messages long cache retention E2E"];

function collectE2E(t, { e2e, catalog } = {}) {
	const root = mkdtempSync(join(tmpdir(), "pi-ai-e2e-collection-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, "home");
	mkdirSync(home);
	const output = join(root, "collected.json");
	const networkAttempts = join(root, "network-attempts");
	const preload = join(root, "deny-network.cjs");
	writeFileSync(
		preload,
		[
			'const { appendFileSync } = require("node:fs");',
			'const { syncBuiltinESMExports } = require("node:module");',
			"function denyNetwork() {",
			`  appendFileSync(${JSON.stringify(networkAttempts)}, "network attempt\\n");`,
			'  throw new Error("Network is forbidden during E2E collection");',
			"}",
			'globalThis.fetch = denyNetwork;',
			'globalThis.WebSocket = denyNetwork;',
			'const net = require("node:net");',
			"net.connect = net.createConnection = net.Socket.prototype.connect = denyNetwork;",
			'require("node:tls").connect = denyNetwork;',
			'for (const protocol of ["node:http", "node:https"]) {',
			"  const transport = require(protocol);",
			"  transport.request = transport.get = denyNetwork;",
			"}",
			"syncBuiltinESMExports();",
		].join("\n"),
	);
	const collector = join(root, "collect.mjs");
	// The CLI's JSON listing omits skipped cases. Use the same real collection API,
	// retaining skipped registrations without ever calling runTestSpecifications/startVitest.
	writeFileSync(
		collector,
		[
			'import { writeFileSync } from "node:fs";',
			'import { relative } from "node:path";',
			`import { createVitest } from ${JSON.stringify(pathToFileURL(join(repoRoot, "node_modules/vitest/dist/node.js")).href)};`,
			`const root = ${JSON.stringify(packageRoot)};`,
			'const ctx = await createVitest("test", {',
			"  root,",
			`  config: ${JSON.stringify(join(packageRoot, "vitest.config.ts"))},`,
			'  configLoader: "runner",',
			"  watch: false,",
			"  api: false,",
			"  reporters: [],",
			"  cache: false,",
			'  pool: "forks",',
			"  maxWorkers: 1,",
			"  fileParallelism: false,",
			`  execArgv: ["--require", ${JSON.stringify(preload)}],`,
			"}, {",
			`  cacheDir: ${JSON.stringify(join(root, "cache"))},`,
			"  server: { watch: null, hmr: false },",
			"});",
			"try {",
			`  const { testModules, unhandledErrors } = await ctx.collect(${JSON.stringify(e2eFiles)});`,
			"  const errors = [...unhandledErrors];",
			"  for (const module of testModules) {",
			"    errors.push(...module.errors());",
			"    for (const suite of module.children.allSuites()) errors.push(...suite.errors());",
			"  }",
			'  if (errors.length) throw new AggregateError(errors, "E2E collection failed");',
			"  const files = testModules.map((module) => ({",
			'    file: relative(root, module.moduleId).replaceAll("\\\\", "/"),',
			"    tests: [...module.children.allTests()].map((test) => ({",
			"      name: test.fullName, mode: test.options.mode, state: test.result().state,",
			"    })),",
			"  }));",
			`  writeFileSync(${JSON.stringify(output)}, JSON.stringify(files));`,
			"  if (!files.length) process.exitCode = 1;",
			"} finally {",
			"  await ctx.close();",
			"}",
		].join("\n"),
	);
	// Allowlist rather than inherit: no provider keys, endpoint overrides, NODE_OPTIONS,
	// or credential/config homes from the caller can activate collection-time OAuth.
	const env = {
		PATH: dirname(process.execPath),
		HOME: home,
		USERPROFILE: home,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_CACHE_HOME: join(root, "cache"),
		APPDATA: home,
		LOCALAPPDATA: home,
		TMPDIR: root,
		TMP: root,
		TEMP: root,
		LANG: "C",
		TZ: "UTC",
		AWS_EC2_METADATA_DISABLED: "true",
		NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
	};
	for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
		if (process.env[name]) env[name] = process.env[name];
	}
	if (e2e !== undefined) env.PI_E2E_TESTS = e2e;
	if (catalog !== undefined) env.PI_DISABLE_CLOUD_PROVIDERS = catalog;
	const result = spawnSync(process.execPath, [collector], {
		cwd: packageRoot,
		env,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.ifError(result.error);
	assert.equal(result.signal, null, result.stdout + result.stderr);
	assert.equal(existsSync(networkAttempts), false, "Collection attempted a forbidden network request");
	assert.equal(existsSync(output), true, result.stdout + result.stderr);
	return { ...result, files: JSON.parse(readFileSync(output, "utf8")) };
}

function assertBindingSkipped(result) {
	assert.deepEqual(result.files.find((file) => file.file === bindingFile).tests, [
		{ name: bindingName, mode: "skip", state: "skipped" },
	]);
}

function assertProviderProbes(result) {
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.deepEqual(result.files.map((file) => file.file).sort(), [...e2eFiles].sort());
	assertBindingSkipped(result);
	for (const [index, filename] of probeFiles.entries()) {
		const tests = result.files.find((file) => file.file === filename).tests;
		assert.ok(tests.some((test) => test.name === `${suiteNames[index]} > covers every generated anthropic-messages model`));
		const probes = index === 0
			? [/ > anthropic\/claude-\S+ accepts configured tool streaming$/, / > anthropic\/claude-\S+ accepts forced eager_input_streaming$/]
			: [/ > anthropic\/claude-\S+ accepts long cache retention$/];
		for (const pattern of probes) {
			const probe = tests.find((test) => pattern.test(test.name));
			assert.ok(probe, `${filename} did not register ${pattern}`);
			assert.equal(probe.mode, "skip", "Credential-free provider probes must remain skipped");
			assert.equal(probe.state, "skipped");
		}
	}
}

test("AI Vitest excludes cloud E2E files unless explicitly enabled", (t) => {
	const result = collectE2E(t);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.deepEqual(result.files, []);
});

test("AI Vitest E2E opt-in registers provider probes when the catalog flag is unset", (t) => {
	assertProviderProbes(collectE2E(t, { e2e: "1" }));
});

test("AI Vitest E2E opt-in preserves an explicit disabled cloud catalog", (t) => {
	const result = collectE2E(t, { e2e: "1", catalog: "1" });
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.deepEqual(
		result.files.toSorted((a, b) => a.file.localeCompare(b.file)),
		[...probeFiles.map((file, index) => ({
			file,
			tests: [{ name: `${suiteNames[index]} > covers every generated anthropic-messages model`, mode: "run", state: "pending" }],
		})), { file: bindingFile, tests: [{ name: bindingName, mode: "skip", state: "skipped" }] }]
			.toSorted((a, b) => a.file.localeCompare(b.file)),
	);
});

test("AI Vitest E2E opt-in preserves an explicit enabled cloud catalog", (t) => {
	assertProviderProbes(collectE2E(t, { e2e: "1", catalog: "0" }));
});
