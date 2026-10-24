# Review: low-level stream failure and explicit prefill whitespace guidance

## Source and scope

V05 source-ready Agent README guidance from candidate #9 `deede133ff5bc52ba82ea52f01ea27acd712a430` asynchronous low-level failure and candidate #17 `12ae8641ab5b34f980391b0393b8b1cd7ec84062` explicit prefill whitespace. Current implementation and constituent tests already exist; no new error protocol or prefill behavior.

Read the complete Agent README and exact source: agent-loop.ts105-131,235-294 settles async failures through terminal events while rejecting invalid initial continuation synchronously; openai-completions.ts1305-1369 preserves explicit trailing text/supported raw reasoning whitespace while ordinary replay filtering stays unchanged. Add one paragraph beside terminal echo guidance and one after low-level observational-stream guidance. No API example, low-level mutable-context contract or tool ordering change.

## Verification and delivery

Existing Agent loop/terminal-prefill consumers **81 passed / 2 files, 1.01s**: agent-loop.test.ts and prefill-terminal.test.ts. Existing AI explicit-prefill converter owner **14 passed / 1 file, 0.43s**: openai-completions-tool-call-prefill.test.ts, including text/thinking/mixed whitespace and ordinary replay controls. This is constituent behavior proof, not a new HTTP/SSE-to-tool composed scenario. The documentation describes existing call-time versus async-event error handling, not a new Promise rejection contract.

Code review: skipped (ce-code-review unavailable). Both bounded native source/proof reviews report no actionable findings; neither executed tests or independently verified timings. These are supplemental, not CE/cross-model receipts. No real provider HTTP, physical terminal, every async hook failure or process-crash claim. Documentation-only unit owns Agent README and this review; normal hook validates checks. No new root aggregate claimed. Other V05 guides remain separate.

Normal documentation commit `3a1e1f8be` passed its full hook: **1770 files / No fixes applied, 11.54s**. Both independent reviews completed before commit. The following review-only amendment records this hook receipt; Agent README content is unchanged. No new root aggregate is claimed.
