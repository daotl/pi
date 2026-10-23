# Review: close automatic compaction when preparation has no summary input

## Problem and final source chain

Parent `57292db2f`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Candidates #13 `aecd44347d2ada4e38b44f0fd8006bd881ae0872` and #15 `447d3579a3123052de1e4b4f54a46942836ceb48` own the no-preparation completion/documentation behavior; final backup AgentSession4713-4717 closes an already-started attempt without result or failure. Audit ID V06 remains stable after its earlier P05 classification correction.

Automatic compaction emits compaction_start before preparation. A retained tail can leave no summary input, causing prepareCompaction to return undefined; the prior return cleared the controller without emitting compaction_end. InteractiveMode installs a temporary Escape handler, progress and compaction indicator on start and restores them only on end. No-result completion is not a failure.

## Adaptation and tests

Emit exactly the ordinary no-result compaction_end shape (reason, result undefined, aborted false, willRetry false) before the no-preparation return. Let existing finally own controller/idle cleanup. Keep the already-compacted-tail pre-start guard eventless and do not create a checkpoint, summary dispatch or failure notice. No scheduler ownership/order change, new result type or exception suppression.

The existing actual-Session compaction suite exercises threshold and overflow with real preparation and a retain-all budget, asserts exact start/end, unchanged history, zero provider calls, idle and no session_compact_failed extension notification. An already-compacted-tail control asserts no lifecycle or dispatch. Existing interactive compaction suite invokes the actual event handler start/end, checks temporary Escape/progress/indicator activation and their cleanup, restored Escape identity, and no user failure/status notice. Output adapters and queues are controlled, not a visual UI run.

## Observed verification

- Before source change: **2 failed / 31 passed / 2.32s**; threshold and overflow each emitted only start. The already-compacted-tail control passed.
- Initial integration: **46 passed / 3 files / 3.41s**. After explicit no-failure and UI cleanup controls: **47 passed / 3 files / 3.40s**.
- First check formatted two owned tests and failed on a restricted global name (`escape`) in the new UI fixture: **1765 files, Fixed 2, one error / 6.99s**. LSP rename changed it to defaultEscape; no production behavior changed for lint.
- Full check then passed **1765 / No fixes applied / 12.26s**. Final post-format three owning files **47 passed / 3.38s**.
- An ad-hoc source SDK/UI smoke was drafted but never executed, then deleted on review feedback. Its temporary model-input type diagnostic was corrected before deletion, not counted as runtime evidence. No smoke result, browser/physical-terminal appearance, full interactive input or provider-wire claim. Runtime proof here is the real preparation/Session lifecycle and actual UI-handler consumer scenarios; no full-process UI verification was performed.

Queue flushing, scheduler wake and render requests remain controlled adapters in the UI handler test; their execution/completion is not proven by this fixture. V06 does not claim queue draining or scheduled dispatch ownership. Those behaviors remain in P07 and must not be credited from mock call counts.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host exposes skill reads but no skill invocation primitive. Bounded native independent source/proof reviews supplement verification, not portable CE or cross-model coverage; results follow actual delivery.

Source/test/JSON guide and this independent review are the only owned paths. No dependencies/lock/generated/changelog changes, no upstream replay or whole-file replacement. Normal explicit-path implementation commit precedes root aggregate; only review receipt is amended after the actual tested SHA/result. Full 44-candidate migration remains open.

NoResultLifecycleSourceReview and NoResultLifecycleProofReview completed bounded read-only reviews with **no actionable findings**. They confirmed the exact no-result payload, no extension failure/checkpoint/generation path, unchanged cheap guard and finally cleanup, plus real preparation and actual UI-handler state assertions. Neither executed verification. Limits remain explicit: no automatic trigger-selection proof, idle-during-end-callback guarantee, queue dispatch ownership/order, full-process or visual terminal verification.

## Fixed committed-source/test aggregate

Normal path-limited implementation commit `261df8038` includes exactly source/two tests/JSON guide/this review, with normal hook **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on this committed source/test tree passed **8603 / 0 failed / 936 skipped**, exit 0, **92.01s**, full output `artifact://4301`. No next-unit source/test changes occurred during execution. Following review-only amendment preserves tested source/test/guide blobs and records aggregate against `261df8038`, not the future amended SHA. This closes V06 only; full migration remains open.
