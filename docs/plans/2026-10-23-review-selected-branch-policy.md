# Selected branch effective policy review

## Scope and sources

Parent `02b295b1c`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`, backup `cb3bee033ba853041609b874303dc625d5d30479`. S4 final branch reconciliation reference: backup AgentSession 2580-2596, authored repair chain through `a820049ee4ff71fb8f35dd62c386181dce6e9222` and `65007d6c75cb16d08fbe47934e923bc53abaea1b`. Preserve current swipe/id0/soft-delete/restore/shred and mixed-edit single-publication semantics, not old whole files.

## Problem and implementation

Navigation restored messages/tools but left prompt construction, skills and context from the abandoned path. A new helper clears inherited runtime resource state and run-only options, enables selected snapshot restoration, restores tools without intermediate persistence, rebuilds the selected effective prompt, and finalizes the snapshot. Tree/swipe navigation, regeneration preparation, id0 versions and navigated mixed swipe batches use it. Physical tail removal reconciles the retained path too.

Mixed edits and regeneration preparation are runtime-only: no second append after the atomic edit publication and no new snapshot at the regeneration anchor. The untrusted defer flag preserves that suppression with OR assignment instead of replacing it. Explicit in-memory updates now retain snapshots, while an empty in-memory startup still has no invisible anchor.

A legitimate system-policy patch before regeneration changes the physical parent of the new assistant. Assistant swipe grouping now skips only system_prompt and role=system ancestors; user-version anchors remain physical. Sibling expansion, selection, deleted-version listing and restore use this logical anchor consistently. Actual assistant subtrees remain disjoint, preserving shred behavior without reparenting history or moving policy.

## Reproduction and verification

- Initial real tree switch in memory/file: **2 failed**, bg_863, B policy remained on A. Added same real loader with changed skill/context disk files and actual provider requests.
- Initial memory snapshots created an unwanted root anchor: existing swipe root regression failed bg_864; retained empty-memory startup behavior with explicit-update snapshot ownership.
- Physical tail deletion leaked idle policy: **1 failed**, bg_865; helper now restores retained snapshot.
- Development untrusted mixed fixture exposed a second append after committed edit (**1 failed / 11 passed**, bg_867); OR defer suppression fixed it. That direct-toggle fixture was discarded. A later SDK version passed 18 tests (bg_892) but was also removed to keep atomic coverage bounded to its original trusted case; independent real untrusted SDK regeneration supplies lifecycle proof. The second-append fix also has source-backed bounded review, not a claim that the removed fixture is final proof.
- Regeneration policy split previous versions: RED bg_872; merely runtime-only prepare still RED bg_873. Logical assistant anchors fixed grouping; **35 passed / 3 files**, bg_875 including delete/restore/shred lifecycle.
- id0 new version inherited old snapshot but live getter leaked later idle policy: **1 failed**, bg_876; runtime-only selected reconciliation fixes it.
- Regeneration regression was strengthened to actual untrusted SDK file reopen, with original session disposed before reopening. It asserts prepare keeps the original anchor, both versions remain selectable, and group delete/restore/shred stay coherent. Earlier direct trust-toggle fixture was only development chronology, not final lifecycle proof.
- Final broad matrix **203 passed / 11 files**, bg_883, 8.36s: selected state, mixed edits, swipe, message edits, durable prefill failure/publication, restored prompt/skills, update transactions, boundaries and untrusted summaries.
- Native Node SDK smoke: actual selected getter/provider policy A after B, reopened snapshot A; all assertions true, bg_882, 0.57s. Script removed.
- Latest full check **1750 files, Fixed 1 file**, bg_884, 10.78s; all dependency/type/browser-smoke gates passed. Earlier type narrowing error was fixed; formatting is not mislabeled no-fix.
- Protected daemon target manifest: **749 paths, zero SHA256 mismatches**.

## Independent review and limits

SelectedBranchAtomicAudit found the untrusted post-publication append and regeneration grouping defect; both reproduced and fixed. Final bounded rereview found no remaining concrete grouping/removal/atomic-publication defect. SelectedBranchStateAudit rereview found helper/tree/id0 state restoration correct within scope. Both read-only, no tests run.

No UI inventory/completion/closure refresh claim. Soft deletion intentionally retains the selected durable policy path; physical tail removal has different semantics. Empty-root and extension-discovery permutations are not exhaustively covered. Graph project/generation/coverage unavailable (WeakMap initializer failure), exact source fallback used. Whole 44-commit migration remains open. Fixed committed-tree aggregate follows normal commit.

Final post-format matrix: **203 passed / 11 files**, bg_885, 8.30s. Final full check: **1750 files, No fixes applied**, bg_886, 10.82s; all gates passed. Both reviewer final outputs were reread directly: bounded correct, empty findings; no outstanding helper rollback finding. The following normal unit commit is followed by a fixed-tree isolated aggregate before another source unit starts.

The final amendment restores mixed-edit regression to its original trusted single case and removes experimental trust setup/imports. No production source changes in this amendment. Verification and aggregate below supersede prior test-tree counts for final accounting.

Simplified final fixture matrix **35 passed / 3 files**, bg_893, 3.50s; full check **1750 files, Fixed 1 file**, bg_894, 10.92s, all gates passed. Normal amendment hook verifies the formatted tree before the isolated aggregate.

## Fixed committed-tree aggregate

Source/test commit **b428a8486**, root isolated test.sh: **8387 passed / 0 failed / 936 skipped**, exit 0, **90.21s**, bg_896, artifact://3333. Normal amendment hook before the run passed **1750 files, No fixes applied** (bg_895). No source/test edits occurred during this aggregate. Protected manifest reconfirmed 749 paths, zero mismatches. The following amendment is review-only.
