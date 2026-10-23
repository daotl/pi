# Review: typed RPC client compaction retention

## Problem and final source

Parent `545d32775`; fixed upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Candidate `23b8ec32612a9308445fbc56c107d36dc452b1cc` exposes retention already supported by the compact RPC command/core. Current `RpcClient.compact` accepted only custom-instruction strings. Passing an object from JavaScript sent the whole object as customInstructions and omitted retention; typed callers could not express the supported command.

## Implementation

- Export `RpcCompactOptions =` core `CompactOptions` from rpc-client, modes and package root. It names the existing three-field core retention contract without colliding with the separate extension `CompactOptions` exported elsewhere.
- `compact(options?: RpcCompactOptions | string)` normalizes the existing string form and forwards customInstructions, keepRecentTokens and keepRecentMessages to the existing command. Undefined/no-argument calls remain supported.
- Preserve current `send(..., 0)` for long-running compaction, not the older candidate's generic request timeout. Server handler and retention algorithm are unchanged. Zero values and both-budget shortest-retained-history precedence stay owned by the current canonical core.
- Guide documents object/string/no-argument forms, zero budgets, valid tool-group boundaries, combined budgets and no-content failure. No duplicate RPC command, compatibility shim, new retry/validation layer, provider credential use or dependency changes.

## Behavioral proof

New real process-boundary regression uses RpcClient -> JSONL child -> actual runRpcMode -> AgentSession -> prepareCompaction -> extension-provided deterministic summary -> checkpoint publication. The child uses existing suite harness/faux provider, forbids fetch, and loads source aliases through the existing source resolver located with config.getPackageDir. It never uses external provider APIs/keys.

Initial unchanged-client RED: **5 failed / 2 passed**, wall **6.12s**. Requested 4-message and 5-token retention actually retained only `answer 3`; the large no-compaction budget incorrectly succeeded; the object focus persisted `Summary: [object Object]`. Two zero/combined controls happened to match the default and are not claimed as independent REDs. Temporary ts-expect-error comments existed only to exercise the known pre-repair public signature; all were removed when the exported public type was implemented.

The tests assert actual retained message texts, firstKeptEntryId source entry and the actual compaction entry's matching boundary/summary. No-content failure leaves messages unchanged; custom instructions appear in the session checkpoint for string and object forms. Default/no-argument and zero-message controls use the same real process path, not mocked send calls. The combined `{ keepRecentMessages: 0, keepRecentTokens: 10000 }` row distinguishes a lost zero-message override from configured defaults. Existing lifecycle/stop/restart/process-exit tests remain unchanged and verify compaction response lifetime.

Actual-source source-resolved CLI smoke with a real child process returned `{actualChildProcess:true, typedRetention:true, retained:["question 2","answer 2","question 3","answer 3"], checkpointBoundaryPersisted:true}`, exit 0, **0.64s**. The output field means the in-memory session contained a compaction entry with the returned boundary; it is not disk durability/reopen proof. Client cleanup ran in finally; executable temporary script removed. Outside-repository LSP initially saw stale dist/string-only declarations; runtime used the existing fail-closed source resolver and repository full TypeScript checks validate the actual public contract. This is real process/core/session-entry behavior, not live-provider, installed-package or disk-persistence verification.

Initial full check formatted five owned files. Post-format four-file run before the two extra boundary controls passed **12**, wall **20.63s**; full check passed **1765 files / No fixes applied**, wall **17.39s**. Final focused/check/independent-review/fixed-tree aggregate receipts are attached after actual results. No test skips/exclusions, timeouts or assertion weakening.

## Scope and review limits

LSP references inspected RpcClient.compact (7 including declaration and existing consumers). Graph initialization remains unavailable with WeakMap error; exact candidate/current source provided discovery and verification, without project/generation/coverage claims. Bounded independent contract/process reviews are read-only and skip build/lint/tests/formatters; parent owns execution and commit. No full CE/cross-model or exhaustive external consumer claim.

No branch/worktree/push, generated metadata, dependency/lock/changelog changes or edits to server/core retention. Existing swipe/restore/shred, harness exports and chat-template counting remain intact. Protected 749 daemon files stay outside staging and are compared with the recovery-time manifest, not an unavailable original manifest. This closes only the candidate's typed RPC client gap; entire 44-candidate migration remains active.

Independent contract review found no defects. Independent process review identified two proof gaps: a zero-message case indistinguishable from defaults, and boundary lookup that did not inspect the checkpoint. Both assertions were strengthened as above. The fixture intentionally uses an in-memory SessionManager; durability/reopen is outside this client's forwarding change and is not claimed. Source cleanup uses finally/stop plus the worker's normal process-exit harness cleanup; forced SIGKILL cannot execute child exit cleanup, an existing lifecycle limit.

Final post-format four-file run: **15 passed**, wall **10.78s**, from packages/coding-agent: `node ../../node_modules/vitest/dist/cli.js --run test/rpc-client-compact.test.ts test/rpc-client-lifecycle.test.ts test/rpc-client-stop-restart.test.ts test/rpc-client-process-exit.test.ts --maxWorkers=1`. Final full check: **1765 files / No fixes applied**, all stages passed, wall **12.87s**. Process reviewer reread the strengthened zero-message/checkpoint cases and returned no remaining concrete issue; contract reviewer likewise reported none. These are bounded static confirmations, not independently executed tests. Protected recovery manifest matched 749/749 files.

## Fixed committed-source/test aggregate

Normal explicit seven-path implementation commit `a51bdad99` included this review; full pre-commit hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed source/test tree: **8578 passed / 0 failed / 936 skipped**, exit 0, **99.67s**, full output `artifact://3844`. No new skips/exclusions or timeout/assertion relaxation. Only this receipt is amended afterward; tested source/test blobs remain unchanged. This closes typed RPC retention, not overall 44-candidate convergence.
