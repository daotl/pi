import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function build(t, { host = "Darwin", arch = "arm64", platform = "darwin-arm64", fail = "" } = {}) {
	const root = await mkdtemp(join(tmpdir(), "pi-build-signing-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const files = {
		"bin/uname": `#!/bin/sh\nif [ "$1" = "-m" ]; then echo '${arch}'; else echo '${host}'; fi\n`,
		"bin/bun": '#!/bin/sh\nwhile [ "$1" != "--outfile" ]; do shift; done\nshift\nprintf \'#!/bin/sh\\necho smoke >> "$BUILD_LOG"\\necho fixture\\n\' > "$1"\nchmod +x "$1"\n',
		"bin/codesign": '#!/bin/sh\necho "$*" >> "$BUILD_LOG"\nif [ "$1" = "$FAIL_SIGN_STEP" ]; then exit 1; fi\n',
		"packages/coding-agent/package.json": '{"version":"test"}',
		"packages/coding-agent/README.md": "fixture",
		"packages/coding-agent/CHANGELOG.md": "fixture",
		"node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm": "fixture",
		"packages/coding-agent/dist/modes/interactive/theme/theme.json": "{}",
		"packages/coding-agent/dist/modes/interactive/assets/logo.png": "fixture",
		"packages/coding-agent/dist/core/export-html/template.html": "fixture",
		"packages/coding-agent/docs/readme.md": "fixture",
		"packages/coding-agent/examples/readme.md": "fixture",
		[`packages/tui/native/${platform.startsWith("darwin") ? "darwin" : "linux"}/prebuilds/${platform}/helper.node`]: "fixture",
	};
	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(root, path, ".."), { recursive: true });
		await writeFile(join(root, path), content, { mode: path.startsWith("bin/") ? 0o755 : 0o644 });
	}
	await mkdir(join(root, "scripts"));
	await copyFile(new URL("./build-binaries.sh", import.meta.url), join(root, "scripts/build-binaries.sh"));
	const log = join(root, "build.log");
	await writeFile(log, "");
	const out = join(root, "output");
	const result = spawnSync("bash", ["scripts/build-binaries.sh", "--skip-install", "--skip-build", "--platform", platform, "--out", out], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, BUILD_LOG: log, FAIL_SIGN_STEP: fail },
	});
	return { ...result, log: (await readFile(log, "utf8")).trim().split("\n").filter(Boolean), out };
}

test("repairs and verifies Darwin signatures before native startup and packaging", async (t) => {
	const result = await build(t);
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.log.map((line) => line.split(" ")[0]), ["--remove-signature", "--force", "--verify", "smoke", "--verify", "smoke"]);
	const unpacked = spawnSync("tar", ["-tzf", join(result.out, "pi-darwin-arm64.tar.gz")], { encoding: "utf8" });
	assert.equal(unpacked.status, 0, unpacked.stderr);
	assert.match(unpacked.stdout, /pi\/pi/);
});

for (const step of ["--remove-signature", "--force", "--verify"]) {
	test(`stops before packaging when codesign ${step} fails`, async (t) => {
		const result = await build(t, { fail: step });
		assert.notEqual(result.status, 0);
		assert.ok(!result.log.includes("smoke"));
		assert.notEqual(spawnSync("test", ["-f", join(result.out, "pi-darwin-arm64.tar.gz")]).status, 0);
	});
}

test("signs cross-architecture Darwin output without trying to execute it", async (t) => {
	const result = await build(t, { platform: "darwin-x64" });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.log.map((line) => line.split(" ")[0]), ["--remove-signature", "--force", "--verify", "--verify"]);
});

test("does not run macOS signing tools for Linux output", async (t) => {
	const result = await build(t, { host: "Linux", arch: "x86_64", platform: "linux-x64" });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.log, []);
});

test("does not invoke codesign for Linux-hosted Darwin cross-compilation", async (t) => {
	const result = await build(t, { host: "Linux", arch: "x86_64" });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(result.log, []);
});
