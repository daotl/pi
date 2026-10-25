# Review: repairs from full merge and follow-up diff review

## Scope

Parent tree `5732877aada8298caf98c7c4c616b2dd17a24f13`. Source review: `2026-10-25-review-full-merge-and-followups.md`. User requested repair of its retained findings. This unit covers #1, #2, #3, #4, #5, #6, #7, #10, #12, #13, #14, #15, plus the #11 first-flush fault matrix. Rejected candidates #8/#9 are not implemented. #11 began as a coverage gap; actual post-open write/close regressions then established a retry defect.

No upstream replay, branch/worktree/push/PR/ticket, released changelog, dependency or generated-model change. Existing swipe/soft-delete/restore/shred/id0 behavior, direct-upload authorization and full chat-template counting remain required. Existing 749 untracked environment-target files are excluded. The source review was degraded because one validator batch exceeded its normal size; its source conclusions are not used as runtime proof here.

Round sections retain their pre-commit status as historical snapshots, not current open work. Their successor headers record the completed repair commits: round 1 `fe50e664f82286dc460c6adc5653addc5bf55901`; round 2 `8daceb2998221a8465630320ee8c76353b68c720`; round 3 `510b7d3031edc3421f74541b053b80ba3edce467`; round 4 `50a522d52e016cd47fea5bc355da84f72b9e9f8f`; round 5 `8d9c6473a9e5fb342222f98fffef9228934612b3`; round 6 `90a97b2ea16655a3c790f7085472e02bcca463d1`. Only the latest section determines current loop status. Round-7 three-reviewer provenance is grounded in the actual agent-native-reviewer.json finding at lines 3-24 as well as security/correctness reports; all are same-family reviews, not cross-model independence.

## Implemented behavior and observed proof

- #5: Any assistant terminal rejected before publication carries its completed physical identity/diagnostics/usage through `TerminalResponseError`. Actual ordinary listener RED lost all metadata and charged zero; fixed ordinary/prefill owners **13 passed / 2 files, 4.62s**. No postpublication duplicate receipt is introduced.
- #2: Low-level failure finalization tracks the active request context, including preparation replacements, and replaces the pending partial before emitting the synthesized error/abort. Actual **12 REDs** across start/continue, error/abort and same/request/next-turn context; final Agent owners **89 passed / 2 files, 1.34s**. Raw run API exception propagation remains unchanged.
- #6: Accepted swipe selection, regeneration preparation and genuinely branch-selecting edits discard recovery owned by the abandoned prefix after durable commit. `id=0` with an anchor creates a new sibling version via branch(parent)+append; its no-anchor replacement fallback does not count as branch selection. Actual **4 REDs** restored the abandoned partial on the next request despite explicit selected contents/leaf; branch/recovery and queued-compaction owners **49 passed / 2 files, 3.41s**.
- #7: The settle decision is captured before consuming queued compaction and supplied as a resume reason. No queued compact preserves the decision; cancellation remains false; success and ordinary failure preserve valid continuation. Combined compact+continue success/failure/cancel produced **3 REDs**, then **3 passed**, and the complete two owners passed as recorded above.
- #4: Ordinary quit aborts/flushes retained charges before suspending the renderer; signal quit first delegates abort/flush to `runtime.dispose()` before terminal writes. Storage rejection resets the latch and keeps the same Session/UI/signal registrations. Fresh review exposed a late-failure hole in the first repair: destructive `stop()` cleared schedules, heartbeat deadlines and extension input callbacks before disposal succeeded. Actual late-failure RED reproduced the lost schedule. Final two-phase shutdown suspends only rendering, restarts the same host on rejection, and performs destructive cleanup only after successful disposal. The late-interactive test preserves schedule/heartbeat records and invokes the pre-existing input callback after recovery. Shutdown also excludes queue/schedule/heartbeat dispatch across abort settlement and redrains retained work on rejection. Actual held-provider shutdown regression proves no premature request and one retained dispatch after the failed flush. Final post-format shutdown/scheduler/#5080/#5724 owners **88 passed / 4 files, 15.37s**. Failure refuses quit rather than discarding a RAM-only receipt; dead-terminal emergency exit 129 remains the existing limitation.
- #10: Heartbeat outcome is not finalized while an already-processing fallback remains in asynchronous preflight. Actual started/handled/rejected **3 REDs** dispatched a later edit too early. Final three owners passed above. An intermediate rejected fixture incorrectly left configured-auth short-circuit active; it was corrected to exercise actual auth rejection, not treated as a second product defect.
- #1: Export initialization distinguishes explicit null selected leaf from absent legacy metadata. Actual live/file public source exports rendered one historical message before the fix; Chromium now renders an empty transcript, retains deliberate tree navigation, honors explicit URL selection and returns to empty on Escape. Legacy absent-leaf fallback remains. No permanent source-text or fake-DOM test was added; no existing DOM fixture exists. Before/after DOM and screenshots were captured; visual pixel inspection is not claimed.
- #13/#14: Shutdown endpoint accounts for separately painted overlay rows; preserveScreen is unchanged. CR-bearing physical backing materializes only supported row-local overwrites with whole graphemes and existing SGR/OSC8/forward-cursor handling. Actual original **3 REDs / 1 passing control**; final TUI owners **93 passed / 4 files, 2.43s**, including colors, wide/combining content and preserveScreen. Empty-transcript stop already passed before the repair. No general terminal emulator or unsupported ANSI expansion.
- #3: Session-format guidance now distinguishes projected interactive rendering from unchanged raw records/exports/accounting, without a universal producer-notification promise.
- #15: OAuth test module type moves to a top-level type import. Existing OAuth shutdown owner **3 passed, 0.45s**. Type-only standards correction; no runtime defect RED claimed.
- #11: Initial exclusive creation followed by write, write-after-output or close failure left a partial/complete target while the entry remained unpublished, preventing retry. Actual **3 REDs** observed the leftover file. The failed attempt now closes best-effort and removes only its exclusively created file, preserving the first error and unpublished state; successful retry/reopen contains one accepted message. A foreign exclusive-open collision is retained unchanged. Rewrite/selection/durable owners **59 passed / 3 files, 4.05s**; no process-crash/concurrent-writer guarantee.

