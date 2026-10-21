# Review: honor explicit coding-agent catalog activation

Date: 2026-10-22
Migration parent: `498528001`.
Source: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` (coding-agent Vitest override), retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. Select this configuration contract only; other catalog-dependent test repairs remain separate.

## Problem and RED

The root isolated runner already preserves an explicit `PI_DISABLE_CLOUD_PROVIDERS=0`, but coding-agent's Vitest config overwrites it with `1`. Its comment advertises an override that cannot take effect. A temporary credential-free child-process smoke ran the existing ModelRegistry test `overriding baseUrl keeps all built-in models`, using real model registry creation and bundled catalog data. Unset and explicit `1` correctly skip; explicit `0` also skips instead of executing. This is the observed RED. The first smoke attempt assumed skipped tests use the JSON state `pending`; actual Vitest reports `skipped`. That fixture assertion was corrected before obtaining the behavioral RED.

## Adaptation

Set the test environment's catalog flag to `process.env.PI_DISABLE_CLOUD_PROVIDERS ?? "1"`; retain `PI_OFFLINE=1`. No credentials, E2E opt-in, endpoint or network flags are forwarded or enabled. No production provider/catalog implementation changes. Existing gated suites are not globally ungated by default.

## Verification

The same child-process smoke now observes unset → skipped, explicit `1` → skipped, explicit `0` → passed. Each process uses an allowlisted environment, isolated home and synchronous HTTP/HTTPS/TCP/TLS/fetch deny hooks; the network-attempt marker remains absent. This runs the real existing registry test, not a copied config assertion. Only that exact catalog-dependent behavioral case executes; other cases remain filtered. No provider request or paid E2E execution is claimed.

`npm run check` passed: 1719 files, no fixes applied; types, dependency/lock checks and browser smoke passed. No permanent test added for a config value; temporary smoke provides the execution evidence. Default-off suite activation and remaining test-local metadata helpers still require separate migration accounting.
