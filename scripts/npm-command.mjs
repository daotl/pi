import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function execNpmSync(args, options = {}) {
	if (process.platform !== "win32") return execFileSync("npm", args, options);
	const env = options.env ?? process.env;
	let npmCli = env.npm_execpath;
	if (!npmCli) {
		const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
		const directories = [dirname(process.execPath), ...path.split(";")];
		for (const directory of directories) {
			if (!directory) continue;
			const candidate = join(directory.replace(/^"(.*)"$/, "$1"), "node_modules", "npm", "bin", "npm-cli.js");
			if (existsSync(candidate)) {
				npmCli = candidate;
				break;
			}
		}
	}
	if (!npmCli) throw new Error("Cannot locate the npm CLI beside Node or on PATH. Install npm or set npm_execpath.");
	if (!existsSync(npmCli)) throw new Error(`Cannot locate the npm CLI: ${npmCli}`);
	return execFileSync(process.execPath, [npmCli, ...args], options);
}
