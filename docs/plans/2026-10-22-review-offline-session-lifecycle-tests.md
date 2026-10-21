# Review: restore scripted session lifecycle regressions to offline runs

Date: 2026-10-22
Migration parent: `12e6c0591`.
Source: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` ungates concurrent/retry/dynamic-provider tests with test-local bundled provider activation; retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. Existing fixture architecture remains intact.

## Current gap and adaptation

The three files report **18 skipped** in the default credential-free, catalog-disabled environment. Concurrent/retry tests supply scripted Agent streams; dynamic registration prompts terminate in a capturing stream stub and inspect the selected physical model URL. The skipped condition confuses bundled metadata availability with real provider access.

Use the already-landed `enableBuiltinProviders()` inside each suite's beforeEach and remove its skip gate. Every case in these three suites requires the same built-in Anthropic metadata; no unrelated suite is activated. Keep `PI_OFFLINE`, Vitest `unstubEnvs` restoration, existing scripted responses and auth storage isolation. No production lifecycle, timeout or assertion change.

## Verification

Same three files under allowlisted environment with `PI_DISABLE_CLOUD_PROVIDERS=1`: **18 passed / 0 skipped**. Public session operations exercise concurrent prompt/steer/followUp, queued event/tool ordering, retry completion and tool-loop settlement, extension-time/session-start/command-time provider replacement. This is coverage activation characterization, not a newly fixed runtime defect. Capturing/scripted streams prevent provider dispatch; no paid API execution is claimed. Remaining gated files are still pending S12.

`npm run check` passed (1719 files; one test file formatted); post-format three-file run **18 passed**. Normal commit hooks remain enabled.