## Native chat-count request fidelity (#12)

Actual strengthened native fixture RED observes internal `toolsAdded`, `toolResult` and `image` blocks where the inference request uses request-level tools, `role:tool`, function calls and `image_url`. The lazy helper now reuses the actual native inference builder and simple-option preparation; a separate count request drops generation controls after template budget resolution. Inference builder types remain unchanged. The Session rechecks context policy and native transport permission after awaited lazy serialization before upload. Effective tools come only from declarations in policy-converted messages; active executable tools are not reinserted. Strict tests prove omitted policy declarations yield no request tools, and compare image/tool/template content against controlled actual native inference HTTP payloads across three template formats. AI owners **82 passed / 5 files, 1.71s**; Session owners **232 passed / 10 files, 19.52s**. No live server numerical-count or all-provider wire claim; no text-only downgrade.

## Verification and review boundary

Focused observations above were run by the integration owner, not implementation/review workers. Post-format Agent owners **89 passed / 2 files, 1.24s**; AI **82 / 5, 1.71s**; Session **232 / 10, 19.52s**, then final shutdown/scheduler controls **88 / 4, 15.37s**; first-flush/recovery **59 / 3, 3.85s**; TUI **93 / 4, 2.43s**. Final full `npm run check`: **1770 files / No fixes applied, 12.87s**. Earlier checks formatted 11, then 1, then 3 owned files; failed intermediate type checks are not final-green evidence. Reuse review found no change; quality replaced a nested expectation ternary with an action-keyed record; efficiency reused the existing ANSI tracker without repeated parsing. Browser tabs and owned export fixture scripts/directories were removed.

## Aggregate and source identity

The first root aggregate failed **8806 passed / 1 failed / 915 skipped, 100.24s**, `artifact://5581`: #5724's minimal prototype context did not provide the redundant signal Session preflight. Signal now enters `runtime.dispose()` first, retaining its real abort/flush sequence; #5724 was not weakened. Subsequent fresh review found the separate destructive late-stop issue described above; the final run includes its two-phase repair and retained-registration regression.

Final isolated root `./test.sh`: **8808 passed / 0 failed / 915 skipped, 93.90s**, `artifact://5598`. The repair-only `git diff -U10 5732877aa` was identical before/after this run, SHA256 `961af0eb20bddc4de91312163b340bc9dc647a4637d7848219fee9cb02223c89`. This is the actual uncommitted source/test/guide tree; a later commit SHA is not retroactively called the tested SHA. Only this review receipt changes after verification.

### Actionable Findings

None remain from the accepted product defects or the confirmed #11 write/close retry defect. The rendered HTML export still has no permanent DOM fixture; actual live/file Chromium proof covers the changed surface, and absence of permanent viewer automation remains a testing limitation, not an unresolved product defect.

### Coverage

Fresh repair-only `ce-code-review` ran ten native personas against the 26 changed tracked paths. All completed; no malformed returns. No external peer was sent because supported serving-family independence could not be attested. Same-model reviews are not cross-model proof. Fresh review's duplicate late-shutdown findings were consolidated into one repaired root cause, plus the separately repaired abort-settlement exclusion. An independent three-item follow-up validator inspected current source/tests and confirmed both fixes and the viewer automation limitation; it performed no execution. No broader old full-merge clearance is inferred. The original full review's oversized validator deviation remains historical and is not reused as this repair's completion gate.

### Verdict

Ready locally within the stated scope. All original retained product findings are fixed, with the #11 coverage gap promoted only after real RED proof. No live tokenizer-server numerical, arbitrary ANSI, process-crash durability or dead-terminal cleanup guarantee is made. Original HTML browser automation is not a permanent test suite. Machine-local proof and review artifacts: `/Users/nex/.local/state/pi-review-repair-2026-10-25/` and `/tmp/compound-engineering-501/ce-code-review/20261025-review-repairs/`. No push or PR.

## Full merge review loop: round 1

Scope: fixed `839dc79197595a4285d711e37d02fb623e5b6b7b` -> `cee6de06220369eea3c2d06296abfafb333a1143`, all 416 changed tracked paths. The immutable snapshot digest is `2f0de79fdeba7f81aecddfa27b0c8a26b6df8da7e4ee8e67c0e97e74ec55fc2b`. This is a fresh complete merge diff, not the previous 26-path repair diff. Eighteen independent native workers completed: eight correctness domains plus ten justified cross-cutting lenses. Exact domain inventories partition all 416 paths without omissions or duplicates. Complete assigned-diff traversal is reported; deep whole-file clearance of every path is not claimed. Historical receipt lines and external/dynamic callers retain explicit evidence limits.

