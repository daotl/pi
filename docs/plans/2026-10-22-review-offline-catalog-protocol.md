# Review: execute local catalog protocol regression in the isolated runner

Date: 2026-10-22
Parent: `9042138a9`.
Source behavior chain: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` separates bundled provider metadata activation from external provider I/O. This current upstream local protocol fixture adopts the already landed `enableBuiltinProviders()` convention. No catalog/runtime product changes.

## Problem and observed execution

The file-wide `describe.skipIf(PI_DISABLE_CLOUD_PROVIDERS === "1")` skipped a localhost catalog protocol regression in the authoritative isolated runner. The test needs bundled OpenRouter metadata, not an actual provider credential or remote model response.

Before edit with `PI_DISABLE_CLOUD_PROVIDERS=1 PI_OFFLINE=1`: **one skipped / one file**, zero execution. After unconditional describe and case-local `enableBuiltinProviders()`: **one passed / one file** under the same invocation environment.

## Boundary and verification

The existing real local HTTP server implements the versioned catalog redirect and shard response; the test exercises ModelRuntime refresh, exact version negotiation, selected model API/base URL and native request adapter path. `allowNetwork()` clears the offline flag; a fetch allowlist installed before runtime creation independently permits only the local catalog origin, captures the expected OpenRouter request without dispatch, and rejects every unexpected origin. The explicit test key is in-memory; no ambient credentials or paid API invocation. The allowlist remains installed through catalog refresh and provider dispatch and is restored in finally.

Changes are the collection gate, case-local metadata setup and this fail-closed fixture boundary. Existing semantic assertions and local server teardown remain. Initial check passed **1746 files, Fixed 1** from unwrapping describe; a later check passed **1746 files, No fixes applied** before moving the guard over the full case. Actual final checks and fixed-tree aggregate are recorded below rather than inferred. No protocol implementation rewrite.

With the guard covering runtime creation, refresh and dispatch, local catalog/image/classifier owners passed **nine / three files** under initial offline flags. Full-case formatting check passed **1746 files, Fixed 1**; final check **1746 files, No fixes applied**, including browser smoke. Post-format actual localhost client run **one passed**, exercising both catalog HTTP requests and captured provider adapter selection; no separate fake smoke substitutes for this real HTTP path. Protected user artifacts **749 SHA256 / zero mismatches**.

Committed fixed tree `f761b243d` root `rtk proxy ./test.sh`: **8321 passed / 0 failed / 936 skipped**, exit 0, **113.14 seconds**, full output `artifact://3062`. Normal commit hooks passed **1746 files, No fixes applied**. The formerly skipped localhost catalog case executes in the isolated aggregate. No next-unit source/test edits occurred; immediate amendment changes only this review evidence. Protected artifacts **749 SHA256 / zero mismatches**.

## Limits

This does not activate registry tests or external model-catalog service probes, change provider auth, enable cloud E2E, or alter tokenizer permission. Changelog unchanged on crystal. Parent aggregate8320/0/937 on source836250c11 is not current-unit evidence.
