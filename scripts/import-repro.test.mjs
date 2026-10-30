import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import register from "../.pi/extensions/import-repro.ts";

test("registered session importer preserves signed JSONL query parameters", async () => {
 const root = mkdtempSync(join(tmpdir(), "pi-import-query-"));
 const originalFetch = globalThis.fetch;
 let command;
 let fetched;
 let switched;
 register({ registerCommand(name, value) { assert.equal(name, "ir"); command = value; } });
 const reference = "https://example.test/repro.jsonl?token=signed#download";
 globalThis.fetch = async (url) => { fetched = url; return new Response(JSON.stringify({ type: "session", id: "signed", cwd: root }) + "\n"); };
 try {
  await command.handler(reference, { sessionManager: { getCwd: () => root, getSessionDir: () => root }, ui: { notify() {}, confirm: async () => true }, switchSession: async (path) => { switched = path; } });
  assert.equal(fetched, reference);
  assert.equal(switched, join(root, "repro.jsonl"));
  assert.equal(JSON.parse(readFileSync(switched, "utf8")).id, "signed");
 } finally { globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true }); }
});