### Confirmed findings and repairs

- R1-#1 (P1; security + adversarial): a stable SDK converter reads live Block images and incoming-prefix settings. A held final-context transform allowed previously converted image bytes to upload after blocking was enabled. Both image and prefix regressions failed before repair. Finalization now reconverts the isolated rechecked context, compares the converted result, and checks built-in live policy values and callback/transport identities after awaited work. Stale counts are declined; complete multimodal/tool/template counting remains. Native authorization owner: 37 passed.
- R1-#3 (P2): a public `agent_settled` subscriber throw bypassed deferred completion rejection and idle-wait resolution. Actual regression failed with unresolved completion. Notification failure now discards not-started deferred actions with the same error and resolves idle waiters after clearing the emission flag. Successful deferred execution retains its prior idle boundary. Actual UI queue test restores the original batch before newer input and retries successfully. Scheduler owner: 55 passed. A separate actual-source runtime smoke observed original-error propagation, deferred rejection, idle resolution and a successful subsequent prompt.
- R1-#5 (P2): native pi-messages EOF/read rejection/abort synthesized an empty terminal assistant despite emitted raw tokens. Four regressions failed before repair. Terminal failure now retains the emitted partial, including raw arguments, content, metadata and diagnostics; pre-start setup failures remain empty. AI owner: 16 passed. Actual localhost HTTP SSE EOF smoke retained the raw prefix in the authoritative result.
- R1-#6 (P2): failed SYSTEM.md/APPEND_SYSTEM.md publication restored Session fields but left rejected loader caches eligible for later tool-loadout rebuild. Two extended regressions failed after toggling active tools. Rollback now pins accepted static sections/baseline/context inputs; the next actual provider request remains on accepted construction until an explicit update succeeds. Prompt transaction owner: 22 passed.
- R1-#7 (P2): prefill capture set Session streaming before the low-level run began, preserving a historical unresolved tool component as live. The real VirtualTerminal regression failed during held continuation. Preservation now depends on low-level Agent streaming ownership; the subsequent streamed/executing tool has one component and retains its identity.
- R1-#8 (P2): atomic heartbeat save renamed over a symlink rather than updating its target. A real-filesystem regression failed before repair. Save now resolves the existing destination before creating its sibling temporary file; alias, target bytes and permissions survive. Four held-save replacement/stop success/error cases also cover the previously reported test gap without changing accepted-snapshot semantics.
- R1-#10 (P2): physical row discovery ignored cursor-forward movement, then materialization inserted the gap too late. Two terminal regressions failed before repair. Supported CUF now participates in last-column clamping/pending-wrap decisions before row splitting; materialization reuses the overwrite-cell path. Actual VirtualTerminal overlay open/hide preserves both continuation rows and following Footer content. TUI owners: 75 passed.

### Validation, verification and exceptions

Ten raw candidates -> one semantic privacy duplicate merged, one pure heartbeat coverage gap demoted, eight candidates independently validated in one normal-sized batch. Seven retained. R1-#4 id0 usage identity was rejected as pre-existing: the fixed base already copied usage into a new unlinked version and counted it again. No unrelated billing change was made.

Post-format integration runs: coding-agent 215 passed / 7 files; AI 16 passed / 1 file; TUI 75 passed / 4 files. Full `npm run check` first passed after formatting three owned files, then passed with **1770 files / No fixes applied, 156.20s**. Actual source lifecycle smoke required a temporary source-export resolver because unbuilt dist imports were unavailable; that resolver and smoke script were removed.

Root aggregate history remains explicit: first run timed out at 240.27s without a total (`artifact://5678`); second ended **8821 passed / 1 failed / 915 skipped, 285.33s** (`artifact://5681`), failing the unchanged experimental remote-worker immediate PID-exit assertion. Its baseline provenance is `65ec9453bc` (2026-08-16). Coordinator disconnect removes the worker mapping before OS process exit; the original isolated case passed three times. Two diagnostic polling edits were exactly reverted; no experimental runtime/test change enters this repair. Final unchanged-source isolated `./test.sh`: **8822 passed / 0 failed / 915 skipped, 236.88s** (`artifact://5689`). No green claim is based on the modified diagnostic run.

