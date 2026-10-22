# Review: boundary continuation preview ignores trailing system patches

Date: 2026-10-22
Parent: `b9c10cb56`.
Source: authored `e13924536243de16b20af0b0eb8d117056f22ec8` hunk321–329; final backup `cb3bee033ba853041609b874303dc625d5d30479` same effective-role predicate. Only two production lines, not extension-runner or scheduler architecture.

## Defect and RED

BoundaryContextPreview.canContinue used the literal final role. A policy/tool system patch after a completed assistant therefore advertised runnable context, even though the landed Agent continuation contract correctly rejects the effective assistant tail. At final settlement, accepting the invalid request made Session.prompt fail rather than settle normally.

The clarified public Session fixture produced **2 failures** before production changes: turn_end observer saw true instead of false; agent_before_settle requested invalid continuation and Agent rejected with assistant-tail precondition. No private preview invocation, source-text assertions or replacement custom/user message.

## Fixture timing evidence

SessionBoundaryDraft supports custom/custom_message/context_edit/compaction, not system patches. A custom_message would change the model-visible final role and test another problem. The fixture injects an already-constructed SessionManager; the first public turn_end handler appends a system policy after assistant persistence, and the next turn_end observer or later agent_before_settle observer reads context and requests continue once.

A received advisory claimed the next handler retained stale context. Exact runner source disproves it: emitBoundary builds initial context at1027, then rebuilds at1051–1053 after every handler before constructing the next event. Both observers therefore see the actual policy tail. An initial closure referenced the harness only when prompt later invoked the callback (no runtime TDZ); it was clarified to preconstructed manager and the same two consumer failures rerun. No runner production change was needed.

## Final adaptation

Use the final non-system LLM-visible message role and define non-system context from its existence. Completed assistant plus policies remains non-runnable; system-only remains empty; actual user/tool-result input, pending custom context and existing steering/follow-up policies retain their rules.

Extension guide documents effective-role semantics and per-handler refreshed context. No public signature, extra allocation, schema, retry, compaction, harness export or upstream swipe/restore/shred change. No changelog on crystal.

## Verification

Five Session owner files passed **72**, again post-format: new boundary tail, full actionable boundaries, queued compact, completed-answer refusal and explicit projection. Native Node existing source resolver with actual SDK/DefaultResourceLoader and controlled faux provider: completed answer plus trailing policy produces **canContinue false**, **1 provider request**, retained answer, idle true. No HTTP/real credentials. Temporary smoke removed.

Initial check passed **1737 files, Fixed 1** (new test formatted), including browser smoke. Final check/hooks, static audits and fixed-tree aggregate recorded after execution.

Parent physical-origin source/test tree `9a9b7e5db` aggregate **8206 / 0 / 945**, 94.38 seconds, `artifact://2685`; `b9c10cb56` amended its review only. Not current-unit aggregate proof.

## Limits

This does not redesign boundary draft transactionality, continuation input policy, effective saved prompt/loadout, durable prefill capture, tokenizer authorization or usage identities. Only system transparency in canContinue is migrated; native terminal and real-provider behavior not tested.

Final check: **1737 files, No fixes applied**, including browser smoke. BoundaryEffectiveTailAudit and BoundaryFixtureTimingAudit independently returned correct/no findings for bounded static review of effective role, queue/custom continuation rules and actual per-handler preview timing. Neither performed edits, runtime tests, builds, checks or formatters; runtime evidence is parent execution above. Protected artifacts: **749 SHA256 / 0 mismatches**. Graph generation/coverage unavailable (WeakMap); exact source/LSP fallback, no exhaustive external-extension claim.

Fixture closure after the first normal commit: add an explicit one-shot patched guard to policy append so a regression's extra turn cannot accumulate policy entries. Five focused owners again **72 passed** and check **1737 files, No fixes applied** before same-unit path-limited amendment. Production two-line behavior unchanged. Normal amendment hooks passed **1737 files, No fixes applied**.

Committed source/test/public-doc tree `2e9590b4b` passed root `rtk proxy ./test.sh`: **8208 passed / 0 failed / 945 skipped**, exit 0, **106.82 seconds**, full output `artifact://2718`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifacts rechecked on committed tree: **749 files / 0 mismatches**.
