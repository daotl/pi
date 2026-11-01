import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const runner = fileURLToPath(new URL("../packages/coding-agent/test/mcp-conformance/run.ts", import.meta.url));
for (const end of ["signal", "exit", "exit-one", "success"]) {
	test(`conformance runner distinguishes ${end} from successful report files`, { skip: process.platform === "win32" }, () => {
		const root = mkdtempSync(join(tmpdir(), "pi-conformance-runner-"));
		try {
			const npx = join(root, "npx");
			writeFileSync(npx, `#!/usr/bin/env node\nconst fs=require('node:fs'),p=require('node:path');const args=process.argv.slice(2);if(args.includes('list')){console.log('  - synthetic');process.exit(0)}const dir=args[args.indexOf('--output-dir')+1];fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(p.join(dir,'checks.json'),JSON.stringify([{id:'synthetic',status:'SUCCESS'}]));fs.writeFileSync(process.env.PI_MCP_CONFORMANCE_REPORT,JSON.stringify({success:true}));${end === "signal" ? "process.kill(process.pid,'SIGTERM');" : `process.exit(${end === "exit" ? 2 : end === "exit-one" ? 1 : 0});`}\n`);
			chmodSync(npx, 0o755);
			const result = spawnSync(process.execPath, [runner, "--mode", "2025-03-26", "--scenario", "synthetic"], { env: { ...process.env, PATH: root + delimiter + process.env.PATH }, encoding: "utf8" });
			assert.equal(result.status, end === "success" ? 0 : 1, result.stdout + result.stderr);
			if (end !== "success") assert.match(result.stdout, /runner-termination.*(?:signal|terminated|exit)/i);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
}

function runReportedScenarios(t, mode, requested, reports) {
	const root = mkdtempSync(join(tmpdir(), "pi-conformance-baseline-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const npx = join(root, "npx");
	writeFileSync(npx, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const reports = ${JSON.stringify(reports)};
const args = process.argv.slice(2);
if (args.includes("list")) {
	for (const scenario of Object.keys(reports)) console.log("  - " + scenario);
	process.exit(0);
}
const report = reports[args[args.indexOf("--scenario") + 1]];
const directory = args[args.indexOf("--output-dir") + 1];
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, "checks.json"), JSON.stringify(report.checks));
fs.writeFileSync(process.env.PI_MCP_CONFORMANCE_REPORT, JSON.stringify({ success: report.success }));
process.exit(report.success && report.checks.every((check) => check.status === "SUCCESS") ? 0 : 1);
`);
	chmodSync(npx, 0o755);
	return spawnSync(process.execPath, [runner, "--mode", mode, ...requested.flatMap((scenario) => ["--scenario", scenario])], {
		env: { ...process.env, PATH: root + delimiter + (process.env.PATH ?? "") },
		encoding: "utf8",
	});
}

const baselineTests = { skip: process.platform === "win32" };
test("conformance baseline accepts unchanged passing checks", baselineTests, (t) => {
	const result = runReportedScenarios(t, "2025-06-18", ["initialize"], {
		initialize: { checks: [{ id: "mcp-client-initialization", status: "SUCCESS" }], success: true },
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /No regressions against the baseline/);
});

test("conformance baseline rejects a previously passing check that fails", baselineTests, (t) => {
	const result = runReportedScenarios(t, "2025-06-18", ["initialize"], {
		initialize: {
			checks: [{ id: "mcp-client-initialization", status: "FAILURE", errorMessage: "initialization rejected" }],
			success: true,
		},
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /2025-06-18 initialize: mcp-client-initialization fails: initialization rejected/);
});

test("conformance baseline rejects a previously passing check that disappears", baselineTests, (t) => {
	const result = runReportedScenarios(t, "2025-06-18", ["initialize"], {
		initialize: { checks: [], success: true },
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /2025-06-18 initialize: mcp-client-initialization was not reported/);
});

test("conformance baseline rejects a missing scenario while another requested scenario runs", baselineTests, (t) => {
	const result = runReportedScenarios(t, "2025-06-18", ["initialize", "tools_call"], {
		tools_call: {
			checks: [
				{ id: "tool-add-numbers", status: "SUCCESS" },
				{ id: "wire-schema-valid", status: "SUCCESS" },
			],
			success: true,
		},
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /pass tools_call/);
	assert.match(result.stdout, /2025-06-18 initialize: scenario did not run/);
});

test("conformance baseline accepts a known failure without hiding it", baselineTests, (t) => {
	const passing = [
		"authorization-request",
		"authorization-server-metadata",
		"client-registration",
		"pkce-code-challenge-sent",
		"pkce-code-verifier-sent",
		"pkce-s256-method-used",
		"pkce-verifier-matches-challenge",
		"prm-pathbased-requested",
		"scope-retry-limit",
		"token-request",
	];
	const result = runReportedScenarios(t, "2025-11-25", ["auth/scope-retry-limit"], {
		"auth/scope-retry-limit": {
			checks: passing.map((id) => ({ id, status: "SUCCESS" })),
			success: false,
		},
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /FAIL auth\/scope-retry-limit/);
	assert.match(result.stdout, /pi-client/);
	assert.match(result.stdout, /No regressions against the baseline/);
});