The strict loop preflight returned `clean:false` because of the original 749 protected untracked files. They are preserved; manual full-review waves are used, not strict loop-protocol convergence. Graph initialization remains unavailable (WeakMap error). No external peer was sent: serving-family independence could not be attested. The canonical receipt helper rejected custom correctness-domain identities; this round retains all raw reports, exact coverage audit and independent validation, but does not claim a canonical helper-complete receipt. Next full wave must use canonical persona identities. Artifacts: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave1-0de930fe/`.

### Actionable Findings

All seven confirmed round-1 defects are repaired and behaviorally verified in the current uncommitted product tree. Commit and a fresh fixed-base -> latest-HEAD full review are still required; this round does not establish convergence.

### Coverage

No live tokenizer numerical, arbitrary ANSI, crash durability, dead-terminal, complete external caller or permanent HTML DOM automation guarantee. Detailed cross-cutting coverage is bounded and recorded per path. Agent-native focused counts were corrected by the mechanical coverage audit to 11 detailed / 405 insufficient paths; complete domain correctness assignments remain separate. Recovery protection is checked against the available recovery snapshot, not the lost original manifest.

### Verdict

Round-1 repairs verified locally; review loop continues after the repair commit. No push, PR, dependency, released changelog or upstream replay.

## Full merge review loop: round 2

Round-1 repair commit: `fe50e664f82286dc460c6adc5653addc5bf55901`; normal hook passed with No fixes applied. All eleven tested product/test blobs match their committed bytes. Round 2 again reviews fixed `839dc79197595a4285d711e37d02fb623e5b6b7b` -> that HEAD, all 416 paths. Snapshot digest: `88b1250f716ab0e39afceccf35aa7b62227c84e6ebc2005905c43d6094cb8cde`. Eleven canonical personas completed; canonical receipt validation passed before mutation. Full manifest/diff coverage is distinct from deep clearance: the conservative union of detailed persona-specific claims is 158 paths; 258 retain insufficient deep evidence (160 historical plans, 98 tests/fixtures/scripts). All 71 runtime source diffs received detailed changed-hunk coverage, not exhaustive transitive-caller proof.

### Confirmed findings and repairs

- R2-#1 (P1): fragment and prepublication summary counting still trusted an old converted result across the second async transform. Stable converter-closure redaction produced two actual REDs: denied history uploaded during preparation, and summary counting still dispatched. Both paths now reconvert an isolated second input and compare results, live settings, callback identities, cancellation and native upload permission before upload. The repaired final-context path remains separate. Complete native multimodal/tool/template counting is retained.
- R2-#2 (P2; three reviewers): tokenizer backoff retained an abort listener after each successful timer. Actual custom-fetch RED recovered count 2 after four attempts but left three listeners. Reuse the existing cleaned-up signaled sleep and keep a timer-only no-signal path. Runtime success/exhaustion leave zero listeners; unlimited retry cancellation remains covered. AI owner: 30 passed.
- R2-#3 (explicit project standard): native integration tests were inside the faux-only `test/suite/`. The initial exception classification was withdrawn because no scoped exception exists. Six fixture/consumer files move to `test/native/`; the shared faux harness remains in its original location. Real native adapter serialization and offline HTTP stubs are unchanged. This placement finding was restored after the eight-item validator batch; no independent validator verdict is claimed for it. Relocated consumers execute successfully.
- R2-#5 (P2): idle mutations after failed prefill restoration could replay deleted/replaced history. Five actual REDs cover deletion, parent deletion, soft-delete, shred and non-navigation replacement. Successful mutations now discard the failed-recovery state before rebuilding/notification. No-op parsing and failed transactions do not clear it. Exact accepted context, the next provider request and reopened state agree. Durable owner: 21 passed.
- R2-#6 (P2): custom output committed before a subscriber threw remained queued and was appended again. Actual RED persisted two equal records. Pending ownership now consumes immediately after durable append, before projection refresh and listeners; append failure retains ownership. A projection refresh failure cannot justify re-appending an already committed record; subsequent request construction refreshes from durable history. Deferred persistence/order owners: 8 passed.
- R2-#7 (P2; correctness + agent-native): exact chat counts lacked live request-policy ownership during/after HTTP completion. Ten REDs cover Agent/SDK prefixes, Block images and converter/transform identities; four further REDs cover payload/stream policy. Publication rechecks policy, abort and native upload permission after the response; reuse checks the captured keys and current permission. Footer keeps billing totals cached but obtains live context usage from Session, rather than copying Agent policy internals. Original lightweight footer fixtures remain unchanged. Changing away and back to identical policy/context restores the same wire-count input; reuse never performs an upload. Hidden arbitrary extension-closure revisions remain outside synchronous introspection guarantees.
- R2-#12 (P2): oversized tool-history fallback flattened converted images into text. Four actual REDs cover native/faux image loss and unfit-image checkpoint publication. Bounded fallback retains policy-visible supported image blocks in order, bounds text through the existing serializer, recomputes the complete budget and rejects unfit multimodal history before dispatch/checkpoint. Unsupported-image model behavior remains unchanged. Real faux-provider smoke received both images with input estimate 3242/output cap 3276; the unfit remainder rejected without another dispatch.
- R2-#13 (P2): downloaded HTML JSONL omitted its separately stored selected leaf. Actual Chromium button -> Blob -> SessionManager.open RED selected abandoned history for ancestor/null exports. Download now appends the existing leaf record using the exported default; temporary viewer navigation does not change it. GREEN restores only the ancestor contribution or empty selection; legacy absent metadata retains last-entry behavior. No permanent fake-DOM/source-regex test or screenshot proof is claimed. Owned browser/service/temp fixtures were cleaned.
- R2-#14 (P2): rejected late disposal restarted a renderer with a stranded render-request latch. Actual regular/fullscreen VirtualTerminal REDs retained a stale or blank frame. Recovery uses the established `requestRender(true)` restart convention. Both modes recover notification/error/transcript/draft without keyboard input and retain extension registration. Shutdown owners: 8 passed.

### Synthesis and verification

Fifteen raw candidates -> three semantic duplicates consolidated, two report-only boundaries (#4 finishTurn exception fallback, #11 unmeasured performance), one test-only gap (#15), plus the restored standards item above. Eight product candidates independently validated in one batch, all true. #15 was strengthened in its existing test to require successful compact/branch results and exactly two attempts; no product defect was inferred from missing assertions. No second validation batch or claim that #3 was in the eight verdicts.

Integration `npm run check` formatted seven, then one owned files during iteration; final check **1770 / No fixes applied, 37.46s**. Final post-format coding owners **184 passed / 11 files**; AI **30 passed / 1 file**. First root run **8836 passed / 11 failed / 915 skipped, 257.84s**, `artifact://5968`: duplicated Footer policy fields broke partial Session fixtures. Centralizing live usage in Session fixed the production cache boundary; fixtures were restored, not expanded. Next root run **8850 passed / 1 failed / 915 skipped, 237.67s**, `artifact://5975`: the unchanged known experimental worker immediate PID-exit race. No experimental test/source edits. Final same-source isolated root run **8851 passed / 0 failed / 915 skipped, 229.68s**, `artifact://5978`.

