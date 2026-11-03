import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageName = "@earendil-works/pi-ai";
const packed = { name: packageName, filename: "pi-ai.tgz" };
const command = fileURLToPath(new URL("./check-model-catalog-compat.mjs", import.meta.url));

function runFixture(t, packOutput, additionalModels = [], options = {}) {
	const root = mkdtempSync(join(tmpdir(), "pi-catalog-compat-test-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const bin = join(root, "bin");
	mkdirSync(bin);
	writeFileSync(join(root, "package.json"), '{"type":"module"}');
	const fixture = `#!${process.execPath}
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const tool = basename(process.argv[1]);
appendFileSync(process.env.FIXTURE_LOG, JSON.stringify([tool, ...args]) + "\\n");
if (tool === "npm") {
	if (args[0] === "view") {
		if (args[2] === "versions") console.log(process.env.FIXTURE_VERSIONS);
		else console.log("99.0.0");
	} else if (args[0] === "pack") console.log(process.env.FIXTURE_PACK);
	else assert.deepEqual(args, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
} else if (tool === "tar") {
	const target = args[args.indexOf("-C") + 1];
	if (args[0] === "xf") {
		const release = join(target, "release");
		mkdirSync(join(release, "packages/ai/scripts"), { recursive: true });
		mkdirSync(join(release, "packages/ai/src/providers"), { recursive: true });
		writeFileSync(join(release, "packages/ai/src/providers/all.ts"), ${JSON.stringify(`export { builtinProviders } from ${JSON.stringify(fileURLToPath(new URL("../packages/ai/src/providers/all.ts", import.meta.url)))};`)});
		mkdirSync(join(release, "node_modules/typescript/bin"), { recursive: true });
		writeFileSync(join(release, "node_modules/typescript/package.json"), '{"type":"module"}');
		writeFileSync(join(release, "package.json"), '{"type":"module"}');
		writeFileSync(join(release, "packages/ai/package.json"), '{"dependencies":{}}');
		writeFileSync(join(release, "packages/ai/scripts/hydrate-model-catalog.ts"), ${JSON.stringify('import assert from "node:assert/strict";\nimport { readFileSync, writeFileSync } from "node:fs";\nexport function hydrateModelCatalog(root, path, options) { const catalog = JSON.parse(readFileSync(path, "utf8")); assert.equal(catalog["test-provider"][0].contextWindow, 2000); assert.equal(options.generatedAt, "2026-10-21T12:12:47.000Z"); writeFileSync(process.env.FIXTURE_RECEIPT, JSON.stringify({ catalog, options })); }\n')});
		writeFileSync(join(release, "node_modules/typescript/bin/tsc"), 'import { accessSync } from "node:fs"; accessSync(process.env.FIXTURE_RECEIPT); if (process.env.FIXTURE_REJECT_RELEASE && process.cwd().includes(process.env.FIXTURE_REJECT_RELEASE)) throw new Error("unsupported catalog");');
	} else {
		assert.equal(args[0], "xzf");
		const data = join(target, "package/dist/providers/data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, ".manifest.json"), '{"generatedAt":"2026-10-21T12:12:47.000Z"}');
		writeFileSync(join(data, "test-provider.json"), '{"openai-completions":{"chat:model-a":{"type":"chat","id":"model-a","contextWindow":1000}}}');
		writeFileSync(join(data, "openrouter.json"), '{}');
	}
} else assert.equal(tool, "git");
`;
	for (const tool of ["npm", "git", "tar"]) {
		const path = join(bin, tool);
		writeFileSync(path, fixture);
		chmodSync(path, 0o755);
	}
	const catalog = join(root, "catalog.json");
	writeFileSync(catalog, JSON.stringify({ "test-provider": [{ type: "chat", id: "model-a", contextWindow: 2000 }], openrouter: additionalModels }));
	const log = join(root, "calls.jsonl");
	const receipt = join(root, "receipt.json");
	const result = spawnSync(process.execPath, [command, "--catalog", catalog], {
		encoding: "utf8",
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			FIXTURE_LOG: log,
			FIXTURE_RECEIPT: receipt,
			FIXTURE_PACK: JSON.stringify(packOutput),
			FIXTURE_VERSIONS: JSON.stringify(options.versions ?? ["99.0.0"]),
			FIXTURE_REJECT_RELEASE: options.rejectRelease,
		},
	});
	return { result, receipt, calls: readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) };
}

for (const [shape, output] of [["npm 10/11 array", [packed]], ["npm 12 package-keyed object", { [packageName]: packed }]]) {
	test(`checks the merged release catalog with ${shape}`, (t) => {
		const { result, receipt } = runFixture(t, output);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), {
			catalog: { "test-provider": [{ type: "chat", id: "model-a", contextWindow: 2000 }], openrouter: [] },
			options: { generatedAt: "2026-10-21T12:12:47.000Z" },
		});
	});
}

test("checks every published release at or above the minimum version", (t) => {
	const { result, calls } = runFixture(t, [packed], [], { versions: ["99.0.0", "1.2.0", "1.2.1"] });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(
		calls.filter(([tool, action]) => tool === "npm" && action === "pack").map((call) => call[2]),
		[`${packageName}@1.2.1`, `${packageName}@99.0.0`],
	);
});

for (const version of [" ", " 99.0.0 "]) {
	test(`rejects malformed published version ${JSON.stringify(version)} before compatibility checks`, (t) => {
		const { result, calls } = runFixture(t, [packed], [], { versions: ["1.2.1", version] });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /npm view returned an unexpected version list/);
		assert.equal(calls.some(([tool, action]) => tool === "npm" && action === "pack"), false);
	});
}

test("rejects a catalog supported only by the newest release", (t) => {
	const { result } = runFixture(t, [packed], [], {
		versions: ["1.2.1", "99.0.0"],
		rejectRelease: "1.2.1",
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /does not type-check against pi 1\.2\.1's pi-ai/);
});

for (const [label, output] of [
	["missing package key", { other: packed }],
	["multiple array entries", [packed, packed]],
	["unexpected package name", [{ ...packed, name: "other" }]],
	["missing filename", [{ name: packageName }]],
	["empty filename", [{ ...packed, filename: "" }]],
	["escaping filename", [{ ...packed, filename: "../pi-ai.tgz" }]],
]) {
	test(`rejects ${label} before package extraction`, (t) => {
		const { result, calls } = runFixture(t, output);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /npm pack returned an unexpected result/);
		assert.equal(calls.some(([tool, action]) => tool === "tar" && action === "xzf"), false);
	});
}

for (const type of ["classifier", "image"]) {
	test(`rejects an unsupported ${type} API in the released provider`, (t) => {
		const api = type === "classifier" ? "openai-decisions" : "unsupported-image-api";
		const { result } = runFixture(t, [packed], [{ type, id: "operation-probe", provider: "openrouter", api }]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /no (classifier|image generation) implementation/);
	});
}

test("accepts implemented classifier and image operations without credentials or network", (t) => {
	const { result } = runFixture(t, [packed], [
		{ type: "classifier", id: "operation-probe", provider: "openrouter", api: "typesafe-system-one" },
		{ type: "image", id: "operation-probe", provider: "openrouter", api: "openrouter-images" },
	]);
	assert.equal(result.status, 0, result.stderr);
});
