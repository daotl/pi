# Review: verify the terminal prefill before publication and tool execution

Date: 2026-10-22
Migration parent: `c7cc34041`.
Source chain: `778e0120721a2978abedd9ce60f945427f5c9ee2` moves full echo verification ahead of publication/tool preflight; `aecd44347d2ada4e38b44f0fd8006bd881ae0872` adds failure abort/event pairing; `7cfc4563ad539607c1f02ef56bd76b38d5fcacf5` adds raw-less semantic JSON equality; `5ee2a4ea9aea9453af2790f0acfd5db481fcd418` names the internal cross-package terminal receipt carrier and supports cause. Later `f2970f807e4121823162581ebb8d7495f52f3785` extends Session prepublication receipt ownership; those storage/listener changes remain pending, not part of this unit. Adapt against final backup `cb3bee033ba853041609b874303dc625d5d30479`, not an intermediate guard or whole Agent architecture.

## Current defect and RED

The old complete-echo fallback ran after runContinuation returned, potentially after returned tools executed. A matching streamed partial also permanently bypassed the terminal comparison. Initial public Agent regressions produce **4 failed / 1 control passed**: three incomplete successful terminals execute a terminating tool (start-only, previously matching partial, and no-start delivery); a streaming mismatch leaves its request signal live. Assertions stop at those observed consumer defects, not later receipt/event controls.

After moving the barrier, a second raw-less argument matrix produces **5 failed / 1 control passed**: same-name calls with changed scalar/nested/array/key/null values still execute. Reordered object keys already pass. This separate RED establishes why name equality is insufficient.

## Final adaptation

- Successful terminal message_end always revalidates the entire prefill before Agent publication and subscribers/tool preflight, regardless of a prior streaming match. Only terminal success/finally clears the pending prefix. Remove the obsolete post-run fallback.
- Raw-token prefixes remain exact. Raw-less calls require semantically equal JSON arguments: object order irrelevant, arrays ordered and nested keys/values exact. Streamed arguments remain provisional until terminal validation.
- Failure aborts its active provider signal while retaining pre-abort error versus user-aborted classification. Close an already-open assistant message instead of publishing another start.
- Internal exported TerminalResponseError carries only a completed prepublication response. Failure publication spreads its exact physical metadata/usage but clears untrusted content. Streaming-only failures invent no completed charge. Already-persisted responses must not be wrapped by future callers.
- AgentSession's existing mismatch test now checks error-event recovery and restored prefix rather than the removed late post-run rejection path. Durable capture/replacement architecture is unchanged. All experimental harness exports remain intact.

LSP references for prefillEchoComplete identified both Session completion/restoration consumers before the exported behavior change. No new dependency or Node-only deep-equality import is introduced into browser-facing Agent code.

## Verification

Agent/loop/new terminal owner files: **127 passed**. Added controls include complete successful echo/tool execution, previously matching streamed partial followed by truncated text/reasoning/raw terminal, raw-less changed arguments and reordered-object positive, incomplete streamed arguments that complete correctly, content-free completed usage/physical identity, signal abort and balanced message starts/ends.

Six Session consumer files: **52 passed**. The new file-backed cross-package test reopens actual JSONL, verifies exactly one content-free terminal receipt with nonzero usage/provider/model/responseId, its physical model cost/token breakdown exactly once, absence of rejected terminal content, and restoration of the original partial in effective context. Earlier two-file receipt run passed 10 before the accounting control was expanded; 52 is the authoritative broader result.

Actual-source temporary smoke: **0 tool executions**, aborted signal, physical provider/model retained, **23 tokens**, empty failure content. Uses source Agent and controlled in-process stream, not stale compiled Agent; no HTTP/provider request. Initial temporary smoke TypeBox entry path was corrected using installed package exports before execution; temporary TypeScript was runtime-only and is not typecheck evidence.

## Explicit remaining S10 limitation

An additional whole-session totals control failed: restoring the original partial copies its historical usage and current totals count both original/restored entries. Observed expected input1309/output11/total1325 versus actual input2607/output15/total2627. This is the frozen pending usageSourceId/clone-dedup contract, not a duplicate terminal receipt. The failing whole-session control was removed from this bounded barrier test rather than pinning the wrong total; exact evidence is retained in external behavior-reconciliation.json. The permanent test retains physical terminal charge attribution exactly once. No complete historical billing, write/rename replacement-failure receipt, HTML export, crash durability, routing or rawDelta transport completion claim is made.

A first npm run check formatted three files and found inferred optional undefined properties in the heterogeneous JSON matrix. Its row type was narrowed to the actual tool-call JSON arguments; the subsequent check passed (1725 files; two further files formatted). Final post-format checks and commit hooks are recorded below.

Final post-format verification: `npm run check` passed, **1725 files, No fixes applied**, including browser smoke. Agent owners again **127 passed / 3 files**; six Session owners again **52 passed / 6 files**. Protected user-file SHA256 manifest: **749 checked / 0 mismatches**. Normal commit hooks also passed with No fixes applied. At committed source/test tree `3d5c2fc90`, root `rtk proxy ./test.sh` passed **8121 / 0 / 945**, exit 0, 95.49 seconds, full output `artifact://2383`. This aggregate ran before any next-unit source/test changes; this amendment changes only this review record, not those verified source/test/public-doc blobs.

Independent bounded source audits: TerminalBarrierAudit and TerminalReceiptConsumerAudit both report correct/no findings. They traced terminal checks, provisional raw-less arguments, failure abort/error classification, event pairing, Session persistence/restoration and physical receipt accounting. Both are source-only: neither ran tests/checks/builds/formatters; runtime evidence above is the parent's actual execution, not independent runtime corroboration. Graph project/generation/coverage remain unavailable (list_projects/check_index_coverage doc reads fail WeakMap; reported); exact source and TypeScript LSP fallback used.
