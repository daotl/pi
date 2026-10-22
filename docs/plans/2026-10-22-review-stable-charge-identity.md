# Review: retain charge identity across context-only clones and replay

Date: 2026-10-22
Parent: `eb4b8f72f`.
Source chain: `ff0f22eb780decb94a196a2700cc6ba44446116e` original usageSourceId producers/shared iterator, `e13924536243de16b20af0b0eb8d117056f22ec8` backend/export parity, `aecd44347d2ada4e38b44f0fd8006bd881ae0872` logical message statistics. Final backup `cb3bee033ba853041609b874303dc625d5d30479` usage-totals60–113, Session stats5946 onward and clone identity. Adapt current upstream swipe/soft-delete/rollback architecture, not backup SessionManager wholesale.

## Defect and RED

The earlier terminal-barrier unit explicitly recorded original partial restoration being billed twice. Current stats/footer/breakdown also counted every tail clone as a separate provider call. Restored/replayed summary usage could be dropped by old suffix reconstruction.

Before production edits, **3 failed / 2 files**:

- File-backed rejected terminal receipt expected whole-session input1309/output11/total1325, actual2607/output15/total2627: the original partial's1298/4 billed again.
- Two independent equal-valued calls should total46 tokens; repeated replacement clones yielded138.
- Repeated surgical removal clones yielded115 instead of46.

These failures occurred before footer/export assertions, so they are not called independent footer/export RED. Initial test authoring had a wrong cleanup line range, detected by edit parsing and immediately restored before execution; no malformed test result counted.

## Producer inventory and final adaptation

Inspected complete replaceMessages/removeEntries implementations before editing, plus appendTrailingEntries, ordinary append, prefill restore and fork serialization.

| Producer | Charge ownership |
|---|---|
| new provider response, including regenerated swipe response | fresh entry ID, distinct actual charge |
| replaceMessages tail clone | retain source usageSourceId or original entry ID |
| removeEntries tail clone / tool-block filtering | retain source identity, preserve current deletion/supersession/rollback |
| restored original partial | pass original mapped entry's transitive identity to appendMessage; refresh mapping |
| system/compaction/branch_summary/standalone usage replay | retain identity and usage while reconstructing fresh entry fields |
| fork/branch-file copy | existing entry IDs and optional identities preserved |

SessionEntryBase adds optional usageSourceId. Existing entries without it retain their own ID; no speculative backfill of old duplicate histories. appendMessage accepts optional replay identity, never used for fresh provider responses. Existing message-to-entry map is reused for prefix restoration rather than adding another state field and cleanup protocol. Abandoned source entries remain addressable; repeated restores and cloned tails retain the transitive original ID.

One shared billableUsages iterator marks an identity only after finding actual usage and yields each charge once. It includes assistant, tool, compaction, branch summary and non-context usage. Equal values do not identify a charge. getUsageTotals and model breakdown share it; responseModel attribution unchanged. Stats use identity for logical message counts, footer uses shared totals, and HTML embeds backend totals while deduplicating logical counts. No provider adapter or extra receipt retry framework.

Suffix replay uses explicit fresh fields, preserving deletedAt visibility and source charge identity without copying abandoned supersededBy. Current soft-delete, restore, shred, swipe alternative topology and atomic rewrite rollback remain unchanged. Session capture/restore transactionality is still pending S2.

## Verification chronology

After production changes, four owners had **2 failed / 27 passed**: the existing footer-width mocks omitted entry IDs, so every fake charge had identity undefined. Added unique IDs to those mock entries and the appended cache-invalidation fixture, not a production exception for invalid entries. A tool mock ID was briefly inserted on its nested message, corrected to entry level before the green run.

Then four billing owners passed **29**; adding summary/tool/cache replay-chain coverage passed **30**. Broader stats/footer/rewrite rollback/context edit/continuation/swipe/soft-delete/system-tail owners passed **114**, then **115 / 10 files** with equal-valued real-alternative/soft-delete controls. Repeated cloned-prefix restoration control plus receipt/identity owners passed **6 / 3 files**: two actual completed rejections add exactly their two usages, not another original partial charge.

The file-backed clone matrix asserts global components, cost, logical assistant count, live/reopened breakdown, actual FooterComponent render and actual generated HTML embedded totals. It retains two distinct equal-valued calls. Summary replay matrix covers tool, compaction, branch-summary and cache-warming charges through clone and replay twice. Soft deletion changes context visibility without merging distinct alternative charges. The original receipt regression's whole-session totals assertion is now permanent and passing, replacing the prior explicit pending S10 limitation for that scenario.

## Actual consumer smoke

Native Node existing source resolver: real file-backed SessionManager clone and JSONL reopen totals input22/output14/cacheRead6/cacheWrite4/cost20. Generated HTML opened in managed Chromium; observed header **2 user / 2 assistant**, **↑22 ↓14 R6 W4**, cost numeric **20.000**, and no browser errors. Tab closed. Header screenshot captured in the external run artifacts; model image input unavailable, so DOM/runtime values are evidence, not aesthetic review. No paid provider/HTTP. Temporary smoke and its export/session directory removed. Initial smoke tried a nonexistent public exportSessionToHtml export and failed before execution; corrected to the inspected internal source module, then passed.

Check chronology: **1738 files, Fixed 5** initially, then **1738 files, Fixed 1** for added alternative test; all check stages including browser smoke passed. Normal commit and cleanup-amendment hooks passed **1739 files, No fixes applied**. Committed source/test/public-doc tree `6a25bd065` passed root `rtk proxy ./test.sh`: **8213 passed / 0 failed / 945 skipped**, exit 0, **94.99 seconds**, full output `artifact://2770`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifacts rechecked on committed tree: **749 files / 0 mismatches**.

## Source review and boundaries

ChargeIdentityProducerAudit, UsageConsumerParityAudit and RestoredPrefillChargeAudit returned correct/no findings in bounded static review. They checked transitive identities, suffix usage, current topology/rollback, accounting parity and restored-prefix map ownership. They ran no tests/builds/checks/formatters; runtime evidence is parent execution. Before additive contract changes, LSP returned 469 `appendMessage` references and 10 `getUsageCostBreakdown` references; relevant producer/consumer paths were inspected and no required caller migration was found. Graph project/generation/coverage unavailable (WeakMap, reported); exact source fallback, not exhaustive external-caller evidence.

This is not all of S10: completed-but-unpublished write/rename/listener receipts, pending persistence recovery, cancelled-summary receipts and rawDelta transport fidelity remain pending. No process-crash guarantee or historical duplicate-ID inference. Existing footer context-budget cache identity is a separate mapped unit. No changelog on crystal.

Parent boundary source/test tree `2e9590b4b` aggregate **8208 / 0 / 945**, 106.82 seconds, `artifact://2718`; `eb4b8f72f` amended its review only. Not current-unit aggregate evidence.

Final extended run passed **116 / 11 files**, including the repeated cloned-prefix restore control. Its new test formatting check passed **1739 files, Fixed 1**; the post-format owner rerun is recorded below. Protected artifact manifest checked before commit: **749 SHA256 / 0 mismatches**. All three source audits are final delivered results, not running-job assumptions.

Post-format extended owners again **116 passed / 11 files**. This is the final focused consumer result before normal commit hooks; it includes all new clone/replay/alternative/restore cases and existing rollback, context-edit and upstream swipe/soft-delete contracts.
