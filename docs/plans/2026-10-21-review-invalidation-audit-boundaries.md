# Review: preserve legacy content and deletion-aware invalidation boundaries

Date: 2026-10-21
Related migration: `02e50bf46`; independent ReplacedCallFinalAudit identified two integration defects in the new replacement scan/remap.

## Problem and RED

A supported legacy assistant with null/missing content throws in the new call scan before replacement. Mapping a removed result's boundary to a soft-deleted clone makes buildContextEntries fail to find the boundary and fall back to all history, resurrecting summarized content. Three targeted regressions fail: two TypeErrors plus unexpected summarized user/assistant replay (**3 failed / 22 skipped**).

## Adaptation

Treat null/missing original and replacement assistant content as empty call lists, consistent with existing projection normalization. Keep hidden clones in storage, but advance a removed compaction/summary boundary to the next retained visible clone. Do not change the existing missing-boundary fallback, soft-deleted compaction un-compaction, parent topology or durable selection contracts.

## Verification

Four owning context-edit/rewrite/edit/swipe suites: **136 passed**. Legacy cases assert actual replacement projection. Visibility case uses valid retained-tail-before-compaction chronology: user/call/result/hidden user/visible user/compaction; changing the call now yields only summary plus visible follower, with boundary referencing that clone. The earlier full isolated suite at99f3654bb was **7965 passed / 0 failed / 999 skipped**, before these added edge regressions; it is not proof of these corrections. No paid provider/network request.

`npm run check` passed (1714 files; two changed files formatted). Corrected-path post-format run includes the actual `test/suite/lax-message-content.test.ts`: **142 passed** across five files. Independent source-only follow-up confirmed both reported defects corrected, with no remaining concrete findings in that scope; no independent test execution claim.
