# Review: settlement-deferred queue completion ownership

## Final-chain adaptation

P07.4 residual from candidate #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45` independent queue ownership, adapted after committed queue/heartbeat/navigation units. AgentSession intentionally returns immediately when prompt submission occurs during agent_settled handlers; deferred execution starts only after handlers finish. The queue owner previously awaited that already-resolved outer promise, released its token, and let scheduled edits publish before the queued prompt even entered preflight.

Valid actual RED **1 failed / 45 skipped, 2.55s**: initialized SessionRuntime/InteractiveMode, real async settlement handler held, queue flush returns, later scheduled edit already appears in canonical messages before settlement is released. This is a current completion-ownership defect, not a missing historical test claim.

## Change and nonblocking contract

Optional internal PromptOptions.onDeferred synchronously hands observers a separate execution completion promise. The ordinary prompt return contract stays immediate. Completion is allocated only for observers; rejection is observed even if a consumer discards it, still propagates through enclosing settlement, and keeps existing onDeferredError semantics. Throwing notification observers cannot reject an already-queued submission.

Queue prompt branches reuse that handoff. A delivery task retains token/session identity and observes actual dispatch/completion; flush returns once execution has been deferred so an extension settlement handler may safely await the flush itself. It must not await the separate execution promise. Promise.race observes both the delivery and deferred-return boundary; no rejection-swallowing detached fallback is added. Existing ownership checks, one-time restoration, newer-input ordering and no-run redrain remain.

Rest is queued after accepted first dispatch, not after first response completion. It may enter steering/follow-up while the first response is held, but cannot enter before first preflight is accepted or execute a provider turn before the held response is released. Whole batch ownership lasts through those queued turns before schedules resume. This preserves established flush behavior rather than serializing every input unnecessarily.

## Actual proof

Two real settlement scenarios cover externally invoked flush and a settlement handler actually awaiting its own flush. Separate handler-entry/flush-return signals plus bounded wait distinguish nonblocking return from later dispatch. Both require no edit publication while settlement/preflight is held, rest empty before acceptance, rest present in follow-up while first provider response is held, and provider order seed/first/rest/scheduled.

A targeted deferred auth failure verifies original/rest/newer queue restoration, no rest input interception, one surfaced error and idle state. A core prompt test verifies a throwing synchronous handoff observer still leaves submission accepted and actual deferred input/answer published. Actual nested compaction inside before_agent_start is gated through session_before_compact and hook-cancelled; newly queued input precedes scheduled edit and compaction_end reports aborted. This is now real nested-compaction proof, not the earlier simplified preflight surrogate.

Both native reviews identified an introduced discard boundary: the sequential settlement drain removed all actions, then an earlier rejection skipped a later queue action without settling its completion. Actual review RED **1 failed / 49 skipped, 3.34s** left the queue absent and owner stranded. Deferred records now have execute/discard; on failure the central drain discards only not-yet-run records with the same original error and rethrows that original object. It does not execute abandoned actions. Prompt discard rejects completion and safely notifies onDeferredError. The real regression verifies restored batch, one surfaced cause, original settlement error identity and no rejected input publication. A subsequent seed-history expectation correction is fixture-only, not product RED.

Final post-format and post-rename focused **138 passed / 5 files, 16.04s**: scheduler-drain-ownership, prompt-preflight-ownership, interactive-mode-compaction, interactive-mode-heartbeat and 7150 RPC prompt-during-compaction. Final full check **1770 files / No fixes applied, 11.43s**. Earlier check formatted one owned test; focused proof followed formatting. The private record member was LSP-renamed from cancel to discard to distinguish unstarted work from active cancellation; behavior is unchanged from the reviewed repair. No paid APIs/network.

## Reviews and limits

Code review: skipped (ce-code-review unavailable). Both native reviews identified the same discarded-completion defect; both follow-ups report it resolved with no new actionable findings. Neither reviewer executed tests. Reviews are supplemental, not CE/cross-model receipts. No physical-terminal, all nested rejection combinations, or every shutdown/replacement interleaving claim. No new public waiting semantics; onDeferred is explicitly internal. The frozen 44-candidate scope is unchanged; this repairs the current-architecture prerequisite of the accepted queue contract.

Owned: AgentSession, InteractiveMode, existing scheduler-drain and prompt-preflight test owners, SDK/sessions guides and this review (seven paths). Normal explicit-path commit precedes fixed committed-tree aggregate; review-only amendment records actual tested SHA. P07 final candidate/raw/accounting reconciliation follows this unit.

## Fixed committed-tree aggregate

Normal implementation commit `7a3441fd5` includes all seven owned paths; hook **1770 files / No fixes applied, 11.73s**. Isolated root `./test.sh` on this fixed source/test/guide tree: **8744 passed / 0 failed / 936 skipped, 92.95s**, `artifact://5161`. No product path changed during aggregate. The following review-only amendment records the receipt; tested SHA remains `7a3441fd5`, not the amended SHA. Recovery-only protection snapshot: **749 / 0 mismatches**; original manifest unavailable. Final candidate/raw reconciliation is external accounting, not an additional product change.

