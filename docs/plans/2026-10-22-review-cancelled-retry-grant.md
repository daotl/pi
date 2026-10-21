# Review: discard retry-derived compaction resume after backoff cancellation

Date: 2026-10-22
Migration parent: `a956fa6b7`.
Origin: independent `CompactRetryBoundaryAudit` found an integration defect in the adapted final authored retry-priority logic. This corrects the just-migrated unit rather than importing unrelated continuation behavior.

## Problem and RED

Queued compact returns a resume flag including an eligible retry grant. `_prepareRetry` can then return false because `abortRetry()` aborts backoff, without setting the whole-run abort flag. The old fallback reused the compact's saved true flag and dispatched a request despite retry cancellation.

New public session regression covers no compact, successful compact and genuinely failed compact. It waits for actual nonzero backoff, calls `abortRetry`, and asserts no additional task request and final idle state. Before the correction, success/failure compact rows each dispatch two requests instead of one; no-compact control passes (**2 failed / 1 passed / 15 filtered**).

## Adaptation

When falling through after a previously eligible retry was not prepared, do not reuse its retry-derived compact resume. Successful `_prepareRetry` still returns through the existing branch. Ordinary non-retry runnable boundaries retain compact resume, and accepted queue presence retains its existing path. No global abortRetry semantics change, special-case input, or additional retry state.

## Evidence and limits

Initial four owning suites: **30 passed** after the fix. Independent source-only recheck confirms the reported defect resolved and no additional introduced defect in this scope; the reviewer ran no tests. Temporary expanded follow-up controls exposed the existing queue-only continuation's two-stage behavior even without compact; those controls were withdrawn rather than pinning a three-request incidental path. Queue-only/approved-prefill precedence remains a separate frozen S2 migration unit. The retained three-row regression proves cancellation with no separately accepted input, not complete queued-input parity.

All tests use faux/scripted transports; no live provider or physical TUI claim. The prior aggregate at `a956fa6b7` was **8059 passed / 0 failed / 964 skipped**, before this audit correction; it is not post-correction proof.

`npm run check` passed (1719 files; one test file formatted). Post-format owning suites: **30 passed**. Independent recheck remains source-only; normal commit hooks stay enabled.
