# Review: cumulative summary checkpoint replay reference

## Source and scope

V05 candidate #13 `aecd44347d2ada4e38b44f0fd8006bd881ae0872`, exact session-format cumulative summaries guidance. The current reference described one latest summary and dropping all retained system messages, while SessionManager selects bounded summaries oldest first and preserves later deltas and legacy systems.

Read the complete session-format guide and current buildContextEntries/buildSessionProjection. Correct only CompactionEntry and Context Building sections: latest retained boundary, bounded chronological summary block, one current checkpoint before that block, suppression of folded pre-checkpoint system deltas, preservation of later deltas and no-checkpoint legacy system messages. No storage/runtime/type change. An attempted ContextEdit UI wording change was restored before review; that separate projected-transcript guidance is outside this unit.

Authority: session-manager.ts:611-670,710-738. Existing behavioral oracles in session-manager/build-context.test.ts:233-307 cover ordered summaries, latest checkpoint, edited retained history, later deltas, soft-deleted checkpoint fallback and legacy no-checkpoint systems.

## Verification and delivery

Existing checkpoint/live-transcript consumers **29 passed / 2 files, 3.20s**: session-manager/build-context.test.ts and suite/live-projection-transcript.test.ts. No new permanent test for copied prose, no new runtime behavior or file migration, and no process-crash/storage completeness claim.

Code review: skipped (ce-code-review unavailable). Both bounded native source/proof reviews report no actionable findings; neither executed tests or independently verified timings. These are supplemental, not CE/cross-model receipts. Documentation-only unit owns session-format guide and this review. Normal explicit-path commit hook validates repository checks; no new root aggregate is claimed for this guide-only unit. Remaining V05 contracts stay separately tracked.

Normal documentation commit `1692819d8` passed its full hook: **1770 files / No fixes applied, 12.17s**. Both independent reviews completed before commit. This review-only amendment records the hook receipt; session-format guide content is unchanged and no new root aggregate is claimed.
