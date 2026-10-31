import { accessSync } from "node:fs";
import { fileURLToPath } from "node:url";

for (const arch of ["x64", "arm64"]) {
	for (const asset of ["windows-job.node", "windows-launcher.exe"]) {
		const path = fileURLToPath(new URL(`./prebuilds/win32-${arch}/${asset}`, import.meta.url));
		try {
			accessSync(path);
		} catch {
			throw new Error(`Missing required Chord Windows asset ${path}; run npm run build:native:win32 first`);
		}
	}
}
