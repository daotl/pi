# Review: execute offline Radius catalog regressions

Date: 2026-10-22
Migration parent: `d5ef3fdf5`.
Source: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` test-local Radius provider activation, retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`.

## Gap and adaptation

Default allowlisted execution reports **3 passed / 3 skipped**. The skipped cases verify restored legacy credential catalogs without model network, a mocked fetch/store request, and no refresh by default. They require bundled metadata, not real Radius access.

Call the existing catalog-only helper inside each of the three affected cases and remove only their skip gates. Preserve pre-existing allowNetwork test setup, per-case allowModelNetwork flags, synthetic unexpired credentials and fetch mocks. Other custom-gateway cases keep their existing environment and assertions. No production routing/auth change.

## Verification

Same file under credential-free environment with `PI_DISABLE_CLOUD_PROVIDERS=1`: **6 passed / 0 skipped**. Existing assertions verify model URL/API, provider identity, configured auth, mocked authorization header/store writes and absence of default catalog fetch. No real OAuth refresh, provider inference or Radius HTTP request is claimed. This is activation characterization rather than product RED.

`npm run check` passed (1720 files, no fixes applied); post-check Radius plus runtime-auth suites: **17 passed**. Normal hooks remain enabled.