### Actionable Findings

All eight independently validated product findings and the explicit placement violation are repaired in the current tested tree. Commit and another fresh fixed-base -> new-HEAD full review remain required; this is not convergence.

### Coverage

Run artifacts and canonical receipt: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave2-d3327764/`. Protected-worktree/manual-loop exception, unattested external-model independence, unavailable graph and prior runtime limits remain explicit. Canonical receipt covers the reviewed committed head, not the later repair tree. Actual source, browser, filesystem, VirtualTerminal and focused execution proofs above are distinct from static reviewer verdicts.

### Verdict

Round-2 repairs verified locally; continue the full merge review loop after committing. No push, PR, upstream replay, dependency or released changelog change.

## Full merge review loop: round 3

Round-2 repair commit: `8daceb2998221a8465630320ee8c76353b68c720`; normal hook passed with No fixes applied. Committed tested source bytes match the captured final tree. Round 3 reviewed fixed `839dc79197595a4285d711e37d02fb623e5b6b7b` -> that HEAD, all 417 paths, including native-test relocation. Snapshot digest: `f00324cdccb09afbcd46cc07a79351be2bd282e643c90fd358cfa4caeb86d14d`. Eleven canonical personas completed; three candidates survived one independent three-item validator batch. Canonical receipt passed before mutation. All runtime source changed hunks received detailed correctness/API/maintenance/reliability review; complete inventory is not exhaustive whole-file or external-caller clearance. The adversarial exact ledger is 25 detailed / 392 diff-only paths and explicitly retains tool-output omission limits.

### Confirmed findings and repairs

- R3-#1 (P2): zero retained-token budget already selected the latest valid atomic cutoff, but both raw/projected selectors still awaited native preparation counts. With transient 503 plus unlimited retry, summary generation never started. Seven actual REDs cover six forbidden-counter invocations and native liveness. Both selectors now bypass counting loops for zero, retaining candidate initialization, message-budget combination, metadata backtracking and split-turn reconciliation. Native summary/final-context exact counts remain 42/100; positive-budget behavior is unchanged.
- R3-#2 (P2): the delivery-local reserved batch disappeared from pending display and Alt+Up while the first prompt awaited preflight. The real VirtualTerminal regression failed on the missing reserved row. The existing delivery token now owns unsubmitted messages; pending display and queue clearing include them. Actual Alt+Up restores/removes only the reserved second message while the accepted first request completes once.
- R3-#3 (P2): remaining batch messages used unconditional followUp/steer after an async input handler. If the first run settled during that handler, the message was stranded in idle Agent queues and scheduled work could overtake it. Actual steer/followUp REDs reproduce both outcomes. Captured `session.prompt` with original streaming behavior and the existing deferred-completion handoff now rechecks run ownership. Delivery exclusion lasts through a newly started run. Later rejection restores only rejected/unsubmitted entries, not the accepted first request. Actual Enter/Alt+Enter/Alt+Up, pending/editor rendering, request order and final transcript are exercised through InteractiveMode, runtime and xterm-backed VirtualTerminal. Retry commands and steering-before-follow-up ordering remain covered.

### Verification

Initial integration check formatted one owned file and found four implicit callback parameter types in two newly generated fixture callbacks; explicit `TranscriptContext` annotations resolved them without runtime changes. Final `npm run check`: **1770 files / No fixes applied, 12.07s**. Post-format focused owners: **156 passed / 2 skipped / 6 files, 18.99s**. Isolated root `./test.sh`: **8863 passed / 0 failed / 915 skipped, 123.01s**, `artifact://6294`. No experimental worker fixture was changed. Five non-report source/test files form the tested repair scope; a later commit is not retroactively named as the executed tree.

### Actionable Findings

All three confirmed round-3 defects are repaired and verified. Another fresh fixed-base -> latest committed HEAD review is required after this repair commit; the loop has not yet converged.

### Coverage

