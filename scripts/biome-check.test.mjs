import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scanner = new URL("./biome-check.mjs", import.meta.url).href;

test("WASM checking ignores a tracked working-tree deletion and checks remaining files", () => {
	const root = mkdtempSync(join(tmpdir(), "pi-biome-deletion-"));
	const git = (...args) => {
		const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr);
	};
	try {
		writeFileSync(join(root, "biome.json"), JSON.stringify({ files: { includes: ["*.ts"] } }));
		writeFileSync(join(root, "removed.ts"), "export const removed = 1;\n");
		writeFileSync(join(root, "kept.ts"), "export const kept = 1;\n");
		git("init");
		git("add", "removed.ts", "kept.ts", "biome.json");
		rmSync(join(root, "removed.ts"));
		const loader = `Object.defineProperty(process, "platform", { value: "android" }); await import(${JSON.stringify(scanner)});`;
		const result = spawnSync(process.execPath, ["--input-type=module", "-e", loader], { cwd: root, encoding: "utf8" });
		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /checked 1 files; 0 diagnostics/);
		assert.equal(readFileSync(join(root, "kept.ts"), "utf8"), "export const kept = 1;\n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
