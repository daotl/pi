const { startupSnapshot } = require("node:v8");

startupSnapshot.setDeserializeMainFunction(() => {
	const { spawn } = require("node:child_process");
	const { writeFileSync } = require("node:fs");
	const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });
	descendant.unref();
	writeFileSync(process.env.PRELOAD_CHILD_FILE, String(descendant.pid));
	process.send({ chord2control: { type: "ready" } });
	process.on("message", (message) => {
		if (message?.chord2control?.type === "shutdown") process.exit(0);
	});
});