Canonical review and repair evidence: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave3-a1b432f7/`. Same protected-worktree/manual-loop, unattested external-family, graph, browser automation and runtime limits apply. Performance observations about long-history footer/count preprocessing remain unmeasured residuals, not newly confirmed defects.

### Verdict

Round-3 repairs verified locally; continue full merge review after local commit. No push, PR, dependency, upstream replay or released changelog change.

## Full merge review loop: round 4

Round-3 repair commit: `510b7d3031edc3421f74541b053b80ba3edce467`; normal hook No fixes applied, tested source blobs match. Fresh fixed-base -> HEAD full review again covers all 417 paths, snapshot digest `7f58e9b8055f68934ed3f4750e4813f20ea70c9ab4bf716ccc54b3074a07f026`. All eleven canonical personas completed. Four candidates independently validated in one batch: three true; repeated Footer projection performance candidate rejected because user-observable impact remains unmeasured. Canonical receipt passed before mutation. Per-path coverage audit retains 10 detailed / 407 insufficient correctness and 29 detailed / 388 insufficient adversarial accounting; other lenses provide attributed runtime-hunk coverage, not whole-tree deep clearance.

### Confirmed findings and repairs

- R4-#1 (P2): upfront continuation refresh removed prompt-only MCP discovery sections. Actual first-start-only section injection RED loses mcp_servers on continuation. Session now retains accepted normalized custom-section values directly, combines them with current explicit base sections on continuation, and clears the snapshot on branch reconciliation. No rendered-tag reverse parsing. Repeated continuation preserves discovery; a fresh prompt without reinjection removes it and the next continuation keeps it absent. Current custom preamble still applies.
- R4-#2 (P2): swipe-specific removal missed failed-prefix recovery invalidation, including zero surviving versions. Actual sole-version shred RED resurrected abandoned partial on the next request. Successful swipe delete/shred now discard failed recovery before rebuilding; failure/no-op paths retain it. Separate soft-delete control exposed only an empty-error projection difference before repair, not claimed as independent resurrection proof.
- R4-#3 (P2): shredding the selected swipe persisted an ancestor leaf, then chose a survivor only in memory. Actual file-backed two-version RED displays the survivor but reopens on another leaf. Shred now stages subtree removal and the same clamped survivor selection in one existing editMessages draft transaction. Finalized context and runtime-only branch policy restore follow the durable commit. Immediate reopen retains the displayed surviving answer without another append.

### Verification

Focused post-format Session/swipe/discovery/MCP/restoration owners: **92 passed / 5 files, 6.66s**. Final full `npm run check`: **1770 / No fixes applied, 21.68s**. Earlier check formatted three files and found a nullable section fixture type, corrected without production behavior changes; repeat-scenario formatting later changed one file. Initial root aggregate **8851 passed / 16 failed / 915 skipped, 197.45s**, `artifact://6521`: tracked packages/durable env-node WSL-platform fixture timed out, then subsequent shell cases observed its temporary Windows platform. Exact owning file isolated **48 passed / 1 skipped, 1.37s**. This was not an untracked packages/env test; no unrelated production/test/environment files were changed or excluded. Final original isolated root `./test.sh`: **8867 passed / 0 failed / 915 skipped, 181.23s**, `artifact://6529`.

### Actionable Findings

All three confirmed defects repaired and verified in the current tree. Commit and a fresh full fixed-base -> latest HEAD review still required; no convergence claim yet.

### Coverage

Canonical review, validator, exact coverage audit and tested content identity: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave4-8b549cfb/`. Existing manual protected-worktree exception and runtime/source limits remain. No live MCP server or physical terminal/network-provider proof is claimed; actual faux request construction and file reopen prove the repaired paths.

### Verdict

Round-4 repairs verified locally; continue full merge review after local commit. No push, PR, upstream replay, dependency or released changelog change.

## Full merge review loop: round 5

Round-4 repair commit: `50a522d52e016cd47fea5bc355da84f72b9e9f8f`; normal hook No fixes applied, tested source blobs match. Fifth fresh fixed-base -> HEAD review covers all 417 paths, snapshot digest `0270b17e4685edc7d380711bbcdded74afabc2ac858fed7c7fbb809bf065ec20`. Eleven canonical personas completed. Two candidates independently validated and retained; canonical receipt passed before mutation. Adversarial exact attributed coverage is 129 investigated changed-hunk/text paths / 288 insufficient detailed evidence, partitioning all 417 without overlap or omission. Other detailed runtime-hunk claims remain attributed, not exhaustive source/caller clearance.

### Confirmed findings and repairs

- R5-#1 (P2): signal disposal awaited active abort before dispatching cleanup; abort's actual agent_end progress write could hit EIO/EPIPE and emergency-exit first. Both terminal-error regressions observed cleanup count zero before repair. Signal-only `dispose({fromSignal:true})` now dispatches cleanup first, then aborts, drains receipts and invalidates. Successful signal cleanup is remembered across retained-receipt failure/retry so cleanup is not duplicated; session replacement resets it. Ordinary disposal remains abort-first. Actual InteractiveMode/VirtualTerminal/faux blocking-tool subprocesses with real SIGTERM listeners and unmocked exit observe cleanup -> abort -> progress error -> exit129 for both injected tty errors. Receipt retry retains UI/signals/draft/schedules/heartbeats and publishes its charge once. This is injected tty failure, not physical disconnection proof.
- R5-#2 (P2): the Footer cache-hit path rescanned complete structural history, violating the explicit compaction guide's unchanged-frame contract. Earlier rounds treated complexity alone as an unmeasured residual; this round's validator identified the concrete documented contract. Actual-source smoke with 1000 history entries observed 101 projection scans for 101 unchanged usage reads before repair, then one scan after repair. Session caches structural estimates/checkpoint applicability by Manager context revision while checking live model/converter/transform/prefix/image/transport/count validity on every read. Revisions cover successful durable commits/appends, same-leaf soft-delete/restoration, replacement, selection, load and summary-budget changes. Rewrite failure alone does not advance revision. Footer does not duplicate policy internals. Permanent tests prove same-leaf deletion/restoration values and the existing during/after policy/count invariants; implementation-call-count assertions remain throwaway runtime proof, not permanent wiring tests. Owned smoke/resolver scripts were removed.

### Verification

Post-format focused owners: **126 passed / 7 files, 17.91s** (the requested extra #5724 filename did not select an additional file; no eight-file claim). Structural cache/revision/value owners separately **76 passed / 4 files, 4.84s**. Final full `npm run check`: **1770 / No fixes applied, 23.89s**; first integration formatted three files. Isolated root `./test.sh`: **8871 passed / 0 failed / 915 skipped, 186.15s**, `artifact://6738`. Tests modified in this repair were executed. Runtime structural scan proof and signal actual subprocess proof are distinct from static reviewer verification.

