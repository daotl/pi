# Review: final selective migration disposition

## Decision and fixed coordinates

All 44 owned candidates have a final selective disposition against baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `my-merge` remains `cb3bee033ba853041609b874303dc625d5d30479`. The 178 upstream commits remain provenance only. No merge replay, branch/worktree switch, backup movement, push or PR.

Decision completeness is not exhaustive hunk equivalence or execution of every historical composed acceptance. There are **27 ordinary-final rows and 17 final rows with named evidence limits**, **0 unresolved candidates and 0 required implementation units**. Canonical `semanticCompletion=true` means the selected migration and its dispositions are complete, not that every optional composition was executed.

## Frozen candidate dispositions

`Limit count` counts named behavior-level evidence limitations; candidate #4 counts its 12 bounded merge-inventory subitems. A final disposition is not an assertion that every optional composition was executed. Detailed limit families are fixed below.

| # | SHA | Final disposition | Named-limit count |
|---|---|---|---|
| 1 | `720b569f1ac0405a547376316d890c1de9c1c0ed` | closed_selective_mixed | 0 |
| 2 | `548504c8cab9c1fddc0781e7c3ec077a203b88cd` | closed_final_behavior | 0 |
| 3 | `6e484348ab86298b669c2c5cfceea56d12d369b9` | closed_selective_mixed | 0 |
| 4 | `e3f076aa28c4d7c1373a3e68a35cbfd07a199bff` | closed_evidence_limited_merge_container | 12 |
| 5 | `92d3171664cdd8fd4e5c67b38d49332a071043a3` | closed_selective_with_evidence_limits | 2 |
| 6 | `e1f9cdc22ecbc3b690625b44ea3aa934592eef79` | closed_selective_mixed | 0 |
| 7 | `667e13ca60785e573d2d121be37780a5fd4a95c7` | closed_selective_with_evidence_limits | 2 |
| 8 | `ff0f22eb780decb94a196a2700cc6ba44446116e` | closed_selective_mixed | 0 |
| 9 | `deede133ff5bc52ba82ea52f01ea27acd712a430` | closed_selective_with_evidence_limits | 1 |
| 10 | `e13924536243de16b20af0b0eb8d117056f22ec8` | closed_selective_with_evidence_limits | 1 |
| 11 | `778e0120721a2978abedd9ce60f945427f5c9ee2` | closed_selective_mixed | 0 |
| 12 | `0a9acad131b79844ce5afd677368090ef95684f7` | closed_selective_mixed | 0 |
| 13 | `aecd44347d2ada4e38b44f0fd8006bd881ae0872` | closed_selective_mixed | 0 |
| 14 | `d8ffbdfa44796c024f9c38b9b743f50e96521ff7` | closed_selective_mixed | 0 |
| 15 | `447d3579a3123052de1e4b4f54a46942836ceb48` | closed_selective_with_evidence_limits | 1 |
| 16 | `7ef7ce610c85a4662eb0846f01a21bcbabb9dc90` | closed_selective_with_evidence_limits | 1 |
| 17 | `12ae8641ab5b34f980391b0393b8b1cd7ec84062` | closed_selective_with_evidence_limits | 1 |
| 18 | `93d7e6dc2a8036b344083338df0df7cc3179f526` | closed_selective_mixed | 0 |
| 19 | `513e503a4ecf728e39a12333f94c66e7749ca4ed` | closed_selective_mixed | 0 |
| 20 | `23b8ec32612a9308445fbc56c107d36dc452b1cc` | closed_final_behavior | 0 |
| 21 | `b65b01b1a8e3e7e2a6a4de09b1cc6487968e795c` | closed_final_behavior | 0 |
| 22 | `6f1cfc1f5511b7ce600843d31eb72661587f9a80` | closed_selective_with_evidence_limits | 2 |
| 23 | `243015b85e9159c785bdfa09053bb9eac12aab74` | closed_selective_mixed | 0 |
| 24 | `3891c85a2d698b87546873ddc42f3d400406db13` | closed_selective_mixed | 0 |
| 25 | `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45` | closed_selective_mixed | 0 |
| 26 | `f5825ecd7744162d449e247eb7c452570d8413aa` | closed_selective_mixed | 0 |
| 27 | `b2489d93bca284d3322ece68c1fa7e086ee02e38` | closed_selective_mixed | 0 |
| 28 | `2093b87fe2af9714f877d279fe1db3674fc278a8` | closed_selective_with_evidence_limits | 1 |
| 29 | `7cfc4563ad539607c1f02ef56bd76b38d5fcacf5` | closed_selective_mixed | 0 |
| 30 | `26cb5df97f1fbe6266113f2a6be681605fca81cc` | closed_selective_mixed | 0 |
| 31 | `a820049ee4ff71fb8f35dd62c386181dce6e9222` | closed_selective_mixed | 0 |
| 32 | `65007d6c75cb16d08fbe47934e923bc53abaea1b` | closed_selective_with_evidence_limits | 2 |
| 33 | `8b99d3ee3d54e82a494ef15d400ff571e864e363` | closed_selective_with_evidence_limits | 1 |
| 34 | `5ee2a4ea9aea9453af2790f0acfd5db481fcd418` | closed_final_behavior | 0 |
| 35 | `f2970f807e4121823162581ebb8d7495f52f3785` | closed_selective_with_evidence_limits | 3 |
| 36 | `17afa8fa70ef1317644a6720b621ea846e0dd344` | closed_selective_with_evidence_limits | 1 |
| 37 | `06023b8cbaacae6ba27c4d8ed68c359dd7104e63` | closed_selective_with_evidence_limits | 1 |
| 38 | `444bce20a39f93d6b860efc6919548995d7509ab` | closed_final_behavior | 0 |
| 39 | `edb4e9d94a08f8315ee8ba0230e81489b23ded9a` | closed_final_behavior | 0 |
| 40 | `39ad8ad45dde2c9fe1939d578c2c0ce22aa2ad2d` | closed_selective_mixed | 0 |
| 41 | `6f9400463750fda6160b9b3b73d20ade24e7b7bb` | closed_selective_with_evidence_limits | 2 |
| 42 | `4ea1dc5e0cadea8894d956758a800c36ad870ac2` | closed_final_behavior | 0 |
| 43 | `6b96c54b1769743cfded773928104d7bfe460c2b` | closed_selective_with_evidence_limits | 1 |
| 44 | `cb3bee033ba853041609b874303dc625d5d30479` | not_migrated_docs_provenance | 0 |


