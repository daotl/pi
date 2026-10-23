# Review: remove the ignored previousSummary positional argument

## Problem and final source

Parent `8b62401c6`; fixed upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Candidate R10 #8 `6f1cfc1f5511b7ce600843d31eb72661587f9a80` removes the public summary helper argument that silently discarded caller context. Later review/documentation chain `243015b85e9159c785bdfa09053bb9eac12aab74` retains the messages-only migration: earlier checkpoints are ordered context, not an instruction to refold summaries.

## Clean cutover

- Remove only the ignored eighth positional `previousSummary` argument from `generateSummary` and `generateSummaryWithUsage`. `thinkingLevel` now follows customInstructions; every later stream/env/retry/callback/session/system/agent/history/clamp argument shifts left once.
- Migrate wrapper/compact calls and all observed test consumers, remove the ignored void statement and false compatibility/merge comments. No overload, deprecated alias, heuristic argument detection or compatibility shim.
- Keep `CompactionPreparation.previousSummary` and its population for extension metadata. Existing custom-compaction example reads that metadata and is intentionally unchanged. Earlier summary messages remain in the selected canonical prefix.
- Guide documents the public breaking signature change and ordered compactionSummary-message example. No root export rename, branch-budget change, token-counting downgrade, provider behavior or persisted schema change.

## Proof

Existing reasoning behavior test was first moved to the intended messages-only argument position before changing production. It failed **1 / 12 passed**, wall **1.20s**: `medium` was swallowed into the ignored slot and never reached dispatch reasoning. After cutover, existing reasoning/off/nonreasoning, prefix, retry, policy-removal and native budget tests exercise the migrated positions.

LSP references inspected both public helpers before mutation: generateSummary 11; generateSummaryWithUsage 20, including two stale references to an already removed temporary smoke. Actual in-repo callers were migrated. Seven longer test calls used AST-aware removal of exactly the eighth argument, followed by normal repository formatting; remaining reasoning consumers were shifted with targeted edits. LSP initially showed old-contract slot diagnostics, resolved by reloading TypeScript, then returned OK. Full TypeScript check validates the complete current repository rather than relying only on text search.

Post-format owning tests from packages/coding-agent: `node ../../node_modules/vitest/dist/cli.js --run test/compaction-summary-reasoning.test.ts test/summary-policy-boundary.test.ts test/summary-policy-retry.test.ts test/suite/summary-request-budget.test.ts test/compaction.test.ts --maxWorkers=1`: **102 passed / 2 existing skipped / 5 files**, wall **10.06s**. Final full `rtk proxy npm run check`: **1765 files / No fixes applied**, all stages passed, wall **12.76s**. Initial check formatted five owned files; no new skip/exclusion, timeout, type suppression or weakened assertion.

Actual-source standalone smoke loaded both public helpers with the existing fail-closed source resolver and observed `{actualSource:true, helpers:2, checkpointMessagesRetained:true, reasoningSlot:"medium", canonicalUnchanged:true}`, exit 0, **0.28s**. Earlier checkpoint plus new work/custom focus survived dispatch, reasoning reached medium and caller history remained unchanged. Local stream emitter only; no HTTP/provider credential. The temporary executable was removed. Outside-repository LSP saw source/dist private-type identity mismatch, not a successful static check; source runtime and repository TypeScript check are separate evidence.

## Scope and limits

Bounded contract/behavior reviewers inspect signatures/callers and message/policy preservation read-only, without checks/tests/formatting. Their outcomes and committed-tree aggregate are appended after actual results. This is not a full CE/cross-model or exhaustive external-caller compatibility review. Graph initialization remains unavailable with WeakMap error; exact source, fixed candidate diff and LSP references are the evidence.

No branch/worktree/push, dependency/lock/generated/changelog change. Current swipe/restore/shred, harness exports, canonical branch grouping, native output budgets and chat-template final counting remain intact. Protected 749 daemon files stay excluded and use the recovery-time manifest. This closes one public API final-chain behavior, not the whole 44-candidate migration.

SummaryApiContractAudit and SummaryApiBehaviorAudit both returned no actionable migration-created finding after comparing signatures, every observed argument tail, retained preparation metadata, checkpoint prefix, policy/retry/budget tests and documentation. Contract review confirmed thinking slot 8 through agent slot 15, with usage-helper history/clamp callbacks at 16/17. Neither ran tests/checks or claimed external consumer coverage. Protected recovery manifest matched all 749 files. Final scope remains six product/test/guide paths plus this independent review.

## Fixed committed-source/test aggregate

Normal explicit seven-path commit `a6bc6619d` includes the API cutover, all observed callers, migration guide and this review; full hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed committed source/test tree passed **8578 / 0 failed / 936 skipped**, exit 0, **97.50s**, full output `artifact://3878`. No new skips/exclusions, timeout or assertion weakening. Only this receipt is amended afterward; source/test blobs remain unchanged. Overall selective migration remains active.
