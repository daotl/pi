# Review: keep ordered patches before one replaceable prefill slot

Date: 2026-10-22
Parent: `ad76207dd`.
Source chain: authored `e3f076aa28c4d7c1373a3e68a35cbfd07a199bff` hunks45398–45410 place already accepted pending input before the assistant prefix; hunks45506–45531 replace the original slot for terminal-only/end-only completion. Final `5ee2a4ea9aea9453af2790f0acfd5db481fcd418` hunks74–123 rotate ordered trailing system patches before pending insertion and again after request preparation. Final backup `cb3bee033ba853041609b874303dc625d5d30479` loop325–337 explicitly retains the pending-input splice. No intermediate whole-loop implementation copied.

## Defect and RED

Explicit low-level returnPrefill contexts could end with policy/tool patches instead of the assistant. Streaming then appended a second prefix rather than replacing the original. Even without patches, terminal-only and no-event completion appended instead of replacing. The next actual Completions conversion consequently emitted duplicate call IDs and synthetic missing-result artifacts.

A 24-row consumer matrix ran before production edits: **22 failed / 2 no-patch streamed controls passed**. Dimensions: stream/run APIs × none/patches/patches-steering/prepare-patches × start-update/terminal-only/end-only. Four no-patch terminal/end-only rows observed actual converted wire call IDs `[call_once, call_once]`; patch rows observed wrong first request order. Assertions outside stream callbacks avoid swallowing failures through loop normalization.

## Final adaptation

- Rotate only trailing system patches around the effective assistant prefix, in place with copyWithin. Older history and policy positions remain unchanged; ordered suffix order preserved. No extra copied message array.
- Before request preparation, accepted prepared/pending messages insert before that final prefix when returnPrefill is active. This is the final authored contract, not a new steering policy. Public Agent approved-prefix continuation still skips its initial steering poll as already landed.
- After preparation, rotate again because the callback may replace the context or append policies.
- Streamed, terminal done/error and end-only paths target the same final assistant slot; no original-prefix mirror remains. A terminal without start still emits its single message_start/message_end pair.
- ReturnPrefill resets only after that first response. Ordinary requests do not rotate history or change insertion behavior. Current execution-model tracking, route API guard, finalized canContinue and awaited publication barrier remain unchanged.
- README documents low-level mutable context and ordered patches/pending input. No AI adapter production change, new dependencies, experimental harness change or changelog on crystal.

A received advisory claimed the splice was absent from final design. Exact source disproves that: final backup331–335 and authored merge45404–45408 contain it; the RED steering rows require prefix-last placement. The implementation retains the evidenced final behavior rather than removing it based on that stale claim.

## Verification

After production fix: **151 / 4 Agent owner files**; adding routed owner and formatter rerun: **156 / 5**. Added ordinary non-prefill no-rotation and terminal-only error/aborted one-slot/event controls: **159 / 5**. Session continuation/system-tail/receipt/queue-only/virtual-model/queued-compact owners: **61 / 6 files**. The 24-row regression uses current actual Completions convertMessages and current typed compatibility arguments (the backup's getCompat module does not exist here and is not recreated). It asserts exact first request, one tool execution, first-response-only flag, one converted tool call and genuine result, next request and final mutable context.

Actual Node source-resolver low-level smoke observed request roles `[user, system, system, assistant]`, ordered policy1/policy2 and **one final assistant slot**. Initial temporary smoke kept a reference to the mutable request array, so its post-run assertion saw the final replacement and failed; snapshotting at dispatch fixed the smoke without a production change. This explicitly confirms mutable context, not immutable-wire storage. No HTTP/credentials. Temporary file removed.

Check chronology: first new matrix formatted **1733 files, Fixed 1** and passed. Extra controls check again **1733 files, Fixed 1** and passed, including browser smoke. Final check and normal commit hooks passed **1733 files, No fixes applied**. Committed source/test/public-doc tree `73837e536` passed root `rtk proxy ./test.sh`: **8194 passed / 0 failed / 945 skipped**, exit 0, **88.50 seconds**, full output `artifact://2583`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifacts rechecked on committed tree: **749 files / 0 mismatches**.

## Limits

No immutable-history promise, Session durable capture/replacement/restoration, `PrepareRequestContext.returnPrefill` field, physical origin policy, tokenization authorization or usage identity completion. Parent signed-empty source/test tree `b4a134217` aggregate was **8167 / 0 / 945**, 87.73 seconds, `artifact://2548`; `ad76207dd` amended only its review. Not current-unit aggregate evidence.

Final post-format owners: **159 passed / 5 Agent files**; final `npm run check`: **1733 files, No fixes applied**, including browser smoke. PrefillRotationAudit and PrefillReplacementAudit independently returned correct/no findings, checking final provenance, ordered system-only rotation, pending placement, replacement callbacks, wire tool ownership, lifecycle balance and ordinary-request controls. Both were static-only and ran no tests/checks/builds/formatters; runtime evidence is parent execution. Protected user artifacts: **749 SHA256 / 0 mismatches**. Graph generation/coverage unavailable (WeakMap); exact source/LSP fallback, no exhaustive caller claim.
