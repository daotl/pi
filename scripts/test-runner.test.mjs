import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const tuiManifest = JSON.parse(readFileSync(join(repoRoot, "packages/tui/package.json"), "utf8"));

function runRunner(t, { catalogOverride, failed = false, npmStatus = 0, additionalNodeSummary = "" } = {}) {
	const root = mkdtempSync(join(tmpdir(), "pi-test-runner-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const bin = join(root, "bin");
	const parentHome = join(root, "caller-home");
	mkdirSync(bin);
	mkdirSync(parentHome);
	const environmentPath = join(root, "child-environment.json");
	const fixturePath = join(root, "fixture.test.mjs");
	writeFileSync(
		fixturePath,
		[
			'import assert from "node:assert/strict";',
			'import { describe, it } from "node:test";',
			'describe("fixture suite", () => {',
			'  it("first pass", () => assert.equal(2 + 2, 4));',
			`  it("second outcome", () => assert.equal(2 + 2, ${failed ? 5 : 4}));`,
			'  it.skip("offline skip", () => {});',
			"});",
		].join("\n"),
	);
	// Follow each real package's reporter selection, but run only the offline fixture.
	const rootReporterArgs = rootManifest.scripts["test:scripts"].split(/\s+/).filter((arg) => arg.startsWith("--test-reporter"));
	const tuiReporterArgs = tuiManifest.scripts.test.split(/\s+/).filter((arg) => arg.startsWith("--test-reporter"));
	writeFileSync(
		join(bin, "npm"),
		[
			`#!${process.execPath}`,
			'const { spawnSync } = require("node:child_process");',
			'const { writeFileSync } = require("node:fs");',
			`writeFileSync(${JSON.stringify(environmentPath)}, JSON.stringify(process.env));`,
			`for (const reporters of ${JSON.stringify([rootReporterArgs, tuiReporterArgs])}) {`,
			`  const result = spawnSync(process.execPath, ["--test", ...reporters, ${JSON.stringify(fixturePath)}], { encoding: "utf8" });`,
			"  if (result.error) throw result.error;",
			"  process.stdout.write(result.stdout);",
			"  process.stderr.write(result.stderr);",
			"}",
			'console.log("\\u001b[32m Test Files  80 passed | 40 skipped (120)\\u001b[39m");',
			`console.log("\\u001b[32m      Tests  5 passed | ${failed ? "2 failed | " : ""}2 skipped (${failed ? 9 : 7})\\u001b[39m");`,
			`console.log(${JSON.stringify(additionalNodeSummary)});`,
			`process.exit(${npmStatus});`,
		].join("\n"),
		{ mode: 0o755 },
	);
	const env = {
		PATH: `${bin}${delimiter}${process.env.PATH}`,
		HOME: parentHome,
		USERPROFILE: parentHome,
		TMPDIR: root,
		PI_E2E_TESTS: "1",
		OPENAI_API_KEY: "not-a-real-key",
		ANTHROPIC_API_KEY: "not-a-real-key",
		GOOGLE_APPLICATION_CREDENTIALS: join(parentHome, "credentials.json"),
		AWS_PROFILE: "caller-profile",
		AWS_ACCESS_KEY_ID: "not-a-real-key",
		AWS_SECRET_ACCESS_KEY: "not-a-real-key",
		AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:1/credentials",
		CLOUDFLARE_API_KEY: "not-a-real-key",
		GITHUB_TOKEN: "not-a-real-token",
		NODE_OPTIONS: "--trace-warnings",
		NPM_CONFIG_USERCONFIG: join(parentHome, "npmrc"),
	};
	for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"]) {
		if (process.env[name]) env[name] = process.env[name];
	}
	if (catalogOverride !== undefined) env.PI_DISABLE_CLOUD_PROVIDERS = catalogOverride;
	const result = spawnSync("bash", [join(repoRoot, "test.sh")], {
		cwd: repoRoot,
		env,
		encoding: "utf8",
		timeout: 30_000,
	});
	assert.ifError(result.error);
	return { ...result, childEnv: JSON.parse(readFileSync(environmentPath, "utf8")), parentHome };
}

function assertIsolated(result) {
	for (const name of [
		"PI_E2E_TESTS",
		"OPENAI_API_KEY",
		"ANTHROPIC_API_KEY",
		"GOOGLE_APPLICATION_CREDENTIALS",
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_CONTAINER_CREDENTIALS_FULL_URI",
		"CLOUDFLARE_API_KEY",
		"GITHUB_TOKEN",
		"NODE_OPTIONS",
	]) {
		assert.equal(result.childEnv[name], undefined, `${name} leaked into the test child`);
	}
	assert.notEqual(result.childEnv.HOME, result.parentHome);
	assert.equal(result.childEnv.USERPROFILE, result.childEnv.HOME);
	assert.ok(result.childEnv.NPM_CONFIG_USERCONFIG.startsWith(dirname(result.childEnv.HOME)));
}

test("runner defaults cloud catalogs off and isolates credentials and e2e opt-in", (t) => {
	const result = runRunner(t);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.equal(result.childEnv.PI_DISABLE_CLOUD_PROVIDERS, "1");
	assertIsolated(result);
});

test("runner totals root Node, TUI Node, and ANSI Vitest tests without counting suites twice", (t) => {
	const result = runRunner(t);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /=== TOTAL: 9 passed, 0 failed, 4 skipped ===/);
});

test("runner preserves the npm failure status while totaling failures from all runners", (t) => {
	const result = runRunner(t, { failed: true, npmStatus: 7 });
	assert.equal(result.status, 7, result.stdout + result.stderr);
	assert.match(result.stdout, /=== TOTAL: 7 passed, 4 failed, 4 skipped ===/);
});

test("runner fails for reported test failures even when npm exits successfully", (t) => {
	const result = runRunner(t, { failed: true });
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /=== TOTAL: 7 passed, 4 failed, 4 skipped ===/);
});

test("runner includes cancelled and todo outcomes from TAP and spec in its three-count total", (t) => {
	const result = runRunner(t, {
		additionalNodeSummary: "# cancelled 2\n# todo 3\nℹ cancelled 1\nℹ todo 4",
	});
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /=== TOTAL: 9 passed, 3 failed, 11 skipped ===/);
});

test("runner treats Node todo outcomes as skipped without failing a successful run", (t) => {
	const result = runRunner(t, { additionalNodeSummary: "ℹ todo 3" });
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /=== TOTAL: 9 passed, 0 failed, 7 skipped ===/);
});

test("runner preserves npm failure status when Node cancellations are reported", (t) => {
	const result = runRunner(t, { additionalNodeSummary: "# cancelled 2", npmStatus: 7 });
	assert.equal(result.status, 7, result.stdout + result.stderr);
	assert.match(result.stdout, /=== TOTAL: 9 passed, 2 failed, 4 skipped ===/);
});
