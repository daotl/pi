# Review: settled scheduler drain ownership prerequisite

## Source and bounded scope

P07 prerequisite only: whole-drain idle guard, settled async dispatch ownership, lowest creation-ID selection across eligible settled/deferred work, and no-run completion redrain. Final source chain: candidates #22 `6f1cfc1f5511b7ce600843d31eb72661587f9a80` (idle guard), #23 `243015b85e9159c785bdfa09053bb9eac12aab74` (completion/disposition owner), #24 `3891c85a2d698b87546873ddc42f3d400406db13` (minimum deferred ID). Preserve the unnumbered pending-compaction-continue precedence; it is not assigned a global creation ID.

Previously compaction/settlement drain could consume settled work while an agent run was active, deferred actions followed arrival order, no-run actions could strand remaining work, and asynchronous input/model preflight had no exclusion owner. The drain now checks true idle plus a named identity owner with preflight/run phase, selects minimum eligible IDs, and routes action completion or prompt disposition to token-checked completion. A non-handled prompt disposition marks the owner as waiting for a subsequent settlement; this is not tied to a particular run ID. An unrelated settlement cannot release a still-held preflight. Actions retain their own completion owner. Handled/rejected/no-op delivery releases/redrains in a microtask. Settlement waits for shutdown before releasing only run-phase ownership. clearScheduledMessages invalidates old callbacks. Foreign-run fallback feeds disposition and rejection back to that owner. Existing busy ordinary-message and compaction queue routing remain unchanged.

This does not complete P07: independent compaction-queue ownership, direct time/message trigger arbitration, heartbeat cadence/preflight/daily ownership and navigation-finally wake remain pending. Existing heartbeat load-generation and core foreign-run protections are not remigrated.

## Actual consumer proof

New harness/faux suite initializes real InteractiveMode/SessionRuntime. Gated provider runs and before_agent_start preflight verify no premature input/follow-up consumption, automatic queue advancement for handled input/extension command and rejected/no-op edit, and ordered request histories after reverse timed action arrival with an intervening settled message. Timed entries use real schedule allocation/deadlines with Date-only control and explicit due delivery; this is not a new timer-accuracy proof. The no-op defensive edit scenario allocates its positive ID through handleScheduleCommand before moving the entry into the existing deferred-action seam; it is not an end-user command that normally parses as an edit.

Initial RED **6 failed / 0 passed, 4.24s**: busy handled execution/follow-up consumption, blocked-preflight concurrent input, reverse action arrival ordering. That first no-op fixture used a synthetic id0; it was replaced with a real allocated ID before final proof. Subsequent source correction retains waiting-for-run ownership through settlement instead of clearing it at preflight completion, scans minimum settled ID explicitly, and releases only after shutdown await. Original microtask-handoff green result is not credited as proof of final owner lifetime.

Phase-repair RED **1 failed / 6 controls passed, 4.27s**: while first scheduled preflight is held, a real unrelated run settles and incorrectly releases its owner, allowing second scheduled input. The phase gate prevents that premature dispatch. The real handled-fallback control now holds fallback input across foreign run settlement, proves no next request/follow-up while held, then releases it and observes next scheduled dispatch without another unrelated settlement. No permanent fallback-rejection deadlock was independently reproduced. A drafted queue-update subscriber rejection scenario was removed because it left partial queue mutation and was outside scope; its passing run is not acceptance evidence.

Final post-format focused **64 passed / 5 files, 8.60s**; full check after final wording correction **1770 files / No fixes applied, 12.86s**. Owners are scheduler-drain-ownership, interactive-mode-schedule, scheduled-edit-application, prompt-preflight-ownership and interactive-mode-compaction. Earlier checks formatted owned files; final proof follows all phase/fallback/fixture changes. No paid APIs/network. The scenarios observe real session inputs, requests, queues and state; no physical-terminal/scheduler-heartbeat integration claim.

## Review and delivery

Code review: skipped (ce-code-review unavailable). Supplemental native source/proof follow-ups found no actionable issue in the phase-aware source and real foreign-run scenarios; final strengthened handled-fallback gate follow-up also found no actionable issue. Neither reviewer executed tests. These are not CE/cross-model receipts. No exhaustive shutdown/replacement, queue-child, heartbeat or navigation ownership claim. Scope is the settled-drain prerequisite, not all scheduler races.

Owned: InteractiveMode, new scheduler-drain suite owner, sessions guide and this review. Normal explicit-path commit precedes fixed committed-tree aggregate; review-only amendment records actual tested SHA separately. P07 whole cluster and full migration remain open.

## Fixed committed-tree aggregate

Normal implementation commit `938856ea3` includes all four owned paths; hook **1770 files / No fixes applied, 13.57s**. Isolated root `./test.sh` on that fixed source/test/guide tree: **8704 passed / 0 failed / 936 skipped, 106.32s**, `artifact://4934`. No product path changed during aggregate. Subsequent review-only amendment records the receipt; tested SHA remains `938856ea3`, not the amended SHA. Recovery-only protection snapshot: **749 files / 0 mismatches**; original manifest unavailable. P07 queue/direct-trigger/heartbeat/navigation units remain open.

