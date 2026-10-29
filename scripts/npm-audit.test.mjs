import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./npm-audit.mjs", import.meta.url));
const advisory = (name = "node-forge", id = "GHSA-86w9-cpqp-85rv", severity = "high") => ({ name, url: `https://github.com/advisories/${id}`, severity, title: `${name} advisory`, range: "*" });
const report = (...entries) => ({ vulnerabilities: Object.fromEntries(entries.map((entry, index) => [`package-${index}`, { via: Array.isArray(entry) ? entry : [entry] }])) });
const cases = [
	["accepts only the reviewed advisory/package pair", report(advisory()), 0, /Accepted GHSA-86w9-cpqp-85rv \(node-forge\)/],
	["rejects the accepted advisory for another package", report(advisory("other")), 1, /other .*\[high\]/],
	["rejects an unaccepted moderate advisory beside an accepted one", report(advisory(), advisory("other", "GHSA-new", "moderate")), 1, /other .*\[moderate\]/],
	["ignores low severity without accepting it", report(advisory("other", "GHSA-low", "low")), 0, /No unaccepted advisories/],
	["resolves indirect reporting through the actual advisory entry", report(["transitive"], advisory("transitive", "GHSA-indirect")), 1, /transitive .*GHSA-indirect/],
	["warns when an accepted advisory no longer exists", report(), 0, /::warning::Accepted advisory .* no longer matches/],
	["rejects malformed audit output", "not json", 1, /did not produce a JSON report/],
	["rejects npm audit top-level errors", { error: { summary: "registry unavailable" } }, 1, /npm audit failed: registry unavailable/],
];
for (const [name, input, status, output] of cases) {
	test(name, () => {
		const root = mkdtempSync(join(tmpdir(), "pi-audit-fixture-"));
		try {
			const bin = join(root, "bin");
			mkdirSync(bin);
			const payload = join(root, "report.json");
			writeFileSync(payload, typeof input === "string" ? input : JSON.stringify(input));
			const fakeNpm = join(bin, "npm");
			writeFileSync(fakeNpm, `#!${process.execPath}\nprocess.stdout.write(require('node:fs').readFileSync(process.env.AUDIT_FIXTURE));process.exit(1);\n`);
			chmodSync(fakeNpm, 0o755);
			const result = spawnSync(process.execPath, [script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AUDIT_FIXTURE: payload }, encoding: "utf8" });
			assert.equal(result.status, status, result.stderr);
			assert.match(result.stdout + result.stderr, output);
		} finally { rmSync(root, { recursive: true, force: true }); }
	});
}
