# Explicit prompt/skill update transaction review

## Scope and source chain

- Parent: `57b3ab1cf`; fixed upstream baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; fixed backup `cb3bee033ba853041609b874303dc625d5d30479`.
- Authored `b2489d93bca284d3322ece68c1fa7e086ee02e38` introduces the explicit-update transaction and routes custom set/clear through it; `a820049ee4ff71fb8f35dd62c386181dce6e9222` adds live-agent and compaction exclusion. Migrate the final behavior, not their intermediate whole files.
- This is an independent S4 prerequisite, not completion of saved effective rendering, trust/current-resource authority, discovery, or branch restoration. No S7/S8 implementation is included. Current swipe/soft deletion, harness exports, and chat-template token counting remain unchanged.

## Problem and implementation

A failed system-prompt snapshot append left the runtime getter, custom override or skill metadata on the rejected policy. The durable session still contained the old snapshot, and a subsequent request could use the rejected construction.

All four public explicit-update methods now share the existing `reloadFromFiles` entry point. Reject before loader refresh when `isStreaming`, an agent signal, or compaction/tree-summary ownership is active. Capture the actual current state: base prompt, normalized options, custom override, copied effective skills/sourceInfo, restore flag, and last-persisted prompt marker. Restore them when refresh, reconstruction or persistence throws. The current normalizer copies mutable collections. The successful normal commit path does not mutate agent messages before saving.

The current architecture has no backup `_promptFileSources`, restored section/baseline, or effective-context-file fields; those were not invented for this prerequisite. Loader caches can reflect the changed files after failure. They are intentionally not rolled back; the committed effective runtime construction remains old until an explicit retry succeeds. Skill bodies are read from disk when invoked, not snapshotted by this change.

## Behavioral proof

- Real same-instance `DefaultResourceLoader`, owned SYSTEM.md and SKILL.md files, file-backed SessionManager, and actual append fault: five set/clear/system/skills/all regressions initially **5 failed** (`bg_785`, 19:13:09). Rejected prompt or skill metadata leaked into the getter. No source-text assertions or private-state assignment.
- Narrow rollback first **5 passed** (`bg_786`); each case also checks the actual next faux-provider request uses the old prompt, durable bytes/entries stay unchanged, and retry/reopen agree.
- Held actual stream plus existing reload/restore/update owners: **26 passed / 5 files** (`bg_787`, 4.19s).
- Added actual awaited `session_before_compact` and `session_before_tree` gates; all explicit updates reject without changing prompt/history. Complete new fixture **8 passed** (`bg_789`, 2.27s).
- Final owning/adjacent matrix after formatting: **84 passed / 9 files** (`bg_792`, 6.38s), covering granular loader reload, system and skill restore, prompt updates, tool prompt contributions, preflight ownership, mixed edits and queued compaction.
- Native Node SDK smoke with the real loader and builtin fs append fault: observed old getter and durable bytes after failure, actual next-request old policy, explicit retry loading changed policy, and matching reopened snapshot (`bg_791`, 0.52s). Output had all five assertions true. Temporary script removed.
- `npm run check`: **1748 files, Fixed 1 file**, all dependency/entry-graph/install-lock/type/browser smoke checks passed (`bg_788`, 10.95s). After adding summary gates, repeated check **1748 files, Fixed 1 file**, same checks passed (`bg_790`, 11.01s). These were formatting changes, not no-fix runs.
- Protected daemon target manifest: **749 paths, zero SHA256 mismatches** before committing.

## Independent review and limits

- `PromptUpdateStateAudit`: read-only exact-source review of reconstruction, normalizer, persistence, next request and skill dispatch; no actionable finding. No checks executed by reviewer.
- Busy/lifecycle review and fixed-commit isolated aggregate are recorded below after their actual results; no current-tree aggregate claim is made here.
- Graph project/generation/coverage unavailable because the tool initializer raises `WeakMap keys must be objects or non-registered symbols`; exact source fallback used. No graph completeness claim.
- Whole 44-commit migration remains open; this unit does not resolve the remaining S4/S6/S7/S8/S9/TUI/scheduler/UI behavior clusters.

## Follow-up findings and verification

Review found that the expected synchronous rejection escaped the interactive editor submission boundary. The new actual-session/prototype-submit fixture first failed during fixture construction (`bg_795`, inherited getter assignment), then correctly reproduced **5 failed / 8 passed** (`bg_796`) after using the real runtimeHost accessor. Both `/update` and `/system-prompt` dispatches now catch and display failure without success status; SDK rejection remains synchronous. **36 passed / 6 files** (`bg_797`, 4.64s); check **1748 files, Fixed 1** (`bg_798`, 10.78s). `PromptUpdateBusyAudit` independently rereviewed and cleared its finding, source-only.

Summary-hook tests validate distinct cancellation contracts instead of accepting arbitrary failures: compact rejects with an Error and emits aborted compaction_end without an operational error; tree returns `{ cancelled: true }`; both leave entries unchanged. **8 passed** (`bg_793`, 2.23s), check **1748 files, No fixes applied** (`bg_794`, 10.84s).

Actual 110x30 tmux TUI with native SDK, isolated resources and a manually held provider stream: while Working remained visible, `/update skills` rendered the busy update error and `/system-prompt clear` rendered the busy system-prompt error. The provider had not been released. Earlier time-based smoke only observed idle updates and is not claimed as busy coverage. This is real command dispatch/error rendering, not only the prototype fixture.

After explicit provider release, the same TUI displayed `SMOKE HELD RESPONSE COMPLETED` and returned idle. Closed normally with Ctrl-D; temporary script and release gate removed. Post-format focused matrix **92 passed / 10 files** (`bg_802`, 6.75s). This run preceded the semantic guard-cause assertion below.

The busy-to-idle transition initially passed **16 tests / 2 files** (`bg_804`, 2.75s), but accepting any error string could also accept a busy-only TypeError. The regression now additionally requires the guard-cause substring `Cannot update the system prompt while the agent is running.`, without pinning the UI prefix. This identifies the intended rejection rather than relying on manual TUI evidence or idle success alone.

Pre-amendment `npm run check`: **1748 files, No fixes applied**, all checks including browser smoke passed (`bg_805`, 10.82s). Verification of the semantic assertion amendment is recorded below.

## Fixed committed-tree aggregate

Root `rtk proxy ./test.sh` on earlier source/test commit **`821ae22ec`** completed with isolated HOME/credentials and default cloud-provider disablement: **8345 passed / 0 failed / 936 skipped**, exit **0**, **83.69s**, `artifact://3179` (`bg_808`). No source/test changes occurred during that run. The review-only amendment produced `c4fce3274`; this aggregate predates the subsequent semantic guard-cause assertion and is not evidence for that amended test tree.

## Semantic guard assertion amendment

The amended interactive regression passed **16 tests / 2 files** (`bg_811`, 2.77s). `npm run check` passed **1748 files, No fixes applied**, including browser smoke (`bg_812`, 11.43s). Only the test assertion and this evidence record change in this amendment; production source remains the previously exercised SDK/TUI implementation. A new fixed-tree aggregate will replace the earlier-tree receipt for final accounting.

Final root isolated aggregate on amended source/test commit **`3e1be1b19`**: **8345 passed / 0 failed / 936 skipped**, exit **0**, **87.06s**, `artifact://3191` (`bg_814`). This tree includes the semantic guard-cause assertion. No source/test edits occurred during the run. The final amendment is review-only.
