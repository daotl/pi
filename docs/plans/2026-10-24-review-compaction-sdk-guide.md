# Review: compaction SDK helper boundaries

## Source and scope

V05 source-ready guidance from candidate #12 `0a9acad131b79844ce5afd677368090ef95684f7` asynchronous cut-point contract and candidate #10 `e13924536243de16b20af0b0eb8d117056f22ec8` standalone Agent baseline fallback. No API implementation change.

Read the complete compaction reference and source contracts. Add two bounded paragraphs: await exported findCutPoint's Promise<CutPointResult>, custom counters return Promise<number> with optional abort signal; source-level prepareCompaction is async but not root-exported. Standalone generateBranchSummary({agent}) uses Agent system/tool state only without a preceding baseline, explicit contextProjection or checkpoint, and never restores shared conversation into the abandoned range. No generic live-Agent override, new import sample or provider/cache claim.

Authority: compaction.ts TokenCounter280-281, findCutPoint451-458 and prepareCompaction1104-1109; root index29-51; branch-summarization.ts430-441. Existing branch-budget and compaction tests inspect those boundaries.

## Verification and delivery

Existing consumers **78 passed / 2 skipped / 3 files, 3.00s**: compaction.test.ts, branch-summarization.test.ts and suite/summary-request-budget.test.ts. The skipped cases are not newly enabled or claimed. No new prose-copy test or runtime/API behavior. Complete guide inspection does not claim all examples were executed.

Code review: skipped (ce-code-review unavailable). Both bounded native source/proof reviews report no actionable findings; neither executed tests or independently verified timings. These are supplemental, not CE/cross-model receipts. Documentation-only unit owns compaction guide and this review; normal hook validates repository checks. No new root aggregate is claimed. Remaining V05 guides stay separate.

Normal documentation commit `0e3a2a012` passed the full hook: **1770 files / No fixes applied, 11.60s**. Both independent reviews completed before commit. The following review-only amendment records the hook receipt; compaction guide content remains unchanged. No new root aggregate is claimed.
