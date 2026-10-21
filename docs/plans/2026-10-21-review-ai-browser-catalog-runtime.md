# Review: browser-safe provider catalogs and current compat catalog mode

Date: 2026-10-21
Migration base: `3f99ef68e`
Source chain: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` → `6b96c54b1769743cfded773928104d7bfe460c2b`

## Problem and current proof

Built-in catalog/factory functions read `process.env` without checking whether Node's `process` global exists. The compatibility module eagerly constructs those providers at import time. An actual browser-target bundle therefore throws before a caller can read catalogs or dispatch with an explicit API key.

The current-base regression bundles the real provider/compat sources with esbuild's browser platform and evaluates the result with normal browser globals but no `process`. All **6 cases failed with `ReferenceError: process is not defined`** while evaluating the real factory. This is not a missing mock or an ambient network failure.

The older local catalog-cache repair introduced call-time flag awareness, but its own process access needed the final browser guard. Migrate the completed chain, not that intermediate implementation.

## Final repair

- Guard the existing two catalog/factory environment reads. Missing `process` means cloud catalogs remain enabled.
- Construct compatibility models lazily, keyed by the guarded local-only flag, so changing Node's catalog mode does not retain an empty or stale collection.
- Preserve current Azure/provider IDs, explicit-key streams, Cloudflare auth handling and API overrides. No provider architecture or catalog values are copied from `my-merge`.

## Verification

- Owning browser/provider/image-model suites: **43 passed / 6 skipped** across three files.
- The browser-bundle cases exercise real provider construction and both native compat dispatch functions through injected Responses SSE. They assert outgoing URL/auth/model and returned usage; unexpected ambient fetch throws.
- Dynamic Node local-only flag controls remain covered. VM execution proves browser-bundle/no-process compatibility; no real browser UI or external provider request was exercised.

- `npm run check`: passed with 1703 files, formatting the new browser test. Post-format owning suites again passed **43 tests / 6 skipped**; normal commit hooks provide the final no-fixes check.