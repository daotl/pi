# Review: atomic mixed swipe-subtree and ordinary-entry shred

## Problem and retained source invariant

Candidate #40 `39ad8ad45dde2c9fe1939d578c2c0ce22aa2ad2d` fixes a single user deletion operation publishing only some selected targets. Its legacy results-first substring deletion and deleteMessages/removeMessages APIs are not migrated. Current upstream soft-delete, restoration, numeric deletable units and swipe-version subtree semantics remain authoritative. This unit adapts only the all-or-nothing invariant to current `AgentSession.shredLastMessages`.

Before this change the mixed path called live `removeEntriesWithDescendants`, then live `removeEntries`. Each commits independently. If the final ordinary-entry rewrite fails, swipe subtrees have already disappeared from disk and the manager while live Session messages have not rebuilt.

## Change and ownership

Mixed subtree + ordinary-entry/tool-call work runs on the existing isolated `SessionManager.editMessages` draft. Draft `_commitEntries` calls cannot write because the draft is nonpersistent; one outer `_commitEntries` rewrites the complete tree before publishing entries, indexes and selected leaf. No rollback-after-first-commit is used. Single-kind paths retain their direct atomic primitives; empty selections still return before work. Target selection, operation order, return units, tool-call filtering, historical entry retention and subtree expansion are unchanged. No new public API, transcript event, provider request, dependency or migration shim is added.

## Runtime proof

An existing persistent transaction-owner test creates a retained prefix, two actual regenerated swipe versions and a later turn. Numeric shred selects the earlier ordinary question, current swipe response and later turn; sibling expansion also selects the abandoned version subtree. The injected rename failure occurs only when the staged selected branch no longer contains the selected ordinary question. Earlier intermediate writes, if present, are allowed through, so this catches the previous two-commit implementation rather than just testing first-write failure. The hook reads JSONL branch links, never opens or mutates a temporary SessionManager and makes no mock call-count assertion.

Valid RED before product changes: **1 failed / 11 passed, 2.92s**, failure at unchanged file bytes after the expected injected error; the first durable commit had already removed version subtrees. Initial text-presence fixtures did not trigger the injection because ordinary deletion retains abandoned history; those failures are discarded, not credited as RED. A temporary staged-loader variant was replaced with read-only JSONL traversal before final verification.

Final focused owners: **50 passed / 5 files, 4.97s** (`message-edit-transaction`, soft-delete, swipe, selected-branch-policy, history-mutation-ownership). They exercise actual AgentSession + faux provider + actual file-backed manager + filesystem failure/retry/reopen. Failure assertions cover exact disk bytes, entries, held object identity, tree, leaf and live messages; success retains exactly the prefix, removes both version roots and reopens to the exact active transcript. Existing tool-call and idle swipe semantics remain covered. Full check: **1766 / No fixes applied, 11.79s**. Earlier formatting pass fixed one test file; a later check caught nullable fixture traversal, corrected before the final no-fix run.

A bare Node SDK smoke did not execute because workspace dist exports were not built; it supplies no runtime evidence. Its script and unexecuted loader draft were removed. No standalone SDK smoke, full interactive Enter, disk stage matrix, crash durability, raw dependent-result boundary proof or mutation-notification completion is claimed. D04's remaining candidate accounting stays open outside this bounded invariant.

## Independent review and delivery

Code review: skipped (ce-code-review unavailable). Host exposes skill content reads, not a skill invocation primitive. Bounded native source/proof reviews are supplemental; results recorded after delivery, not portable CE or cross-model receipts.

Owned source, existing test, sessions guide and this review only. No branch/worktree/push or changelog changes. Normal explicit-path commit precedes fixed committed-source/test aggregate; review-only amendment then records the exact tested SHA separately from final SHA. Full 44-candidate migration remains open.


MixedShredProofReview completed read-only source/proof review with no actionable findings: the final selected-branch oracle catches the previous intermediate commit without a temporary loader or call-count assertion, and cleanup/state assertions are sound. Successful reopen checks non-system message text, not complete message objects. The reviewer ran no checks. Final documented tree check passed **1766 / No fixes applied, 12.95s**.

MixedShredSourceReview completed bounded read-only source review with no actionable findings: nonpersistent draft isolation, outer rewrite-before-publish, held identity recovery, unchanged single-kind primitives and empty-selection early return were confirmed. Interactive routing retains returned-unit handling and existing submit-error containment. Neither native reviewer executed checks or independently verified runtime/UI/crash durability. Recovery-only protection check matched **749 files / zero mismatches**; both temporary smoke/loader files were confirmed absent.

## Fixed committed-source/test aggregate

Normal explicit-path implementation commit `2e07e14ae` contains only the four owned source/test/guide/review paths; hook passed **1766 / No fixes applied**. Root `rtk proxy ./test.sh` on that committed tree passed **8617 passed / 0 failed / 936 skipped**, exit 0, **95.99s**, full output `artifact://4464`. No next-unit source/test changes occurred during execution. Requested additional committed-tree focused run also passed **50 / 5 files / 19.88s** while the aggregate was running. The following review-only amendment records these results against tested `2e07e14ae`, not its future final SHA; product blobs are preserved. This completes the bounded mixed-shred atomicity unit, not D04's remaining legacy-boundary/notification accounting or the full migration.