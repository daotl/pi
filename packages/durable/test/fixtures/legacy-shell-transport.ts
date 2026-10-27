import assert from "node:assert/strict";
import { delimiter } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "../../src/env/index.ts";
import { NodeExecutionEnv } from "../../src/env/node.ts";

const [root, shellPath, systemRoot, expectedArg] = process.argv.slice(2);
if (!root || !shellPath || !expectedArg) throw new Error("Missing shell fixture arguments");
const platform = process.platform;
process.chdir(root);
process.env.PATH = `${root}${delimiter}${process.env.PATH ?? ""}`;
if (systemRoot === "<unset>") delete process.env.SystemRoot;
else process.env.SystemRoot = systemRoot;
Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
const env = new NodeExecutionEnv({ cwd: root, shellPath });
let output = "";
try {
	const result = getOrThrow(
		await env.exec(
			`name='World'; echo "Hello, ${"$"}{name}!"`,
			{
				onOutput: (text) => {
					output += text;
				},
			},
			BACKGROUND_CONTEXT,
		),
	);
	assert.equal(result.exitCode, 0);
	assert.ok(output.includes("Hello, World!"), output);
	assert.ok(output.includes(`args:${expectedArg}`), output);
} finally {
	// Cleanup must use this fixture's real OS even if the simulated launch fails.
	Object.defineProperty(process, "platform", { configurable: true, value: platform });
	await env.cleanup(BACKGROUND_CONTEXT);
}
console.log(JSON.stringify({ output, expectedArg }));
