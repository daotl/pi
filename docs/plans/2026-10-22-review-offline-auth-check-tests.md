# Review: execute offline authentication-check regressions

Date: 2026-10-22
Migration parent: `1a4a8621a`.
Source: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` auth-check fixture activation; final backup `cb3bee033ba853041609b874303dc625d5d30479` retains the behavior. No production credential logic is changed.

## Current gap and adaptation

Default credential-free execution reports **1 passed / 9 skipped**. All skipped cases use isolated auth files/in-memory credentials, disable model-catalog network refresh and either avoid OAuth refresh or replace it with a local stub. They do not require ambient cloud access.

Enable bundled metadata inside the file's existing runtime factory and the one direct auth-check-runtime case, remove nine skip gates, and preserve default `PI_OFFLINE` plus Vitest environment restoration. The pure argument case does not activate catalogs. No package-wide hook or ambient credential forwarding is added.

## Verification

Same file under allowlisted environment with `PI_DISABLE_CLOUD_PROVIDERS=1`: **10 passed / 0 skipped**. Existing assertions exercise configured/unknown providers, model-to-provider selection, no-refresh token reads, stubbed OAuth refresh, unresolved env references, invalid auth JSON, no accidental file creation and runtime construction. This is characterization/coverage restoration, not an assertion RED. No provider request or real OAuth token is used.

`npm run check` passed (1719 files; one test file formatted). Post-format auth-check plus runtime-auth suites: **21 passed**. Normal hooks remain enabled.
