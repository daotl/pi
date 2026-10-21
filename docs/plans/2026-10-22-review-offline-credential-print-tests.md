# Review: run isolated credential command regressions offline

Date: 2026-10-22
Migration parent: `de30e28b8`.
Source: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` credential-print activation, retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. Only test activation is selected.

## Current gap and adaptation

Default credential-free execution reports **5 skipped**. The cases use in-memory synthetic credentials, disable model network, stub OAuth refresh and capture CLI errors. They do not require provider access. Enable bundled metadata in the existing file-local runtime factory, remove the five skip gates and retain Vitest environment restoration. The malformed-argument CLI path does not need catalog activation. No production credential behavior changes.

## Verification

Same file in an allowlisted environment with `PI_DISABLE_CLOUD_PROVIDERS=1`: **5 passed / 0 skipped**. Existing assertions verify resolved API key/bearer values, synthetic refreshed-token storage, invalid credential kinds/arguments and CLI failure status. No actual credential is inherited or printed by the test runner, no provider request or real OAuth refresh is claimed. This is activation characterization, not a product defect RED.

`npm run check` passed (1720 files; one test file formatted). Post-format credential-print and auth-check suites: **15 passed**. Normal hooks remain enabled.
