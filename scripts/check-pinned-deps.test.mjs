import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./check-pinned-deps.mjs", import.meta.url));

async function check(t, manifest, extraManifests = {}) {
	const root = await mkdtemp(join(tmpdir(), "pi-pinned-deps-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	for (const [path, contents] of Object.entries({ "package.json": manifest, ...extraManifests })) {
		await mkdir(join(root, path, ".."), { recursive: true });
		await writeFile(join(root, path), JSON.stringify(contents));
	}
	return spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
}

// #10865: internal workspace dependencies must not allow incompatible newer releases.
test("rejects internal and external registry dependency ranges in every direct dependency section", async (t) => {
	const result = await check(t, {
		dependencies: {
			"@earendil-works/pi-codemode": "^1.2.0",
			"@earendil-works/chord": "~1.2.0",
			external: "^1.0.0",
		},
		devDependencies: { "@earendil-works/pi-ai": "1.x" },
		optionalDependencies: { "@earendil-works/pi-tui": "*" },
	});
	assert.equal(result.status, 1);
	for (const dependency of [
		"dependencies.@earendil-works/pi-codemode",
		"dependencies.@earendil-works/chord",
		"dependencies.external",
		"devDependencies.@earendil-works/pi-ai",
		"optionalDependencies.@earendil-works/pi-tui",
	]) {
		assert.ok(result.stderr.includes(`${dependency} must be pinned`), result.stderr);
	}
});

test("accepts exact internal and external versions, exact registry aliases, and non-registry specifiers", async (t) => {
	const result = await check(t, {
		dependencies: {
			"@earendil-works/pi-codemode": "1.2.0",
			"@earendil-works/chord": "1.2.0",
			external: "1.0.0",
			alias: "npm:@earendil-works/pi-ai@1.1.0",
			local: "file:../local",
			workspace: "workspace:*",
		},
		devDependencies: { "@earendil-works/pi-ai": "1.2.0" },
		optionalDependencies: { "@earendil-works/pi-tui": "1.2.0-rc.1" },
	});
	assert.equal(result.status, 0, result.stderr);
});

test("ignores root build output and coding-agent binary archives", async (t) => {
	const oldManifest = { dependencies: { "@earendil-works/pi-ai": "^0.99.2" } };
	const result = await check(t, {}, {
		"out/darwin-arm64/package.json": oldManifest,
		"packages/coding-agent/binaries/darwin-arm64/package.json": oldManifest,
		"packages/coding-agent/binaries/darwin-arm64-backup/package.json": oldManifest,
	});
	assert.equal(result.status, 0, result.stderr);
});

test("still checks source and example packages with output-like directory names", async (t) => {
	const manifest = { dependencies: { external: "^1.0.0" } };
	const paths = [
		"packages/out/package.json",
		"packages/binaries/package.json",
		"packages/coding-agent/examples/out/package.json",
		"packages/coding-agent/examples/binaries/package.json",
	];
	const result = await check(t, {}, Object.fromEntries(paths.map((path) => [path, manifest])));
	assert.equal(result.status, 1);
	for (const path of paths) {
		assert.ok(result.stderr.includes(path), result.stderr);
	}
});

test("rejects registry alias ranges", async (t) => {
	const result = await check(t, {
		dependencies: { alias: "npm:@earendil-works/pi-ai@^1.2.0" },
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /dependencies\.alias must be pinned/);
});
