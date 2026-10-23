# Review: append the exit resume hint without clearing scrollback

## Problem and final source

Parent `ba7734a47`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #13 `aecd44347d2ada4e38b44f0fd8006bd881ae0872`, exact final hint patch at artifact lines1494-1510. P17 is independent of completed TUI LF, physical occupancy/caret and stop-height work.

Interactive quit stopped the UI and disposed the runtime, then prefixed its resume hint with `ESC[2J ESC[3J ESC[H`. Those bytes erased the visible transcript and scrollback even though the lower-level renderer had already preserved its final output. Signal shutdown has no hint and a deliberately different teardown order.

## Adaptation

Remove only the destructive clear/home prefix and its obsolete comment. Append the existing dimmed hint and retain the awaited stdout flush. Do not change formatResumeCommand, signal shutdown, emergency terminal exit, stop/dispose ordering or renderer state. No API, dependency, lockfile, generated-file or changelog change.

The existing #5080 shutdown consumer test replaces its obsolete clearing expectation with exact equality to the complete hint bytes, excluding any erase/home prefix or unrelated suffix. Signal ordering, interactive ordering, signal no-hint and reentry controls remain. No permanent test source-string assertion or extra snapshot.

## Evidence

- Before source change: **1 failed / 4 passed**, **2.26s**. The actual shutdown output contained erase/home sequences and failed the no-history-erasure assertion.
- After change: **5 passed**, **2.32s**.
- Existing shutdown plus format-resume-command owners: **13 passed / 2 files**, **2.84s**.
- Full `npm run check`: **1765 files / No fixes applied**, all stages passed, **15.36s**.
- Native Node with existing workspace source resolver invoked the real `InteractiveMode.shutdown` on a controlled context and wrote captured stdout to unmodified xterm. Result: `{"actualShutdown":true,"historyRowsPreserved":12,"finalTranscriptPreserved":true,"hintAppended":true,"order":["drain","stop","dispose"]}`, **0.58s**. Actual file-backed SessionManager determined the resume command. Output/exit adapters were controlled and restored in finally; owned smoke and temporary session directory removed. This proves the changed output boundary in an emulator, not a full Enter/quit process, OS signal or physical-terminal visual run.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). The host provides skill reads but no skill invocation primitive. Independent bounded native source/proof reviews supplement verification; their delivered results follow. No portable CE or cross-model receipt is claimed.

Only the source, owning test and this independent review belong to this unit. Pre-work status before P17 contained only protected `?? packages/env/`; P04 is already committed. Normal path-limited commit and hooks precede the root aggregate; its actual committed source/test SHA and result will be recorded after execution. No next-unit source edits during that run; review-only amendment preserves tested blobs. The 44-candidate migration and U02 bounded merge-family limitation remain open.

ResumeHintSourceReview and ResumeHintProofReview both completed bounded read-only review with **no actionable findings**. Source review covered hint-only diff, awaited flush, eligibility, signal no-hint/cleanup, reentry and final stop ordering; proof review covered the actual shutdown-output regression and stated emulator limits. Neither executed tests/checks or independently reproduced runtime evidence. Protected recovery snapshot again matched **749 / zero mismatches** before commit.

Final assertion follow-up strengthens the temporary contain-plus-no-clear oracle to exact full hint equality; production is unchanged from the reviewed source. Both owners passed **13 / 2 files / 10.48s** after that change. Full check passed **1765 / No fixes applied / 15.21s**. The earlier **1 failed / 4 passed** RED remains the actual pre-fix observation; no second pre-fix run is invented.

## Fixed committed-source/test aggregate

Normal path-limited implementation commit `c9f1a2a6d` contains exactly this source/test/review unit; its normal hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed source/test tree passed **8589 / 0 failed / 936 skipped**, exit 0, **119.58s**, full output `artifact://4105`. No next-unit source/test edits occurred during execution. The following review-only amendment records this result without changing the tested source/test blobs; the aggregate is attributed to `c9f1a2a6d`, not to its future review-amended SHA. This closes P17 only, not the complete migration.
