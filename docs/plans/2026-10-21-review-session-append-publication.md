# Review: persist appended entries before publishing them

Date: 2026-10-21
Migration base: `0813beef1`
Source chain: `b2489d93` accepts staged entries in persistence; `7cfc4563` applies persist-before-publication to the shared append primitive without copying the full history after initial flush.

## Problem and observed proof

_appendEntry publishes membership, index and selected leaf before _persist. A thrown initial open or subsequent append therefore leaves a failed user/prompt entry active in memory but absent on disk.

Rewrite/publication suite RED: **2 failed / 10 passed**. Real SessionManager initial user append and already-flushed prompt append both leave extra live entries after an injected pre-write failure.

## Adaptation

Persist staged initial membership before pushing the new entry into fileEntries/byId/leaf. _hasConversation and _persist accept the staged entry list so setup-only sessions remain fileless, while the first user/assistant still flushes all accepted setup plus itself. Already-flushed and in-memory append do not copy history. Caller label updates still occur after successful append.

This is a live-publication repair, not append-file atomicity: partial write or close failure can still leave bytes on disk, and an initial partial file can block retry via exclusive open. No cleanup/crash-durability guarantee. BranchWithSummary changes leaf before invoking append and remains a separate caller-owned publication candidate.

## Verification

Rewrite fault, file operations, save-entry, labels, system prompt restore and skill restore suites: **65 passed** across six files. Regressions assert previous entries/projection/selected leaf/saved prompt, unchanged disk or no file on the exercised pre-write faults, then successful retry and real disk reopen parity. Existing file-operation controls retain setup-only lazy creation and first-conversation persistence. No paid provider call.

`npm run check` passed (1712 files; two changed files formatted). Post-format owning suites passed **65 tests** again.