### Actionable Findings

Both confirmed defects repaired and verified. A new full fixed-base -> committed latest-HEAD review is still required after this repair commit; convergence is not claimed.

### Coverage

Canonical receipt, validator, exact coverage audit and runtime evidence: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave5-b4e0600e/`. Original protected 749 files remain excluded and checked against recovery snapshot. Same manual-loop, graph, external-family and runtime limits apply. No measured latency improvement is claimed beyond the observed structural scan reduction.

### Verdict

Round-5 repairs verified locally; continue full merge review after local commit. No push, PR, dependency, upstream replay or released changelog change.

## Full merge review loop: round 6

Round-5 repair commit: `8d9c6473a9e5fb342222f98fffef9228934612b3`; normal hook No fixes applied, tested source blobs match. Sixth fresh fixed-base -> HEAD review covers all 418 paths, snapshot digest `e702ab5d0a8fa0071178b352c8503de6839263f4b82ee3541289689477217873`. Eleven canonical personas completed. Three raw candidates -> one semantic discovery duplicate consolidated -> two independently validated. Canonical receipt passed before mutation. Exact adversarial ledger: 97 investigated / 321 insufficient detailed paths. Source changed-hunk review and whole-inventory accounting remain distinct from exhaustive source/caller/runtime clearance.

### Confirmed finding and repair

R6-#2 (P2; correctness + adversarial): the volatile accepted-section snapshot fixed same-instance continuation but was empty after branch reconciliation or reopen. Actual regenerate/reopen requests both lost selected mcp_servers before repair. Continuation now snapshots the selected canonical structured section map and merges only dynamic sections into already-rendered generated sections, after `buildSystemPromptSections` has returned. No wrapper parsing, no second wrapping and no abandoned-branch volatile authority. Base-owned sections refresh as before; explicit custom inputs override preservation; fresh-start removals remain authoritative. Active continuation state clears after settlement. The obsolete accepted raw-value map is removed. Coverage includes first-start-only injection, repeated continuation, new-start removal, interrupted regeneration followed by another continuation, and file reopen without another before_agent_start handler.

R6-#1 same-leaf soft-delete exact-count candidate was rejected as pre-existing: the fixed baseline already retained the count through that mutation. No unrelated counting expansion was added. The known behavior remains explicitly outside this round's introduced-defect repair scope.

### Verification

Actual RED: **2 failed** regenerate/reopen consumer cases, `bg_301` terminal result. Post-format focused discovery/prompt restoration/transaction/swipe/MCP owners: **93 passed / 5 files, 6.18s**. Final full `npm run check`: **1770 / No fixes applied, 20.30s**; first check formatted two owned files. Isolated root `./test.sh`: **8873 passed / 0 failed / 915 skipped, 136.03s**, `artifact://6869`. Tests assert exact single-wrapper structured value and accepted removals. The first two-file probe also named a nonexistent untrusted-summary test path; no third-file execution is claimed.

### Actionable Findings

The single confirmed introduced defect is repaired and verified. Commit and another full fixed-base -> latest-HEAD review remain required; no convergence claim yet.

### Coverage

Canonical receipt, validator, exact path audit and tested content identity: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave6-8c732390/`. Existing manual protected-worktree exception, source/caller limits and runtime exclusions remain. No live MCP server proof or full arbitrary-extension timing guarantee.

### Verdict

Round-6 repair verified locally; continue full merge review after local commit. No push, PR, dependency, upstream replay or released changelog change.

## Full merge review loop: round 7

Round-6 repair commit: `90a97b2ea16655a3c790f7085472e02bcca463d1`; normal hook No fixes applied, tested source blobs match. Seventh fresh fixed-base -> HEAD review covers all 418 paths, snapshot digest `d74fd19a93f4b579997e4fa1432b6edbe58ad3c410f35b06ea3d862f1de9b992`. Eleven canonical personas completed. Three independent same-family findings (security, correctness, agent-native) describe one trust-boundary defect and were semantically merged; one independent validator confirmed it. Exact adversarial coverage ledger: 87 investigated / 331 insufficient detailed paths. No whole-merge deep-clearance claim. Canonical receipt first rejected mismatched first_evidence after merging; matching it to evidence[0] passed before mutation.

### Confirmed finding and repair

R7-#1 (P2): unconditional canonical section preservation let an untrusted reopened session import historical custom system instructions into the effective prompt. That effective prompt was then used by the new sanitizer, so context hooks and outgoing requests saw the rejected historical section. Actual SDK/faux direct-continuation RED observed HISTORICAL HOSTILE SECTION in context_with_system input (`artifact://7042`). Durable historical dynamic-section capture is now allowed only when project trust is true. Untrusted continuation uses accepted current base construction; current context-hook augmentation remains allowed. Trusted regenerate/reopen discovery controls remain intact. This fixes an interaction with the newly established sanitizer contract, not a claim that project trust is an OS sandbox.

### Verification

