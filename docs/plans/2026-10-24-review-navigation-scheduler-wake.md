# Review: post-cleanup navigation scheduler wake

## Final source and scope

P07 navigation subunit, candidate #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45`, final patch `audit-patches/...diff:685-727,814-827,1720-1847`. Extension command navigation previously flushed only after success; selector navigation likewise flushed success before its finally cleanup. Cancel/failure could strand due actions because tree-summary completion does not emit an agent settlement.

Both paths call a shared wake helper in finally; it flushes compaction input and wakes the existing scheduler only after streaming/compaction ownership is released. Selector clears its branch-summary indicator and restores Escape first. This guard prevents a second navigation rejected before ownership from flushing another operation's input. No change to selected branch, summaries, request routing or resource restoration. Existing independent queue ownership claims dispatch synchronously before the subsequent drain can overtake it. P07 residual evidence and whole-migration accounting remain separate.

## Actual consumer proof

Existing initialized scheduler suite adds selector/extension × success/cancel/failure × continue/edit (12 scenarios). Target is an earlier assistant node saved before departed user/partial entries; an explicit different-from-current-leaf assertion protects the setup. Real tree-selector selection callback or registered `/visit` extension command enters real Session navigation and gated session_before_tree. Due action uses production message-count trigger. Summary success persists expected branch summary; cancellation/failure retain departed history without a branch summary, and provider failure is observed through actual showError/showExtensionError boundaries rather than transient transcript text that later rebuilds remove.

Actual scheduled provider dispatch must occur after navigation completes without unrelated settlement. At dispatch, Escape matches the original and branch-summary indicator is absent; request context matches selected summary/departed branch/edit, and unsent draft survives. Error/diagnostic spies observe existing boundaries without replacing behavior and are restored individually. Existing tree availability/busy/abort tests gain the new drain method in their partial fixture; no production optional fallback.

Valid RED **12 failed / 32 controls passed, 28.83s**: every scenario entered summary and failed at zero post-navigation requests. Subsequent fixture-only failures were corrected: successful branch summary is itself a user-role contribution, leaf equality was observed after scheduled work legitimately changed it, and failure notice disappears after continuation/edit rebuild. Those are not additional product RED.

Source review identified premature flush after a concurrent second extension navigation was busy-rejected. Actual review-repair RED **1 failed / 44 controls passed, 12.95s**: first navigation's hook remains held but queued ordinary input is intercepted twice by the second call's finally. The guarded helper prevents interception while busy; releasing the real first cancellation then delivers that input/request exactly once. This tests actual two-command concurrency, not a mocked busy flag.

Final post-format focused **56 passed / 3 files, 17.11s**; full check **1770 files / No fixes applied, 60.75s**. Owners are scheduler-drain-ownership, interactive-mode-tree-navigation and selected-branch-policy. This rerun includes the additional success/continue request exclusion assertion; production behavior is unchanged from the reviewed guard. Earlier checks exposed insufficient spy generics; final MockInstance types pass. No paid API/network. Selector callback exercises mounted real selector directly, not terminal Enter; choice dialog returns Summarize through a narrow spy.

## Bounded review and limits

Code review: skipped (ce-code-review unavailable). Source review found the busy-rejection defect above; both native source/proof follow-ups report no remaining actionable findings after its repair. Neither reviewer executed tests. These are supplemental, not CE/cross-model receipts. No physical-terminal, all early dialog-cancel paths, actual abort outcome, all nested queue/navigation races, permanent error-notice retention, or entire P07 completion claim. This matrix covers navigation success, hook cancellation and provider failure; pre-navigation busy/dialog behavior retains existing controls.

Owned: InteractiveMode, existing scheduler-drain and tree-navigation test owners, sessions guide and this review. Normal explicit-path commit precedes fixed committed-tree aggregate; review-only amendment records actual tested SHA separately. P07 remains open pending residual acceptance/accounting reconciliation.

## Fixed committed-tree aggregate

Normal implementation commit `858c4909a` includes all five owned paths; hook **1770 files / No fixes applied, 37.48s**. Three isolated root `./test.sh` runs used that unchanged source/test/guide tree. First: **8737 passed / 1 failed / 936 skipped, 260.52s**, `artifact://5109`, experimental idle worker registry removal preceded its OS process exit. Exact isolated worker consumer passed (**1 passed / 25 skipped, 2.78s**). Second: **8737 passed / 1 failed / 936 skipped, 310.99s**, `artifact://5115`, existing bash spill file was present but empty at immediate read; exact isolated consumer passed (**1 passed / 84 skipped, 2.96s**). Neither unrelated source/test path was changed, and these failures remain evidence rather than being erased by retry.

Third unchanged-tree aggregate: **8738 passed / 0 failed / 936 skipped, 224.56s**, `artifact://5120`. No product path changed across these runs. The following review-only amendment records the receipt; actual tested SHA remains `858c4909a`, not the amended SHA. These observations establish intermittent failures in two unrelated consumers, not an exhaustive diagnosis or fix of their lifecycle boundaries. Recovery-only protection snapshot remains **749 / 0 mismatches**; original manifest unavailable. P07 residual acceptance and overall 44-candidate convergence remain open.

