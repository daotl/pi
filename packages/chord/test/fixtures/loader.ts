// Runs the node loader outside vitest: its module runner bypasses the Node resolve hooks the loader installs.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { createHost, local, method } from "../../src/index.ts";
import { nodeLoader } from "../../src/loader.ts";

// Plugin modules live under the package so bare imports (typebox) resolve; removed afterwards.
const dir = fileURLToPath(new URL(`../.tmp-plugins-${process.pid}/`, import.meta.url));
// Separate from `dir`, which becomes a reload root once its facet loads.
const plugins = fileURLToPath(new URL(`../.tmp-plugins-${process.pid}-order/`, import.meta.url));
const chord = new URL("../../src/index.ts", import.meta.url).href;

// The test's own copy of the plugin's contract: binding is by description, not object identity.
const Hello = local("t.hello", {
	version: 1,
	input: Type.Object({}),
	members: { greet: method(Type.String(), Type.String()) },
});

const facetSource = `
import { Type } from "typebox";
import { defineFacet, local, method } from ${JSON.stringify(chord)};
import { greeting } from "./greeting.ts";

await Promise.resolve();

const Hello = local("t.hello", {
	version: 1,
	input: Type.Object({}),
	members: { greet: method(Type.String(), Type.String()) },
});

export default defineFacet((host) => {
	host.serve(Hello, () => ({ greet: (name) => greeting + " " + name }));
});
`;

const writeGreeting = (text: string) =>
	writeFileSync(`${dir}greeting.ts`, `export const greeting = ${JSON.stringify(text)};\n`);

try {
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}facet.ts`, facetSource);
	writeGreeting("v1");
	const host = createHost({ self: { kind: "host" }, loader: nodeLoader, onError: () => {} });
	await host.load([`${dir}facet.ts`]);
	const ref = host.hold(Hello, {});
	assert.equal(await ref.greet("x"), "v1 x");
	writeGreeting("v2");
	const report = await host.reload([`${dir}facet.ts`]);
	assert.deepEqual(report.changed, ["t.hello"]);
	assert.equal(await ref.greet("x"), "v2 x");
	await host.close();

	// A facet listed first that imports a later facet's directory shares that facet's copy of the module.
	const Shared = local("t.shared", {
		version: 1,
		input: Type.Object({}),
		members: { same: method(undefined, Type.Boolean()) },
	});
	mkdirSync(`${plugins}a`, { recursive: true });
	mkdirSync(`${plugins}b`, { recursive: true });
	writeFileSync(`${plugins}b/state.ts`, "export const state = { installed: false };\n");
	writeFileSync(
		`${plugins}b/facet.ts`,
		`import { defineFacet } from ${JSON.stringify(chord)};\nimport { state } from "./state.ts";\nexport const own = state;\nexport default defineFacet(() => { state.installed = true; });\n`,
	);
	writeFileSync(
		`${plugins}a/facet.ts`,
		`import { Type } from "typebox";\nimport { defineFacet, local, method } from ${JSON.stringify(chord)};\nimport { state } from "../b/state.ts";\nimport { own } from "../b/facet.ts";\n` +
			`const Shared = local("t.shared", { version: 1, input: Type.Object({}), members: { same: method(undefined, Type.Boolean()) } });\n` +
			`export default defineFacet((host) => host.serve(Shared, () => ({ same: () => own === state && state.installed })));\n`,
	);
	const ordered = createHost({ self: { kind: "host" }, loader: nodeLoader, onError: () => {} });
	await ordered.load([`${plugins}a/facet.ts`, `${plugins}b/facet.ts`]);
	assert.equal(await ordered.hold(Shared, {}).same(), true);
	await ordered.close();

	const dataSource = `import { appendFileSync } from "node:fs";\nimport { defineFacet } from ${JSON.stringify(chord)};\nawait Promise.resolve();\nappendFileSync(${JSON.stringify(`${dir}data-loads`)}, "x");\nexport default defineFacet(() => {});\n`;
	const dataUrl = new URL(`data:text/javascript,${encodeURIComponent(dataSource)}`);
	const dataHost = createHost({ self: { kind: "host" }, loader: nodeLoader, onError: () => {} });
	await dataHost.load([dataUrl]);
	assert.equal(readFileSync(`${dir}data-loads`, "utf8"), "x");
	await dataHost.reload([dataUrl]);
	assert.equal(readFileSync(`${dir}data-loads`, "utf8"), "xx");
	await dataHost.close();

	const literalDataSource = `import { appendFileSync } from "node:fs";\nimport { defineFacet } from ${JSON.stringify(chord)};\nconst text = ({ text: "x" })?.text === "x" ? "x" : "wrong";\nappendFileSync(${JSON.stringify(`${dir}literal-data-loads`)}, text);\nexport default defineFacet(() => {});\n`;
	const literalDataUrl = new URL(`data:text/javascript,${literalDataSource}`);
	const literalDataHost = createHost({ self: { kind: "host" }, loader: nodeLoader, onError: () => {} });
	await literalDataHost.load([literalDataUrl]);
	assert.equal(readFileSync(`${dir}literal-data-loads`, "utf8"), "x");
	await literalDataHost.reload([literalDataUrl]);
	assert.equal(readFileSync(`${dir}literal-data-loads`, "utf8"), "xx");
	await literalDataHost.close();
} finally {
	rmSync(dir, { recursive: true, force: true });
	rmSync(plugins, { recursive: true, force: true });
}
