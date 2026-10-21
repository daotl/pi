import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveProjectTrusted } from "../src/core/project-trust.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../src/core/trust-manager.ts";

describe("ProjectTrustStore", () => {
	let tempDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `trust-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("stores decisions and inherits from parent directories", () => {
		const store = new ProjectTrustStore(agentDir);
		const parentDir = join(tempDir, "trusted-parent");
		const childDir = join(parentDir, "project");
		mkdirSync(childDir, { recursive: true });

		expect(store.get(childDir)).toBeNull();
		store.set(parentDir, true);
		expect(store.get(childDir)).toBe(true);
		store.set(childDir, false);
		expect(store.get(childDir)).toBe(false);
		store.set(childDir, null);
		expect(store.get(childDir)).toBe(true);
	});

	it("requires trust for a heartbeat only in the active project root", () => {
		writeFileSync(join(cwd, "HEARTBEAT.md"), "/heartbeat 5m\nproject instruction\n");
		expect(hasTrustRequiringProjectResources(cwd)).toBe(true);
		const child = join(cwd, "child");
		mkdirSync(child);
		expect(hasTrustRequiringProjectResources(child)).toBe(false);
	});

	it("asks before trusting heartbeat scheduling and honors stored denial", async () => {
		writeFileSync(join(cwd, "HEARTBEAT.md"), "/heartbeat 1s\nproject instruction\n");
		let selection = "Do not trust (this session only)";
		const prompts: string[] = [];
		const options = {
			cwd,
			trustStore: new ProjectTrustStore(agentDir),
			defaultProjectTrust: "ask" as const,
			projectTrustContext: {
				cwd,
				mode: "tui" as const,
				hasUI: true,
				ui: {
					select: async (prompt: string) => {
						prompts.push(prompt);
						return selection;
					},
					confirm: async () => false,
					input: async () => undefined,
					notify: () => {},
				},
			},
		};
		expect(await resolveProjectTrusted(options)).toBe(false);
		selection = "Trust (this session only)";
		expect(await resolveProjectTrusted(options)).toBe(true);
		options.trustStore.set(cwd, false);
		expect(await resolveProjectTrusted(options)).toBe(false);
		expect(prompts).toHaveLength(2);
	});

	it("detects trust-requiring project resources", () => {
		const originalHome = process.env.HOME;
		process.env.HOME = tempDir;
		try {
			mkdirSync(join(tempDir, ".pi", "agent"), { recursive: true });
			mkdirSync(join(tempDir, ".agents", "skills"), { recursive: true });
			expect(hasTrustRequiringProjectResources(tempDir)).toBe(false);
			expect(hasTrustRequiringProjectResources(cwd)).toBe(false);

			writeFileSync(join(tempDir, ".pi", "settings.json"), "{}");
			expect(hasTrustRequiringProjectResources(tempDir)).toBe(true);
			rmSync(join(tempDir, ".pi", "settings.json"), { force: true });

			mkdirSync(join(cwd, ".pi"), { recursive: true });
			writeFileSync(join(cwd, ".pi", "settings.json"), "{}");
			expect(hasTrustRequiringProjectResources(cwd)).toBe(true);

			rmSync(join(cwd, ".pi"), { recursive: true, force: true });
			mkdirSync(join(cwd, ".agents", "skills"), { recursive: true });
			expect(hasTrustRequiringProjectResources(cwd)).toBe(true);
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
		}
	});
});
