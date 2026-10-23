# Review: reject deletion and restoration while Session history is owned

## Problem and final source chain

Parent `7aa5b5f80`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Candidates #11 `778e0120721a2978abedd9ce60f945427f5c9ee2` and #13 `aecd44347d2ada4e38b44f0fd8006bd881ae0872` establish deletion exclusion during agent runs and compaction/branch summarization. Final backup deleteLastMessages1949-1955 and deleteMessages1980-1985 contain these guards. The old batch API and permanent /delete command are not restored.

Current upstream adds soft-delete/shred/restore and swipe-version mutations. CLI-only streaming checks do not protect SDK callers or compaction. Deleting an existing selected message during a held stream or actual summary hook can rewrite history while its owner still relies on the old context.

## Adapted bounded scope

One synchronous private guard checks isStreaming then isCompacting. Nine public deletion/restoration entrypoints call it first: deleteLastMessages, deleteMessage, softDeleteLastMessages, softDeleteMessage, shredLastMessages, restoreDeletedMessages, deleteSwipeVersions, shredSwipeVersions and restoreSwipeVersions. It runs before selection/no-op decisions and before any mutation. Busy rejection is intentionally consistent across this history-mutating family. Idle semantics remain.

Do not guard goToSwipeVersion, prepareSwipeRegeneration or regenerateSwipe in this unit; navigation/regeneration have distinct lifecycle contracts. Existing applyMessageEdits already owns its separate busy guard. No selected-tool dependency redesign, cross-operation transaction, transcript notification or scheduler change.

## Evidence and discarded fixture

An initial 33-row test mixed deletion with no-op restoration/navigation and both hook registrations. Its 33 failures are **not valid RED evidence** and are not credited. The file was wholly replaced before production edits with meaningful existing-target fixtures: deleteMessage and softDeleteMessage, each against real held stream/manual compaction/tree-summary ownership; only the relevant owner hook is registered.

- Valid RED: **6 failed / 3.05s**. Each target was an active, non-deleted assistant entry with verified content. The mutation failed to reject; no claim of final on-disk corruption is made from that assertion.
- Guard plus existing idle-success soft-delete/swipe/continuation/selected-policy owners: **47 passed / 5 files / 4.47s**. The six new cases assert rejection, unchanged entries/leaf/messages/events, then owner completion or normal cancellation and successful deletion of the same target after idle. Existing suites own the remaining mutators' meaningful idle behavior.
- First full check **1766 / Fixed 2 / 14.52s** passed, formatting the owned source/new test. Later owner-completion and cleanup refinements were independently rerun; those earlier results are not final-tree evidence.
- Final cleanup only ends the owned stream if owner=stream and the Session is still streaming; outcome is observed in finally without replacing the original assertion error. Final focused result **47 passed / 5 files / 4.72s**; full check **1766 / No fixes applied / 13.46s**.

Runtime evidence is actual AgentSession/provider-held stream and real compaction/tree hooks via the existing faux harness, not mocked busy flags. No standalone SDK smoke, full interactive Enter, physical terminal, file-backed mutation-failure matrix or automatic-compaction trigger proof is claimed. The permanent fixtures exercise the changed runtime path directly; source review verifies all nine first-line guard uses without source-text or forwarding tests. Guard-only tests would merely restate the implementation and were not added.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host exposes skill reads but no skill invocation primitive; independent bounded native source/proof review is supplemental, not portable CE or cross-model coverage. Results follow actual delivery.

Source/new owned test/sessions guide and this independent review only. No unrelated branch/worktree/push, dependency/lock/generated/changelog change. Normal explicit-path commit precedes fixed-tree root aggregate; review-only amendment then records exact tested/final SHA without changing product blobs. Full 44-candidate migration remains open.

HistoryGuardSourceReview and HistoryGuardProofReview completed bounded read-only source/proof review with **no actionable findings**. They confirmed all nine first-line guards and no intentional active-run internal callers, unchanged recovery/navigation/regeneration paths, meaningful selected-target runtime fixtures, safe cleanup and existing idle controls. Proof review noted the compact fixture only asserted an Error; a final assertion now verifies compaction_end aborted:true with no errorMessage. Production is unchanged. Post-format owners again **47 passed / 5 files / 4.47s**; final full check **1766 / No fixes applied / 12.06s**. The preceding assertion-format check passed but fixed one test file (**12.16s**), not counted as no-fix. Neither reviewer executed verification. Protected recovery snapshot matched **749 / zero mismatches** before this assertion-only follow-up.

## Fixed committed-source/test aggregate

Normal explicit-path implementation commit `38bdfc0e8` includes exactly source/new test/sessions guide/this review; hook passed **1766 / No fixes applied**. Root `rtk proxy ./test.sh` on that committed source/test tree passed **8616 / 0 failed / 936 skipped**, exit 0, **92.05s**, full output `artifact://4420`. No next-unit source/test changes occurred during execution. Following review-only amendment preserves product blobs and records aggregate against `38bdfc0e8`, not the future amended SHA. This closes P02's adapted deletion/restoration exclusion only, not the full migration.
