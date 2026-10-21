# Review: explicit E2E collection registers provider probes

Date: 2026-10-21
Migration base: `ce56ff6c9`
Source: `edb4e9d9` AI E2E catalog activation and network-denied real Vitest collection regression. Root runner isolation/metadata override remain independent committed behavior.

## Problem and RED

PI_E2E_TESTS=1 includes E2E files but defaults provider catalogs off. Two Anthropic suites derive probe registrations from catalogs, so they collect no provider cases. Real collect() regression: **1 failed / 3 passed**, missing configured-streaming Anthropic probe when catalog flag unset. Default exclusion and explicit flag controls already passed.

## Adaptation

When catalog flag is unset, default to0 only for explicit E2E opt-in, otherwise1. Do not override any explicit catalog flag, forward credentials through root runner, or execute E2E probes offline.

## Verification

Four real collection cases plus eight root runner cases: **12 passed**. Collector uses isolated credential-free home/allowlisted environment and network-denial preload in parent and fork; invokes createVitest.collect, never start/run. Requires known Anthropic configured-streaming/forced-eager/long-cache probe registrations and skipped state. Also includes the current thinking-binding fixed-model conformance file and requires its single credential-free case skipped; that fixed registration was not the catalog-dependent defect. All three selected Anthropic files remain excluded by default. No broad all-provider E2E coverage or live provider execution claim.

`npm run check` passed (1714 files; No fixes applied). Config file remains in its existing excluded formatting convention; no generated catalogs/dependencies changed.
