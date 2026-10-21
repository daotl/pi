import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const guard = new URL("../packages/ai/test/setup-e2e-guard.ts", import.meta.url).href;
const groups = {
	"Anthropic bearer and federation credentials": [
		"ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_FEDERATION_RULE_ID", "ANTHROPIC_ORGANIZATION_ID",
		"ANTHROPIC_SERVICE_ACCOUNT_ID", "ANTHROPIC_IDENTITY_TOKEN_FILE", "ANTHROPIC_WORKSPACE_ID",
	],
	"provider API keys": ["QWEN_TOKEN_PLAN_API_KEY", "QWEN_TOKEN_PLAN_CN_API_KEY", "TYPESAFE_API_KEY", "META_API_KEY", "BASETEN_API_KEY"],
	"Azure endpoint configuration": ["AZURE_OPENAI_BASE_URL", "AZURE_OPENAI_RESOURCE_NAME", "AZURE_OPENAI_API_VERSION", "AZURE_OPENAI_DEPLOYMENT_NAME_MAP"],
};

function guardedEnvironment(t, names, optIn) {
	const root = mkdtempSync(join(tmpdir(), "pi-test-e2e-guard-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const home = join(root, "home");
	mkdirSync(home);
	const probe = join(root, "probe.mjs");
	writeFileSync(probe, `import ${JSON.stringify(guard)};\nconsole.log(JSON.stringify(Object.fromEntries(${JSON.stringify([...names, "PI_GUARD_UNRELATED"])}.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]))));\n`);
	const env = {
		PATH: dirname(process.execPath), HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home,
		PI_GUARD_UNRELATED: "preserve-unrelated", ...Object.fromEntries(names.map(name => [name, "synthetic-fixture"])),
	};
	if (optIn !== undefined) env.PI_E2E_TESTS = optIn;
	const result = spawnSync(process.execPath, [probe], { env, encoding: "utf8", timeout: 10_000 });
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	return JSON.parse(result.stdout);
}

for (const [group, names] of Object.entries(groups)) {
	test(`AI guard removes ambient ${group} without E2E opt-in`, (t) => {
		assert.deepEqual(guardedEnvironment(t, names), { PI_GUARD_UNRELATED: "preserve-unrelated" });
	});
}

test("AI guard only preserves credentials for exact E2E opt-in", (t) => {
	const names = [...Object.values(groups).flat(), "OPENAI_API_KEY"];
	assert.deepEqual(guardedEnvironment(t, names, "0"), { PI_GUARD_UNRELATED: "preserve-unrelated" });
	assert.deepEqual(guardedEnvironment(t, names, "1"), {
		PI_GUARD_UNRELATED: "preserve-unrelated", ...Object.fromEntries(names.map(name => [name, "synthetic-fixture"])),
	});
});
