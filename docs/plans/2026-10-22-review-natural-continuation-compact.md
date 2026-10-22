# Review: preserve finalized continuation through queued compaction

Date: 2026-10-22
Parent: `d69228941` (terminal barrier; documentation-only amendment of source/test tree `3d5c2fc90`).
Source chain: authored boundary-input recovery in `e1f9cdc22ecbc3b690625b44ea3aa934592eef79`, superseding the tool-result-only intermediate guard in `92d3171664cdd8fd4e5c67b38d49332a071043a3`; finalized natural tool-batch contract in `243015b85e9159c785bdfa09053bb9eac12aab74`. Final backup: `cb3bee033ba853041609b874303dc625d5d30479`, Agent types/loop and Session `_installAgentQueuedCompactStop`. No imported architecture, harness deletion, upstream swipe/restore/shred cutover, or other original upstream candidate.

## Problem and RED

Session returned any prior finishTurn decision before considering queued compact. A boundary handler that committed next input and requested continue could therefore dispatch that request before compaction; cancellation was too late. Separately, the presence of tool results was treated as runnable work, restarting an all-terminating batch after compact.

Before production edits, the new Session regression matrix had **4 failures / 2 passing controls / 22 filtered**:

- Terminating tool restarted and published `continued runnable work`.
- Successful compact ended after the next boundary answer rather than before it.
- Ordinary compact failure consumed the task response in the wrong phase and lost the intended answer.
- Cancellation still dispatched the boundary instruction.

The new low-level Agent consumer matrix had **10 failures**: the completed-turn context did not expose finalized `canContinue`; an actual callback could not preserve naturally runnable batches. This RED observed missing values (not a compiler error); mixed/hook-resumed scenarios also lacked their second provider request. Cases cover sequential/parallel execution, all terminating, mixed, afterToolCall overrides and error/aborted hard exits. Initial fixture converter type errors from repo-wide custom AgentMessage augmentation were corrected with role narrowing before execution; no `any` or provider HTTP added.

## Final adaptation

- Required `AgentTurnContext.canContinue` carries only the already-computed finalized natural tool-batch decision. Normal completed turns use `hasMoreToolCalls`; error/aborted paths use false. No extra tool walk, result copying or queue poll.
- The Session queued compact always ends the low-level run at this boundary, retaining the prior decision only to determine post-compact resumability. Explicit end and failure/abort remain ended. Natural continuation can resume; explicit continue additionally requires canonical runnable boundary context.
- Existing cancellation/failure/retry and late-settlement machinery remains unchanged. Completed tool-less context-only continue is not permission to regenerate its answer after compact; newly committed custom boundary input remains runnable after success or ordinary failure, not cancellation.
- The existing faux suite harness gains one optional FinishTurn injection so tests use the actual before-Session hook composition. Default harness behavior unchanged; production experimental harness untouched.
- Public Agent README and compaction guide document the new field and boundary semantics. No changelog on crystal.

TypeScript LSP references were checked before changing the exported context. AgentTurnContext appears in FinishTurn and PrepareNextTurnContext; the latter resolves to nine references across Agent/loop/Session. Both actual completed-turn construction sites now provide the field. Full check validates structural callers. Graph docs still fail WeakMap and cannot establish project/generation/coverage; exact source fallback used.

## Verification

After the production fix, Agent owners passed **123 / 3 files**, and full queued-compact owner passed **28**. Added explicit-end and tool-less continue controls plus post-format runs passed **137 / 4 Agent files** and **51 / 5 Session files**. Session owners also include deferred persistence, queue-only continuation, retry/continue lifecycle and file-backed terminal receipt, preserving adjacent landed contracts.

Native Node source-resolver smoke exercised actual Agent.prompt and finishTurn: terminating batch **1 provider request / [false]**; runnable batch **2 requests / [true,false]**, both settled idle. It uses the existing workspace source resolver for all package identities, a controlled local stream and no network. Temporary smoke removed after use.

`npm run check` passed **1726 files, Fixed 2** (new tests formatted). The subsequent normal hook while amending only the preceding review passed **1726 files, No fixes applied**, including browser smoke, against this current working tree. This is current-tree check evidence, not a new-unit aggregate.

Parent terminal fixed source/test tree `3d5c2fc90` passed root `./test.sh`: **8121 passed / 0 failed / 945 skipped**, 95.49 seconds, `artifact://2383`; its review-only amendment is d69228941. This new unit's committed source/test/public-doc tree `359048384` then passed root `rtk proxy ./test.sh`: **8139 passed / 0 failed / 945 skipped**, exit 0, 82.01 seconds, full output `artifact://2410`. Its normal commit hooks passed **1726 files, No fixes applied**. No next-unit source/test changes were made during that aggregate; this amendment changes only this review record.

## Boundaries

No physical routing, saved prompt restore, tokenizer policy, branch-summary grouping, in-flight durable prefill replacement, usageSourceId, completed-summary receipt or TUI migration is included. The already-recorded original-prefill duplicate usage remains pending S10; this unit neither changes accounting nor claims it repaired. Tests are controlled offline stream consumers, not real-provider validation.

Independent bounded static audits NaturalContinuationAudit and CompactDecisionAudit both returned correct/no findings, tracing finalized hook overrides, hard exits, queued decision precedence, explicit end, committed boundary input, cancellation and adjacent settlement/retry handling. Neither ran tests/checks/builds/formatters; this is source-only corroboration, not independent runtime evidence. Protected user artifacts: **749 SHA256 checked / 0 mismatches** immediately before commit.
