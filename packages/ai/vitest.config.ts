import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from 'vitest/config';

// Cloud e2e tests (*-e2e.test.ts) hit real provider APIs and activate on
// endpoint/auth env vars. They are excluded by default so stray API keys in
// the environment can never activate cloud tests; set PI_E2E_TESTS=1 to run
// them explicitly.
const e2eExclude = process.env.PI_E2E_TESTS === '1' ? [] : ['test/**/*-e2e.test.ts'];

// Cloud metadata stays disabled by default. Explicit E2E opt-in needs catalogs
// to register provider probes; an explicit catalog flag remains authoritative.
if (process.env.PI_DISABLE_CLOUD_PROVIDERS === undefined) {
	process.env.PI_DISABLE_CLOUD_PROVIDERS = process.env.PI_E2E_TESTS === '1' ? '0' : '1';
}

export default defineConfig({
	resolve: {
		alias: [{ find: /^@earendil-works\/pi-telemetry$/, replacement: fileURLToPath(new URL('../telemetry/src/index.ts', import.meta.url)) }],
	},
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30 seconds for API calls
    reporters: process.env.GITHUB_ACTIONS ? ['dot', 'github-actions'] : ['dot'],
    silent: 'passed-only',
    exclude: [...defaultExclude, ...e2eExclude],
    setupFiles: ['test/setup-e2e-guard.ts'],
    // Both OAuth files require the registered callback port; run them after the parallel group, one file at a time.
    projects: [
      {
        extends: true,
        test: { name: 'parallel', exclude: [...defaultExclude, ...e2eExclude, 'test/openai-chatgpt-oauth.test.ts', 'test/openai-codex-oauth.test.ts'], sequence: { groupOrder: 0 } },
      },
      {
        extends: true,
        test: { name: 'fixed-port-oauth', include: ['test/openai-chatgpt-oauth.test.ts', 'test/openai-codex-oauth.test.ts'], fileParallelism: false, sequence: { groupOrder: 1 } },
      },
    ],
  }
});
