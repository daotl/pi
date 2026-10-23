# Review: projection-aware SDK tail deletion with checkpoint retention

## Problem and final source chain

P01 reconciles candidates #5 `92d3171664cdd8fd4e5c67b38d49332a071043a3`, #6 `e1f9cdc22ecbc3b690625b44ea3aa934592eef79`, and final checkpoint-retention refinement #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45`. The final #25 patch selects canonical projection source IDs, preserves crossed compaction/state entries, reconnects them before descendant expansion and rebases each surviving checkpoint against its own original branch. Earlier raw-scan/intermediate deletion variants are not replayed.

Current SDK `SessionManager.removeLastMessages` counted raw messages, including system policies, omitted messages and raw rather than projected harness content. Deleting a retained message before its compaction removed the checkpoint and its state/descendants, exposing earlier raw history or removing surviving sibling checkpoints. Current CLI `/delete` and `/shred` use separate deletable units; their semantics remain unchanged.

## Change and publication boundary

Count only projected contributions owned by message entries, excluding raw system owners and projected empty harness assistants. Source IDs map those contributions back onto the active raw path. An explicit no-crossed-compaction path retains destructive suffix deletion with no retained-state Map. A crossed checkpoint path removes non-system tail messages and their labels/context edits, reconnects retained checkpoint/system/metadata entries, expands descendants using those staged parents, then remaps removed firstKeptEntryId boundaries on each checkpoint's original branch.

Private `_deleteMessageSubtrees` is shared by the two paths. Staged parent/boundary records are copies; held source objects remain unchanged. Existing `_commitEntries` rewrites before publishing entries/indexes/selected leaf. Public API signature, soft-delete/restore, swipe, ordinary surgical removal and CLI unit contracts are unchanged. AgentSession comment and sessions guide describe the SDK-only contract.

## Valid RED, fixture analysis and runtime verification

Before product edits the new existing-owner cases yielded **9 failed / 11 passed, 1.06s**:

- Omitted raw tail: expected empty projected transcript and removed visible source; received the still-visible user message. The test did not expect the buggy hidden-tail deletion.
- Two projected-harness directions: raw empty aborted response replaced by real content must count; raw real response projected empty must not count.
- Trailing system policy must not consume the count; it is still part of destructive suffix removal when no checkpoint is crossed.
- Counts 1, 2 and oversized 99 after compaction must remove only the two retained projected messages, preserve policies/checkpoint/state/bookmark and unrelated sibling history, with exact expected retained content after reopening.
- A sibling checkpoint must survive retained-boundary deletion and rebase on its own original branch, not the selected branch.
- Rename-failure state/bytes/held-identity/reopen assertions already passed before the fix; the final case failed at successful retry's raw count (3 versus projected 2). This is not evidence of a pre-existing atomic-write defect. It protects staged rebasing against premature publication after this change.

No fixture assumptions were invalidated in this nine-case matrix. An advisory calling the first expected value wrong contradicted the observed expected-empty/received-visible output and was not adopted. A preliminary implementation shared generalized descendant logic for both paths; before final proof it was changed to retain the explicit no-checkpoint fast path from the frozen source.

Pre-review post-format focused owner and actual SDK lifecycle consumers: **124 passed / 9 files, 7.30s**. They run source-aliased production SessionManager/AgentSession, real persistent file writes, rename fault injection/retry and actual reopen, plus continuation/prefill/selected-policy consumers. Earlier six-file owners passed **97 / 6, 5.20s** after formatting. Pre-review check **1766 / No fixes applied, 16.61s**; prior formatting check passed but fixed two owned files (**13.60s**). No standalone smoke, full interactive Enter, provider network, crash durability or exhaustive malformed-graph proof is claimed. No extra loader/scripts were created.

## Independent review and delivery

Code review: skipped (ce-code-review unavailable). Native bounded source/proof reviews are supplemental, not portable CE or cross-model receipts. Results follow actual delivery.

Owned manager source, AgentSession comment, existing removal test, sessions guide and this review only. No branch/worktree/push, dependencies, generated catalog or changelog changes. Normal explicit-path implementation commit precedes committed-tree root aggregate. Review-only amendment records actual tested SHA separately and preserves product blobs. Full 44-candidate migration remains open.

### Review finding and repair

ProjectedTailSourceReview found one actionable adaptation defect retained by the frozen algorithm: a physically retained but soft-deleted checkpoint could be chosen as the next firstKeptEntryId. `buildContextEntries` filters that checkpoint out, misses the rebased boundary and revives summarized raw history. A minimal persistent regression (old raw user → retained user → hidden checkpoint → visible checkpoint) reproduced this before repair: **1 failed / 20 skipped, 1.39s**, received the old raw question after deletion instead of only the visible summary. Rebase now skips `deletedAt` candidates as well as physically removed IDs. The test verifies summary-only live and reopened context, self boundary and the retained hidden marker. This extends the final backup adaptation only to preserve current upstream soft-delete semantics; no hidden-checkpoint resurrection is accepted.

After repair the complete owner/lifecycle selection passed **125 / 9 files, 8.42s**; full check **1766 / No fixes applied, 20.89s**. Earlier 124/9 proof applies to the pre-review tree, not this final tree. ProjectedTailProofReview found no defects in the original nine-case matrix and confirmed its expected-empty omission oracle was valid; that review executed no checks. Source review's delivered follow-up verified the finding repair.

ProjectedTailSourceReview's bounded follow-up confirmed the reported defect is repaired and found no further actionable issues: visible-path predicate and persistent pre/post/reopen oracle match. It ran no tests/checks/commands or edits. Protection was checked against the recovery-only snapshot: **749 / zero mismatches**; this is not the lost original pre-migration manifest.

ProjectedTailProofReview's final bounded addendum found no actionable issues in the tenth hidden-boundary fixture or repaired predicate, and confirmed the guide's harness-empty wording. It performed source/document reads only. After guide wording and stale review tense were corrected, the same nine-file focused selection passed **125 / 9, 25.14s**; normal amend hook checked **1766 / No fixes applied, 16.42s**, producing corrected committed tree `65f64a824`. The earlier root run started on `7c9a5aa7b` returned **8627 / 0 / 936, 109.96s**, `artifact://4497`, but guide/review edits happened during that run; it is explicitly superseded and is not the final fixed-tree receipt. The fresh aggregate on `65f64a824` completed as recorded below, with no subsequent source/test/guide changes.

## Fixed committed source/test/guide aggregate

Root `rtk proxy ./test.sh` on corrected committed source/test/guide tree `65f64a824` passed **8627 passed / 0 failed / 936 skipped**, exit 0, **112.75s**, full output `artifact://4503`. During execution only this independent review received an addendum; product source, tests and sessions guide remained unchanged. The following normal review-only amendment preserves those blobs and records this aggregate against `65f64a824`, not the future final SHA. Both bounded native reviews and their hidden-boundary repair follow-ups are complete; P01 is closed after canonical receipt synchronization, not the full 44-candidate migration.
