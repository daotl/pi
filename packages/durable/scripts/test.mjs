import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this test runner through npm test.");

const forwardedArgs = process.argv.slice(2);
// Focused runs cover both Node retention modes. Run Workers explicitly with test:workers.
// Only argument-free npm test runs all three phases.
for (const [args, env] of [
	[[vitest, "--run", ...forwardedArgs], process.env],
	[[vitest, "--run", ...forwardedArgs], { ...process.env, PI_DURABLE_DOCUMENT_RETENTION_MS: "0" }],
	...(forwardedArgs.length === 0 ? [[[npm, "run", "test:workers"], process.env]] : []),
]) {
	const result = spawnSync(process.execPath, args, { stdio: "inherit", env });
	if (result.error) throw result.error;
	if (result.signal) {
		process.kill(process.pid, result.signal);
		process.exit(1);
	}
	if (result.status !== 0) process.exit(result.status ?? 1);
}
