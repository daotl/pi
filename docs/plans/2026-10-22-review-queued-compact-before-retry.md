# Review: process accepted compact before automatic retry backoff

Date: 2026-10-22
Migration parent: `239e147f5`.
Source: final retry-grant adaptation in `a820049ee4ff71fb8f35dd62c386181dce6e9222`, retained in backup `cb3bee033ba853041609b874303dc625d5d30479`; cancellation normalization from `06023b8cbaacae6ba27c4d8ed68c359dd7104e63` is already landed separately. Other S2/S3 settlement/prefill transactions are not imported.

## Problem and RED

Post-run handling prepares automatic retry, emits its event and waits backoff before consuming an accepted queued compact. The six-row authored matrix reproduces three failures: enabled finite/unlimited retry dispatches another provider request before compaction; cancelled compaction still permits a retry. Disabled, zero-budget and no-compact controls already pass (**3 failed / 3 passed / 7 filtered**).

## Adaptation

Compute the existing retry eligibility before consuming queued compact; run compact at the completed boundary before `_prepareRetry`. Its resume flag includes only that pre-existing grant, not a new grant. Cancellation suppresses that internal retry. `_prepareRetry` still rechecks live settings after async work; disabled/exhausted policies do not gain requests. The ordinary interrupted runnable-boundary path and separately accepted queues retain existing behavior. Do not migrate backup's prefill transaction argument or unrelated wrapper architecture.

## Verification and fixture limits

The original six rows pass after source changes. Two additional controls inject genuine summary failure through a controlled summary stream and verify finite/disabled grant limits. Initial versions threw from an extension handler; the runner isolates handler errors, so default summary consumed a scripted response. Those two fixture failures were not product RED; failure injection was moved to the actual summary stream without changing production.

Eight-row matrix: **8 passed**. It covers control/disabled/zero/one/unlimited/cancel/ordinary-failure/disabled-failure outcomes, compaction-before-retry event order, actual provider request counts, final recovered answer, checkpoint presence/absence and idle/queue cleanup. Public session.prompt/queueCompact plus faux transport execute the behavior. No clock timeout assertion, exact error wording or paid request is used. Existing tokenizer harness interception remains outside this unit.

`npm run check` passed (1719 files; one test file formatted). Post-format queued compact, enabled retry, public pre-prompt and chat-tokenize suites: **27 passed**. Normal hooks remain enabled.
