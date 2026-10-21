import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_AGENT_DIR, getPackageDir } from "../src/config.ts";

const cliPath = join(getPackageDir(), "src/cli.ts");
const sourceResolverUrl = pathToFileURL(join(getPackageDir(), "src/experimental/source-resolver.ts")).href;
const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function runCli(args: string[]) {
	const dir = mkdtempSync(join(tmpdir(), "pi-heartbeat-mode-"));
	tempDirs.push(dir);
	const agentDir = join(dir, "agent");
	mkdirSync(agentDir);
	return spawnSync(process.execPath, ["--import", sourceResolverUrl, cliPath, ...args], {
		cwd: dir,
		encoding: "utf8",
		timeout: 15_000,
		input: "",
		env: {
			PATH: process.env.PATH,
			HOME: dir,
			[ENV_AGENT_DIR]: agentDir,
			PI_OFFLINE: "1",
			PI_DISABLE_CLOUD_PROVIDERS: "1",
		},
	});
}

describe("startup heartbeat mode", () => {
	it.each([
		["print", ["-p", "hello"]],
		["json", ["--mode", "json"]],
		["rpc", ["--mode", "rpc"]],
		["redirected terminal", []],
	] as const)("rejects heartbeat in %s before provider setup", (_label, modeArgs) => {
		const result = runCli(["--heartbeat", "5m", "--no-session", ...modeArgs]);
		expect(result.status, result.stderr).toBe(1);
		expect(result.signal).toBeNull();
		expect(result.stderr).toContain("--heartbeat only supports interactive mode");
		expect(result.stdout).toBe("");
	});

	it.each(["--help", "--list-models"])("allows heartbeat alongside metadata command %s", (command) => {
		const result = runCli([command, "--heartbeat", "5m", "--no-extensions"]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.signal).toBeNull();
		expect(result.stderr).not.toContain("--heartbeat only supports interactive mode");
		if (command === "--help") expect(result.stdout).toContain("--heartbeat");
	});
});
