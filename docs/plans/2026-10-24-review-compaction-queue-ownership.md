# Review: independent compaction queue delivery ownership

## Source and scope

P07 queue subunit from candidate #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45`, final patch `audit-patches/...diff:734-797,1307-1419,1424-1598`. Builds on settled drain `72da9a1d7`. Independent queue delivery must outlive a parent scheduled extension command's handled return and exclude settled/deferred actions while child prompt preflight/run owns delivery. Direct timed ordinary-message arbitration, heartbeat and navigation-finally wake remain separate pending units.

flushCompactionQueue now holds an identity/session-bound token, waits for first prompt dispatch before queuing its rest, then awaits that prompt's actual completion. Rejection is observed by a handler that records error and resolves a non-rejecting dispatch barrier; the enclosing catch restores once. Restoration prepends the original batch before newer queued input instead of overwriting newer input. Restored pending input blocks settled drain until explicit retry. Successful completion drains later compaction input first, then schedules. Existing retry/steer/followUp routing remains; deferred actions observe the independent owner. Session replacement and stop invalidate the token; stale restore/finally callbacks cannot clear a replacement owner.

The first-prompt dispatch barrier adapts the frozen patch to a confirmed failure path: its old caught promise could dispatch remaining input before first preflight rejected. No claim of all-or-nothing side effects after an already-started prompt or completed extension commands; this is not a durable transaction for the queue.

## Actual proof

Existing real scheduler-suite helper initializes InteractiveMode/SessionRuntime/faux provider. Started and handled preflight gates reject competing settled edits; input added while delivery owns preflight drains before deferred schedules. Parent/child proof review found the first fixture dispatched its command while idle and bypassed the settled owner. The corrected fixture allocates parent command and later edit during a real gated seed run; settlement routes the parent through the owned drain, it starts child queue flush and returns handled, and held child preflight/run still excludes the next edit. This is a direct extension child-dispatch seam, not actual tree navigation.

Targeted checkAuth rejection with model present and no configured auth verifies first input only, rest not dispatched, one error, original batch before newer input, true idle and schedules still blocked. Explicit auth recovery and queue retry then dispatch original first/rest/newer/scheduled in order, proving owner release. Spies are installed before dispatch and restored individually. A real active-run steering scenario replaces the old mock argument assertion: steering receives the input, follow-up remains empty, and the next request consumes steering.

Real extension `ctx.newSession()` control verifies safe abandonment of the outgoing batch: runtime identity changes, remaining text reaches neither stored live transcript, provider-context capture sees no stale dispatch and pending queue is empty. This is defensive coverage, not a failing-before replacement regression; the source reviewer retracted the initial consumer-regression claim after the observation. The removed fresh replacement-provider response control was a fixture/provider-registration limitation, not queue proof. Cleanup aborts/waits/disposes the current runtime session. No replacement-owner coexistence or all lifecycle outcomes claim.

Valid initial RED **3 failed / 8 controls passed, 5.84s** after simplifying an initial nested-compaction fixture to direct held preflight. The discarded complex fixture is not credited as actual nested-compaction proof. Failure-path RED **1 failed / 11 controls passed, 6.02s** with targeted auth rejection: original rest entered input before first rejection. Earlier model-getter injection is superseded by targeted auth evidence.

Final post-format focused **70 passed / 5 files, 10.12s**: scheduler-drain-ownership, interactive-mode-compaction, interactive-mode-schedule, prompt-preflight-ownership and scheduled-edit-application. Full check **1770 files / No fixes applied, 12.78s**. These results follow corrected true-settled parent and runtime-replacement controls. Earlier checks formatted owned files and rejected an incorrect AuthCheck fixture shape; final fixture uses declared `{ type: "api_key" }`. No paid API/network. New tests assert actual inputs/request order/queues/state, not call forwarding.

## Review and limits

Code review: skipped (ce-code-review unavailable). Native bounded source/proof follow-ups report no remaining actionable findings after correcting the parent fixture and adding defensive replacement guards/control; neither executed tests. These are not CE/cross-model receipts. No physical-terminal, actual nested compaction or actual navigation child, all lifecycle outcomes, retry-branch partial failures, settlement-deferred prompt completion, or subscriber-exception atomicity claim. P07 remains open.

Owned: InteractiveMode, existing scheduler-drain test owner, existing compaction test owner (obsolete forwarding assertion removed, real steering proof added), sessions guide and this review. Normal explicit-path commit precedes fixed committed-tree aggregate; review-only amendment records exact tested SHA separately. No changelog on crystal.

## Fixed committed-tree aggregate

Normal implementation commit `3653490d9` includes all five owned paths; hook **1770 files / No fixes applied, 14.88s**. Isolated root `./test.sh` on this fixed source/test/guide tree: **8710 passed / 0 failed / 936 skipped, 139.61s**, `artifact://4979`. No product path changed during aggregate. Subsequent review-only amendment records this receipt; tested SHA remains `3653490d9`, not the amended SHA. Recovery-only protection check: **749 files / 0 mismatches**; original manifest unavailable. P07 direct-trigger/heartbeat/navigation and unexercised nested-compaction/settlement-deferred boundaries remain open.

