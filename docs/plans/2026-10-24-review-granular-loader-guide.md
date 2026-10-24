# Review: custom ResourceLoader granular reload guidance

## Source and scope

V05 candidate #26 `f5825ecd7744162d449e247eb7c452570d8413aa`, exact behavior `R14#2 sdk.md custom ResourceLoader migration section`. The required interface and implementation already exist. The complete SDK guide explains custom loaders but did not state their synchronous granular method obligations.

Add one paragraph after custom-loader selection: reloadSystemPrompt and reloadSkills are synchronous, update corresponding getters and do not reload unrelated resource categories. Distinguish the existing immutable full-control example's empty methods from a mutable loader's required cache refresh. Authority: resource-loader.ts interface153-169 and implementations655-690; full-control example36-50. No API/runtime/example change or unrelated SDK restyling.

## Verification and review

Existing real granular loader/effective inventory consumers: **2 passed / 2 files, 3.51s**, suite/resource-granular-reload.test.ts and suite/effective-resource-inventory.test.ts. Source/guide parity only; no new sample executable or permanent source-text test. Complete SDK guide and relevant source/example sections inspected.

Code review: skipped (ce-code-review unavailable). Both supplemental native source/proof reviews report no actionable findings; neither executed tests or independently verified timings. These are not CE/cross-model receipts. No claim every custom loader implementation or full-control provider request was executed. Documentation-only unit owns SDK guide and this review; normal hook verifies repository checks. Remaining V05 guide units stay separate.

Normal documentation commit `2c67efb27` passed the full hook: **1770 files / No fixes applied, 26.66s**. Both independent reviews completed before that commit. This review-only amendment records the exact hook receipt; SDK guide content remains identical. No new root aggregate or full-control provider request is claimed for this documentation-only unit.
