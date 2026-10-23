# Review: unified selected-summary presentation

## Problem and final source chain

P06: candidate #12 `0a9acad131b79844ce5afd677368090ef95684f7` repaired latest persisted checkpoint selection; candidate #30 `26cb5df97f1fbe6266113f2a6be681605fca81cc` supersedes the isolated repair with unified presentation (`audit-patches/...diff:1166-1250,1599-1774`). Current SessionManager selects summaries oldest-first before retained entries. Prior boundary handling required entries[0] to equal the new checkpoint; normal chronological completion removed entries[0] and appended event payload with a new timestamp. Initial/rebuild rendering ignored chronological placement.

## Change and boundaries

Normal successful compaction and selected boundary checkpoints use the same rebuild as initial load/reopen. The entry renderer orders only selected entries by active-branch IDs in chronological mode; context mode retains summaries-first order. Persisted summaries supply timestamps and usage. Boundary suppression still marks trailing entries already included by the rebuild so later entry_appended events do not duplicate them. No model-context ordering/filtering, projection API, event protocol, deletion or scheduler changes. Completed P08 inflight-retention prerequisite remains in place, including its active-run ownership gate and idle reload freshness.

## Consumer proof

Existing interactive-mode-compaction owner now includes context/chronological × initial/completion/boundary/rebuild/reopen scenarios with real initialized InteractiveMode, SessionRuntime, file-backed SessionManager and xterm. Completion uses actual session.compact with extension-provided persisted summary; boundary uses a real faux-provider prompt and turn_end extension drafts (compaction plus displayed trailing custom message). Reopen constructs a separate SessionManager.open(file), harness, runtime, mode and terminal; it does not switch the already-open runtime to the same file. Cleanup independently stops/disposes both runtimes and restores display globals.

Expected selected summaries derive from post-phase persisted context so budget eviction remains authoritative; chronological order derives from active-branch order filtered to those selected IDs. Assertions check each visible label once, placement order, excluded checkpoint/history absence, distinct persisted billing notice once and immediately after its summary, persisted summary timestamps, unchanged summaries-first model context, and terminal output. Usage component sums are distinct 100/200/300/400, not only totalTokens. Summary metadata is read through a named test surface because timestamps are not rendered.

Valid current-source RED **6 failed / 12 controls passed, 3.52s**: chronological initial/rebuild/reopen order; chronological completion missing older summary; both boundary placements missing new summary. Earlier three failures from querying an unrefreshed live agent state were fixture defects, not product RED. Initial same-file runtime switch did not establish independent reopen proof and was replaced. Three old mock-forwarding/implementation-detail tests removed, not re-pinned. They used reversed producer order or asserted delegation rather than output; the real lifecycle scenarios replace their relevant behavior coverage.

Final focused **79 passed / 5 files, 7.47s**: interactive-mode-compaction, inflight-appearance-rebuild, agent-session-boundaries, session-manager/build-context and existing 4167 unresolved-tool owner. Final full check **1767 files / No fixes applied, 12.10s**. Earlier checks formatted the test and exposed an obsolete import and fixture union-narrowing issue; both resolved before final proof.

## Review and limitations

Code review: skipped (ce-code-review unavailable). Native bounded source/proof reviews are supplemental, not portable CE or cross-model receipts. Both read-only reviews report no actionable findings; neither independently ran checks. Container assertions prove order/multiplicity; xterm assertions prove label presence only, not terminal-level order/multiplicity. No physical terminal, all extension draft combinations, full live-projection reconciliation or all navigation paths claim. Fixture provider and compaction hook avoid paid APIs; test resource/model setup is local.

Owned paths are InteractiveMode source, its existing compaction test owner, the existing 4167 fixture, compaction guide and this review. Normal explicit-path implementation commit/amendment precedes the fixed committed source/test/guide aggregate; subsequent review-only amendment records the exact tested SHA. No changelog on crystal. Full 44-candidate migration remains open.

## Failed first aggregate and integration repair

Initial implementation commit `82f6deae3` passed its normal hook (**12.14s**, no fixes), but isolated root aggregate failed: **8683 passed / 2 failed / 936 skipped, 91.02s**, `artifact://4806`. Both failures were the existing 4167 partial renderer context missing `settingsManager.getCompactionSummaryPlacement`, before its consumer assertions ran. That tree is not a passing receipt. The fixture now supplies context placement and a branch getter; original unresolved-tool completion and historical-result output assertions are unchanged. No optional production fallback was introduced. The expanded five-owner focused proof and no-fix check above cover this repair; a replacement fixed committed tree must pass aggregate before closure.

## Passing fixed committed-tree aggregate

Implementation amendment `229fdea2d` includes the 4167 fixture integration; normal hook **1767 files / No fixes applied, 12.81s**. Narrow read-only proof follow-up found no actionable issue in the fixture contract changes. Isolated root `./test.sh` on this fixed committed source/test/guide tree: **8685 passed / 0 failed / 936 skipped, 102.51s**, `artifact://4818`. No product path changed during the aggregate. The subsequent review-only amendment records this receipt; tested SHA remains `229fdea2d`, not the amended SHA. Recovery-only protection check: **749 / 0 mismatches**; original manifest remains unavailable.

