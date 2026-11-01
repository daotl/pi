import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execNpmSync } from "./npm-command.mjs";
import { readArtifactSet } from "./package-artifacts.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDirectory, "..");

function runScript(name, args) {
	return spawnSync(process.execPath, [join(scriptsDirectory, name), ...args], { cwd: repoRoot, encoding: "utf8" });
}

function assertFailsBeforeWork(result, message) {
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, message);
	assert.doesNotMatch(result.stdout, /generate:models|npm run clean/);
}

test("rejects missing option values before doing work", () => {
	assertFailsBeforeWork(runScript("local-release.mjs", ["--out"]), /--out/);
	assertFailsBeforeWork(runScript("pack-packages.mjs", ["--out", "--force"]), /--out/);
	assertFailsBeforeWork(runScript("use-local-packages.mjs", ["--manifest", "--consumer", "target"]), /--manifest/);
});

test("rejects an unsupported package manager before doing work", () => {
	assertFailsBeforeWork(
		runScript("use-local-packages.mjs", ["--manifest", "missing.json", "--consumer", "target", "--package", "example", "--package-manager", "yarn"]),
		/Unsupported package manager: yarn/,
	);
});

for (const command of ["pack-packages.mjs", "local-release.mjs"]) {
	test(`${command} packs installable local packages without release daemon assets`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "pi-local-artifact-cli-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const repo = join(root, "repo");
		const envPackage = join(repo, "packages/env");
		mkdirSync(join(envPackage, "dist"), { recursive: true });
		writeFileSync(
			join(repo, "package.json"),
			JSON.stringify({
				name: "pi-monorepo",
				private: true,
				scripts: Object.fromEntries(["generate:models", "clean", "build:offline"].map((name) => [name, 'node -e ""'])),
			}),
		);
		writeFileSync(
			join(envPackage, "package.json"),
			JSON.stringify({
				name: "@earendil-works/pi-env",
				version: "1.0.0",
				type: "module",
				exports: "./dist/index.js",
				files: ["dist", "bin"],
			}),
		);
		writeFileSync(join(envPackage, "dist/index.js"), 'export const marker = "local-env-consumer";\n');
		execFileSync("git", ["init", "--quiet"], { cwd: repo });
		execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
		execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
		execFileSync("git", ["add", "."], { cwd: repo });
		execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"], { cwd: repo });
		const out = join(root, "artifacts");
		const args =
			command === "local-release.mjs"
				? ["--skip-check", "--skip-test", "--skip-install"]
				: ["--offline-model-data"];
		const result = spawnSync(process.execPath, [join(scriptsDirectory, command), "--out", out, ...args], {
			cwd: repo,
			encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout + result.stderr, /(?:skipping|not checking).*release.daemon/i);
		assert.match(result.stdout + result.stderr, /(?:not|does not).*certif.*deploy/i);
		const artifactSet = readArtifactSet(join(out, "manifest.json"));
		const consumer = join(root, "consumer");
		mkdirSync(consumer);
		writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}\n');
		execNpmSync(
			["install", "--ignore-scripts", "--no-audit", "--no-fund", artifactSet.getPackage("@earendil-works/pi-env").tarballPath],
			{ cwd: consumer },
		);
		const output = execFileSync(
			process.execPath,
			["--input-type=module", "-e", 'import { marker } from "@earendil-works/pi-env"; console.log(marker);'],
			{ cwd: consumer, encoding: "utf8" },
		);
		assert.equal(output.trim(), "local-env-consumer");
	});
}
