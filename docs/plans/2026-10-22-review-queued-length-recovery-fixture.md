# Review: verify queued length recovery against the actual faux transport

Date: 2026-10-22
Migration parent: `77316eced`.
Source: final backup `cb3bee033ba853041609b874303dc625d5d30479` agent-session-boundaries.test.ts lines 1022–1034 expects both independent length attempts among durable omissions. This follow-up corrects an integration fixture exposed by the queue-only migration; no production change.

## Aggregate failure and source evidence

Authoritative isolated `./test.sh` at `77316eced`: **8105 passed / 1 failed / 945 skipped** (artifact2319). The sole failure is the distinct queued follow-up length-recovery case, expecting only the first length ID omitted while both are omitted.

The current fixture uses the default faux API, not openai-completions, so its old comment claiming return_prefill recovery is incorrect. Existing `_checkCompaction` handles recoverable length independently of context overflow and omits that attempt before recovery. Queue-only delegation also preserves the first completed recovery that the former fallback deleted before delivering follow-up. Independent source-only review confirms the frozen final assertion and no demonstrated production defect; no change to recovery thresholds or production omission policy is warranted.

## Adaptation and verification

Keep the four scripted outcomes, capture actual provider contexts/prefill flags, expect both length attempt IDs among omissions, and assert the distinct follow-up reaches its request, no request uses prefill, the first completed answer remains in raw history, and the final answer is the recovered follow-up. Preserve the four-call bound. This replaces an invalid transport assumption with consumer-visible outcomes, not a narrowed test.

Boundary/queue-only/retry-lifecycle/queued-compact owners: **71 passed**. All requests are faux/scripted; no live provider or durable in-flight prefill claim. Source-only reviewer did not run tests.

`npm run check` passed (1723 files; one test formatted). Post-format owning run: **71 passed**. Normal hooks remain enabled.
