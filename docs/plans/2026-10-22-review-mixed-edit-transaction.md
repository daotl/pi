# Review: publish mixed edits, versions, additions and swipe edits as one history transaction

Date: 2026-10-22
Parent: `8fbb32508`.
Source chain: `243015b85e9159c785bdfa09053bb9eac12aab74` stages mutation publication; `3891c85a2d698b87546873ddc42f3d400406db13` combines replacements and ordered additions; `7cfc4563ad539607c1f02ef56bd76b38d5fcacf5` requires persistence before live publication; `39ad8ad45dde2c9fe1939d578c2c0ce22aa2ad2d` closes partial selected-set changes. Final backup `cb3bee033ba853041609b874303dc625d5d30479`, manager1958–2110. Current upstream id0 version creation/pi_swipe behavior is intentionally retained, so the old replacement-only Session implementation is not transplanted.

## Problem and RED

`applyMessageEdits()` performed version creation, replacements, additions and swipe edits as separate live mutations. A later validation or storage failure left earlier history changes durable while the public transcript could remain stale.

Observed real RED:

- An append fault on the initial id0 version left entries unchanged but moved the selected leaf to the version anchor.
- A stale later swipe timestamp failed only after replacement/version/addition had already published (eight entries versus the original four, with changed supersession metadata).
- A separate nonzero replacement plus addition case persisted the replacement tail before the later addition append failed.

Those failures are distinct causal paths, not three names for the same syscall. Once the whole batch became a single rewrite, regression injection moved to its actual write/fsync/close/rename boundary rather than pinning obsolete append wiring.

Independent reviews identified a draft integration regression: a non-current swipe changed the committed branch but no longer restored that branch's active tools. A realistic public branch fixture failed with runtime tools `read` instead of the selected branch's `bash`. A first fixture failed before reaching the changed path because regeneration itself restores the anchor tools; that was corrected, not counted as production RED. Successful batches now record whether any swipe navigated, then restore the final branch's runtime loadout and base prompt/options only after commit. This restoration is runtime-only, avoiding an extra snapshot append after atomic publication; other public navigation keeps its existing behavior. A later file-backed fixture had to retain the sibling at the original anchor because persisted regeneration can insert a prompt snapshot there. Its final form arms all append writes to fail during edit and still verifies successful branch tools and reopened context.

## Adaptation

- `SessionManager.editMessages()` builds an in-memory draft using a deep clone of stored records, including private selection bookkeeping. Its indexes, selected leaf and summary setting start from the current manager.
- The synchronous callback applies existing edit operations to that isolated manager. No live manager swapping, provider dispatch, extension hooks or intermediate transcript publication.
- After successful draft execution, unchanged records with equal original IDs reuse their original objects; changed/new records remain isolated. The complete draft tree and selection publish through existing atomic `_commitEntries` only after durable rewrite succeeds.
- `AgentSession` retains its original edit ordering and result counts: snapshot positive IDs, id0 versions first, nonzero replacements, ordered negative additions, then swipe edits. Root id0 fallback stays replacement; noncurrent swipe still follows its latest descendant branch; timestamps and version ordering remain unchanged.
- Internal swipe-group/select/message-suffix helpers accept the draft manager. Public navigation remains a live refresh/tool-restoration operation; batch preparation performs neither. Final transcript refresh and conditional runtime-only branch tool restoration occur after commit, with no extra persistence operation or last-persisted prompt marker update.
- Existing soft deletion, tool-call result invalidation, clone-local references and logical charge identities remain in the reused manager methods. No legacy permanent-delete cutover or saved prompt/loadout behavior change.

## Verification

Initial public regressions: two failures (anchor leaf change and stale-swipe partial publication), then a separately proven nonzero replacement/add failure. First integration: **157 passed / eight files**. Expanded ten-row transaction suite plus existing edit/swipe/soft-delete/rewrite/selection/lexical owners: **164 passed / eight files**.

The eight storage rows cover replacement/add and version/add × write/fsync/close/rename. Fault callbacks inspect current manager entries, held source identities, tree, leaf and public transcript before throwing; bytes and reopened history remain unchanged afterward, and retry publishes the intended complete result. The stale-swipe row verifies no earlier change publishes. The two-swipe success row checks original version positions/timestamps, selected version, historical answer content and unchanged logical charge totals after reopen.

Initial check passed **1747 files, Fixed 2**, but emitted one template-style info; the fixture expression was corrected rather than ignored. Next check passed **1747 files, Fixed 1** without that info. These formatting runs are not final no-fix claims. TypeScript initially had stale new-method diagnostics; service reload returned OK. Public LSP references checked: applyMessageEdits34 and getSwipeGroup52; public method signatures remain unchanged.

Broader pre-audit owners passed **225 / thirteen files**. After branch-loadout correction, edit/swipe owners passed **102 / three files**. Both MixedEditStorageAudit and MixedEditSessionAudit found the same loadout regression; final Session review confirmed applied conditional runtime-only restoration with no additional actionable finding. Neither review ran tests/checks; they are static evidence, not independent runtime results.

Final applied branch-restoration owners: **226 passed / thirteen files**. Check passed **1747 files, Fixed 1**, then final check **1747 files, No fixes applied**, including browser smoke. Post-format batch/swipe owners **29 passed / two files**. Both source reviewers' final applied reassessments returned correct/no remaining actionable findings. Protected user artifacts **749 SHA256 / zero mismatches**.

Committed fixed source/test tree `a6434caf4` root `rtk proxy ./test.sh`: **8332 passed / 0 failed / 936 skipped**, exit 0, **84.52 seconds**, full output `artifact://3108`. Normal commit hooks passed **1747 files, No fixes applied**. No next-unit source/test edits occurred; immediate amendment changes only this review evidence. Protected artifacts **749 SHA256 / zero mismatches**.

Native Node actual SDK/DefaultResourceLoader/file-backed manager smoke injected a builtin rename failure and observed original bytes, entries and selected leaf while the syscall failed. After restoring storage, a batch containing replacement + id0 version + addition returned `{edited:1,added:1,versioned:1,swiped:0}` and reopening yielded exactly `changed question`, `new version`, `added input`. Output: `{"actualSDK":true,"renameFailurePreservesBytesAndSelection":true,"result":{"edited":1,"added":1,"versioned":1,"swiped":0},"reopenedTexts":["changed question","new version","added input"]}`. Builtin exports restored and temporary smoke removed. No paid API or visual UI claim.

## Limits

The manager callback is a synchronous edit boundary, not a general asynchronous transaction or an arbitrary runtime-operation sandbox. No navigation durability, effective prompt restore, tokenizer policy, branch-summary budgeting or TUI rendering migration. Changelog unchanged on crystal. Parent aggregate8321/0/936 on sourcef761b243d is not this unit's evidence. Graph project/generation/coverage unavailable due to reported WeakMap initialization failure; exact source/LSP fallback.
