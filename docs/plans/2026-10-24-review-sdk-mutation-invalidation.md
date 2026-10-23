# Review: after-commit invalidation for three SDK mutation APIs

## Frozen source and scope

P09 from candidate #23 `243015b85e9159c785bdfa09053bb9eac12aab74`, patch `audit-patches/...diff:1176,1297-1319,4630-4678`. Only `deleteLastMessages`, `deleteMessage` and `applyMessageEdits` gain successful nonempty `transcript_changed` notifications. The initial drafted matrix included unrelated APIs; it was narrowed before execution or production edits. No soft-delete/shred/restore/swipe-navigation API notification expansion. Existing CLI handlers already redraw; no claim ordinary CLI deletion was necessarily stale.

Emit after each method's existing durable mutation and live-state refresh. These refresh paths differ by method; this change does not add or guarantee a uniform selected-policy restoration step. applyMessageEdits includes current edited/added/versioned/swiped results rather than the backup's obsolete replacements/additions-only guard. Preserve id0 new-version semantics, in-place swipe timestamp semantics, selected-leaf persistence and busy guards. No changes to storage transaction design, model dispatch, UI event protocol or existing state restoration ordering.

## Consumer proof

New suite owner uses initialized real InteractiveMode/SessionRuntime/xterm and file-backed SessionManager with two assistant versions. Six outcomes cover the three APIs: tail deletion, single deletion, replacement, addition, id0 version, and in-place pi_swipe edit. Actual API calls—not CLI handler redraws—must refresh the attached UI. Each event snapshot records current live text, independently reopened committed disk text and selected leaf; expected text is explicit and output checks each label once while excluded versions stay absent. Terminal assertions prove expected label presence, not physical-terminal order/multiplicity.

Every scenario first injects one rename failure at the actual atomic publication seam, requires that failure, and asserts zero events, unchanged file bytes/live messages/UI. A subsequent successful retry yields one matching live/disk snapshot and current UI. This ran successfully for all six paths, including all applyMessageEdits forms through its outer atomic edit transaction; no assumption that arbitrary APIs share a rename seam. No-op count/missing ID/non-edit input and invalid edit target emit no further event.

Current-source RED **6 failed / 0 passed, 3.68s**: each passed its storage-failure controls then lacked the successful publication snapshot. These are six outcomes of three APIs, not six or thirteen API claims. Final post-format focused **111 passed / 6 files, 7.55s**: transcript-mutations, message-edit-transaction, selected-branch-policy, live-projection-transcript, agent-session-message-edit and agent-session-continue-prefill. Full check after documentation wording correction **1769 files / No fixes applied, 11.94s**. Earlier checks formatted the new test; final proof follows formatting. No paid APIs/network.

## Review, limits and delivery

Code review: skipped (ce-code-review unavailable). Both supplemental bounded native source/proof reviews report no actionable findings; neither executed tests or independently confirmed timings. These are not CE/cross-model receipts. No universal mutation notifications, dependency-result boundary redesign, every storage fault stage, subscriber-thrown exception atomicity, physical terminal or second resumed interactive UI claim. Broader deletion/restoration/navigation and context_edit/recovery producer decisions remain separately accountable, not silently closed by P09.

Owned paths: AgentSession, new transcript-mutations suite owner, SDK guide and this review. No changelog on crystal. Normal explicit-path commit precedes fixed committed-tree aggregate; review-only amendment records the actual tested SHA separately. Overall 44-candidate migration remains open.

## Fixed committed-tree aggregate

Normal implementation commit `0461cdcda` contains all four owned paths; hook **1769 files / No fixes applied, 12.48s**. Isolated root `./test.sh` on that fixed source/test/guide tree: **8696 passed / 0 failed / 936 skipped, 97.25s**, `artifact://4893`. No product path changed during aggregate. The following review-only amendment records the receipt; tested SHA remains `0461cdcda`, not the amended SHA. Recovery-only snapshot check: **749 files / 0 mismatches**; original manifest remains unavailable.

