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

function runFixture(t, packOutput) {
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
	if (args[0] === "view") console.log("99.0.0");
	else if (args[0] === "pack") console.log(process.env.FIXTURE_PACK);
	else assert.deepEqual(args, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
} else if (tool === "tar") {
	const target = args[args.indexOf("-C") + 1];
	if (args[0] === "xf") {
		const release = join(target, "release");
		mkdirSync(join(release, "packages/ai/scripts"), { recursive: true });
		mkdirSync(join(release, "node_modules/typescript/bin"), { recursive: true });
		writeFileSync(join(release, "node_modules/typescript/package.json"), '{"type":"module"}');
		writeFileSync(join(release, "package.json"), '{"type":"module"}');
		writeFileSync(join(release, "packages/ai/package.json"), '{"dependencies":{}}');
		writeFileSync(join(release, "packages/ai/scripts/hydrate-model-catalog.ts"), ${JSON.stringify('import assert from "node:assert/strict";\nimport { readFileSync, writeFileSync } from "node:fs";\nexport function hydrateModelCatalog(root, path, options) { const catalog = JSON.parse(readFileSync(path, "utf8")); assert.equal(catalog["test-provider"][0].contextWindow, 2000); assert.equal(options.generatedAt, "2026-10-21T12:12:47.000Z"); writeFileSync(process.env.FIXTURE_RECEIPT, JSON.stringify({ catalog, options })); }\n')});
		writeFileSync(join(release, "node_modules/typescript/bin/tsc"), 'import { accessSync } from "node:fs"; accessSync(process.env.FIXTURE_RECEIPT);');
	} else {
		assert.equal(args[0], "xzf");
		const data = join(target, "package/dist/providers/data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, ".manifest.json"), '{"generatedAt":"2026-10-21T12:12:47.000Z"}');
		writeFileSync(join(data, "test-provider.json"), '{"openai-completions":{"chat:model-a":{"type":"chat","id":"model-a","contextWindow":1000}}}');
	}
} else assert.equal(tool, "git");
`;
	for (const tool of ["npm", "git", "tar"]) {
		const path = join(bin, tool);
		writeFileSync(path, fixture);
		chmodSync(path, 0o755);
	}
	const catalog = join(root, "catalog.json");
	writeFileSync(catalog, JSON.stringify({ "test-provider": [{ type: "chat", id: "model-a", contextWindow: 2000 }] }));
	const log = join(root, "calls.jsonl");
	const receipt = join(root, "receipt.json");
	const result = spawnSync(process.execPath, [command, "--catalog", catalog], {
		encoding: "utf8",
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_LOG: log, FIXTURE_RECEIPT: receipt, FIXTURE_PACK: JSON.stringify(packOutput) },
	});
	return { result, receipt, calls: readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) };
}

for (const [shape, output] of [["npm 10/11 array", [packed]], ["npm 12 package-keyed object", { [packageName]: packed }]]) {
	test(`checks the merged release catalog with ${shape}`, (t) => {
		const { result, receipt } = runFixture(t, output);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(readFileSync(receipt, "utf8")), {
			catalog: { "test-provider": [{ type: "chat", id: "model-a", contextWindow: 2000 }] },
			options: { generatedAt: "2026-10-21T12:12:47.000Z" },
		});
	});
}

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
