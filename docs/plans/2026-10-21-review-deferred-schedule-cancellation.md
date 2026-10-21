# Review: keep deferred scheduled actions visible and cancellable

Date: 2026-10-21
Migration base: `3bf824731`
Source: `6f1cfc1f` deferred schedule listing and cancellation (interactive diff:5-55). No scheduler claim/preflight/cadence changes.

## Problem and RED

When a due continue/edit action moves into deferredScheduledActions, list/cancel APIs see only scheduledMessages. User cannot discover/cancel it, and -N can cancel an older pending item instead. Three cases fail (**3 failed / 29 skipped**): missing deferred ID in output, deferred ID not removed, newest cross-queue cancellation wrong.

## Adaptation

List both queues in ID order. Cancel by ID from its owning queue. For -N choose newest accepted IDs across both queues and clear their current timers. Keep separate queues and existing delivery order/state, with no schema or timer policy change.

## Verification

Schedule, scheduled-edit and heartbeat suites: **105 passed**. New controls exercise real list/cancel methods against pending/deferred state and assert retained/removed IDs; list output assertion checks user-visible identifier/payload, not incidental prose. Existing long-deadline cancellation remains covered. No initialized TUI/drain/preflight proof claimed.

`npm run check` passed (1717 files; test formatted). Post-format owning suites: **105 passed**.
