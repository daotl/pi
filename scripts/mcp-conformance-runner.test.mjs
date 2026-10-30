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