## Final behavior and accounting

- All 16 source-difference clusters are closed. D01/D04 deliberately preserve upstream per-unit soft-delete/restore/shred/swipe and single-message substring semantics; no old dependent-result batch expansion or legacy deletion API.
- P09 covers only successful nonempty after-commit notification for `deleteLastMessages`, `deleteMessage`, `applyMessageEdits`, including their existing version/swipe results. A universal context-edit/recovery producer protocol is out of selected scope, not unfinished P09.
- V01/V02 remaining composed scenarios are implemented/component-covered acceptance with explicitly unexecuted exact combinations. No 23-unit implementation expansion. V03 retains accepted Google text/image converter plus canonical-accounting proof, not full system/tool/all-provider wire or actual cache hits.
- D03 excludes cosmetic helper/type/cast/old-paragraph/released-changelog cleanup. Retain `appendTrailingEntries`: a real charge-identity consumer exists and public external callers are unknown. Inherited source-regex XSS tests and the skipped cloud first-user-pinned assertion remain superseded maintenance, not runtime proof or new product work.
- U01 actual unknown-model → availability snapshot → post-auth consumer → real Session/default settings/model-change proof is final `326c0d9c0`, tested `60c7d5b36`. U03 different-path saved/discovered collision is final `f8e7b1742`, tested `cd85792fb`; grammar is independently closed. Offline auth/background-refresh seams do not prove OAuth, full UI or disk-reopened settings.
- U02 is a final no-direct-replay, evidence-limited merge-container disposition. Its bounded corrected model/composer/flags/export/skill subitems and conservative remaining ranges are recorded. Whole 196-path/own-overlay hunk equivalence is not claimed; `audit-merge-coding.diff` was not reopened.
- Preserve agent harness/experimental/node exports and complete chat-template/multimodal/tool-schema counting. No text-only downgrade. Encoded `%7B`/`%7D` endpoint rejection is not claimed.

