# Review: activate offline runtime authentication and gateway regressions

Date: 2026-10-22
Migration parent: `477186e4f`.
Source: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` test-local bundled catalog helper and auth/gateway test activation, retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. No production provider/credential behavior is changed.

## Gap and adaptation

With credentials removed from the process environment and catalogs disabled, the two existing runtime auth/gateway files report **6 passed / 7 skipped**. Five skipped cases use in-memory credentials and inspect real runtime auth/availability behavior; two gateway cases use a capturing fetch returning local SSE. None requires paid provider access. Skipping them removes normal offline regression coverage.

Add the final authored `enableBuiltinProviders` helper beside the existing allowNetwork helper. It only stubs the catalog flag, not `PI_OFFLINE`. Invoke it inside each affected case, remove those seven skip gates, and rely on the current coding-agent Vitest `unstubEnvs: true` boundary for restoration. Do not activate unrelated extension-provider cases or change their environment. LSP references confirmed the existing helper's consumers before adding the separate export.

## Verification

Both files now execute **13 passed / 0 skipped** under an allowlisted credential-free environment with `PI_DISABLE_CLOUD_PROVIDERS=1`. Assertions cover stored-key resolution, scoped credential reads/failures, provider-owned auth methods, OAuth/subscription distinctions, actual gateway URL/header materialization via runtime streaming and extension-style auth resolution. Local capturing fetch supplies responses; no real provider request or OAuth refresh is claimed. This is activation characterization rather than a new assertion RED. Existing tests are retained, not replaced with wiring assertions.

`npm run check` passed (1719 files, no fixes applied); post-check two-file run **13 passed**. Remaining session/retry/catalog-gated suites are still pending and are not included in this receipt.
