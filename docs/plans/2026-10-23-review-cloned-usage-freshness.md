# Review: reject copied usage as a fresh projected-context measurement

## Problem and final source chain

Parent `10cb2889e`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #10 `e13924536243de16b20af0b0eb8d117056f22ec8` adds the exact source-entry identity check in `estimateProjectedContextTokens` (frozen patch468-476; final backup-compaction228-266). This unit is separate from its already-closed P04 export repair, completed billing dedup and summary request-local usage reset.

Editing or deleting an earlier message clones a retained assistant with a new entry ID but its original `usageSourceId` and provider usage. The projected estimator previously found that clone after the latest context-edit/compaction position and treated its old request usage as a fresh measurement of the smaller current context. Canonical usage must remain for billing; deleting it is not the fix.

## Adaptation and preserved boundaries

Only accept the selected usage source when `usageSourceId` is absent or equals its current entry ID. Otherwise retain the existing local content estimate and null usage index. Existing later-edit/compaction invalidation, effective system/tools, public signature and estimator traversal remain unchanged. No new allocation, new helper, broad scanner or billing mutation.

Existing context-edit regression file adds actual replace/remove clone paths and exact local-estimate fields, with unchanged historical charges and raw provider usage. An independently appended alternative on a real SessionManager branch has a new ID with no `usageSourceId` and remains trusted; this is a controlled entry fixture, not a provider generation. After cloned history a new user turn and assistant response entry also restore usage-backed measurement. This guards against over-rejecting every new ID. The compaction guide explains the same billing-versus-freshness boundary; it is final V05 guidance for this change, not a new feature.

## Verification chronology

- Actual current-source RED: **2 failed / 26 passed**, **1.32s**. Replace/remove clones returned historical **50001** tokens instead of local **6 / 3**, with non-null usage indices. The independent alternative control passed. The initial combined fresh-response fixture passed too, but had not yet included a new user turn or explicit fresh-entry provenance assertion; only the final strengthened fixture below proves that intended sequence.
- After the identity predicate, context-edit, charge-identity and restored-prefix-charge owners: **33 passed / 3 files**, **4.49s**.
- First full check: **1765 files, Fixed 1**, all stages passed, **15.12s**. It formatted the owned test; not a no-fixes gate.
- Fresh-response fixture then gained the real preceding user turn and explicit absent `usageSourceId` assertion. Final focused owners **33 passed / 3 files / 13.23s**; full check **1765 / No fixes applied / 17.58s**.
- Actual-source Node smoke used file-backed SessionManager, real replacement and disk reopen. Copied source identity was rejected, edited context locally estimated **7** tokens, historical charges unchanged; after a new user/assistant pair fresh provider usage **2050** was trusted. Output `{"actualSource":true,"reopenedCloneIgnored":true,"editedContextTokens":7,"historicalChargesPreserved":true,"freshUsageTokens":2050}`, **0.30s**. Temporary executable and owned session directory removed.
- The old `/tmp/pi-audit-consumer-probes.test.ts` remained absent when checked by read and Bun.file.exists. LSP still reported cached references to that deleted file; those references do not establish a new file or executed probe.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host exposes skill reads but no skill invocation primitive. Completed bounded native source/proof reviews are supplemental evidence, not a portable CE/cross-model receipt.

No real provider call, visual UI claim, chat-template/tokenizer downgrade, usageSourceId billing change, swipe/harness/API change, dependency/lockfile/generated change or changelog on crystal. Ordinary raw estimateContextTokens remains unchanged; this is the projected context source guard. Current source/test/guide and this independent review are the only owned paths. Normal path-limited commit precedes root aggregate, then only review receipt is amended. Aggregate and final hashes are recorded only after execution. The entire 44-candidate migration remains open.

ClonedUsageSourceReview and ClonedUsageProofReview completed independent bounded read-only reviews with **no actionable findings**. They checked the final backup predicate, projection provenance, clone/replacement/removal/restoration seams, consumer-visible fallback and alternative/fresh-response controls, unchanged billing and guide accuracy. Neither executed verification or a broad candidate audit. Before staging, all **749 recovery-snapshot hashes matched**; owned status contained only the three product/test/guide paths plus protected `packages/env/`. The ignored review is included through its own explicit force-add; final cached content is inspected before commit.

## Fixed committed-source/test aggregate

Normal path-limited implementation commit `b7b8ee1e9` contains exactly source/test/guide and this independent review; its normal hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that committed source/test tree passed **8592 / 0 failed / 936 skipped**, exit 0, **108.93s**, full output `artifact://4144`. No next-unit source/test changes occurred during execution. The following review-only amendment records this exact tested SHA without changing the verified source/test/guide blobs; aggregate is not attributed to the future amended SHA. This closes P03, not the complete migration.