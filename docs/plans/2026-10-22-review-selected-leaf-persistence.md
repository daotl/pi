# Review: persist destructive mutation's selected leaf without changing history identity

Date: 2026-10-22
Parent: `68b8664a7`.
Source chain: `243015b85e9159c785bdfa09053bb9eac12aab74` adds durable selected-leaf outcomes to staged mutations; `7cfc4563ad539607c1f02ef56bd76b38d5fcacf5` completes persist-before-publication; `a820049ee4ff71fb8f35dd62c386181dce6e9222` reuses transactions for recovery; `39ad8ad45dde2c9fe1939d578c2c0ce22aa2ad2d` requires atomic selected-set deletion. Final backup `cb3bee033ba853041609b874303dc625d5d30479`, SessionManager1888–1942. This unit covers successful selection persistence and destructive staging only, not mixed edit/add/version transactions or old permanent-delete product semantics.

## Problem and RED

The loader selected the final physical tree entry. A destructive rewrite could select an empty branch or retained ancestor correctly in memory while leaving another branch last in the file. Reopening silently changed the next request's context.

Five file-backed regressions failed before edits: removeMessage/removeEntriesWithDescendants/removeLastMessages selected empty in memory but reopened a retained root; subtree/last removal selected an ancestor in memory but reopened a later sibling. Assertions inspect actual reopened context and leaf, not serialized source text.

The first adaptation followed the backup's non-tail leaf clone. Current upstream's existing rollback owner then failed: successful descendant removal must preserve the original surviving ancestor ID. Marking that ancestor superseded to hide a clone would also globally change swipe alternatives. That approach was removed, not hidden by changing the assertion. No clone, supersession or swipe-reclassification workaround remains.

Four malformed/stale-marker regressions then failed against the initial private loader: missing value, number, object and nonexistent ID could replace the live selected ID and hide retained context. `_buildIndex` now accepts only null or a string referring to an entry already indexed before that marker; invalid markers remain hidden bookkeeping and leave the last valid selection unchanged. This is boundary validation of the newly introduced private record, not broad session-file validation.

## Final adaptation and compatibility

- Preserve the authored file-only checkpoint mechanism but extend its private leaf value to `string | null`. This records the selected original ancestor rather than duplicating its tree entry. No header override or earlier header-based proposal is used.
- Private `StoredFileEntry` includes `LeafCheckpoint`; public `FileEntry` and `SessionEntry` remain unchanged. Internal loader/index applies selection records in physical order. A later appended tree entry supersedes the earlier marker naturally.
- Public `loadEntriesFromFile`, `parseSessionEntries`, `getEntries`, entry counts, tree, context, totals and current-branch JSONL export exclude bookkeeping. Raw session-file import and full-history fork retain it. Existing files without records keep their physical-tail loading behavior.
- `_commitEntries` drops superseded selection markers, builds entries/index/labels and stages the current selection only when it differs from the retained physical tail (or explicitly empty with retained history). Atomic rewrite must succeed before publication.
- Tail/subtree removal now stages retained entries and local leaf instead of mutating live indexes then rolling back. Surgical selected removal stages its new tail, local IDs and source supersession map; only a successful rewrite publishes them. Existing branch-local reference remapping, deleted-tool metadata and transitive charge identity are retained.
- Metadata-only soft-delete/restore and ordinary replacement retain their existing rewrite paths. They do not create selection clones or broaden this transaction scope. Their rewrites preserve previously stored markers. Standalone branch/reset remain memory-only; this unit persists a destructive mutation's resulting selection.
- Existing original ancestor IDs, labels, siblings, soft-delete/restore/shred and id0 swipe semantics are preserved. No unrelated branchWithSummary staging change.

The complete pre-edit manager file was read in chunks, including migrations, projection, loader, constructor, persistence, all mutation methods, branch/fork/list/import consumers. LSP found 31 FileEntry references before the private separation. Graph project/generation/coverage remains unavailable due to reported WeakMap initialization failure; exact source/LSP fallback, no exhaustive graph claim.

## Verification

- Five original RED rows pass with original ancestor identity preserved.
- Two private-boundary rows exercise empty/ancestor selection, public parsers/history/counts/tree, branch export, raw-file import/fork and subsequent soft-delete/restore rewrite.
- Eight actual filesystem stages: empty/ancestor × write/fsync/close/rename. At the fault callback, live leaf, entries, tree, projection and every held source identity remain unchanged. After failure bytes remain unchanged; retry/reopen agrees. Existing rollback/reference/continuation suites remain active.
- First clone adaptation: **one failed / 78 passed / six files**, original ancestor ID mismatch. Private marker adaptation: **79 passed / six files**. Public loader/fork/import owners: **75 passed / five files**. With storage faults: **89 passed / six files**.
- Broad final storage/swipe/soft-delete/continuation/usage/export owners: **206 passed / sixteen files**.
- Check chronology: **1746 files, Fixed 2**, then **1746 files, Fixed 1**, both passed including browser smoke. Formatting results are not claimed as no-fix checks.
- Final check passed **1746 files, No fixes applied**, including browser smoke. Protected user artifacts verified **749 SHA256 / zero mismatches**.
- After malformed/stale-marker guard: **210 passed / sixteen files**; check **1746 files, Fixed 1**. Final no-fix check then passed **1746 files, No fixes applied**, including browser smoke; post-format selected-leaf/rewrite owners **39 passed / two files**. Protected hashes rechecked **749 / zero mismatches**. Storage reviewer source reassessment closed its P2 with no remaining actionable findings.

Committed fixed source/test tree `60a55fd72` root `rtk proxy ./test.sh`: **8312 passed / 0 failed / 945 skipped**, exit 0, **172.24 seconds**, full output `artifact://3017`. Normal commit hooks passed **1746 files, No fixes applied**. No next-unit source/test edits occurred during this run; the immediate amendment changes only this review evidence. Protected user artifacts: **749 SHA256 / zero mismatches**.

SelectionMutationAudit returned correct/no actionable findings for its bounded source review. SelectionStorageAudit's initial review was correct, then its boundary follow-up identified the malformed-marker issue above and confirmed the narrow guard policy. Neither ran checks/tests. The new eight-stage fault matrix directly targets destructive tail/subtree removal; surgical-removal staging is additionally source-reviewed and exercised by existing regression owners. FS fault mocks reset during each setup so a prior failed case cannot contaminate subsequent fixtures.

Native Node with repository source resolver and actual SessionManager/file storage: selected ancestor ID survived reopening, retained sibling stayed stored but not selected, empty root reopened empty, public history hid the marker, raw fork/import retained selection. Output: `{"selectedAncestorIdPreserved":true,"reopenedSiblingNotSelected":true,"emptyRootReopened":true,"privateMarkerHidden":true,"rawForkImportPreserved":true}`. Temporary smoke removed. No visual UI claim.

## Limits

This private extension is required by current upstream identity/swipe contracts; it is an adaptation of final selected-leaf behavior, not an exact old-file transplant. Public parser output intentionally carries history, not storage selection; callers needing a persisted selected branch open it through SessionManager. No standalone navigation durability, mixed edit transaction, compaction grouping/budget, saved loadout or tokenizer policy migration. Changelog unchanged on crystal. Parent aggregate8293/0/945 on sourcecb0efc3c8 is not this unit's evidence; its committed-tree aggregate is recorded separately.
