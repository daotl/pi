# Review: retain trailing system patches before the prefill

Date: 2026-10-21
Migration base: `6ecefcde2`
Source chain: `d8ffbdfa` tool-prefix held-system handling; `7cfc4563` final text/reasoning-prefix handling. Failed-response replay exclusion remains separately scoped.

## Problem and RED

With skipTrailingToolResultSynthesis, trailing system patches disappear for pending tool calls and remain after text-only prefixes, violating the required trailing assistant position. Two focused cases failed (**2 failed / 3 passed**): missing patch for tools, misplaced patch for text.

## Adaptation

Identify last non-system message, hold trailing system patches for any assistant prefill, and insert held patches before that assistant while retaining their order. Existing mid-conversation tool accounting/synthetic result behavior remains. No public API, failed-response filtering, raw serialization or whitespace policy change.

## Verification

Transform prefill, actual Completions serialization and reasoning-details suites: **21 passed**. Canonical input remains unchanged; serializer controls require patch present before final assistant and raw tool-prefix/text retained. No live HTTP provider call.

`npm run check` passed (1713 files; three changed files formatted). Post-format owning suites: **21 passed**.
