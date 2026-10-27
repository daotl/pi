import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { installConsumer } from "./local-package-install.mjs";
import { produceArtifactSet } from "./package-artifacts.mjs";
import { codingAgentName, smokeTestCodingAgent } from "./coding-agent-smoke.mjs";

function writePackage(directory, manifest, files) {
	mkdirSync(directory, { recursive: true });
	writeFileSync(join(directory, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(directory, path)), { recursive: true });
		writeFileSync(join(directory, path), content);
	}
}

function createFixture(t, { importUndeclared = false } = {}) {
	const temporaryRoot = mkdtempSync(join(tmpdir(), "pi-coding-agent-smoke-test-"));
	t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
	const root = join(temporaryRoot, "fixture with spaces");
	const repoRoot = join(root, "repo");
	mkdirSync(repoRoot, { recursive: true });
	writeFileSync(join(repoRoot, "package.json"), '{"name":"fixture","private":true}\n');
	writePackage(
		join(repoRoot, "packages", codingAgentName.split("/")[1]),
		{
			name: codingAgentName,
			version: "1.0.0",
			type: "module",
			main: "./dist/index.js",
			types: "./dist/index.d.ts",
			exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
			files: ["dist"],
			bin: { pi: "dist/bundle/cli.js" },
		},
		{
			"dist/index.js": `${importUndeclared ? 'import "@earendil-works/undeclared";' : ""}
export function createAgentSession() {}
export class SessionManager { static inMemory() {} }
export class ModelRuntime { static create() {} }
`,
			"dist/index.d.ts": "export {};\n",
			"dist/cli.js": 'console.log("1.0.0");\n',
			"dist/bundle/cli.js": 'console.log("1.0.0");\n',
		},
	);
	const artifactSet = produceArtifactSet({ build: false, outDir: join(root, "artifacts"), repoRoot, source: null });
	const directory = join(root, "consumer");
	installConsumer({ artifactSet, directory, packageNames: [codingAgentName] });
	return directory;
}

test("accepts a valid coding-agent package", (t) => {
	smokeTestCodingAgent(createFixture(t));
});

// #9132: smoke-test the public SDK, not just a bundled CLI that hides missing imports.
test("fails when the SDK imports an undeclared package despite a working CLI", (t) => {
	const directory = createFixture(t, { importUndeclared: true });
	assert.throws(() => smokeTestCodingAgent(directory), /Cannot find package '@earendil-works\/undeclared'/);
});

test("rejects a declared development-only dependency", (t) => {
	const directory = createFixture(t);
	const path = join(directory, "node_modules", codingAgentName, "package.json");
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	manifest.dependencies = { "@earendil-works/pi-server": "1.0.0" };
	writeFileSync(path, JSON.stringify(manifest));
	assert.throws(() => smokeTestCodingAgent(directory), /Development-only dependency/);
});

test("rejects a resolvable source-only export", (t) => {
	const directory = createFixture(t);
	const path = join(directory, "node_modules", codingAgentName, "package.json");
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	manifest.exports["./client"] = "./dist/index.js";
	writeFileSync(path, JSON.stringify(manifest));
	assert.throws(() => smokeTestCodingAgent(directory), /Source-only export resolves/);
});
