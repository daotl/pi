import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this test runner through npm test.");

for (const [args, env] of [
	[[vitest, "--run"], process.env],
	[[vitest, "--run"], { ...process.env, PI_DURABLE_DOCUMENT_RETENTION_MS: "0" }],
	[[npm, "run", "test:workers"], process.env],
]) {
	const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
	if (result.error) throw result.error;
	if (result.signal) {
		process.kill(process.pid, result.signal);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}
