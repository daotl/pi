# Review: process aborted continuation before leaving its loop

Date: 2026-10-22
Migration parent: `23afc5033`.
Origin: independent `LateCompactBoundaryAudit` found a regression in `024392670`'s adapted standalone-continuation loop. This is an audit correction to the late-compact integration, not a durable-prefill redesign.

## Problem and RED

The new outer `while (!this._agentRunAbortRequested)` skipped `_handlePostAgentRun` after public cancellation. That method restores an incomplete echoed prefill before its own abort early-return; skipping it let finally clear the saved original while the truncated echo remained selected.

The existing provider-aborted test does not call session.abort and never sets that flag. A new public continue/abort regression waits for actual stream setup, delivers an aborted terminal with only `Part` of `Partial response`, and observes the truncated value instead of the original before the correction (**1 failed / 7 filtered**).

## Adaptation and verification

The standalone continuation loop always processes the just-completed outcome once. Existing post-run abort handling and `_continuePastSettleBoundary` stop subsequent generation; no global cancellation behavior or storage schema is changed.

Six owning prefill/queued-compact/deferred-persistence/actionable-boundary/retry-continuation/post-compaction-prefill suites: **83 passed**. Two public abort cases verify incomplete echo restores the full original, while complete echo plus new tokens remains intact in both live messages and SessionManager projection; session reaches idle. The completed-echo case is a post-fix control. Abort listener is removed, stream ended and run awaited during cleanup. Synthetic/scripted provider only; no actual provider request or crash-durability claim.

`npm run check` passed (1720 files; one test file formatted). Post-format owning suites: **83 passed**. Independent source-only follow-up confirmed the original finding corrected with no further assigned-scope finding; it did not rerun tests. Normal hooks remain enabled.
