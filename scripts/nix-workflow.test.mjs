import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";

const workflow = YAML.parse(readFileSync(new URL("../.github/workflows/nix.yml", import.meta.url), "utf8"));
const pin = { revision: `sha256-${"a".repeat(64)}`, generatedAt: "2026-10-21T12:12:47.000Z" };
const run = (command, args, cwd, env = {}) => {
	const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr || result.stdout);
	return result.stdout;
};

function shouldRun(condition, refType) {
	if (condition === undefined) return true;
	const expression = condition.trim().replace(/^\$\{\{\s*|\s*\}\}$/g, "");
	if (expression === "true" || expression === "false") return expression === "true";
	const comparison = /^github\.ref_type\s*(!=|==)\s*'([^']+)'$/.exec(expression);
	assert.ok(comparison, `Unsupported workflow condition: ${condition}`);
	return comparison[1] === "==" ? refType === comparison[2] : refType !== comparison[2];
}

for (const kind of ["tag", "branch"]) {
	test(`Nix ${kind} build preserves the resolved catalog generation time`, () => {
		const root = mkdtempSync(join(tmpdir(), "pi-nix-workflow-"));
		try {
			mkdirSync(join(root, "nix"));
			const originalPin = kind === "tag" ? pin : { revision: `sha256-${"b".repeat(64)}`, generatedAt: "2026-10-20T00:00:00.000Z" };
			const original = `${JSON.stringify(originalPin, null, 4)}\n`;
			writeFileSync(join(root, "nix/model-catalog.json"), original);
			const step = workflow.jobs.build.steps.find((step) => step.name === "Use the resolved model catalog pin");
			const enabled = shouldRun(step.if, kind);
			assert.equal(enabled, kind !== "tag", "Only non-tag builds replace the committed pin");
			if (enabled) run("bash", ["-eu", "-c", step.run], root, {
				REVISION: pin.revision, GENERATED_AT: pin.generatedAt, GITHUB_REF_TYPE: kind,
			});
			const result = readFileSync(join(root, "nix/model-catalog.json"), "utf8");
			assert.deepEqual(JSON.parse(result), pin);
			if (kind === "tag") assert.equal(result, original);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
}

test("Nix pin output survives commit-pin publication", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-nix-publication-"));
	try {
		const work = join(root, "work"), remote = join(root, "remote.git");
		mkdirSync(join(work, "nix"), { recursive: true });
		writeFileSync(join(work, "nix/model-catalog.json"), JSON.stringify(pin));
		run("git", ["init", "--bare", remote], root);
		run("git", ["init", "-b", "main"], work);
		run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "add", "nix/model-catalog.json"], work);
		run("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "initial"], work);
		run("git", ["remote", "add", "origin", remote], work);
		run("git", ["push", "-u", "origin", "main"], work);
		const output = join(root, "outputs");
		const pinStep = workflow.jobs.pin.steps.find((step) => step.id === "pin");
		run("bash", ["-eu", "-c", pinStep.run], work, { GITHUB_REF_TYPE: "tag", GITHUB_OUTPUT: output });
		const values = Object.fromEntries(readFileSync(output, "utf8").trim().split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)));
		assert.equal(values.generatedAt, pin.generatedAt);
		writeFileSync(join(work, "nix/model-catalog.json"), JSON.stringify({ revision: `sha256-${"b".repeat(64)}`, generatedAt: "2026-10-20T00:00:00.000Z" }));
		const commitStep = workflow.jobs["commit-pin"].steps.find((step) => step.name === "Commit and push the model catalog pin");
		run("bash", ["-eu", "-c", commitStep.run], work, { REVISION: values.revision, GENERATED_AT: values.generatedAt });
		assert.deepEqual(JSON.parse(run("git", ["--git-dir", remote, "show", "main:nix/model-catalog.json"], root)), pin);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