Post-format untrusted direct continuation/summary, trusted discovery continuation and prompt restoration owners: **31 passed / 3 files, 4.23s**. Final `npm run check`: **1770 / No fixes applied, 19.77s**; first check formatted one file. Isolated root `./test.sh`: **8874 passed / 0 failed / 915 skipped, 132.26s**, `artifact://7047`. Actual request/hook contents, not only intermediate Session state, establish rejection of historical preamble/custom/tail and retention of current policy/hook additions.

### Actionable Findings

The single confirmed defect is repaired and verified. Another fresh complete fixed-base -> latest committed HEAD review remains required; no convergence claim yet.

### Coverage

Canonical receipt, independent validation, exact path audit and tested source identity: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave7-aadbb0ed/`. Existing manual protected-worktree exception, graph/external-family/source/caller limits remain. All reviewer execution claims remain static-only; runtime proof above belongs to integration.

### Verdict

Round-7 repair verified locally; continue full merge review after local commit. No push, PR, dependency, upstream replay or released changelog change.

## Full merge review loop: round 8

Round-7 repair commit: `5335339d2fdf3413ca93e47151b3c6c0b878af4c`; normal hook No fixes applied, tested source blobs match. Eighth fresh fixed-base -> HEAD review covers all 418 paths, snapshot digest `18119a3519c9fecd83629c9c998022ac2b39e5e4f1d115c322cd51267b1912f8`. Eleven canonical personas completed; five distinct candidates independently validated in one batch, all true. Canonical receipt passed before mutation. Exact adversarial partition: 108 investigated / 310 insufficient detailed evidence; correctness 71 runtime-source hunks / 347 insufficient deep paths; reliability 37 detailed / 381 remaining. These are attributed lens-specific boundaries, not whole-tree semantic clearance.

### Confirmed findings and repairs

- R8-#1 (P2): fresh canonical continuation usage remained before a cloned checkpoint, defeating position-only freshness checks. Actual RED projected usageTokens=0 despite a newly billed response. New optional message-entry `usageContextEntryId` identifies the remapped latest checkpoint/edit included in that request. SDK/footer and projection estimates share the provenance-aware estimate; copied usage identity and later boundaries still invalidate. Live/file-reopened tests accept fresh continued usage and reject copied/later-invalidated values. Native exact count 100 is replaced by fresh provider usage 12. Standalone actual SDK/reopen/footer smoke observes 1334 tokens and `1.3k/125k (1.0%)`, not unknown.
- R8-#2 (P2): swipe terminal-leaf search compared preserved older suffix timestamps against the newly timestamped nonterminal response root. Actual RED selects the assistant instead of its policy suffix. Selection now compares only terminal descendants, falling back to the version root only when none exists. Continued answer re-selection restores VERSION_ONE policy; historical suffix timestamps and billing identity remain unchanged.
- R8-#3 (P2): cancelled signal disposal resumed UI after permanent extension cleanup without reactivation. Actual built-in MCP RED returns `MCP server "docs" is shut down` on a real post-failure tool call. Disposal now awaits existing bindExtensions/session_start activation before returning the original error; cleanup state resets only on success. Failed activation cleans the partial generation and retains shutdownPending, AggregateError details and original cause. Interactive recovery remains latched with no queue/heartbeat/schedule redrain until resources are ready. Real MCP JSON-RPC transports close once per generation; retained charge persists once. Standalone runtime/faux/MCP proof: two generations, one recovered transport call, original error identity preserved.
- R8-#4 (P2): the historical trust guard also discarded safe current-lifecycle global-extension discovery during untrusted continuation. Actual RED omits the accepted mcp_servers section. Current hook-accepted custom sections now have separate lifecycle/selected-path authority, cleared on fresh prompt, runtime rebuild or selected-path replacement; historical untrusted sections remain excluded. Trusted/untrusted repeated continuation and hostile reopen/regeneration controls pass.
- R8-#5 (P2): a newly billed continued tool call inherited an old deletedToolCalls tombstone, hiding a newly generated reused call ID while its real result remained. Actual RED executes once but the next canonical request omits call_1. New continuation replacements clear old tombstones while historical source tombstones remain stored. The following provider request and file reopen retain the new call/result pair.

### Verification

All four continuation consumer defects and the real MCP cancellation defect produced RED before implementation; setup-only fixture mistakes are separated in worker receipts. Post-format combined owning tests: **279 passed / 19 files, 19.37s**. Final full `npm run check`: **1770 / No fixes applied, 20.14s**; first check formatted four owned files. Original isolated root `./test.sh`: **8887 passed / 0 failed / 915 skipped, 134.93s**, `artifact://7183`. Existing SDK, compaction and session-format guides document disposal recovery, lifecycle section authority and durable usage provenance. No new source-regex, fake-DOM or internal call-count test is used as consumer proof.

### Actionable Findings

All five confirmed findings repaired and verified. Commit and another fresh full fixed-base -> latest committed HEAD review remain required; no convergence claim yet.

### Coverage

Canonical receipt, independent five-item validator, exact coverage audit, RED/GREEN and actual smoke receipts: `/tmp/compound-engineering-501/ce-code-review/20261025-full-wave8-805d1875/`. Same protected-worktree/manual-loop, unavailable graph, unattested external family and runtime limitations apply. In-memory MCP transport is actual protocol/resource lifecycle proof, not live remote-server proof.

### Verdict

Round-8 repairs verified locally; continue full merge review after local commit. No push, PR, dependency, upstream replay or released changelog change.
