# Review: apply live summary budget changes consistently

Date: 2026-10-21
Migration base: `38c2b3204`
Source: `a820049ee` final live-policy synchronization and four setter/override transition regressions (commit diff:394-478,730-731,851-852,1063-1137). Adapted to current direct manager projection seams without importing old prefill/transaction architecture.

## Problem and RED

AgentSession sets manager summary budget only at construction/full reload. Changing SettingsManager through setter or overrides leaves live messages, subsequent request projection and boundary preview on stale/different budgets. Four transition cases (0→1000 and 1000→0 through both APIs) fail on public session.messages (**4 failed / 29 skipped**).

## Adaptation

Track the last effective budget, synchronize manager before live/provider/boundary/compaction projection, and invalidate cached post-compaction counts only on a real delta. A pending refresh marker survives early usage reads; finalized refresh consumes it. Unchanged public reads preserve the existing messages array. Preview managers receive the same effective setting rather than the class default. No setting API/schema or summary contents change, no prefill/queue redesign.

## Verification

Boundary, actual AgentSession compaction, manager context, context-edit and continuation suites: **112 passed**. Four regressions verify public live summaries and unchanged-read identity, provider requests before/after committed boundary compaction, extension preview summaries, subsequent manual summary input and final projection. Assertions inspect captured requests outside normalized provider callbacks. Initial RED stops at live read; downstream checks are post-fix controls. No paid provider/direct tokenizer HTTP proof.

Final fixture verifies pre-change array differs after policy refresh and subsequent unchanged reads preserve the refreshed array. Removed redundant manual/auto entry sync calls; retained counter sync from exact a820049 diff:673-674. `npm run check` passed after narrowing (1712 files; No fixes applied); final owning suites **112 passed**.