## Exact integrity and review corrections

Canonical audit checks **44 unique SHAs/numbers, 313 normalized behavior keys and 307 native-schema raw keys**. Bidirectional comparison includes every decision field, including raw-only `evidence`, proof/tests/limits, not just source/status. There are **0 field mismatches, 0 conflicting native aliases, 0 invalid cluster references**. Explicit null is compared by property presence, not nullish fallback. Initial 38 parity discrepancies were comparator false positives; subsequent broader audit found and replaced 13 stale raw evidence values, with originals retained in the repair log. Nine additional raw-only decision fields were promoted losslessly.

All reported stale current-source negatives were replaced by exact current source/review decisions: copied usage, callback export, busy guards, resume hint, safe-tail, projected SDK deletion, fullscreen, early role guard, physical overlays, projected custom-message copy, composite save guidance, completed P06/P08 integration and scheduler dependency reference. Final source/accounting reviewers initially found metadata inconsistencies; all findings were repaired. Actual read-back repair results are `correct` with empty findings; neither reviewer executed commands or runtime. No initial incorrect verdict was relabeled or hidden.

**80 commit references exist**; **42 distinct selected-unit commits include a review document in the same commit**. All 749 protected files match the recovery-only SHA256 snapshot. The original pre-migration protection manifest and disposition ledger were lost; recovery evidence does not recreate them. Graph devices fail initialization with the recorded WeakMap error; no graph generation/coverage completeness claim.

Code review: skipped (ce-code-review unavailable). Native bounded reviews are supplemental, not CE/cross-model receipts.

## Actual final verification

- Focused U01 authentication/catalog owners: **62 passed / 2 files, 3.37s**.
- Prior U01 isolated root `./test.sh`: **8769 passed / 0 failed / 915 skipped, 112.77s**, `artifact://5427`, on fixed committed source/test tree **`60c7d5b36`**.
- Review-only amended U01 commit **`326c0d9c0`** has identical non-review source/test/guide blobs; the aggregate is not attributed to the amended SHA.
- Final source-tree `npm run check`: **1770 files / No fixes applied, 12.53s**; all stages passed. No production/test/guide edits followed that run.
- Final authoritative isolated root `./test.sh` on committed **`d5ba0b8a8`**, including the pre-amend final disposition document: **8769 passed / 0 failed / 915 skipped, 96.23s**, `artifact://5480`. No source/test/guide/document edits occurred during the run. The normal final-document hook passed **1770 files / No fixes applied, 11.95s**. This following review-only amendment adds the portable 44-row table and exact receipt; `d5ba0b8a8` remains the actual tested tree, not the amended SHA. No production/test/guide bytes change.

## Durable audit artifacts

Machine-local root: `/Users/nex/.local/state/pi-selective-migration`.

- `candidate-disposition-current.json` and `.md`: complete final candidate/behavior decisions, rendered from persisted corrected JSON and read back.
- `final-integrity-audit.json`, `final-exact-disposition-change-log.json`, `final-raw-evidence-repairs.json`, `final-raw-extra-field-reconciliation.json`: exact integrity and correction trail; pre-final snapshot retained.
- `final-source-review-result.json`, `final-accounting-review-result.json`: actual final repair verdict payloads.
- `final-continuation-evidence-review.json`, `final-local-verification-review.json`: lossless component/optional/evidence boundaries, not new execution receipts.
- `first-auth-default-selection-receipt.json`, `saved-skill-name-collision-receipt.json`, `recovered-ledger.json`: final local units and closure ledger.

The complete machine-local behavior audit is not portable repository content. This committed review freezes all 44 candidate SHAs/dispositions/limit counts plus fixed coordinates, outcome and named limit families; losing local state does not lose the candidate-level conclusions. Individual implementation reviews remain with their commits.
