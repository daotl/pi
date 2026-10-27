// A real kernel-lock contender with a deterministic pause at stale-file reclamation.
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { isChordError } from "../../src/errors.ts";
import { processLock } from "../../src/manager.ts";

const name = process.argv[2]!;
if (process.argv[3] === "pause") {
	const remove = fs.rm;
	fs.rm = async (path, options) => {
		process.send?.("reclaiming");
		const resume = Promise.withResolvers<void>();
		process.once("message", () => resume.resolve());
		await resume.promise;
		return remove(path, options);
	};
	syncBuiltinESMExports();
}
try {
	const release = await processLock(name);
	process.on("message", () => void release().then(() => process.exit(0)));
	process.send?.("acquired");
} catch (error) {
	process.send?.(isChordError(error) && error.reason === "locked" ? "locked" : String(error), () => process.exit(0));
}
