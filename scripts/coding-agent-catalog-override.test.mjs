import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const title = "overriding baseUrl keeps all built-in models";

for (const catalog of [undefined, "1", "0"]) {
	test(`coding-agent catalog ${catalog ?? "default"} ${catalog === "0" ? "executes" : "skips"} the offline registry contract`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "pi-coding-catalog-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const home = join(root, "home");
		mkdirSync(home);
		const output = join(root, "result.json");
		const attempts = join(root, "network-attempts");
		const preload = join(root, "deny-network.cjs");
		writeFileSync(preload, [
			'const { appendFileSync } = require("node:fs");',
			'const { syncBuiltinESMExports } = require("node:module");',
			`function denyNetwork() { appendFileSync(${JSON.stringify(attempts)}, "attempt\\n"); throw new Error("Network forbidden in catalog regression"); }`,
			"globalThis.fetch = globalThis.WebSocket = denyNetwork;",
			'const net = require("node:net");',
			"net.connect = net.createConnection = net.Socket.prototype.connect = denyNetwork;",
			'require("node:tls").connect = denyNetwork;',
			'for (const name of ["node:http", "node:https"]) { const transport = require(name); transport.request = transport.get = denyNetwork; }',
			"syncBuiltinESMExports();",
		].join("\n"));
		const env = {
			PATH: dirname(process.execPath), HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
			XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, TMPDIR: root, TMP: root, TEMP: root,
			PI_OFFLINE: "1", AWS_EC2_METADATA_DISABLED: "true", NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
		};
		for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
			if (process.env[name]) env[name] = process.env[name];
		}
		if (catalog !== undefined) env.PI_DISABLE_CLOUD_PROVIDERS = catalog;
		const result = spawnSync(process.execPath, [
			join(repoRoot, "node_modules/vitest/dist/cli.js"), "--run", "test/model-registry.test.ts",
			"-t", `^ModelRegistry baseUrl override \\(no custom models\\) ${title}$`,
			"--maxWorkers=1", "--reporter=json", `--outputFile=${output}`,
		], { cwd: join(repoRoot, "packages/coding-agent"), env, encoding: "utf8", timeout: 30_000 });
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(existsSync(attempts), false, "Catalog test attempted network I/O");
		const report = JSON.parse(readFileSync(output, "utf8"));
		const cases = report.testResults.flatMap(file => file.assertionResults);
		const matching = cases.filter(item => item.title === title);
		assert.equal(matching.length, 1, "Expected the existing registry behavior case exactly once");
		assert.equal(matching[0].status, catalog === "0" ? "passed" : "skipped");
		assert.deepEqual(cases.filter(item => item.status === "passed").map(item => item.title), catalog === "0" ? [title] : []);
	});
}
