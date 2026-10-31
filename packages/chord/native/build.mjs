import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "chord-win32-"));
process.on("exit", () => rmSync(temporary, { recursive: true, force: true }));
const arches = process.argv.includes("--current") ? [process.arch] : ["x64", "arm64"];
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
function run(command, args, options = {}) {
	const result = spawnSync(command, args, { stdio: "inherit", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
function visualStudio() {
	const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
	if (!existsSync(vswhere)) return undefined;
	const result = spawnSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" });
	const path = result.stdout?.trim();
	return path ? join(path, "Common7", "Tools", "VsDevCmd.bat") : undefined;
}
const toolchain = process.env.CHORD_WIN32_TOOLCHAIN ?? (process.platform === "win32" ? "msvc" : "mingw");
if (!["msvc", "mingw"].includes(toolchain)) throw new Error("CHORD_WIN32_TOOLCHAIN must be msvc or mingw");
for (const arch of arches) {
	if (!["x64", "arm64"].includes(arch)) throw new Error(`Unsupported Windows architecture: ${arch}`);
	const directory = join(temporary, arch);
	mkdirSync(directory, { recursive: true });
	for (const [source, output, entry] of [
		["windows-job.c", "windows-job.node", undefined],
		["windows-launcher.c", "windows-launcher.exe", "chord_main"],
	]) {
		const destination = join(directory, output);
		if (toolchain === "msvc") {
			const developer = visualStudio();
			if (!developer) throw new Error("Microsoft C++ Build Tools are required to build Chord Windows helpers");
			const batch = join(directory, `${source}.cmd`);
			writeFileSync(batch, [
				"@echo off",
				`call ${quote(developer)} -no_logo -arch=${arch} -host_arch=${process.arch === "arm64" ? "arm64" : "x64"}`,
				"if errorlevel 1 exit /b %errorlevel%",
				["cl /nologo /TC /std:c11 /W4 /O1 /GS- /Oi-", entry ? "" : "/LD", `/Fe:${quote(destination)}`, quote(join(root, source)), "/link /NODEFAULTLIB kernel32.lib /OPT:REF /OPT:ICF", entry ? `/ENTRY:${entry} /SUBSYSTEM:CONSOLE` : "/ENTRY:chord_dll_main"].join(" "),
				"if errorlevel 1 exit /b %errorlevel%",
			].join("\r\n"));
			run("cmd.exe", ["/d", "/s", "/c", batch], { cwd: directory });
		} else {
			const prefix = arch === "x64" ? "x86_64" : "aarch64";
			const compiler = process.env[`CC_${arch.toUpperCase()}`] ?? process.env.CC ?? `${prefix}-w64-mingw32-gcc`;
			run(compiler, [
				...(process.env.CC && !process.env[`CC_${arch.toUpperCase()}`] ? [`--target=${prefix}-w64-windows-gnu`] : []),
				"-std=c11", "-Wall", "-Wextra", "-Os", "-fno-builtin", "-fno-stack-protector", "-nostdlib",
				...(entry ? [`-Wl,--entry,${entry}`, "-Wl,--subsystem,console"] : ["-shared", "-Wl,--entry,chord_dll_main"]),
				join(root, source), "-lkernel32", "-o", destination,
			], { cwd: directory });
		}
		const outputDirectory = join(root, "prebuilds", `win32-${arch}`);
		mkdirSync(outputDirectory, { recursive: true });
		copyFileSync(destination, join(outputDirectory, output));
	}
}
