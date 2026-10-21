import { vi } from "vitest";

/** Enable network code paths for tests that replace external I/O with local fixtures or mocks. */
export function allowNetwork(): void {
	vi.stubEnv("PI_OFFLINE", undefined);
}

/** Enable bundled provider metadata without enabling network I/O; Vitest unstubEnvs restores it after each test. */
export function enableBuiltinProviders(): void {
	vi.stubEnv("PI_DISABLE_CLOUD_PROVIDERS", "0");
}
