# Review: direct scheduled trigger arbitration

## Source and scope

P07 direct-trigger subunit, candidate #26 `f5825ecd7744162d449e247eb7c452570d8413aa`, final patch `audit-patches/...diff:305-365,724-837`. Builds on committed settled, queue and heartbeat ownership. Preserve original creation IDs and the unnumbered pending-compaction-continue priority. Navigation-finally wake and explicit residual evidence remain open.

Due ordinary messages during genuinely active streaming/compaction retain existing follow-up/compaction-queue routing only when no settled/queue/heartbeat preflight delivery owns dispatch. Other due entries, including idle ordinary messages, enter the shared deferred queue and drain. Deferred ordinary messages use prompt delivery, not edit/continue execution. Existing owner phase and no-run redrain callbacks remain unchanged. Bare heartbeat dispatch already calls its own continuation handoff and does not enter its own exclusion guard.

## Actual proof

Existing initialized scheduler suite adds time/message-count cases: first ordinary prompt holds real before_agent_start; second ordinary and edit become due while held. Their input/model/state must remain untouched until owner release. Actual provider request order then follows first/second/edit; the edit's response remains gated to confirm run ownership. Date-only plus explicit fire is delivery injection, not a timer-accuracy claim; message-count directly exercises the production contribution counter with a non-harness assistant contribution.

Valid RED **2 failed / 29 controls passed, 11.05s**: edit request overtook owning prompt preflight for both trigger kinds. A real active-run ordinary-message control verifies follow-up (not steering), absence of premature provider dispatch and eventual consumption after run release. Existing heartbeat, queue, no-run and creation-ID controls remain in the focused owners.

Final post-format focused **136 passed / 4 files, 10.69s**: scheduler-drain-ownership, interactive-mode-schedule, interactive-mode-heartbeat and prompt-preflight-ownership. Full check **1770 files / No fixes applied, 14.26s**. Earlier checks formatted owned source/test; final proof follows formatting. No paid API/network.

## Review and limits

Code review: skipped (ce-code-review unavailable). Both supplemental native source/proof reviews report no actionable findings; neither independently executed tests. These are not CE/cross-model receipts. No physical-terminal, all mixed-producer timing, timer accuracy, actual navigation-finally completion or entire-P07 completion claim.

Owned: InteractiveMode, existing scheduler-drain test owner, sessions guide and this review. Normal explicit-path commit precedes fixed committed-tree aggregate; review-only amendment records actual tested SHA separately. P07/full migration remain open.

## Fixed committed-tree aggregate

Normal implementation commit `fec1b4c99` includes all four owned paths; hook **1770 files / No fixes applied, 13.23s**. Isolated root `./test.sh` on that fixed source/test/guide tree: **8725 passed / 0 failed / 936 skipped, 145.64s**, `artifact://5067`. No product path changed during aggregate. Following review-only amendment records this receipt; actual tested SHA remains `fec1b4c99`, not the amended SHA. Recovery-only protection snapshot: **749 / 0 mismatches**; original manifest unavailable. P07 navigation wake/residual evidence remains open.

