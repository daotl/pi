# Review: contain awaited editor submission failures

## Problem and final source chain

Parent `5da4452f6`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #23 `243015b85e9159c785bdfa09053bb9eac12aab74`, exact patch2025-2038 wraps the existing async submit body in a returned catch. This is D02, distinct from already-migrated prompt-update-specific catches, deletion atomicity and scheduler ownership.

The editor calls onSubmit as a void callback. Awaited command failures such as a rolled-back soft-delete persistence error could reject the assigned async function without displaying an error. Existing idle prompt and explicit prompt-update catches do not cover every branch.

## Adaptation and contract

Keep the complete submission body as one local async submit function, assign onSubmit to its caught promise, and report Error.message or String(error). Existing per-command messages and routing remain; no automatic retry or restoration of earlier editor clears. Only returned/awaited failures are contained, not detached work. The sessions guide states those limits.

The permanent actual-submit test injects one real manager rename failure in a file-backed session. Awaiting the returned callback observes whether its rejection is contained: RED rejects, fixed callback resolves and shows the exact failure once. It is not a process-global unhandledRejection test or actual Enter interaction. History/leaf/messages/file bytes/provider-call count stay unchanged after failure; restoring storage and submitting again deletes the intended answer, reopens the same user-only visible transcript, and dispatches no provider. Inert queue assertions were removed because this failure occurs before queue delivery; no draft preservation is promised (the command already clears its editor before awaiting).

## Verification chronology

- Current-source RED **1 failed / 18 passed / 2.55s**: onSubmit rejected the injected deletion storage error instead of resolving and displaying it.
- Initial fix: prompt-update and soft-delete owners **27 passed / 2 files / 3.15s**. First check **1765 / Fixed 1 / 13.46s** passed.
- Retry/reopen consumer controls were added, then refined from full internal-object equality to visibleTexts/reopenedTexts and a post-retry unchanged call count. Final formatted owners **27 passed / 2 files / 3.15s**; full check **1765 / No fixes applied / 13.42s**. Earlier format-writing runs are not claimed as no-fix gates.
- Actual Node source SDK + DefaultResourceLoader/file-backed SessionManager and real setupEditorSubmitHandler/handleDeleteCommand smoke injected fs.renameSync, observed the contained error and unchanged bytes/messages, restored the builtin, then reopened a user-only successful delete. Output `{"actualSDK":true,"actualSubmit":true,"errorDisplayed":true,"failedBytesUnchanged":true,"retryReopenedUserOnly":true}`, **0.60s**. Builtin exports restored and owned executable/session directory removed in finally. No provider/credential/network/visual UI claim.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host exposes skill reads but no skill invocation primitive; bounded native independent source/proof reviews are supplemental, not portable CE or cross-model receipts. Results recorded after delivery.

No command grammar, deletion soft/shred contract, scheduler, arbitrary task catch, dependencies/lock/generated/changelog changes. Owned source/test/sessions guide and this independent review only. Normal explicit-path commit precedes fixed-tree root aggregate; review-only amendment then records exact tested/final SHA without changing product blobs. Full 44-candidate migration remains open.

SubmitBoundarySourceReview and SubmitBoundaryProofReview completed independent bounded read-only review with **no actionable findings**. They traced the final wrapper, void editor/custom forwarding, material awaited command paths, real soft-delete rollback and final failure/retry/reopen assertions. Existing command-specific catches remain. Neither executed verification; actual Enter/process-global unhandled-rejection behavior, queue and draft preservation remain outside the proof.

## Fixed committed-source/test aggregate

Normal explicit-path implementation commit `64e56907d` includes exactly source/test/sessions guide/this review; normal hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on this committed source/test tree passed **8604 / 0 failed / 936 skipped**, exit 0, **108.04s**, full output `artifact://4344`. No next-unit source/test edits occurred during execution. Following review-only amendment preserves verified source/test/guide blobs, attributing aggregate to `64e56907d` rather than the future amended SHA. This closes D02 only; full migration remains open.