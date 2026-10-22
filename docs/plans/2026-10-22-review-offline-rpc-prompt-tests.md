# Review: execute scripted RPC prompt-disposition regressions offline

Date: 2026-10-22
Migration parent: `7387d8e25`.
Source: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` RPC test-local catalog activation; adapt to the current upstream's additional handled/transformed-input controls. No RPC production implementation changes.

## Current coverage gap and adaptation

An allowlisted, credential-free run with `PI_DISABLE_CLOUD_PROVIDERS=1` reports **7 passed / 2 skipped**. The two skipped cases verify started and queued prompt responses through an actual AgentSession with scripted streams and captured RPC JSONL output. They require bundled provider metadata, not external provider access.

Enable bundled metadata inside those two cases and replace existing direct catalog environment mutations in handled-input/clear-queue controls with the same scoped helper. Vitest restores stubs after each test; preserve current RPC output assertions, response delays and cleanup. No package-wide catalog enablement, credentials, E2E opt-in or real provider request.

## Evidence limits

The before-run is characterization of skipped coverage, not a product assertion RED. Existing response-count/disposition/queue assertions remain the behavioral contract; no config-source or copied-value assertion is added. This does not prove physical stdin/stdout behavior outside the existing mocked JSONL/output boundary.

After activation, the same isolated file passes **9 tests / 0 skipped**. `npm run check` passed (1721 files, no fixes applied), including types, dependency/lock checks and browser smoke. No production source was changed.
