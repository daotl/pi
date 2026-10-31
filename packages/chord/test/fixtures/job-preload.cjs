const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
	stdio: "ignore",
	detached: true,
	env: { ...process.env, NODE_OPTIONS: "" },
});
child.unref();
writeFileSync(process.env.PRELOAD_CHILD_FILE, String(child.pid));
process.stdout.write("chord-job-preload\n");
