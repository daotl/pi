# Review: stop cancelled preparation before extension hooks

Date: 2026-10-22
Migration parent: `e13db593f`.
Source: final preparation guards in `b2489d93bca284d3322ece68c1fa7e086ee02e38`, retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. Only the two post-prepare cancellation checks are selected; tokenizer authorization/concurrency and completed-summary receipt work remain separate.

## Problem and RED

Cut-point preparation can await tokenizer work and then return estimated counts or no candidate after cancellation. Both manual and automatic paths previously continued into extension hooks; the automatic empty-preparation path returned without closing its started event pair.

Public manual compact and ordinary prompt/automatic overflow regressions hold a controlled tokenizer fetch until abortCompaction, then release it with an unsupported-endpoint response. Four rows cover tiny and retain-all budgets. Before source changes: **3 failed / 1 passed / 5 filtered**. Tiny manual/automatic budgets invoke the hook once after cancellation; automatic retain-all emits no compaction_end. Manual retain-all was already a passing control.

## Adaptation and verification

Immediately after awaited prepareCompaction, check the operation's signal before inspecting an empty result or calling hooks. Existing catch paths report aborted completion and avoid checkpoint publication. No estimate policy, token-count API, retry grant or extension semantics changed.

Owning tokenize/queued-compact/enabled-retry files: **33 passed**. New rows assert no hook call, one aborted completion without retry, no checkpoint, and rejected manual operation. Fetch is a controlled local gate, released and awaited in finally; no real server/provider request or tokenizer privacy claim. The test supplies synthetic history and disables unrelated retries. All coverage uses the existing harness/faux conventions.

The cancellation-after-summary-before-checkpoint guard remains a separate pending boundary because completed usage preservation has additional S10 ownership requirements. This unit only covers preparation before any summary generation.

`npm run check` passed (1719 files, no fixes applied); post-check owning suites **33 passed**. Normal commit hooks remain enabled.
