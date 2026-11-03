import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportFromFile } from "../src/core/export-html/index.ts";
import {
	CURRENT_SESSION_VERSION,
	type SessionEntry,
	type SessionHeader,
	type SessionMessageEntry,
} from "../src/core/session-manager.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

interface TreeNode {
	entry: { id: string };
	children: TreeNode[];
}

interface TreeApi {
	buildTree: () => TreeNode[];
	buildActivePathIds: (targetId: string) => Set<string>;
	flattenTree: (roots: TreeNode[], activePathIds: Set<string>) => Array<{ node: TreeNode }>;
	findNewestLeaf: (nodeId: string) => string;
	getPath: (targetId: string) => Array<{ id: string }>;
}

function loadTreeApi(html: string): TreeApi {
	const sessionData = html.match(/<script id="session-data" type="application\/json">([^<]+)<\/script>/)?.[1];
	const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	const viewer = scripts.pop();
	if (!sessionData || !viewer) throw new Error("Missing exported session data or viewer script");
	const context = createContext({
		atob,
		TextDecoder,
		URLSearchParams,
		document: { getElementById: () => ({ textContent: sessionData }), querySelector: () => null },
		window: { location: { search: "" } },
	});
	return runInContext(
		viewer.replace(
			"let treeNodeMap = null;",
			"let treeNodeMap = null; return { buildTree, buildActivePathIds, flattenTree, findNewestLeaf, getPath };",
		),
		context,
	);
}

// #11225
describe("HTML export deep session tree", () => {
	const depth = 20_000;
	let tempDir: string;
	let api: TreeApi;

	beforeAll(async () => {
		initTheme("dark");
		tempDir = mkdtempSync(join(tmpdir(), "pi-export-deep-"));
		const header = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: "deep-test",
			timestamp: new Date(0).toISOString(),
			cwd: tempDir,
		} satisfies SessionHeader;
		const lines = [JSON.stringify(header)];
		for (let i = 0; i < depth; i++) {
			const entry: SessionMessageEntry = {
				type: "message",
				id: `e${i}`,
				parentId: i === 0 ? null : `e${i - 1}`,
				timestamp: new Date(i * 1000).toISOString(),
				message: { role: "user", content: "x", timestamp: i * 1000 },
			};
			lines.push(JSON.stringify(entry));
		}
		const sessionPath = join(tempDir, "session.jsonl");
		writeFileSync(sessionPath, `${lines.join("\n")}\n`);
		api = loadTreeApi(readFileSync(await exportFromFile(sessionPath, join(tempDir, "out.html")), "utf8"));
	});

	afterAll(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("builds and flattens a single-child chain deeper than the call stack", () => {
		const tree = api.buildTree();
		expect(tree).toHaveLength(1);
		const leafId = `e${depth - 1}`;
		const flat = api.flattenTree(tree, api.buildActivePathIds(leafId));
		expect(flat).toHaveLength(depth);
		expect(flat[depth - 1].node.entry.id).toBe(leafId);
		expect(api.findNewestLeaf("e0")).toBe(leafId);
		const path = api.getPath(leafId);
		expect(path).toHaveLength(depth);
		expect(path[0].id).toBe("e0");
		expect(path[depth - 1].id).toBe(leafId);
	});

	it.each(["conversation", "state", "policy", "through-usage"] as const)(
		"keeps the %s continuation when a newer detached usage-only subtree arrives",
		async (tail) => {
			const header: SessionHeader = {
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: `receipt-navigation-${tail}`,
				timestamp: new Date(0).toISOString(),
				cwd: tempDir,
			};
			const timestamp = (seconds: number) => new Date(seconds * 1000).toISOString();
			const usage = {
				input: 3,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 3,
				cost: { input: 0.01, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
			};
			const entries: SessionEntry[] = [
				{
					type: "message",
					id: "question",
					parentId: null,
					timestamp: timestamp(1),
					message: { role: "user", content: "retained question", timestamp: 1000 },
				},
				{
					type: "message",
					id: "follow-up",
					parentId: "question",
					timestamp: timestamp(2),
					message: { role: "user", content: "retained follow-up", timestamp: 2000 },
				},
			];
			let selected = "follow-up";
			if (tail === "state") {
				selected = "state-tail";
				entries.push({
					type: "custom",
					id: selected,
					parentId: "follow-up",
					timestamp: timestamp(3),
					customType: "retained-state",
					data: { count: 2 },
				});
			} else if (tail === "policy") {
				selected = "policy-tail";
				entries.push({
					type: "system_prompt",
					id: selected,
					parentId: "follow-up",
					timestamp: timestamp(3),
					systemPrompt: "retained policy",
				});
			} else if (tail === "through-usage") {
				entries.push({
					type: "usage",
					id: "continuing-receipt",
					parentId: "follow-up",
					timestamp: timestamp(3),
					kind: "codemode",
					provider: "scorer",
					model: "judge",
					usage,
				});
				selected = "real-continuation";
				entries.push({
					type: "message",
					id: selected,
					parentId: "continuing-receipt",
					timestamp: timestamp(4),
					message: { role: "user", content: "continued through receipt", timestamp: 4000 },
				});
			}
			entries.push(
				{
					type: "usage",
					id: "late-receipt",
					parentId: "question",
					timestamp: timestamp(10),
					kind: "codemode",
					provider: "scorer",
					model: "judge",
					usage,
				},
				{
					type: "usage",
					id: "latest-receipt",
					parentId: "late-receipt",
					timestamp: timestamp(11),
					kind: "codemode",
					provider: "scorer",
					model: "judge",
					usage,
				},
			);
			const input = join(tempDir, `receipt-navigation-${tail}.jsonl`);
			writeFileSync(
				input,
				`${[header, ...entries, { type: "leaf", leafId: selected }].map((entry) => JSON.stringify(entry)).join("\n")}\n`,
			);
			const viewer = loadTreeApi(
				readFileSync(await exportFromFile(input, join(tempDir, `receipt-navigation-${tail}.html`)), "utf8"),
			);
			expect(viewer.findNewestLeaf("question")).toBe(selected);
			expect(viewer.getPath(viewer.findNewestLeaf("question")).map((entry) => entry.id)).toEqual([
				"question",
				"follow-up",
				...(tail === "through-usage"
					? ["continuing-receipt", selected]
					: selected === "follow-up"
						? []
						: [selected]),
			]);
			// Accounting nodes remain available for deliberate inspection, not deleted from the tree.
			expect(viewer.getPath("latest-receipt").map((entry) => entry.id)).toEqual([
				"question",
				"late-receipt",
				"latest-receipt",
			]);
			expect(viewer.findNewestLeaf("latest-receipt")).toBe("latest-receipt");
			expect(
				viewer
					.flattenTree(viewer.buildTree(), viewer.buildActivePathIds(selected))
					.map(({ node }) => node.entry.id),
			).toEqual(expect.arrayContaining(entries.map((entry) => entry.id)));
			if (tail === "through-usage") {
				expect(viewer.findNewestLeaf("continuing-receipt")).toBe(selected);
			}
		},
	);
});
