import { fileURLToPath } from "node:url";
import { createHostManager, forkDriver } from "../../src/manager.ts";

const manager = createHostManager({
	driver: forkDriver({
		entry: fileURLToPath(new URL("./worker.ts", import.meta.url)),
		env: { GRANDCHILD_FILE: process.argv[2]! },
		init: { greeting: "hi" },
	}),
});
const instance = await manager.start();
process.send!({ pid: instance.pid });
