# Review: consume late queued compact before settlement

Date: 2026-10-22
Migration parent: `8548425ff`.
Source: `6f1cfc1f5511b7ce600843d31eb72661587f9a80` final-boundary queue repair, refined by `aecd44347d2ada4e38b44f0fd8006bd881ae0872` shared `_continuePastSettleBoundary`; final backup `cb3bee033ba853041609b874303dc625d5d30479` retains that helper. Do not import the backup's separate prefill persistence/usage/restore architecture.

## Problem and RED

A compact accepted by `agent_before_settle` after the final assistant boundary is left pending instead of executed. The standalone continuation loop also never invokes that final boundary. New public prompt/continue cases each fail because the selected branch has no compaction checkpoint (**2 failed / 18 filtered**).

## Adaptation

Share final-boundary continuation selection between prompt and standalone continue: honor abort; run existing before-settle boundary; if it does not request continuation, consume queued compact before reporting settled. Actual retry continuation still uses `_continueOnce`; explicit final-boundary continuation uses Agent.continue directly, matching the final authored distinction. Do not alter queued user policy, retry budgets or storage transaction semantics.

## Verification

Five queued-compact/actionable-boundary/continue-prefill/retry-lifecycle/post-compaction-prefill files: **77 passed**. New four-row prompt/continue × success/cancel controls verify successful checkpoint publication or no checkpoint on cancel, one compaction completion before settlement, no extra provider request, cleared queue and idle state. Cancellation rows are post-fix controls, not original RED. The first owning invocation included a nonexistent continue filename and therefore ran only two actual files (53 passed); the subsequent five-file command used discovered real paths and is the authoritative owning result.

All operations use existing harness/faux public session APIs. No paid request, physical TUI or completed-summary usage receipt claim. Preparation/tokenizer policy and full durable prefill remain independently tracked.

`npm run check` passed (1719 files; one test file formatted). Post-format five-file owning run: **77 passed**. The sole queueCompact call in each new case is inside its final-boundary handler; actual completion/checkpoint state proves that path without a private fixture-flag assertion.
