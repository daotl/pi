# Full merge review repair closure

Baseline: `8322aa1d6808711a6e46bfbe67d8a788ca8cbd1e`. Branch: `fix/full-merge-review-8322aa1d`. No push. Original review: `2026-10-27-review-full-merge-and-followups-8322aa1d.md`.

## Disposition

| Original finding | Result |
|---|---|
| #1 Avoid executing client-supplied schemas before contract validation | Fixed; runtime or exact documentation contract evidence recorded. |
| #2 Reject packed payloads hidden in WebSocket text frames | Fixed; runtime or exact documentation contract evidence recorded. |
| #3 Keep resource dependency waits inside the readiness deadline | Fixed; runtime or exact documentation contract evidence recorded. |
| #4 Replace newly introduced inline imports with top-level imports | Rejected: eager imports conflict with documented lazy architecture. |
| #5 Resolve method arity from the active variant | Fixed; runtime or exact documentation contract evidence recorded. |
| #6 Release the hold before forgetting a failed snapshot binding | Fixed; runtime or exact documentation contract evidence recorded. |
| #7 Do not recommend mcp__* for removing resource tools | Fixed; runtime or exact documentation contract evidence recorded. |
| #8 Document the summary output cap still using reserveTokens | Fixed; runtime or exact documentation contract evidence recorded. |
| #9 Preserve the previously released Durable changelog sections | Rejected: deliberate upstream publication history reset; released sections unchanged. |
| #10 Remove unavailable renderFakeCursor API from public usage guidance | Fixed; runtime or exact documentation contract evidence recorded. |
| #11 Preserve sibling text when cropping an offscreen image | Fixed; runtime or exact documentation contract evidence recorded. |
| #12 Release smoke goes green with development-only packages installed | Fixed; runtime or exact documentation contract evidence recorded. |
| #13 Preserve argument parse errors in tracked tool-end frames | Fixed; runtime or exact documentation contract evidence recorded. |
| #14 Reject malformed argument markers in Pico tool execution | Fixed; runtime or exact documentation contract evidence recorded. |
| #15 Keep Mistral header deadlines separate from response-body cancellation | Fixed; runtime or exact documentation contract evidence recorded. |
| #16 Handle fork spawn errors before awaiting child exit | Fixed; runtime or exact documentation contract evidence recorded. |
| #17 Reset the idle clock for each new child | Fixed; runtime or exact documentation contract evidence recorded. |
| #18 Discard results according to the consumer method contract | Fixed; runtime or exact documentation contract evidence recorded. |
| #19 Recompute candidate derivations against commit-time state | Fixed; runtime or exact documentation contract evidence recorded. |
| #20 Check record-valued fields during contract compatibility | Fixed; runtime or exact documentation contract evidence recorded. |
| #21 Prevent VM launch after cancellation during WASM loading | Fixed; runtime or exact documentation contract evidence recorded. |
| #22 Preserve invocation tool modifiers across branch restoration | Fixed; runtime or exact documentation contract evidence recorded. |
| #23 Teach retained v3 importer about leaf checkpoints | Fixed; runtime or exact documentation contract evidence recorded. |
| #25 Preserve nested tool diagnostics through durable codemode | Fixed; runtime or exact documentation contract evidence recorded. |
| #26 Union recursion for duplicate native watch targets | Fixed; runtime or exact documentation contract evidence recorded. |
| #27 Keep captured arguments when a tool-call block ends | Fixed; runtime or exact documentation contract evidence recorded. |
| #28 Buffer image input fails transfer and strands its worker | Fixed; runtime or exact documentation contract evidence recorded. |
| #29 Preserve unread output while transport backpressure blocks readers | Fixed; runtime or exact documentation contract evidence recorded. |
| #30 Kill terminal jobs outside the shell's process group | Fixed; runtime or exact documentation contract evidence recorded. |
| #31 Resolve drive-less Windows roots on the remote machine | Fixed; runtime or exact documentation contract evidence recorded. |
| #32 Reject results from superseded triage attempts | Fixed; runtime or exact documentation contract evidence recorded. |
| #33 Build the daemon before local release tests | Fixed; runtime or exact documentation contract evidence recorded. |
| #34 Prepare daemon binaries before packing local env artifacts | Fixed; runtime or exact documentation contract evidence recorded. |
| #35 Keep documented TUI default aligned with runtime | Fixed; runtime or exact documentation contract evidence recorded. |

Withdrawn #24 remains excluded: the alleged strict-JSON boundary already existed at baseline.

## Repair edges found during review

- Schema guards distinguish JSON Schema nodes from ordinary member/property names and preserve additive record compatibility. Executable refs/combinators/custom TypeBox kinds require identical registered schema roots. Bounded depth14 DAG now rejects before invocation.
- Pinned roots use retained codeVersion for method arity. Expired/foreign contexts and released views reject before readiness waits.
- Cluster publication remains synchronous. Recoverable preflight failures abort before publication; terminal install failures never send abort after commit. Failed-child cleanup does not reopen old resources or restart old tasks. Actual RED effects close2/open1/task1 become only close2.
- Codemode divergence returns the same enriched diagnostics as persisted recovery.
- Fake-Windows shell tests now isolate process-wide platform/cwd simulation in a bounded child; actual cleanup uses real OS. No NodeExecutionEnv production behavior changed.

## Verification

- Root check: 1977 files, No fixes applied; all type/import/runtime/entry/install-lock/browser gates pass.
- Offline build: all retained and upstream packages pass.
- Authoritative isolated ./test.sh with external locked/offline daemon: **12351 passed / 0 failed / 939 skipped**, artifact://9579.
- Earlier failures remain explicit: 10898/2/935 and12297/16/939 fake-Windows platform timeout cascade. Final process isolation fixes the cascade without changing production shell behavior.
- Parent targeted runs: Mistral15; Pico/import103 plus orchestration6; Durable142/divergence45; Chord74/69; sandbox154; TUI76; daemon19; artifact policy7. Counts overlap; not summed.
- Package installation: final14 isolated consumers passed; SDK/CLI identity and source-only boundary checks included.
- Public smoke rejects hostile unknown contract and packed text; active variant call returns hello; actual image worker preserves Buffer bytes.
- Three simplification lenses returned no worthwhile behavior-equivalent findings. Eleven canonical repair reviewers completed; seven semantic findings entered one fresh independent closure batch.
- No paid/live-provider requests. Native Windows filesystem, Linux/Android PTY behavior, Nix, and native Bun startup are not verified.

## Package validation boundary

check:package-install explicitly checks installation/exports, SDK and CLI only. It reports release daemon assets unverified. Production pack/publish/local-release artifact paths still require the full eight-target daemon matrix and reject missing/empty files. Actual release binaries are unavailable here; no fake binaries or reduced matrix substituted.

## Evidence

Machine-local run: `/tmp/pi-full-review-repairs-df3b91c8`. Per-unit JSON/logs preserve failure-before/fix-after/runtime limits. All749 protected files use recovery snapshot verification; my-merge unchanged.

## Independent repair-review closure

One fresh validator checked seven deduplicated review edges; all seven confirmed original defects and closure in current source. Direct, relayed and three adapter DAG paths reject before invocation; simple adapters remain accepted. Pinned variant roots, loading contexts, record compatibility and terminal child side effects are independently checked. Actual SQLite divergence/recovery test passed. No remaining actionable finding from repair review.

### Actionable Findings

None remain in this repair scope. Original #4 and #9 are rejected with evidence; #24 was withdrawn. Testing gaps remain informational: inline/remote cancellation startup windows, permanent paused-transport regression, and additional release-matrix positive cases. Actual bounded runtime proofs are recorded; broad platform guarantees are not.

### Coverage

All11localcanonicalpersonascompleted; one7itemindependentvalidationbatch; localadversarialnotcrossmodel. Three simplification lenses reported no worthwhile changes. Current full test12351/0/939, rootcheckNo fixes, offlinebuildand14installationconsumersgreen. Full productionreleaseassetmatrixunavailable.

### Verdict

Ready locally within the named repaired behavior and disclosed runtime/platform limits. No push.

## Complete merge and follow-up review - 2026-10-27 / 682c6667

Fresh full-scope review. It does not replace the historical repair disposition above. Finding numbers below belong to this new review.

**Scope:** `839dc79197595a4285d711e37d02fb623e5b6b7b -> 682c666713ef14f72b15f32099e400044ae0a31f`; 1507 changed paths. Reviewed tree: `c1217509a4cbf4b254062ed670f1402621c1e43a`. Branch: `fix/full-merge-review-8322aa1d`.

**Tracked snapshot digest:** `cb194a7110fe5b62e0e82d228c5d699a4312da70ca58d01e2dbd69cb9711e822`.

**Mode:** markdown report-only. No product fixes, commits, push, branch movement or release performed.

**Intent:** Review the complete maintained merge and all later changes, not only the 69-file repair commit. Preserve Crystal history editing/deletion/restore/shred/id0, retained Harness/experimental/client consumers, full multimodal/token counting, configured summary budgets, and prompt/receipt ownership. Supplementary comparisons: premerge `98dfe28 -> HEAD`, merge `8322aa1d -> HEAD`, upstream parent `d5b3de22 -> HEAD`.

**Reviewers:** 11 canonical local personas completed: correctness (10 non-overlapping domain shards), project-standards, testing, maintainability, agent-native, security, performance, api-contract, data-migration, reliability, adversarial. Security covered public protocol/auth boundaries; API covered native Chord and retained consumers; migration covered session/SQLite compatibility; reliability covered process/watch/daemon ownership. Deployment verification supplied operational notes. One fresh validator checked all 27 surviving actionable candidates.

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
| --- | --- | --- | --- | --- |
| Process and native IO ownership | #1, #13, #22, #23, #24, #25, #26 | Lock, cleanup, watch and framing boundaries | Apply queue: fix #1 first; then independent native IO defects | Prevent concurrent owners before broader lifecycle changes |
| Replay and transcript integrity | #6, #7, #8, #18, #20, #21 | Retained history/tool/queue consumers under new producers | Apply queue: exercise replay boundaries and event delivery end to end | Producer tests do not prove retained consumer behavior |
| Tool and provider composition | #2, #10, #11, #12, #15, #16, #19 | Errors, images, JSON, callbacks and renderer composition | Apply queue: repair each explicit boundary and retain consumer smoke | Distinct failure paths; not duplicates |
| Native contract migration | #3, #4, #5, #14 | State, variants, pinned calls and public usage | Apply queue: preserve active and retained variant contracts | Local-only validation misses remote consumers |

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 1 | `packages/chord/src/manager.ts:107` | Stale socket reclamation can admit two lock owners | reliability | 75 |

- **#1:** Two contenders can both authorize reclamation of one stale socket. The second can unlink the first contender's live socket; both processLock calls then succeed. Serialize reclamation and owner installation, and make release conditional on ownership. Origin: newer-upstream. Independent validation: A fresh Darwin run of the independently inspected public processLock race probe let both live contenders acquire the same stale-socket lock, confirming the unsynchronized probe/unlink/rebind window.

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 2 | `packages/ai/src/api/openai-decisions.ts:154` | Classifier error formatter throws on null rejection | maintainability | 100 |
| 3 | `packages/chord/src/cell.ts:393` | Remote derived state changes undefined into null | correctness | 100 |
| 4 | `packages/chord/src/remote.ts:617` | Member lookup uses the first declared variant | correctness | 100 |
| 5 | `packages/client/README.md:25` | Client migration example cannot connect | api-contract | 100 |
| 6 | `packages/coding-agent/src/core/agent-session.ts:6273` | Negative tool modifiers do not remove default-active extensions | correctness | 100 |
| 7 | `packages/coding-agent/src/core/message-edit.ts:607` | XML edit safety drops malformed-argument metadata | correctness | 100 |
| 8 | `packages/coding-agent/src/core/session-manager.ts:2250` | Retain-none deletion checkpoint fails legacy v3 import | data-migration | 100 |
| 9 | `packages/coding-agent/src/extensions/mcp/cli.ts:554` | MCP login timeout excludes connection handshakes | correctness | 100 |
| 10 | `packages/durable/src/codemode/codemode.ts:285` | Durable codemode read loses image content | agent-native | 100 |
| 11 | `packages/agent/src/agent-loop.ts:313` | Synthetic stream failures bypass finishTurn | correctness | 75 |
| 12 | `packages/ai/src/utils/streaming-json.ts:536` | Overflowing JSON numbers enter tracked tool arguments | correctness | 75 |
| 13 | `packages/chord/src/manager.ts:225` | Windows host stop leaves child descendants alive | reliability | 75 |
| 14 | `packages/chord/src/remote.ts:651` | Pinned remote calls decode with the new variant arity | correctness | 75 |
| 15 | `packages/chord/src/websocket.ts:27` | Synchronous WebSocket authentication can crash the host | security | 75 |
| 16 | `packages/codemode/src/source.ts:109` | Options scan rejects template-string data | correctness | 75 |
| 17 | `packages/coding-agent/docs/models.md:201` | Image guide gives an incorrect no-disk guarantee | correctness | 75 |
| 18 | `packages/coding-agent/src/core/agent-session.ts:3231` | Resume replays tool changes from soft-deleted entries | adversarial | 75 |
| 19 | `packages/coding-agent/src/core/export-html/tool-renderer.ts:104` | HTML export bypasses built-in tool renderer overrides | correctness | 75 |
| 20 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:57` | Native state coalescing loses transcript events | api-contract | 75 |
| 21 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5505` | Dequeuing misses an in-flight unaccepted message | correctness | 75 |
| 22 | `packages/durable/src/env/node-watch.ts:418` | Native file watches miss symlinked parent directories | correctness | 75 |
| 23 | `packages/env/daemon/src/main.rs:285` | Directory pages can exceed the daemon frame limit | correctness | 75 |
| 24 | `packages/env/daemon/src/pty.rs:316` | Normal PTY leader exit forgets live background jobs | correctness | 75 |
| 25 | `packages/env/daemon/src/sys/windows.rs:319` | Windows relative PATH uses the daemon cwd | correctness | 75 |
| 26 | `packages/env/daemon/src/watch.rs:640` | Native watcher rescan does not report uncertainty | correctness | 75 |
| 27 | `scripts/package-artifacts.mjs:55` | Evaluator packing now requires release-only daemon assets | correctness | 75 |

- **#2:** onPayload, onResponse or injected fetch can reject with null/undefined. The error formatter dereferences that value and throws TypeError instead of returning the classifier failure result. Narrow unknown before reading status. Origin: newer-upstream. Independent validation: Direct exported Decisions classify calls whose onPayload rejected null or undefined both rejected with a new status-dereference TypeError instead of returning an error ClassifierResult.
- **#3:** An ordinary derivation update stores undefined locally but emits a root op containing null. Remote readers diverge until a fresh snapshot. Preserve undefined with an appropriate reset instead of a JSON-null replacement. Origin: newer-upstream. Independent validation: An unmodified two-host public Chord probe changed a Type.Unknown derivation to undefined and observed undefined locally but null remotely, matching the emitted root replacement op.
- **#4:** A member can be state in one variant and a method in another. Lookup selects the first declaration rather than the active variant, so valid narrowed calls can become non-callable or fail hydration. Resolve local and remote member kind from the active variant. Origin: newer-upstream. Independent validation: A legal state-first/method-second contract hydrated its second variant but returned non-callable value members both locally and remotely, so valid value() calls threw TypeError.
- **#5:** The example passes remote instead of the required principal, and uses the optional hello path without the correct server ID. Correct the public connection example against the actual connect contract. Origin: merge-resolution. Independent validation: The README supplies remote without principal, and invoking the current public Host.connect with that option shape immediately threw the documented principal-required TypeError.
- **#6:** Fresh-session construction appends default-active extension tools after applying -name to the earlier list. Explicitly excluded tools remain declared; reload can reactivate them. Apply modifiers to the final extension-inclusive selection. Origin: newer-upstream. Independent validation: A fresh public createAgentSession with tools:["-active_tool"] and a default-active extension still reported active_tool active because extension activation follows modifier application and empty-transcript restoration returns early.
- **#7:** editableContentKey omits argumentsError. Formatting and parsing an unchanged tool call can discard its malformed raw arguments and turn {} into an executable call. Include this replay/validation metadata in losslessness checks. Origin: merge-resolution interaction. Independent validation: Public edit formatting accepted a malformed-argument tool call, its unchanged XML round-trip removed argumentsError, and validateToolArguments changed from rejecting the original to accepting the reconstructed empty object.
- **#8:** Deletion can write firstKeptEntryId equal to the compaction ID. The retained importer walks ancestors from its parent and never finds that self-boundary. Normalize it to an empty retained tail before the walk. Origin: retained-fork change before merge: 7a06074c5. Independent validation: A real SessionManager persisted a self-boundary compaction after removeLastMessages(2), and opening that exact producer file through JsonlSessionRepo failed with firstKeptEntryId not on its parent branch.
- **#9:** --timeout advertises a whole-login bound, but initial getClient and final reconnect do not receive that deadline. A stalled initialize can outlast it. Carry the same cancellation/deadline through every sign-in stage. Origin: newer-upstream. Independent validation: A loopback server stalled initialize and the real runMcpCommand login --timeout 0.05 returned only after approximately 308 ms under a 300 ms connection timeout, proving the deadline excludes initial connection.
- **#10:** Schema-less read image output passes through textOf and becomes an empty string. image(await tools.read(...)) and classifier image input cannot compose. Preserve ImageContent through the codemode outcome boundary. Origin: newer-upstream. Independent validation: A faux-model durable Harness using the real read and codemode tools read a PNG successfully but the script received {type:"string",value:""}, confirming loss at the schema-less codemode mapping.
- **#11:** prepareRequest/stream/iterator rejection uses endWithError and emits turn_end without the configured finalizer. Ordinary error events call it. Use the same exactly-once turn-finalization path for synthesized failures. Origin: retained-fork fix before merge: 551975eabc. Independent validation: An unmodified agentLoopContinue preparation failure emitted a terminal error turn and settled its stream while its configured finishTurn callback ran zero times, contrary to the error-response contract.
- **#12:** A valid numeric token 1e309 converts to Infinity and is emitted in streaming changes/snapshots. Strict JSON persistence rejects it; final argument parsing also accepts nested Infinity. Reject or mark non-finite numbers before publication. Origin: newer-upstream. Independent validation: The real StreamingJsonParser emitted Infinity for {"value":1e309}, final parsing retained Infinity, and the current strict Chord copy boundary rejected the snapshot as non-finite JSON.
- **#13:** Negative PID process-group termination is POSIX-only; the Windows fallback kills only the immediate child. Forced stop or replacement can leave its descendants running. Use an actual Windows tree-termination mechanism. Origin: newer-upstream. Independent validation: The new public Node manager uses a negative-PID POSIX group kill and falls back only to child.kill, so its promised descendant termination has no Windows implementation; native Windows execution was unavailable.
- **#14:** The caller decodes args/context using the current remote variant, while the provider dispatches the retained codeVersion. Reload across no-arg/arg variants can misclassify ctx or reject the call. Decode against the retained variant across remote calls too. Origin: post-merge repair: 682c6667. Independent validation: Both trusted two-host pinned-root arity transitions failed after coordinated reload: no-args to args threw a circular-JSON TypeError and args to no-args rejected foreign_ctx because remote dispatch decoded the current variant.
- **#15:** principal(request) is evaluated before Promise.resolve. A synchronous throw escapes the connection callback instead of closing just that link. Invoke authentication inside a guarded promise continuation. Origin: newer-upstream. Independent validation: With a real loopback ws server, a synchronous principal authenticator exception escaped the connection listener into uncaughtException rather than the link-close rejection branch.
- **#16:** The physical-line scan treats a // @options: line inside a multiline string as an execution directive. Valid source/data transforms fail before execution. Recognize real JavaScript comments, not string-literal contents. Origin: newer-upstream. Independent validation: The supplied multiline-template script executed as valid JavaScript but the real parseCodemodeSource rejected its literal-data options marker as a misplaced directive.
- **#17:** The guide says generated images are not saved, but its image() example writes private OS temporary files. Document actual persistence and cleanup. This is not a demonstrated cross-user disclosure. Origin: newer-upstream. Independent validation: The documented example forwards generated images to image(), and a model-free real executeCodemode image call persisted matching image bytes in a mode-0600 temporary file despite the guide claiming no disk persistence.
- **#18:** The raw branch scan includes deleted system tool deltas. Resume/navigation can undo the visible history tool selection and change the next request. Exclude deletedAt entries before collecting mentioned names and folding deltas. Origin: merge-resolution. Independent validation: After soft-deleting a real toolsRemoved system entry, canonical context still declared read/bash but public createAgentSession resume activated only read because raw-branch restoration replayed the deleted removal.
- **#19:** The export prefilter and browser built-in switch skip middleware overrides for read/bash/write/edit/ls. Interactive and exported transcripts therefore differ. Resolve custom middleware before falling back to built-in rendering. Origin: newer-upstream feature plus retained export path. Independent validation: A real exportSessionToHtml with read and custom calls invoked the supplied renderer only for custom, and the inspected template also consults pre-rendered overrides only after its built-in-name switch.
- **#20:** Transcript stores only the last source event. A coalesced/reset state can omit message_end or run_end, while runClient relies on those events for answer text and completion. Use a lossless event contract or reconstruct consumer results from snapshots. Origin: merge-resolution. Independent validation: A size-reporting Chord probe coalesced message_end/run_end into one delivery, and actual runClient replaying that coalesced event sequence through faux discovery returned empty text without reconstructing snapshot answers.
- **#21:** Queue draining shifts a message before asynchronous input/authentication preflight. The local submitting slot is absent from queue/dequeue APIs; it can dispatch after the user dequeues the batch. Retain visible ownership until acceptance. Origin: retained-fork fix before merge: 510b7d3031. Independent validation: Holding the second submission in a controlled prompt preflight made actual queue helpers list and dequeue only the third message, while releasing preflight still admitted the second message after dequeue.
- **#22:** A regular/missing file below a symlink parent has no watcher on its resolved containing directory. Linux native mode can keep stale configuration. Watch resolved parents as well as lexical replacement boundaries. Origin: newer-upstream. Independent validation: After waiting beyond initial native-watcher settlement, a real symlink-parent file watch missed a write through the resolved real path; lstat marks the parent as a symlink and reconciliation never watches its target directory.
- **#23:** readdir accepts a large valid max and builds one unbounded metadata result. Above 16 MiB the shared output writer stops, stranding unrelated requests. Bound encoded page size before writing the frame. Origin: newer-upstream. Independent validation: The public reader forwards arbitrary positive safe page counts to an unbounded daemon metadata collection, whose single reply can exceed MAX_FRAME and permanently stop Output.run; no byte or count guard handles it.
- **#24:** After silence the daemon unregisters the terminal/session. A HUP-ignoring background job survives master close, and later close/shutdown cannot discover it. Keep or settle session cleanup before unregistering. Origin: newer-upstream; explicit-close repair does not cover normal exit. Independent validation: The PTY normal-leader-exit/silence path unregisters terminal and session ownership without kill_session, while settled requests remove abort listeners and shutdown cleans only registered sessions, leaving HUP-ignoring descendants unowned.
- **#25:** Executable lookup tests relative/empty PATH entries against daemon cwd rather than command cwd. Valid remote commands can fail or select another executable. Resolve these entries against the requested cwd. Origin: newer-upstream. Independent validation: Windows resolve_program checks relative PATH candidates with is_file before applying request.cwd, unlike its explicit-relative-program branch, so valid command-local executables are checked against the daemon directory.
- **#26:** need_rescan only reconciles metadata. A dropped same-size/mtime-preserving rewrite can remain invisible and no overflow reaches the consumer. Emit the documented overflow signal when native coverage is uncertain. Origin: newer-upstream. Independent validation: A native notify need_rescan event only schedules metadata comparison, and unchanged snapshots suppress all notifications without emitting the contract-required overflow signal for known event loss.
- **#27:** produceArtifactSet defaults to requiring all eight daemon assets. The offline evaluator install-runtime caller does not opt out or build that matrix, so clean image packing fails. Keep production release enforcement and explicitly separate this intermediate install-only profile. Origin: post-merge repair: 682c6667. Independent validation: The real produceArtifactSet on a bounded clean pi-env fixture with the evaluator caller options threw Missing pi-env release daemon assets for all eight platforms, while the actual Docker build never prepares those assets.

### Finding Routes and Details

All rows are un-applied. Independent validation accepts the concrete defect; runtime versus source-only limits are recorded in Coverage and per-finding evidence. No cross-model confidence promotion.

| # | Severity | File | Required response | Route | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | `packages/chord/src/manager.ts:107` | Stale socket reclamation can admit two lock owners; suggested_fix present | `manual -> downstream-resolver` | 75 |
| 2 | P2 | `packages/ai/src/api/openai-decisions.ts:154` | Classifier error formatter throws on null rejection; suggested_fix present | `gated_auto -> downstream-resolver` | 100 |
| 3 | P2 | `packages/chord/src/cell.ts:393` | Remote derived state changes undefined into null; suggested_fix present | `manual -> downstream-resolver` | 100 |
| 4 | P2 | `packages/chord/src/remote.ts:617` | Member lookup uses the first declared variant; suggested_fix present | `manual -> downstream-resolver` | 100 |
| 5 | P2 | `packages/client/README.md:25` | Client migration example cannot connect; suggested_fix present | `gated_auto -> downstream-resolver` | 100 |
| 6 | P2 | `packages/coding-agent/src/core/agent-session.ts:6273` | Negative tool modifiers do not remove default-active extensions; suggested_fix present | `gated_auto -> downstream-resolver` | 100 |
| 7 | P2 | `packages/coding-agent/src/core/message-edit.ts:607` | XML edit safety drops malformed-argument metadata; suggested_fix present | `gated_auto -> downstream-resolver` | 100 |
| 8 | P2 | `packages/coding-agent/src/core/session-manager.ts:2250` | Retain-none deletion checkpoint fails legacy v3 import; suggested_fix present | `gated_auto -> downstream-resolver` | 100 |
| 9 | P2 | `packages/coding-agent/src/extensions/mcp/cli.ts:554` | MCP login timeout excludes connection handshakes; suggested_fix present | `gated_auto -> downstream-resolver` | 100 |
| 10 | P2 | `packages/durable/src/codemode/codemode.ts:285` | Durable codemode read loses image content; suggested_fix present | `gated_auto -> downstream-resolver` | 100 |
| 11 | P2 | `packages/agent/src/agent-loop.ts:313` | Synthetic stream failures bypass finishTurn; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 12 | P2 | `packages/ai/src/utils/streaming-json.ts:536` | Overflowing JSON numbers enter tracked tool arguments; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 13 | P2 | `packages/chord/src/manager.ts:225` | Windows host stop leaves child descendants alive; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 14 | P2 | `packages/chord/src/remote.ts:651` | Pinned remote calls decode with the new variant arity; suggested_fix present | `manual -> downstream-resolver` | 75 |
| 15 | P2 | `packages/chord/src/websocket.ts:27` | Synchronous WebSocket authentication can crash the host; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 16 | P2 | `packages/codemode/src/source.ts:109` | Options scan rejects template-string data; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 17 | P2 | `packages/coding-agent/docs/models.md:201` | Image guide gives an incorrect no-disk guarantee; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 18 | P2 | `packages/coding-agent/src/core/agent-session.ts:3231` | Resume replays tool changes from soft-deleted entries; suggested_fix present | `manual -> downstream-resolver` | 75 |
| 19 | P2 | `packages/coding-agent/src/core/export-html/tool-renderer.ts:104` | HTML export bypasses built-in tool renderer overrides; suggested_fix present | `manual -> downstream-resolver` | 75 |
| 20 | P2 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:57` | Native state coalescing loses transcript events; suggested_fix present | `manual -> downstream-resolver` | 75 |
| 21 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5505` | Dequeuing misses an in-flight unaccepted message; suggested_fix present | `manual -> downstream-resolver` | 75 |
| 22 | P2 | `packages/durable/src/env/node-watch.ts:418` | Native file watches miss symlinked parent directories; suggested_fix present | `manual -> downstream-resolver` | 75 |
| 23 | P2 | `packages/env/daemon/src/main.rs:285` | Directory pages can exceed the daemon frame limit; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 24 | P2 | `packages/env/daemon/src/pty.rs:316` | Normal PTY leader exit forgets live background jobs; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 25 | P2 | `packages/env/daemon/src/sys/windows.rs:319` | Windows relative PATH uses the daemon cwd; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 26 | P2 | `packages/env/daemon/src/watch.rs:640` | Native watcher rescan does not report uncertainty; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |
| 27 | P2 | `scripts/package-artifacts.mjs:55` | Evaluator packing now requires release-only daemon assets; suggested_fix present | `gated_auto -> downstream-resolver` | 75 |

### Agent-Native Gaps

- #10: direct image reads and codemode image reads do not have equivalent model-visible content. This is the same finding, not another defect.

### Deployment Notes

- Stop the old SQLite owner and take a SQLite-consistent, recoverable whole-database backup before the first v2 open. Keep the same database path and table prefix.
- Before scheduling resumes, check schema version 2, integrity_check=ok, no tasks_v2 table, the five expected task indexes, and exact seven-column task equality against the backup in both EXCEPT directions. Compare metadata and other-table counts too.
- A committed v2 upgrade cannot be rolled back by deploying v1 code against the same database. Restore the complete backup only with explicit accounting for subsequent writes and external effects. Never lower the schema version manually.
- Upgrade/rollback rehearsal, production-size lock/disk behavior and live Cloudflare migration were not executed in this review. These are deployment gates, not newly claimed corruption defects.
- Package installation/exports/SDK/CLI checks do not certify the eight-target release daemon matrix. Preserve the production asset gate while repairing intermediate callers covered by #27.

### Coverage

- Immutable inventory: 1507 paths. Correctness shards traversed changed content for 1505 paths, with selected source/caller investigation. This is not uniform whole-file or whole-upstream certification. Two historical report bodies were deliberately excluded from reviewer ingestion: `docs/plans/2026-10-25-review-full-merge-finding-repairs.md` and this closure report. The orchestrator read and preserved this report's original 88 lines. Tooling mapped all 579 hunk headers and explicitly records those body exclusions.
- Accepted adversarial fallback: `Round2FinalAdversarial`; 78 paths directly investigated, 1429 explicitly insufficient for that persona, including all 161 historical documents inventoried only. Other domains supply their own coverage. No other-reviewer finding artifacts were used by this accepted fallback.
- External route: actual host serving family codex; requested Claude route/model `claude-opus-5`, effort `high`. Runner `20261027T085211Z-886efaba` terminated `execution_failure` after 183 seconds. No usable review. Actual model/effort and serving-family independence unverified. Digest/head identity matched; collected terminal evidence retained and owned runner cleaned. No unresolved peer obligation.
- Process deviations: external Stage 3d started after local dispatch, so this is not strict original-order clearance. Early `Round2Adversarial` was excluded. `Round2FreshAdversarial` was cancelled after reading aggregated source-details; its output is excluded. `Round2CleanAdversarial` aborted after incidental historical diff context and supplied no usable report. Only the final clean fallback counts.
- Mechanics: 33 raw candidates; no malformed returns/findings, quote-gate suppression or confidence suppression. Three candidates rejected on current contract/intent evidence; three moved to soft buckets below. Stable #1-#27 came from the reconciled deterministic pass; validation does not renumber them.
- No cross-model validation shortcut. One fresh validator received all 27 actionable findings in severity/stable-number order. The initial 8-item selection was corrected within this same batch before completion. The batch exceeds the normal cap to avoid omitting actionable findings; no second batch and no sampled primary queue.
- Actual parent runtime: on macOS, a crashed socket holder and two real processLock contenders were ordered at the filesystem reclamation seam. Both calls acquired the same lock while both processes remained alive. This is a deterministic legal interleaving, not a measured organic race rate. Subprocess exits were collected and the owned socket removed. See `lock-smoke.json`.
- The exact committed tree had already passed authoritative isolated `./test.sh`: **12351 passed / 0 failed / 939 skipped**, exit 0, artifact://9604. That unchanged full suite was not rerun here and does not prove these newly examined boundaries.
- Graph initialization failed (`WeakMap keys must be objects or non-registered symbols`). Exact source, immutable history and lexical tracing were used. No graph/caller completeness claim. No paid/live-provider calls. Native Windows, Linux/Android PTY/watch, live SSH/Cloudflare, Nix, native Bun startup and the real release matrix are not certified.
- Evidence/artifacts: `/tmp/compound-engineering-501/ce-code-review/20261027-full-682c6667-f029efb0`. Full hydrated why/evidence, raw reports, provenance, canonical mechanics, all validator verdicts and per-finding runtime/source limits are retained.

Validator result: 27 accepted; 0 rejected.

#### Runtime evidence boundaries

22 findings have bounded runtime evidence; #13, #23, #24, #25 and #26 are independently source-confirmed only. #20 combines actual native transport coalescing with a separately exercised real consumer using faux discovery; it is not a full server lifecycle run. #21 exercises actual queue methods, not a launched TUI. #22 was observed on Darwin after settling; Linux remains source-only. #27 uses actual packing in a clean one-package fixture, not a Docker/release-matrix build.

Invalid initial WebSocket/HTML fixture attempts were not used as defect evidence; corrected finite probes supplied the accepted results. No source edits were used to create RED behavior.

| # | Verification boundary |
| --- | --- |
| 1 | Deterministic rm-timing interleaving proves the possible race, not organic frequency; Darwin only. |
| 2 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 3 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 4 | Runtime covers state-first/method-second declaration order; reverse-order hydration is source-traced, not executed. |
| 5 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 6 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 7 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 8 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 9 | Runtime proves initial initialize stage only; post-OAuth reconnect deadline bypass independently source-traced, no live OAuth attempted. |
| 10 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 11 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 12 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 13 | Source-confirmed Windows-only defect; no Windows host, no emulated Windows process semantics claimed. |
| 14 | Both arity directions exercised over real trusted host links and coordinated reload; no external network. |
| 15 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 16 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 17 | Offline bounded probes only; no live provider requests, product source changes, tests, formatters, or repository builds. |
| 18 | Public resume probe confirms active loadout; next-provider reconciliation not executed, source-traced only. |
| 19 | Actual exporter and injected renderer exercised; no browser render performed; template switch independently inspected. |
| 20 | Native transport coalescing and actual runClient consumer executed separately: consumer discovery/agent are source-free faux imports and replay the same coalesced event-type sequence; not a full server lifecycle run, pending-cap reset/hang not executed. |
| 21 | Actual unmodified InteractiveMode prototype methods with source-free controlled session prompt preflight; no real terminal UI launched. |
| 22 | Initial probe written before 500ms initial settle reported events and was inconclusive; later probe waited 850ms then wrote, yielding zero events over 900ms; executed on Darwin, Linux-specific behavior source-confirmed only. |
| 23 | Source-only proof; no oversized filesystem fixture or daemon build/run; existing daemon binary not assumed aligned with reviewed HEAD. |
| 24 | Source-only proof; no daemon build/run or child-process leakage experiment; existing daemon binary not assumed aligned with reviewed HEAD. |
| 25 | Source-confirmed Windows-only path resolution; no Windows execution available. |
| 26 | Source-only proof of explicit event-loss signal dropping; no synthetic source mutation, notify queue exhaustion, or native overflow injection. |
| 27 | One-package bounded clean fixture and actual pack throw path; no eight-platform release build, image build, publication, install, or production package mutation. |

#### Independent validator disposition

| # | Accepted | Evidence-grounded reason |
| --- | --- | --- |
| 1 | yes | A fresh Darwin run of the independently inspected public processLock race probe let both live contenders acquire the same stale-socket lock, confirming the unsynchronized probe/unlink/rebind window. |
| 2 | yes | Direct exported Decisions classify calls whose onPayload rejected null or undefined both rejected with a new status-dereference TypeError instead of returning an error ClassifierResult. |
| 3 | yes | An unmodified two-host public Chord probe changed a Type.Unknown derivation to undefined and observed undefined locally but null remotely, matching the emitted root replacement op. |
| 4 | yes | A legal state-first/method-second contract hydrated its second variant but returned non-callable value members both locally and remotely, so valid value() calls threw TypeError. |
| 5 | yes | The README supplies remote without principal, and invoking the current public Host.connect with that option shape immediately threw the documented principal-required TypeError. |
| 6 | yes | A fresh public createAgentSession with tools:["-active_tool"] and a default-active extension still reported active_tool active because extension activation follows modifier application and empty-transcript restoration returns early. |
| 7 | yes | Public edit formatting accepted a malformed-argument tool call, its unchanged XML round-trip removed argumentsError, and validateToolArguments changed from rejecting the original to accepting the reconstructed empty object. |
| 8 | yes | A real SessionManager persisted a self-boundary compaction after removeLastMessages(2), and opening that exact producer file through JsonlSessionRepo failed with firstKeptEntryId not on its parent branch. |
| 9 | yes | A loopback server stalled initialize and the real runMcpCommand login --timeout 0.05 returned only after approximately 308 ms under a 300 ms connection timeout, proving the deadline excludes initial connection. |
| 10 | yes | A faux-model durable Harness using the real read and codemode tools read a PNG successfully but the script received {type:"string",value:""}, confirming loss at the schema-less codemode mapping. |
| 11 | yes | An unmodified agentLoopContinue preparation failure emitted a terminal error turn and settled its stream while its configured finishTurn callback ran zero times, contrary to the error-response contract. |
| 12 | yes | The real StreamingJsonParser emitted Infinity for {"value":1e309}, final parsing retained Infinity, and the current strict Chord copy boundary rejected the snapshot as non-finite JSON. |
| 13 | yes | The new public Node manager uses a negative-PID POSIX group kill and falls back only to child.kill, so its promised descendant termination has no Windows implementation; native Windows execution was unavailable. |
| 14 | yes | Both trusted two-host pinned-root arity transitions failed after coordinated reload: no-args to args threw a circular-JSON TypeError and args to no-args rejected foreign_ctx because remote dispatch decoded the current variant. |
| 15 | yes | With a real loopback ws server, a synchronous principal authenticator exception escaped the connection listener into uncaughtException rather than the link-close rejection branch. |
| 16 | yes | The supplied multiline-template script executed as valid JavaScript but the real parseCodemodeSource rejected its literal-data options marker as a misplaced directive. |
| 17 | yes | The documented example forwards generated images to image(), and a model-free real executeCodemode image call persisted matching image bytes in a mode-0600 temporary file despite the guide claiming no disk persistence. |
| 18 | yes | After soft-deleting a real toolsRemoved system entry, canonical context still declared read/bash but public createAgentSession resume activated only read because raw-branch restoration replayed the deleted removal. |
| 19 | yes | A real exportSessionToHtml with read and custom calls invoked the supplied renderer only for custom, and the inspected template also consults pre-rendered overrides only after its built-in-name switch. |
| 20 | yes | A size-reporting Chord probe coalesced message_end/run_end into one delivery, and actual runClient replaying that coalesced event sequence through faux discovery returned empty text without reconstructing snapshot answers. |
| 21 | yes | Holding the second submission in a controlled prompt preflight made actual queue helpers list and dequeue only the third message, while releasing preflight still admitted the second message after dequeue. |
| 22 | yes | After waiting beyond initial native-watcher settlement, a real symlink-parent file watch missed a write through the resolved real path; lstat marks the parent as a symlink and reconciliation never watches its target directory. |
| 23 | yes | The public reader forwards arbitrary positive safe page counts to an unbounded daemon metadata collection, whose single reply can exceed MAX_FRAME and permanently stop Output.run; no byte or count guard handles it. |
| 24 | yes | The PTY normal-leader-exit/silence path unregisters terminal and session ownership without kill_session, while settled requests remove abort listeners and shutdown cleans only registered sessions, leaving HUP-ignoring descendants unowned. |
| 25 | yes | Windows resolve_program checks relative PATH candidates with is_file before applying request.cwd, unlike its explicit-relative-program branch, so valid command-local executables are checked against the daemon directory. |
| 26 | yes | A native notify need_rescan event only schedules metadata comparison, and unchanged snapshots suppress all notifications without emitting the contract-required overflow signal for known event loss. |
| 27 | yes | The real produceArtifactSet on a bounded clean pi-env fixture with the evaluator caller options threw Missing pi-env release daemon assets for all eight platforms, while the actual Docker build never prepares those assets. |

#### Rejected contract/preference candidates

- Model-sized summaries: rejected. README retained-budget intent and `packages/coding-agent/docs/compaction.md:45` explicitly preserve the configured reserve-derived output cap. Removing it is not a defect repair.
- Decisions and easter-egg eager imports: rejected. Specific lazy-provider and first-use animation architecture requires these boundaries; no separate runtime failure was established. These do not authorize reversing retained architecture.

#### Residual risks and testing gaps

- Default classifier deadline: optional `timeoutMs` and SDK-default examples do not establish a universal classifier deadline. An unbounded omitted-timeout request remains an operational improvement candidate, not a confirmed contract violation.
- SSH daemon pruning across distinct simultaneous deployments: source-traced advisory only. No assumed deployment topology or live SSH reproduction promoted into the primary queue.
- Permanent paused-transport post-exit regression coverage remains missing. The existing windowed large-output test does not cover the unwindowed pause gate. This is a testing gap, not another observed current truncation.
- Performance reviewer reported no new finding; native reflow/allocation risk was not benchmarked. Broad platform and deployment limits remain above.
- Provenance is separated per finding: newer upstream, retained fork changes before the merge, merge-resolution interactions, and actual post-merge repair edges. In particular #11 (551975eabc) and #21 (510b7d3031) are pre-merge retained fixes, not regressions introduced by 682c6667. #14 and #27 are post-merge repair edges.

---

### Verdict

**Not ready.** Fix the confirmed P1 lock ownership race (#1) before relying on single-host storage ownership. 27 independently accepted findings remain un-applied. Prior repair-scope closure remains historical evidence, not a full-merge clean bill. Runtime/platform limits are disclosed; no strict cross-model or whole-upstream clearance is claimed.

### Actionable Findings

- #1 P1 `packages/chord/src/manager.ts:107` - Stale socket reclamation can admit two lock owners; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #2 P2 `packages/ai/src/api/openai-decisions.ts:154` - Classifier error formatter throws on null rejection; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #3 P2 `packages/chord/src/cell.ts:393` - Remote derived state changes undefined into null; manual -> downstream-resolver; suggested_fix present; confidence 100.
- #4 P2 `packages/chord/src/remote.ts:617` - Member lookup uses the first declared variant; manual -> downstream-resolver; suggested_fix present; confidence 100.
- #5 P2 `packages/client/README.md:25` - Client migration example cannot connect; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #6 P2 `packages/coding-agent/src/core/agent-session.ts:6273` - Negative tool modifiers do not remove default-active extensions; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #7 P2 `packages/coding-agent/src/core/message-edit.ts:607` - XML edit safety drops malformed-argument metadata; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #8 P2 `packages/coding-agent/src/core/session-manager.ts:2250` - Retain-none deletion checkpoint fails legacy v3 import; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #9 P2 `packages/coding-agent/src/extensions/mcp/cli.ts:554` - MCP login timeout excludes connection handshakes; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #10 P2 `packages/durable/src/codemode/codemode.ts:285` - Durable codemode read loses image content; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #11 P2 `packages/agent/src/agent-loop.ts:313` - Synthetic stream failures bypass finishTurn; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #12 P2 `packages/ai/src/utils/streaming-json.ts:536` - Overflowing JSON numbers enter tracked tool arguments; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #13 P2 `packages/chord/src/manager.ts:225` - Windows host stop leaves child descendants alive; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #14 P2 `packages/chord/src/remote.ts:651` - Pinned remote calls decode with the new variant arity; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #15 P2 `packages/chord/src/websocket.ts:27` - Synchronous WebSocket authentication can crash the host; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #16 P2 `packages/codemode/src/source.ts:109` - Options scan rejects template-string data; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #17 P2 `packages/coding-agent/docs/models.md:201` - Image guide gives an incorrect no-disk guarantee; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #18 P2 `packages/coding-agent/src/core/agent-session.ts:3231` - Resume replays tool changes from soft-deleted entries; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #19 P2 `packages/coding-agent/src/core/export-html/tool-renderer.ts:104` - HTML export bypasses built-in tool renderer overrides; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #20 P2 `packages/coding-agent/src/experimental/services/transcript-provider.ts:57` - Native state coalescing loses transcript events; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #21 P2 `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5505` - Dequeuing misses an in-flight unaccepted message; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #22 P2 `packages/durable/src/env/node-watch.ts:418` - Native file watches miss symlinked parent directories; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #23 P2 `packages/env/daemon/src/main.rs:285` - Directory pages can exceed the daemon frame limit; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #24 P2 `packages/env/daemon/src/pty.rs:316` - Normal PTY leader exit forgets live background jobs; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #25 P2 `packages/env/daemon/src/sys/windows.rs:319` - Windows relative PATH uses the daemon cwd; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #26 P2 `packages/env/daemon/src/watch.rs:640` - Native watcher rescan does not report uncertainty; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #27 P2 `scripts/package-artifacts.mjs:55` - Evaluator packing now requires release-only daemon assets; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.


## Full-review repair closure - 2026-10-27 / post-682c6667

This section supersedes the un-applied queue and Not ready verdict in the dated full-review section above. Those sections remain historical evidence. This repair covers all 27 numbered findings, plus the verified repair-edge failures discovered during follow-up review.

Base commit: `682c666713ef14f72b15f32099e400044ae0a31f`. Working branch: `fix/full-merge-review-8322aa1d`. No push. Product changes remain local.

### Disposition

| Full-review # | Repair and evidence boundary |
|---|---|
| 1 | Fixed: per-name SQLite BEGIN IMMEDIATE claim serializes file-socket acquisition/reclamation; private persistent claim is never unlinked. Distinct names do not share a port namespace. Real crash/contention/independence regressions pass. |
| 2 | Fixed: normalize unknown classifier errors before reading status; direct null/undefined rejection regressions pass. |
| 3 | Fixed: derived transitions involving undefined emit reset with actual undefined; local/remote public binding regressions pass. |
| 4 | Fixed: local and remote member access resolve the live variant before loading fallback; both state/method declaration orders and reload pass. |
| 5 | Fixed documentation: client connection uses principal and stable client.serverId, not invalid remote/optional hello access. |
| 6 | Fixed: startup/reload apply modifiers after complete extension-inclusive selection; later explicit selections remain authoritative. |
| 7 | Fixed: XML edit losslessness key includes argumentsError; malformed tool calls cannot silently become valid empty-object calls. |
| 8 | Fixed: retained v3 importer recognizes self-boundary checkpoints as an empty retained tail; real producer deletion/open/fork/commit/reopen pass. |
| 9 | Fixed: one whole-login signal bounds initialize, OAuth and reconnect; abort races stage waits and initiates active connection teardown. Loopback stalled initialize regression passes. |
| 10 | Fixed: read declares string-or-image structured output so actual Harness codemode image display and classifier input preserve the same PNG bytes. |
| 11 | Fixed: synthesized preparation/stream/iterator errors await finishTurn exactly once with active config/context, then settle; finalizer failure does not recurse. |
| 12 | Fixed: streamed complete/pending scalar conversions withhold non-finite numbers; final nested arguments reject through argumentsError. Numeric boundary regressions pass. |
| 13 | Fixed: Windows forced stop uses taskkill /F /T before parent death and joins termination before exited. Native Windows tests authored, not executed on Darwin. |
| 14 | Fixed: required protocol v5 shape metadata carries bounded current/retained consumer-view variants and origin-specific fenced admission hints. Remote args are cleaned before JSON transport, including stripped bigint/private extras. Retained foreign roots survive between calls; modern consumers skip incompatible old projections; pending-only holds wait for commit or abort without poisoning the link. Real before/after-acquisition, both arity/origin, fenced, versioned-consumer and pending commit/abort regressions pass. |
| 15 | Fixed: invoke synchronous WebSocket principal inside promise continuation; real rejected socket and subsequent authenticated client pass. |
| 16 | Fixed: dependency-free lexical scanner distinguishes literal/comment/template context, postfix division, control-statement regexps and control-keyword member calls/optional chaining. Public parser tests reject genuine misplaced directives while preserving literal markers. |
| 17 | Fixed documentation: image() writes private OS temporary files and reports paths; generated data alone is not claimed to persist. |
| 18 | Fixed: raw-branch tool restoration ignores soft-deleted system deltas; actual resume/navigation/provider-visible loadout regressions pass. |
| 19 | Fixed: export pre-renders built-in overrides and browser chooses middleware before built-in fallback. Actual generated HTML displays both custom read call and result with zero console errors. |
| 20 | Fixed: transcript schema v2 carries bounded sequenced event window; consumers replay each unseen event and fail explicitly on overrun instead of silently losing text/boundaries. Coalesced/reset and TUI tests pass. |
| 21 | Fixed: all normal and willRetry submissions retain visible ownership through async preflight. Internal cancellation is checked before queue/run admission, accepted callbacks release ownership, and rejections restore failed/reserved/newer input in order. Real first/second dequeue and retry steer/followUp regressions pass. |
| 22 | Fixed: native watches retain lexical and resolved nearest-existing-parent coverage across absolute/relative/nested dangling directory links, delayed recreation, retargeting and replacement. Actual settled Darwin native regressions pass; Linux/Android remains unexecuted. |
| 23 | Fixed: encoded-byte-bounded directory pages carry the next entry without loss; request-local oversized response errors preserve subsequent frames. Rust boundary tests pass. |
| 24 | Fixed: normal PTY leader completion kills remaining session members before unregistering; real HUP-ignoring job exits and leader status7 is preserved. |
| 25 | Fixed: Windows relative/empty PATH entries resolve against command cwd; native Windows resolve/spawn regression authored, not executed on Darwin. |
| 26 | Fixed: native need_rescan emits overflow independently of metadata equality and still schedules reconciliation; actual serialized overflow event regression passes. |
| 27 | Fixed: evaluator intermediate install explicitly opts out of release daemon matrix; production pack/publish enforcement remains unchanged. Artifact policy tests pass; no Docker or eight-target release certification. |

### Repair edges and compatibility

- The initial TCP reclamation claim was replaced, not shipped as the closure design. The final per-name SQLite kernel lock has no finite TCP namespace. Claims live in a validated owner-only directory and are never unlinked during acquisition; process death releases the write lock.
- Native Chord wire protocol is now **5**. All peers must update together; mismatch remains an explicit refusal, not a compatibility shim. The new bounded call projection metadata preserves pre-send consumer cleanup, pinned arities, adapters, fenced admission and root cleanup. State hydration remains unversioned. `packages/chord/docs/spec.md` records this cutover.
- Experimental Transcript contract is now **2**. A bounded 256-event sequence window survives native state coalescing/reset. A consumer overrun fails explicitly; it is not silently converted into an empty answer or an unresolved boundary wait.
- Follow-up review found seven semantic edges: postfix division, regexp after control parentheses, renderer image suppression, outbound parameter projection, false-positive fatal-tree fixture, retry queue ownership, and dangling resolved directories. One independent seven-item batch accepted all seven; all were repaired.
- Focused closure then caught and repaired three exact consequences: control-keyword member-call classification, a modern consumer encountering incompatible retained provider code, and pending-only holds producing empty required projection metadata. Independent protocol and consumer closure reports now record no open finding in their assigned finite scopes.
- Actual exported HTML with the real read renderer now retains a decoded 1x1 PNG alongside renderer text. Chromium DOM/image decoding was observed. A screenshot timed out, so no screenshot evidence is claimed.
- Windows fatal-tree fixtures now wait for an acknowledged running descendant and validate its positive safe-integer PID. Native Windows tests are authored but not represented as executed on Darwin.

### Verification

- Final `npm run check`: 1978 files, **No fixes applied**, exit 0; all dependency/import/entry/install-lock/type/browser gates pass (bg_527).
- Final offline build: all packages and coding-agent bundle pass, exit 0 (bg_517).
- Final authoritative isolated `./test.sh` with the independently rebuilt external daemon: **12441 passed / 0 failed / 941 skipped**, exit 0, artifact://10303 (bg_528). This includes the final protocol, lexer, watcher, queue and fixed-port test-isolation repairs.
- Earlier aggregate12440/1/941 (artifact://10291) exposed an actual cross-file test collision: Codex OAuth intentionally occupies1455 while ChatGPT OAuth needs it. `packages/ai/vitest.config.ts` now runs those two unchanged test files once in a later, file-serial project; ordinary tests stay parallel. The original production callback ports and authorization assertions are unchanged. Focused OAuth17 and cloud-collection4 pass; independent T1 closure confirms disjoint collection, group ordering and inherited cloud guards. No unknown process was killed.
- Earlier final-tree full suite:12439/2/941, artifact://10284; staged managed-update test timed out, then cleanup caused proper-lockfile ECOMPROMISED/ERELEASED pollution. Exact two unchanged tests pass serially (2 passed, bg_522); the later full suite passes both. No updater production change or weakened assertion substituted.
- Earlier full suite after main edge fixes passed12438/0/941 (artifact://10270); later compatible-consumer and pending-only projection changes have their direct regressions and the latest full-suite outcomes above.
- Native Chord final full package:690 passed/2 Windows skips in latest authoritative suite; pending/current-consumer targeted97 passed. AI numeric137; Agent finalization100; initial coding-agent143; retry/export68; native dangling watcher59; codemode8; Rust16; actual final rebuilt daemon terminal10; artifact policy3. Counts overlap and are not summed.
- Runtime proof includes real lock contention/crash recovery and distinct-name independence, native two-host pinned calls, actual session producer/import consumers, faux Harness PNG/classifier composition, loopback MCP deadline, native watcher delayed recreation and PTY HUP cleanup. Actual browser image decoded1x1 after renderer override.
- Final daemon was rebuilt with locked offline dependencies in `/tmp/pi-full-review-round2-fixes-a041ad0b/cargo-final`, outside all protected target files. Its terminal test passes10. The concurrent full suite used a different immutable binary path; no executable was overwritten mid-run.

### Review coverage and limits

- Repair-only review: 55 tracked paths at immutable digest `e23d8330210b4e0eae7d691e1ddc57b8f43debdfa6232d5173c5a0e79beaa34c`. Ten canonical personas completed. The new untracked `packages/chord/test/fixtures/lock-contender.ts` was excluded from that captured peer scope, read only as test context, and exercised by actual local regressions/full suites.
- That 55-path digest binds the pre-follow-up repair snapshot, not the final whole diff. Later protocol, lexer, queue, image and watcher deltas received the independent seven-item validation and finite follow-up source closure in `/tmp/pi-full-review-round2-fixes-a041ad0b/edge-closure/protocol.json` and `consumers.json`; the later OAuth runner delta received `oauth-isolation.json`. Final authoritative verification covers the integrated tree after these deltas.
- The performance persona disclosed contact with a simplification lens; its empty result is not treated as fully independent or used for confidence promotion. All actual findings received the independent validator batch.
- Claude was started before this repair-review local roster. Requested `claude-opus-5/high`; terminal `execution_failure` after 171 seconds, no usable review, actual model/effort/independence unverified. Collected digest/head evidence matched and runner was cleaned. A fresh unseeded local adversarial reviewer supplied the required role. No unresolved peer obligation and no cross-model clearance claim.
- Three simplification lenses completed. Applied two behavior-preserving changes: remove obsolete local queue state; move already-owned Rust page values instead of recursively copying them. Their affected regressions and full check were rerun.
- Native Windows process-tree/PATH tests, Linux/Android native PTY/watch behavior, live SSH/Cloudflare, Nix, native Bun startup, Docker evaluator image construction, and the real eight-target release daemon matrix are not certified. No paid/live-provider calls or publication occurred.
- Production pack/publish release assets remain enforced. Evaluator intermediate installation is explicitly install-only; a successful install does not certify release binaries.
- Source graph initialization failed; exact source, immutable history and available LSP references were used. No exhaustive external/dynamic caller claim.
- Evidence: `/tmp/pi-full-review-round2-fixes-a041ad0b`; repair review: `/tmp/compound-engineering-501/ce-code-review/20261027-repair-682c6667-141e9b43`; exact focused closure: `/tmp/pi-full-review-round2-fixes-a041ad0b/edge-closure`.
- Testing blocker T1 is closed by test-runner isolation and the zero-failure authoritative aggregate. Its original red result and the unrelated earlier managed-update timeout are retained above rather than overwritten.

### Verdict

**Ready locally within the named repair and disclosed platform/deployment limits.** All 27 product findings, seven validated repair-edge groups, their exact closure consequences, and testing blocker T1 are closed. Final authoritative tests, check, and offline build pass. This is not a new whole-upstream safety certification. Local commit authorized after verification; no push or release.

### Actionable Findings

None remain from the original 27-item queue, the seven validated repair-edge groups, or T1 within the independently inspected closure scopes. Native-platform and release-matrix gaps remain explicitly unverified above.


## Complete maintained merge review - db3f2fd8

This is a fresh complete-scope review. It preserves the earlier repair history but supersedes its clean verdict only for the current findings below. Numbering is local to this review.

**Scope:** `839dc79197595a4285d711e37d02fb623e5b6b7b -> db3f2fd865399983e5ef2af6e4470788e0085350`; 1509 changed paths. Tree: `2019485c40a63ba0d8f2c83e5f61c49ff12796c1`. Branch: `fix/full-merge-review-8322aa1d`.

**Tracked snapshot digest:** `2e90e0b673f69aad6bf9159d24654385692041bacf6cb28ec8f9cb1dbbae5057`. Supplementary comparisons: retained premerge `98dfe28 -> HEAD`, merge `8322aa1d -> HEAD`, first repair `682c6667 -> HEAD`, incoming upstream `d5b3de22 -> HEAD`. This is not a review of only the latest 60-file repair.

**Mode:** markdown report-only. Product source, tests, HEAD, index and branch references stay unchanged; only this user-requested report is appended. No fix, commit or push.

**Intent:** Verify current reachable behavior across the full maintained merge and all later changes. Preserve Crystal history/edit/swipe/delete/restore/shred/id0, retained Harness/experimental/client/server consumers, full multimodal/token counting, configured summary budgets, and prompt/receipt ownership. Attribute defects by immutable history, not by the latest commit alone.

**Reviewers:** 11 canonical personas completed. Correctness used ten non-overlapping domain assignments. Standards checked the two supplied applicable AGENTS files. Testing covered changed harnesses and false-pass boundaries; maintainability covered structural contract drift; agent-native covered tools/MCP; security covered public trust boundaries; performance covered replication/allocation; API covered retained consumers and wire schemas; migration covered actual SQLite/history transforms; reliability covered processes/watchers/cancellation. Deployment verification supplied operational notes.

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
| --- | --- | --- | --- | --- |
| Native Chord trust and control plane | #1, #2, #5 | Method metadata, principal identity and schema compatibility cross public links. | Un-applied fix queue: Fix null-principal trust first (#2), then unblock call projection delivery (#1); repair schema overlap independently (#5). | State flow control must not block calls; null is a supplied guest identity, not omission. |
| Transcript, export and presentation lifecycle | #3, #6, #9, #17, #18 | Replicated events, selection downloads, static rendering and pending display own different lifetimes. | Un-applied fix queue: Bound replay bytes/deltas first (#3); preserve export selection and stored duration; dispose detached live clocks. | A bounded event count does not bound cumulative payload bytes, and static views must not own live timers. |
| History usage and summary consumers | #4, #11, #12, #16 | Producer metadata must survive retained finalizers, replay/import and compaction consumers. | Un-applied fix queue: Preserve original charge identity during import (#4); retain finalization, native budgeting capabilities and nested file tracking. | Consumer gaps do not disappear when the producer and broad suite pass. |
| MCP and retained client admission | #8, #19, #20 | Rejected attachment, OAuth cancellation and config naming own failure-sensitive capability state. | Un-applied fix queue: Preserve current references on failure (#8), then fix final reconnect cancellation (#19) and non-destructive setup naming (#20). | Failed or cancelled work must not destroy the still-current capability set. |
| Native environment and storage boundaries | #21, #22, #23, #24 | Read-only ID allocation, stdin backpressure and native watch coverage. | Un-applied fix queue: Reject read-only allocation before storage effects; arm process cancellation before blocking input; align remote native watch coverage. | Early side effects and missing event sources bypass later rejection/timeout/reconciliation. |

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 1 | `packages/chord/src/connection.ts:644` | Send call projections outside the state window | correctness | 75 |
| 2 | `packages/chord/src/host.ts:567` | Preserve null guest principals instead of elevating to host | security | 75 |

- **#1:** After a coordinated reload, fresh worker roots can no longer call a previously hydrated remote object while the provider-to-worker state window is full. codeVersionChanged routes the required new callVariants through #unit, which queues the entire shape behind acknowledgements whenever an existing state feed survives; RemoteBinding.call then waits for that metadata before it sends any call. Thus state backpressure now blocks calls/results too, potentially indefinitely for a stalled acknowledging peer, contrary to the documented state-only flow control contract. **Response:** Publish the current/retained method projection metadata immediately when a code version changes, independently of windowed state-unit snapshots. Either introduce a control-only projection update or send a shape carrying the new callVariants immediately while preserving the pending snapshot/missing-member bookkeeping; do not flush queued state merely to unblock calls. Add a coordinated reload test with an existing stateful hold, a saturated provider window and paused acknowledgements, asserting a fresh-root method completes before acknowledgements resume. **Origin:** latest repair db3f2fd8. **Independent validation:** Actual coordinated reload advanced both hosts to version 2 while paused acknowledgements prevented any fresh ping call frame or completion, and releasing acknowledgements immediately completed pong, confirming method metadata is incorrectly windowed with state.
- **#2:** When an application represents an anonymous or otherwise unprivileged caller with null, a WebSocket connection is accepted with that exact principal, but acquiring its remote object replaces null with the host principal. A factory that grants an owner variant only to the host therefore gives that variant, its state, and its methods to the anonymous client. Root creation and forwarded-principal handling repeat the same nullish fallback, so preserving null only at the first acquisition is not sufficient; default only when the principal is undefined throughout this path. **Response:** Treat only undefined as an omitted principal. Replace the nullish principal defaults in HostImpl.acquire, joinRoot, remote-key/routing paths and self.get address calculation with explicit undefined checks, and make Connection.#principalOf preserve a forwarded null. Add a remote/WebSocket regression with self="host", accepted principal=null, and a factory that returns an owner-only variant for "host"; verify the guest receives only its null-principal variant locally and through a relay. **Origin:** newer upstream. **Independent validation:** A real remote client accepted with principal null caused the provider factory to receive host and exposed its owner method and owner-secret state; inspected WebSocket acceptance and forwarding also preserve admission of null before nullish defaults elevate it.

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 3 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:57` | Store deltas, not cumulative messages, in replay history | performance | 75 |
| 4 | `packages/agent/src/harness/session/jsonl/legacy-v3.ts:500` | Deduplicate original charges during legacy history migration | data-migration, api-contract | 100 |
| 5 | `packages/chord/src/schema.ts:194` | Check named fields against matching patternProperties | correctness | 100 |
| 6 | `packages/coding-agent/src/core/export-html/template.js:1192` | Terminate exported selection checkpoints with a newline | api-contract | 100 |
| 7 | `packages/coding-agent/src/core/model-config.ts:60` | Share the retained context-window default with generated schemas | maintainability | 100 |
| 8 | `packages/coding-agent/src/experimental/client-runtime.ts:211` | Failed session switch discards the still-attached service references | adversarial, correctness | 100 |
| 10 | `packages/durable/package.json:122` | Make the retention test command work on Windows | testing | 100 |
| 11 | `packages/agent/src/agent.ts:848` | Run finishTurn for rejected terminal prefills | correctness | 75 |
| 12 | `packages/ai/src/providers/azure.ts:52` | Preserve output-clamp capability through native provider wrappers | correctness | 75 |
| 13 | `packages/coding-agent/docs/terminal-setup.md:233` | Remove the unconditional program-status privacy guarantee | correctness | 75 |
| 16 | `packages/coding-agent/src/core/compaction/compaction.ts:922` | Include nested tool results in summary file tracking | correctness | 75 |
| 18 | `packages/coding-agent/src/core/tools/render-utils.ts:154` | Dispose elapsed timers when live tool views detach | performance | 75 |
| 19 | `packages/coding-agent/src/extensions/mcp/index.ts:936` | Honor sign-in cancellation during the final MCP reconnect | correctness | 75 |
| 20 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:8746` | Choose an unused Radius MCP server name | correctness | 75 |
| 21 | `packages/durable/src/session/session.ts:792` | Reject read-only transactions before persistent ID allocation | correctness | 75 |
| 22 | `packages/env/daemon/src/exec.rs:290` | Arm exec cancellation before writing the stdin script | reliability | 75 |
| 23 | `packages/env/daemon/src/watch.rs:469` | Watch resolved parents of symlinked file targets | correctness | 75 |
| 24 | `packages/env/daemon/src/watch.rs:481` | Union recursive coverage across duplicate watch targets | correctness | 75 |

- **#3:** Experimental clients now receive a complete, growing assistant message in every newly appended replay record, so streaming a long answer or tool argument repeatedly serializes its entire prefix instead of sending its delta. For a 256 KiB response arriving in 128-byte updates, the new event inserts alone encode 268,566,528 text bytes (about 256 MiB), and the last 256 messages make a reconnect/reset snapshot encode another 62,930,944 text bytes (about 60 MiB), before envelopes or the current snapshot. These are source-derived payload counts, not benchmark measurements; the insertion path bypasses the nested string-append savings and runs through synchronous JSON stringify/parse in the routed link, causing avoidable CPU, allocation, and transport load during normal streaming. Keeping sequenced delta frames and terminal events preserves replay ordering without retaining and retransmitting each cumulative prefix. **Response:** Represent replayed message_update records with the existing AssistantMessageFrame delta plus run/message identity, and reconstruct the cumulative message at the replay consumer. Keep the current authoritative snapshot for hydration and sequenced terminal events for prompt completion; byte-bound the replay buffer and retain the existing explicit overrun detection. Migrate LaneWatchEvent/transcript consumers together rather than dropping the replay guarantee. **Origin:** latest repair db3f2fd8. **Independent validation:** Measured the actual production replay ring at 62,930,944 retained text bytes and 268,566,528 inserted prefix bytes for 2,048 immutable 128-byte updates, while a real faux AgentHarness response serialized 540,632,412 wire bytes; recommend P2 rather than P1 because the experimental-path performance defect is proven but outage-level severity is not.
- **#4:** A v3 session containing a replayed compaction or branch-summary receipt reports the same provider charge again when opened by the retained Harness/experimental server, and the inflated total is made durable on v4 upgrade. This change starts preserving usage on replayed receipts and explicitly marks them with usageSourceId, but LegacyV3Source still sums every physical receipt without reading that identity. The regular coding-agent totals correctly deduplicate these records, so moving the same session across the supported boundary changes its billed token and cost totals. **Response:** Add optional usageSourceId to LegacyV3EntryBase and maintain a seen-charge Set in readLegacyV3Inventory. When legacyEntryUsage returns usage, add it only once per entry.usageSourceId ?? entry.id (mark seen only when usage exists), matching core/usage-totals.ts. Keep importing every transcript node. Verify an actual SessionManager-produced assistant plus replaceMessages/removeEntries clone yields one charge before upgrade, after the first v4 commit, and after reopening; two distinct assistant calls with identical usage must still count twice. **Origin:** retained premerge producer/importer interaction. **Independent validation:** Actual SessionManager compaction replay retained one charge identity and totals of input 11/cost 10, but JsonlStorage imported input 22/cost 20 and durably preserved that inflation after upgrade and reopening, confirming the newly preserved replay usage is counted twice.
- **#5:** A same-version provider can be accepted as compatible even though it rejects valid consumer arguments. For a consumer object with x: string and additionalProperties: false, and a provider with the same x property plus patternProperties {"^x$": {type:"number"}}, objectFits skips the matching pattern because x is also a named provider property and returns true. Calling the accepted method with {x:"text"} then fails invalid/args: JSON Schema applies both the named-property schema and every matching pattern, not one or the other. **Response:** Remove the !(key in supProperties) exemption when checking named subProperties against supPatterns; require every matching named value to fit the pattern schema as well as its named schema. Cover this with a fits counterexample and a same-version method binding/call test using a named field that also matches a provider pattern. **Origin:** newer upstream. **Independent validation:** The real same-version remote contracts bound successfully although matching named x:string violates the provider's numeric patternProperties, and calling with valid consumer input rejected invalid/args before the provider handler ran.
- **#6:** Downloading an HTML export whose selected leaf is null or an ancestor, then opening that JSONL through JsonlSessionRepo/the experimental server, selects the last retained entry instead of the exported selection. The new leaf checkpoint is always the final line, but downloadSessionJson emits no trailing newline and the retained legacy-v3 reader intentionally ignores unterminated final records. That can put abandoned or deleted-from-selection conversation history back into the active model context; newline-terminating the download preserves both the selection contract and the reader's torn-write protection. **Response:** Make downloadSessionJson emit `${lines.join("\n")}\n` so the final leaf checkpoint is a complete JSONL record. Add a cross-consumer round-trip scenario for both an ancestor selection and a null selection: HTML download bytes -> JsonlSessionRepo open/fork/upgrade, verifying the selected branch remains unchanged. **Origin:** retained premerge export/import interaction. **Independent validation:** Executing the unmodified HTML download function and opening its actual Blob bytes selected abandoned tail history for both ancestor and null selections, whereas adding only a final newline preserved the intended root or null selection.
- **#7:** Users configuring a custom model without contextWindow are told by both editor completion and the generated reference that its default is 128000, but the live model is constructed with 262144. That changes displayed context percentages and delays automatic compaction relative to the published configuration contract. The merge retained the fork's runtime default while importing the upstream schema default, so generating the reference again cannot repair the disagreement. **Response:** Preserve the retained 262144 runtime default, move it to one shared custom-model defaults constant, and use that constant in both modelFromJson and ModelDefinitionSchema; regenerate models.schema.json and models-configuration.md. Verify that a custom model omitting contextWindow has the same value advertised by the generated schema. **Origin:** merge-resolution interaction. **Independent validation:** Public ModelConfig.load and composeModelProvider constructed an omitted-contextWindow custom model with 262144 while the inspected schema and generated reference explicitly advertise 128000, confirming the merge-created configuration contract mismatch.
- **#8:** After attaching to a valid Session, an attempted attach to a missing Session clears all public models/agent/transcript references before the remote operation rejects. The server intentionally acquires the replacement before releasing the current attachment, so the original Session remains attached, but every facade getter now throws "No Session is attached". The same eager release precedes remove/detach; a rejected management operation must not destroy still-current local capability state. **Response:** Do not clear sessionRefs before remoteManagement.attach succeeds. Keep the existing references while the server validates/acquires the requested Session; after successful attachment/hydration, acquire the new references, install them, then release the old set. On a failure that leaves client.attachment unchanged, preserve the old set. Add a regression that attaches demo-1, attempts an unknown Session, catches rejection, and continues using the original agent/models/transcript without reattaching. **Origin:** merge-resolution retained experimental consumer. **Independent validation:** Through the actual Unix Server/Client, experimental management facet and real worker services, rejecting a missing-session switch left the original attachment unchanged but released its models reference and made the public getter throw No Session is attached.
- **#10:** Running npm test on native Windows stops after the first Durable suite: npm uses cmd.exe by default, which treats PI_DURABLE_DOCUMENT_RETENTION_MS=0 as an executable rather than an environment assignment. Consequently neither the zero-retention run nor workerd tests execute, and the root workspace test command fails despite the first suite passing. The existing cross-platform env workflow invokes selected Vitest files directly, so it does not exercise this package-script failure. **Response:** Replace the inline POSIX environment assignment with a small Node runner that spawns Vitest twice, setting PI_DURABLE_DOCUMENT_RETENTION_MS in the second child environment, and then runs test:workers; preserve each child exit status. Alternatively use an explicitly declared cross-platform environment helper. Validate the package script under native Windows npm, not only a bash workflow step. **Origin:** newer upstream. **Independent validation:** Source-only native-Windows validation confirms the Durable script contains a POSIX inline assignment, repository npm configuration supplies no shell override, and installed npm selects ComSpec/cmd.exe on win32 without translating that assignment; Windows execution was unavailable.
- **#11:** An Agent caller's finishTurn callback is never invoked when a completed prefill response fails terminal echo verification, although the caller receives message_end, turn_end, and agent_end for the synthesized error. The new publication barrier throws from processEvents before streamAssistantResponse returns, so neither normal runLoop finalization branch executes; handleRunFailure emits the error lifecycle directly without invoking finishTurn. Finalizer-owned persistence or turn bookkeeping is therefore skipped on this newly rejected-response path, unlike provider-reported errors and the low-level stream failure settlement. **Response:** Track whether the current turn's finishTurn callback has started and finalize the synthesized failure exactly once before emitting turn_end in Agent.handleRunFailure. Supply the finalized failure message, current context/new messages, empty toolResults, and canContinue:false; do not re-enter a callback whose own failure caused settlement. Share this error-finalization state with the existing loop mechanism rather than unconditionally invoking finishTurn for every exception. **Origin:** retained premerge terminal-prefill gate. **Independent validation:** Public Agent.continue with an incomplete terminal prefill emitted message_end, turn_end and agent_end for the synthesized error but invoked finishTurn zero times, matching the inspected exception path that bypasses loop finalization.
- **#12:** Near-full conversations with tool history summarized through Azure Chat Completions can be submitted with a one-token output cap and then fail compaction as an incomplete summary. azureStreams returns a new unregistered object around the marked native completions API, so usesProviderOutputClamp reports false even though streamSimple still applies the native 4,096-token safety ceiling. For example, a 128,000-token window with 125,000 estimated input tokens is admitted with 3,000 output tokens by the summary builder, but the adapter reduces that to one; preserving the independent clamp capability lets the existing headroom guard avoid that request. OpenCode and Cloudflare wrappers have the same capability loss. **Response:** Preserve only the output-clamp capability on repository-owned wrappers: when isContextClampingApiStreams(streams) is true, register the returned azureStreams wrapper with markContextClampingApi. Apply the same guarded propagation to withOpenCodeSessionHeader and cloudflareStreams. Do not grant history attribution or direct-tokenizer permission as a side effect. Add a near-window summary case through the real provider factory, rather than testing only naked API factories. **Origin:** merge-resolution capability-wrapper interaction. **Independent validation:** The actual Azure provider factory lost the native adapter's registered output-clamp capability while its delegated clamp reduced a 3000-token near-window budget to one, and the inspected compaction guard depends on precisely that lost capability.
- **#13:** Operators are told that enabling terminal/dashboard status cannot expose prompts or model output, but status messages forward arbitrary extension dialog titles and provider error text without content redaction. A concrete shipped example, rpc-demo.ts, puts the model-generated bash command directly in a selector title; loading it in interactive mode sends that command in OSC 7501 to a supporting terminal/dashboard, even before approval. Replace the absolute guarantee with the actual data categories and their sensitivity, or remove dynamic text from status messages if the guarantee is intended to hold. **Response:** Replace 'Reports never contain prompts or model output' with a precise warning that reports include session names, extension-supplied dialog titles, and the first line of provider errors; these strings can contain sensitive conversation-derived content. Explain that PI_PROGRAM_STATUS=0 disables this reporting. Do not promise content exclusion unless dynamic status text is actually redacted or omitted. **Origin:** newer upstream documentation. **Independent validation:** The shipped approval extension places the model-generated bash command in a dialog title, the inspected reporter forwards that title, and actual OSC encoding retained the command verbatim after base64 decoding, contradicting the unconditional privacy guarantee.
- **#16:** Compacting a conversation that used codemode to read, write, or edit files now drops those files from the generated read-files/modified-files tags and checkpoint details. Nested calls are recorded on the toolResult, but the new attributable-history collector only examines assistant messages; the assistant contains a codemode call rather than the underlying read/write/edit calls. Tree branch summarization repeats the same filter, so both summary entry points lose this metadata even when native dispatch and context conversion preserve the complete history. **Response:** In both attributable converted-history collectors, also call extractFileOpsFromMessage for toolResult messages, while retaining the existing failed/aborted assistant exclusion and request-history authorization checks. Verify a native codemode nested read/write/edit survives conversion and appears in compaction and branch-summary file tags/details. **Origin:** retained premerge summary collector. **Independent validation:** Actual generateSummaryWithUsage dispatched converted toolResult history containing nested read/write calls yet returned empty fileOps, and both compaction and branch-summary collectors explicitly filter those toolResult records out.
- **#18:** Switching sessions, disconnecting, or changing the theme while an experimental bash/codemode tool has partial output leaves its elapsed interval running forever. The timer closes over the old ToolExecutionComponent and TUI; the view clears its tool map or disposes only its status indicator, so the later final tool result reaches a replacement component rather than clearing the old interval. Each detached tool therefore retains its output/render state and continues invalidating/redrawing once per second, and the referenced interval can keep the process alive. Tying the clock to component/view lifetime rather than final-result delivery closes this newly introduced lifecycle leak. **Response:** Add a ToolExecutionComponent disposal path that clears its renderer timer and invoke it for every tool removed by ExperimentalChatView.refreshTheme(), transcript divergence, and dispose()/lane close. Prefer a component-owned elapsed timer with explicit disposal (or a renderer cleanup callback) so built-in renderers do not leave unmanaged intervals; preserve live components when rebuilding without detaching them. **Origin:** newer upstream timer plus retained experimental consumer. **Independent validation:** Rendering and disposing an actual ExperimentalChatView with partial bash output left one referenced interval alive and produced another UI invalidation after 1.15 seconds, confirming detached tool timers outlive the view; the probe cleared all remaining owned timers.
- **#19:** After browser authorization succeeds, the sign-in screen continues to advertise Esc to cancel while reconnecting to the MCP server, but Esc now only aborts a signal that the reconnect never reads. If initialize or tools/list stalls, the manager remains trapped on Connecting until the server's request timeout, normally 60 seconds, even after the user cancels. The new cancellation feature needs to cover this final awaited stage as well as the OAuth requests. **Response:** Check the combined cancellation signal after signInMcpServer returns, and await the final reconnect through raceWithAbortSignal using that signal. Track the reconnect promise through settlement, as with other background connection work, and map an aborted wait to Sign-in cancelled rather than continuing to hold the manager open. Keep actual session shutdown responsible for closing the connection. **Origin:** newer upstream extension cancellation. **Independent validation:** Source inspection shows the manager awaits sign-in through an advertised cancel screen, but after OAuth it awaits reconnect without checking or passing the combined cancellation signal, and only connection shutdown closes pending initialization; no live OAuth probe was performed.
- **#20:** Accepting the Radius MCP setup prompt silently replaces an unrelated global server when mcp.json already has both radius and radius-mcp entries pointing elsewhere. The fallback checks only radius, then passes the occupied radius-mcp name to addMcpServerConfig, whose documented and implemented behavior is replacement. Choosing a genuinely unused name preserves existing server configuration while adding Radius. **Response:** When no server already targets RADIUS_MCP_URL, collect existing global server names and choose radius, radius-mcp, radius-mcp-2, etc. until unused; preserve the existing matching server name only when intentionally updating its authentication. **Origin:** newer upstream Radius setup. **Independent validation:** Executing the actual Radius setup selector's Yes action against an owned mcp.json containing both occupied names replaced the unrelated radius-mcp URL with Radius rather than selecting an unused name.
- **#21:** A read-only Harness backed by the new IndexedDbStorage still changes its database when a caller attempts a write, even though that write rejects with ReadOnlySession. For example, root.commit(tx => tx.appendEntry(...)) mints an ID while running the callback; IndexedDbStorage.mintId() commits nextId to its meta store before the read-only check runs. The rejection therefore violates the promised before-Storage boundary and can fail the whole viewer on a backend that refuses writes, rather than remaining a harmless ReadOnlySession rejection. **Response:** Reject ID-allocating Tx operations on a read-only Session before calling the underlying Storage.mintId(), while retaining commits that only read existing records/documents. Put the read-only allocation gate outside the fatal storage-error guard so ReadOnlySession does not fail the Session; use it for conversation, entry, task, submission, and document allocation. Add an IndexedDB read-only regression that checks the next minted ID after a rejected create/write. **Origin:** newer upstream read-only/IndexedDB allocator interaction. **Independent validation:** Actual read-only SessionImpl backed by IndexedDbStorage over the installed IndexedDB implementation rejected appendEntry with ReadOnlySession but persisted an extra allocation, advancing the next minted ID from 3 to 5 instead of 4 while remaining readable.
- **#22:** Remote commands using the supported legacy Windows WSL bash.exe transport can ignore both an explicit timeout and cancellation indefinitely. The daemon synchronously writes the complete script before starting output readers or entering its timeout/cancel loop: a script beginning with a long-running command and followed by more than a pipe buffer of text blocks that write while bash executes the first command; similarly an output-producing prefix can fill stdout before the daemon drains it. The connection continues exchanging pings, so its silence watchdog does not release the caller. Start monitoring and draining the child before feeding stdin, with the feed running concurrently, so timeout/abort can kill the child and unblock the writer. **Response:** Register the child PID and establish the deadline immediately after spawn, start stdout/stderr readers, then move the optional stdin write into its own writer task/thread while the existing receive loop handles cancellation and timeout. On termination, close/interrupt or join that writer after killing the child so it cannot keep the request alive. Add a Windows/legacy-stdin regression using a sleeping first line plus a script tail larger than pipe capacity, exercising both timeout and abort. **Origin:** newer upstream daemon stdin path. **Independent validation:** Source-only legacy-WSL validation confirms supported Windows bash.exe selects command_on_stdin and synchronous write_all precedes PID registration, deadline and output readers, so queued cancellation cannot be processed while that pipe write blocks; the verified macOS prebuilt cannot exercise this Windows-only branch.
- **#23:** Remote native watches silently miss edits and creation beneath a symlinked parent. For a target /workspace/link/AGENTS.md with link pointing to /outside/real, scan records /workspace/link as a symlink, reconcile excludes it from directory watches, and the ordinary file target gets no direct watch; only lexical ancestors remain watched nonrecursively. Editing /outside/real/AGENTS.md therefore produces no relevant event after initial setup, despite watch returning ready/native, so consumers can retain stale resources. The local Node watcher already retains followed directory identities and resolved replacement boundaries; the daemon needs equivalent coverage and lexical event mapping. **Response:** Port NodeFileWatcher's linkedDirectories and resolvedParents handling to the Rust watcher: retain lexical symlink identity separately from followed directory identity, watch resolved parents component-by-component (including dangling destinations), map their boundary changes back to lexical targets, and reconcile coverage after replacement or retargeting. Add the symlink-parent and dangling-link scenarios for RemoteExecutionEnv, not just NodeExecutionEnv. **Origin:** newer upstream native watcher. **Independent validation:** Actual RemoteExecutionEnv native watching through the independently checked prebuilt reported ready but emitted no change after editing a file beneath a symlinked parent following settle, matching the missing followed-parent coverage in the exact HEAD source.
- **#24:** On macOS, a nonrecursive target listed after a recursive target for the same directory disables recursive native coverage. With targets [{path: skills, recursive: true}, {path: skills}], wanted first stores true then overwrites it with false, and macOS installs no per-subdirectory watches. Once the initial settle scan has passed, edits to skills/a/b/data are filtered by notify's nonrecursive event filter and never trigger a rescan, although the combined targets require recursive coverage. This makes results depend on target order and violates the remote/local watcher contract. **Response:** Accumulate wanted recursion with logical OR instead of unconditional replacement, matching NodeFileWatcher: wanted.entry(target.path.clone()).and_modify(|recursive| *recursive |= target.recursive && !per_directory).or_insert(target.recursive && !per_directory). Cover both target orders against the remote daemon on macOS, modifying an existing deep file after the settle interval. **Origin:** newer upstream native watcher. **Independent validation:** Actual macOS RemoteExecutionEnv native watches missed a settled deep edit when recursive preceded nonrecursive for the same root, while reversed target order emitted that exact file, confirming last-write recursion replacement rather than coverage union.

### P3 -- Low

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 9 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5510` | Clear submitting ownership before rendering a restored queue | correctness | 100 |
| 17 | `packages/coding-agent/src/core/export-html/tool-renderer.ts:95` | Do not start live execution clocks during HTML export | maintainability | 75 |

- **#9:** After queued input fails preflight (for example, missing or expired authentication after compaction), the pending-message panel shows the failed message twice even though only one copy remains queued. restoreQueue copies delivery.submitting.message back to compactionQueuedMessages and immediately rebuilds the panel while the same submitting message is still included by getAllQueuedMessages; finally drops the delivery token without refreshing that panel. Clearing the submitting slot before rendering the restored queue prevents the false duplicate. **Response:** After capturing unsent in restoreQueue, delete delivery.submitting before updatePendingMessagesDisplay(); also refresh pending-message display when finally releases compactionQueueDeliveryPending so rendered queue state matches ownership. **Origin:** latest repair db3f2fd8. **Independent validation:** Real AgentSession authentication rejection caused the queue display projection to render queued-once twice while the final retained queue contained it once and no later display refresh occurred; recommend P3 because the demonstrated harm is a stale duplicate display rather than duplicate delivery.
- **#17:** Exported bash calls now report a fabricated execution duration, usually "Took 0.0s", even when the stored result records a much longer duration. The latest repair sends built-in bash calls through the TUI renderer, whose startToolTimer sees executionStarted=true at export time, while the static render context discards durationMs. This is a concrete mismatch between live-renderer lifecycle state and historical rendering, not a request to reorganize working code. **Response:** Thread the stored tool-result durationMs through both ToolHtmlRenderer interfaces, preRenderCustomTools, and createToolHtmlRenderer into the result render context. Mark static call rendering as executionStarted=false so legacy results without a recorded duration omit timing instead of measuring export work; keep the newly supported custom built-in renderers. **Origin:** latest repair db3f2fd8 exposing existing live-render context. **Independent validation:** Actual SessionManager-to-HTML export retained a stored bash duration of 42000 ms but embedded Took 0.0s because static rendering starts a new clock and drops durationMs; recommend P3 for incorrect historical display.

### Finding Routes and Details

All 22 accepted findings remain un-applied. Fix recommendations are not apply authority. Stable numbers remain unchanged after validation; gaps #14 and #15 are intentional.

| # | Severity | File | Route | Suggested fix | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | `packages/chord/src/connection.ts:644` | `gated_auto -> downstream-resolver` | present | 75 |
| 2 | P1 | `packages/chord/src/host.ts:567` | `gated_auto -> downstream-resolver` | present | 75 |
| 3 | P2 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:57` | `manual -> downstream-resolver` | present | 75 |
| 4 | P2 | `packages/agent/src/harness/session/jsonl/legacy-v3.ts:500` | `gated_auto -> downstream-resolver` | present | 100 |
| 5 | P2 | `packages/chord/src/schema.ts:194` | `gated_auto -> downstream-resolver` | present | 100 |
| 6 | P2 | `packages/coding-agent/src/core/export-html/template.js:1192` | `gated_auto -> downstream-resolver` | present | 100 |
| 7 | P2 | `packages/coding-agent/src/core/model-config.ts:60` | `gated_auto -> downstream-resolver` | present | 100 |
| 8 | P2 | `packages/coding-agent/src/experimental/client-runtime.ts:211` | `manual -> downstream-resolver` | present | 100 |
| 9 | P3 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5510` | `gated_auto -> downstream-resolver` | present | 100 |
| 10 | P2 | `packages/durable/package.json:122` | `gated_auto -> downstream-resolver` | present | 100 |
| 11 | P2 | `packages/agent/src/agent.ts:848` | `gated_auto -> downstream-resolver` | present | 75 |
| 12 | P2 | `packages/ai/src/providers/azure.ts:52` | `gated_auto -> downstream-resolver` | present | 75 |
| 13 | P2 | `packages/coding-agent/docs/terminal-setup.md:233` | `gated_auto -> downstream-resolver` | present | 75 |
| 16 | P2 | `packages/coding-agent/src/core/compaction/compaction.ts:922` | `gated_auto -> downstream-resolver` | present | 75 |
| 17 | P3 | `packages/coding-agent/src/core/export-html/tool-renderer.ts:95` | `gated_auto -> downstream-resolver` | present | 75 |
| 18 | P2 | `packages/coding-agent/src/core/tools/render-utils.ts:154` | `manual -> downstream-resolver` | present | 75 |
| 19 | P2 | `packages/coding-agent/src/extensions/mcp/index.ts:936` | `gated_auto -> downstream-resolver` | present | 75 |
| 20 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:8746` | `gated_auto -> downstream-resolver` | present | 75 |
| 21 | P2 | `packages/durable/src/session/session.ts:792` | `gated_auto -> downstream-resolver` | present | 75 |
| 22 | P2 | `packages/env/daemon/src/exec.rs:290` | `gated_auto -> downstream-resolver` | present | 75 |
| 23 | P2 | `packages/env/daemon/src/watch.rs:469` | `gated_auto -> downstream-resolver` | present | 75 |
| 24 | P2 | `packages/env/daemon/src/watch.rs:481` | `gated_auto -> downstream-resolver` | present | 75 |

### Agent-Native Gaps

- #16: native codemode tool-result file operations disappear from summary file tracking even though converted history retains them. This is the same finding, not a duplicate.
- #8 and #19 affect still-current client capabilities and cancellable MCP sign-in; their concrete consumers are included above.

### Deployment Notes

- Before the first schema-2 SQLite open, stop the sole storage owner and take a consistent, separately restorable whole-database backup. Keep database identity and namespace prefix unchanged.
- Before workload resumes, verify schema version2, no leftover tasks_v2, the five declared task indexes, all seven task columns and exact record JSON, allocator metadata and other-table inventories against the quiesced snapshot.
- A committed v2 upgrade cannot be undone by deploying v1 code against the same database. Choose a schema-2-capable rollback release or restore the complete pre-upgrade snapshot, explicitly accounting for subsequent writes and external effects. Never relabel schema version or switch prefixes as rollback.
- Actual copy/drop/rename/index failure injection, representative lock/disk/runtime measurement, restore drill, live Cloudflare migration and sleep/alarm recovery were not executed. Source review established no new concrete SQL migration corruption defect. See deployment-verification.md for exact checks and attribution.

### Coverage

- All 1509 changed paths are accounted for in ten disjoint correctness partitions with no missing or duplicate path. Semantic diff/source coverage is 1207 paths; **302 paths remain insufficient_evidence**. Hunk inventory/traversal is not whole-file semantic certification. Exact path arrays/reasons are in coverage-audit.json and each domain report.
- Correctness accounting (assigned / semantic / insufficient): AI207/207/0; Agent48/48/0; Chord129/91/38; Durable234/152/82; env42/42/0; session142/140/2; integrations33/33/0; interactive94/94/0; docs34/34/0; tooling546/366/180. Historical review ledgers were inventory/dated-prose context only, not correctness seeds. Cross-cutting lenses disclose narrower source depths separately.
- The accepted fresh local adversarial reviewer inventoried1509 paths, source-covered93, deep-reviewed14 of those, and classified1416 insufficient for that lens. It read no other reviewer findings. Other persona evidence is not inflated into adversarial depth.
- Claude external attempt started before local dispatch: requested `claude-opus-5/high`, receipt supported. Runner `20261027T151611Z-f585563f` terminated `execution_failure` after188 seconds. No usable review. Actual model/effort and serving-family independence unverified. Collected digest/head matched; terminal runner removed; no unresolved peer obligation. Fresh local fallback supplies required adversarial coverage. No cross-model clearance or confidence promotion.
- Graph initialization failed with `WeakMap keys must be objects or non-registered symbols`. Exact source, immutable history and available LSP were the fallback. No exhaustive dynamic/external caller claim. No new cloud/provider calls, product edits or full-suite reruns were used as a substitute for boundary verification.
- Prior committed repair verification remains evidence of its exercised suite, not proof of these new boundaries: authoritative `./test.sh`12441/0/941 (artifact://10303), mandatory check1978 files/No fixes applied, offline build passed. Those tests preceded this report-only review and do not invalidate current concrete findings.
- Mechanics before semantic triage:29 raw findings, no malformed returns/findings or quote/confidence suppression. Two duplicate pairs merged (legacy usage identity, rejected session switch). Two testing-only candidates moved to testing_gaps. One release-policy proposal rejected as a contract conflict. Stable numbers were restored by deterministic helper.
- No implementation plan was selected: the requested closure document is a historical ledger, not a requirements specification. Generic review/fix branch keywords did not authorize inferred-plan settlement suppression. Existing product/release contracts were checked directly.
- Validation: one fresh independent batch selected **all24 actionable candidates**, including all3 initial P1 candidates. Normal8 cap was exceeded within that single batch to avoid sampling; no second batch, no cross-model skips. **22 accepted / 2 rejected**. Severity calibrated from observed harm: #3 P1 -> P2; #9 and #17 P2 -> P3. Final total: **2 P1 / 18 P2 / 2 P3**.
- Runtime evidence exists for19 accepted findings; #10, #19 and #22 are independently source-confirmed only. Runtime probes use unchanged public code, owned temp fixtures, offline/faux providers, in-process/native links or loopback. No paid/live provider/OAuth requests.
- #3 measured the actual production replay ring: **62,930,944 retained text bytes**, **268,566,528 inserted prefix bytes** for2048 immutable128-byte updates; a real faux AgentHarness streamed response serialized **540,632,412 wire bytes**. These are measured payload/serialization counts, not heap/RSS or outage benchmarks. An earlier over-instrumented trial timed out and was not used as a result.
- #2 actual remote null-principal acquisition exposed host-only state/method. Relay/WebSocket null admission was source-traced, not runtime-exercised. #1 actual paused-ack reload allowed neither fresh call frame nor completion until acknowledgements resumed.
- #23/#24 used a known prebuilt native macOS daemon after source-path/timestamp checks. The binary has no embedded commit ID; this is not cryptographic rebuild attestation. Linux/Android native watcher behavior remains source-only. #21 uses actual IndexedDbStorage with installed fake-indexeddb, not a real browser scheduler.
- validator-evidence.json records exact per-finding observations, failed setup attempts, source limits and cleanup. Broad green suite results are not substituted for these probes.

#### Validator disposition

| # | Accepted | Reason |
| --- | --- | --- |
| 1 | yes | Actual coordinated reload advanced both hosts to version 2 while paused acknowledgements prevented any fresh ping call frame or completion, and releasing acknowledgements immediately completed pong, confirming method metadata is incorrectly windowed with state. |
| 2 | yes | A real remote client accepted with principal null caused the provider factory to receive host and exposed its owner method and owner-secret state; inspected WebSocket acceptance and forwarding also preserve admission of null before nullish defaults elevate it. |
| 3 | yes | Measured the actual production replay ring at 62,930,944 retained text bytes and 268,566,528 inserted prefix bytes for 2,048 immutable 128-byte updates, while a real faux AgentHarness response serialized 540,632,412 wire bytes; recommend P2 rather than P1 because the experimental-path performance defect is proven but outage-level severity is not. |
| 4 | yes | Actual SessionManager compaction replay retained one charge identity and totals of input 11/cost 10, but JsonlStorage imported input 22/cost 20 and durably preserved that inflation after upgrade and reopening, confirming the newly preserved replay usage is counted twice. |
| 5 | yes | The real same-version remote contracts bound successfully although matching named x:string violates the provider's numeric patternProperties, and calling with valid consumer input rejected invalid/args before the provider handler ran. |
| 6 | yes | Executing the unmodified HTML download function and opening its actual Blob bytes selected abandoned tail history for both ancestor and null selections, whereas adding only a final newline preserved the intended root or null selection. |
| 7 | yes | Public ModelConfig.load and composeModelProvider constructed an omitted-contextWindow custom model with 262144 while the inspected schema and generated reference explicitly advertise 128000, confirming the merge-created configuration contract mismatch. |
| 8 | yes | Through the actual Unix Server/Client, experimental management facet and real worker services, rejecting a missing-session switch left the original attachment unchanged but released its models reference and made the public getter throw No Session is attached. |
| 9 | yes | Real AgentSession authentication rejection caused the queue display projection to render queued-once twice while the final retained queue contained it once and no later display refresh occurred; recommend P3 because the demonstrated harm is a stale duplicate display rather than duplicate delivery. |
| 10 | yes | Source-only native-Windows validation confirms the Durable script contains a POSIX inline assignment, repository npm configuration supplies no shell override, and installed npm selects ComSpec/cmd.exe on win32 without translating that assignment; Windows execution was unavailable. |
| 11 | yes | Public Agent.continue with an incomplete terminal prefill emitted message_end, turn_end and agent_end for the synthesized error but invoked finishTurn zero times, matching the inspected exception path that bypasses loop finalization. |
| 12 | yes | The actual Azure provider factory lost the native adapter's registered output-clamp capability while its delegated clamp reduced a 3000-token near-window budget to one, and the inspected compaction guard depends on precisely that lost capability. |
| 13 | yes | The shipped approval extension places the model-generated bash command in a dialog title, the inspected reporter forwards that title, and actual OSC encoding retained the command verbatim after base64 decoding, contradicting the unconditional privacy guarantee. |
| 14 | no | Although the current public edit scenario doubles usage, exact base source already copied baseAssistant.usage, appended the id-zero edit under a fresh identity, and summed every physical assistant receipt, so the reported duplicate-charge behavior predates and is not introduced by this diff. |
| 15 | no | The inactive matched deferred tool is intentional under the inspected MCP exposure contract, which requires tool_search or direct exposure for declaration, and an existing wildcard consumer test explicitly expects only the matching direct tool active; the finding assumes an unsupported allowlist override. |
| 16 | yes | Actual generateSummaryWithUsage dispatched converted toolResult history containing nested read/write calls yet returned empty fileOps, and both compaction and branch-summary collectors explicitly filter those toolResult records out. |
| 17 | yes | Actual SessionManager-to-HTML export retained a stored bash duration of 42000 ms but embedded Took 0.0s because static rendering starts a new clock and drops durationMs; recommend P3 for incorrect historical display. |
| 18 | yes | Rendering and disposing an actual ExperimentalChatView with partial bash output left one referenced interval alive and produced another UI invalidation after 1.15 seconds, confirming detached tool timers outlive the view; the probe cleared all remaining owned timers. |
| 19 | yes | Source inspection shows the manager awaits sign-in through an advertised cancel screen, but after OAuth it awaits reconnect without checking or passing the combined cancellation signal, and only connection shutdown closes pending initialization; no live OAuth probe was performed. |
| 20 | yes | Executing the actual Radius setup selector's Yes action against an owned mcp.json containing both occupied names replaced the unrelated radius-mcp URL with Radius rather than selecting an unused name. |
| 21 | yes | Actual read-only SessionImpl backed by IndexedDbStorage over the installed IndexedDB implementation rejected appendEntry with ReadOnlySession but persisted an extra allocation, advancing the next minted ID from 3 to 5 instead of 4 while remaining readable. |
| 22 | yes | Source-only legacy-WSL validation confirms supported Windows bash.exe selects command_on_stdin and synchronous write_all precedes PID registration, deadline and output readers, so queued cancellation cannot be processed while that pipe write blocks; the verified macOS prebuilt cannot exercise this Windows-only branch. |
| 23 | yes | Actual RemoteExecutionEnv native watching through the independently checked prebuilt reported ready but emitted no change after editing a file beneath a symlinked parent following settle, matching the missing followed-parent coverage in the exact HEAD source. |
| 24 | yes | Actual macOS RemoteExecutionEnv native watches missed a settled deep edit when recursive preceded nonrecursive for the same root, while reversed target order emitted that exact file, confirming last-write recursion replacement rather than coverage union. |

#### Rejected and advisory candidates

- #14 id0 manual-version duplicate usage: current behavior reproduced, but exact baseline already copied usage into a fresh physical receipt and summed it. Rejected from this diff review as pre-existing/unaffected, not declared correct.
- #15 explicit deferred MCP tool activation: rejected. The current exposure contract requires tool_search or direct exposure; an existing wildcard test intentionally activates only the matching direct tool. No unsupported allowlist override is imposed.
- Local pack/local-release daemon asset opt-out proposal: rejected as a release-policy conflict. Preserve full production artifact enforcement; install-only evaluator/check profiles are explicit separate callers. Missing release assets remain an operational preparation limit.
- Testing gaps retained: replace source-text assertions in export-html-system-messages.test.ts with actual renderer execution; restrict native tokenizer fixture upload URLs to exact allowlisted origins rather than endpoint suffixes. Neither is claimed as an independently reproduced production data leak.
- Additional limits: native Windows/WSL, Linux/Android PTY/watch, live SSH/Cloudflare, IndexedDB browser scheduling, Nix, native Bun startup, full Docker evaluator image and real eight-target release asset matrix remain uncertified. No new deadline contract is inferred from those limits.

---

### Verdict

**Not ready.** Fix #2 null-principal host elevation and #1 call-metadata/state-window coupling first. All22 accepted findings remain un-applied. Earlier repair-scope green closure is historical evidence, not a clean bill for this complete merge. No product code, tests, commits or pushes were changed by this review.

### Actionable Findings

- #1 P1 `packages/chord/src/connection.ts:644` - Send call projections outside the state window; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #2 P1 `packages/chord/src/host.ts:567` - Preserve null guest principals instead of elevating to host; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #3 P2 `packages/coding-agent/src/experimental/services/transcript-provider.ts:57` - Store deltas, not cumulative messages, in replay history; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #4 P2 `packages/agent/src/harness/session/jsonl/legacy-v3.ts:500` - Deduplicate original charges during legacy history migration; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #5 P2 `packages/chord/src/schema.ts:194` - Check named fields against matching patternProperties; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #6 P2 `packages/coding-agent/src/core/export-html/template.js:1192` - Terminate exported selection checkpoints with a newline; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #7 P2 `packages/coding-agent/src/core/model-config.ts:60` - Share the retained context-window default with generated schemas; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #8 P2 `packages/coding-agent/src/experimental/client-runtime.ts:211` - Failed session switch discards the still-attached service references; manual -> downstream-resolver; suggested_fix present; confidence 100.
- #10 P2 `packages/durable/package.json:122` - Make the retention test command work on Windows; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #11 P2 `packages/agent/src/agent.ts:848` - Run finishTurn for rejected terminal prefills; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #12 P2 `packages/ai/src/providers/azure.ts:52` - Preserve output-clamp capability through native provider wrappers; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #13 P2 `packages/coding-agent/docs/terminal-setup.md:233` - Remove the unconditional program-status privacy guarantee; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #16 P2 `packages/coding-agent/src/core/compaction/compaction.ts:922` - Include nested tool results in summary file tracking; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #18 P2 `packages/coding-agent/src/core/tools/render-utils.ts:154` - Dispose elapsed timers when live tool views detach; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #19 P2 `packages/coding-agent/src/extensions/mcp/index.ts:936` - Honor sign-in cancellation during the final MCP reconnect; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #20 P2 `packages/coding-agent/src/modes/interactive/interactive-mode.ts:8746` - Choose an unused Radius MCP server name; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #21 P2 `packages/durable/src/session/session.ts:792` - Reject read-only transactions before persistent ID allocation; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #22 P2 `packages/env/daemon/src/exec.rs:290` - Arm exec cancellation before writing the stdin script; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #23 P2 `packages/env/daemon/src/watch.rs:469` - Watch resolved parents of symlinked file targets; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #24 P2 `packages/env/daemon/src/watch.rs:481` - Union recursive coverage across duplicate watch targets; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #9 P3 `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5510` - Clear submitting ownership before rendering a restored queue; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #17 P3 `packages/coding-agent/src/core/export-html/tool-renderer.ts:95` - Do not start live execution clocks during HTML export; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.

## Local repair of the db3f2fd8 review findings

This section supersedes the preceding report-only verdict for the local working tree, not its historical evidence. Base remains `db3f2fd865399983e5ef2af6e4470788e0085350` on `fix/full-merge-review-8322aa1d`. No commit or push is authorized or performed. The two rejected candidates, #14 and #15, remain unchanged.

### Repair disposition

| Finding | Local repair and boundary proof |
| --- | --- |
| #1 | Chord protocol 6 adds control-only `projections` through producers, relays and consumers, independent of state windows. Actual paused-ACK reload smoke returned `pong` before ACK release. Initial pending-only holds still receive their first shape only after commit; the existing commit/abort regression passes. |
| #2 | Principal defaults now distinguish `undefined` from explicit `null` across local acquisition, remote identity, routing and forwarding. Actual null-principal remote smoke retained guest identity and returned the guest method rather than owner state. |
| #3 | Transcript contract 3 stores compact identity-bearing frames with a 256-record/1 MiB UTF-8 replay bound and independent high-water cursor. Hydration carries exact decoder checkpoint/cursor; navigation publishes a sequenced reset. Aligned snapshot blocks use tracked deltas, not cumulative container replacement. Actual 262144-byte faux response retained full final text and terminal boundary with 2306850 serialized wire bytes, versus the original review's 540632412 bytes. |
| #4 | Legacy v3 inventory deduplicates usage by `usageSourceId` or entry ID, marking identities only when usage exists. Migration/reopen regression covers durable totals rather than equal-value heuristics. |
| #5 | Named properties must satisfy every matching `patternProperties` schema. Same-version binding and contract regressions cover incompatible overlaps. |
| #6 | HTML download terminates the final leaf checkpoint with a newline. Real Chromium download Blob bytes for ancestor and null selections imported through `JsonlStorage` with the intended selection intact. |
| #7 | Runtime and generated model schema share the 262144 custom-model context-window default. Schemas and references were regenerated through their scripts; runtime/schema agreement test passes. |
| #8 | Rejected Session switches retain capabilities when the attachment is unchanged. Replacements install before old refs release; partial acquisitions release on failure. Actual framed-client tests cover rejected switch, partial release and subsequent recovery. |
| #9 | Restoring a rejected queued submission clears `submitting` before repaint, then refreshes after delivery ownership releases. Actual VirtualTerminal rejection test shows the restored steering row once. |
| #10 | Durable's npm test command uses a Node runner instead of POSIX inline assignment; it preserves both retention passes, Workers execution and failure propagation. Executed through `npm test`; native Windows itself was unavailable. |
| #11 | Stateful Agent failure settlement shares exactly-once awaited `finishTurn`, including terminal prefill echo rejection, preserving active model/context and receipt identity. Agent terminal-prefill and loop regressions pass. |
| #12 | Azure, OpenCode and Cloudflare wrappers propagate only the adapter output-clamp marker, not history-upload or tokenizer authority. Actual provider-factory summary budgeting and provenance tests pass. |
| #13 | Program-status documentation now describes session/dialog/error text exposure and the `PI_PROGRAM_STATUS=0` opt-out instead of an unconditional no-content guarantee. Original OSC evidence retained; no source-text test added. |
| #16 | Compaction and branch summarization collect nested operations retained on policy-converted tool results. Actual summarization tests verify read/modified lists and appended tags, without restoring policy-removed raw metadata. |
| #17 | Static HTML renderer contexts never start a live execution clock and receive recorded `durationMs`. Real exported page displays `Took 42.0s`; legacy missing-duration regression fabricates no elapsed duration. |
| #18 | Experimental, mini and micro views dispose detached tool-row clocks; disposal is idempotent and suppresses detached invalidation. Actual renderer smoke waited 1200 ms after disposal and observed zero further invalidations. |
| #19 | MCP manager sign-in races its final tracked reconnect against the combined cancel signal, keeps `server.ready` coherent and leaves cleanup owned by session shutdown. Real loopback OAuth test reaches `Connecting…`, presses Escape, returns cancellation and verifies stalled reconnect socket cleanup on shutdown. |
| #20 | Radius MCP setup chooses an unused name while preserving both occupied `radius` and `radius-mcp`. Actual selector action writes `radius-mcp-2` and preserves both existing configs. |
| #21 | Read-only Durable sessions reject ID allocation before calling persistent storage and outside fatal-backend handling. Six IndexedDB creation paths reject without advancing allocation; existing records remain readable. |
| #22 | Daemon registers PID/deadline and output readers before concurrently feeding stdin; stop/interruption joins pipe workers. Real Unix bash-stdin execution covers timeout, abort, output draining and descendant-held stdin. Native legacy WSL remains unexecuted. |
| #23 | Native daemon watches followed/resolved symlink parent boundaries, including initially missing destinations, retargets and directory replacement. Physical registrations are identity-deduplicated while lexical aliases route events separately. Actual macOS remote-consumer regressions pass. |
| #24 | Recursive coverage is ORed across duplicate roots and physical aliases; a nonrecursive alias cannot downgrade an existing recursive registration. Actual macOS tests cover both duplicate/alias target orders. Linux inotify alias-retarget case is source-reviewed and platform-gated, not executed here. |

### Verification and repair-boundary review

- Chord targeted suite: 114 passed across 7 files; original-reference hydration followup: 14 passed. Agent migration/prefill/loop: 170 passed; lane/frame capture: 14 passed. AI frame codec: 32 passed; Cloudflare: 4 passed.
- Coding-agent integrated consumer run: 152 passed across 7 files. Final multi-block frame parity/wire suite: 6 passed, including corrections, thinking metadata, raw tool JSON, nested arrays, key removal and replay resets.
- Durable portable npm runner: first retention pass 1427 passed/4 skipped; zero-retention pass 1427 passed/4 skipped; Workers 30 passed. IndexedDB targeted read-only suite: 62 passed.
- Current native Rust tests: 20 passed; daemon built offline with external `CARGO_TARGET_DIR`. Actual remote environment suite after alias repair: 20 passed/3 platform skips.
- Mandatory `npm run check` passed after all current TypeScript changes, including pinned/runtime dependencies, TS imports, entry graphs, install-lock, typecheck and browser bundle smoke. Offline monorepo build passed (81-file coding-agent bundle, 9.4 MiB).
- Real browser rendered the exported historical duration and exercised JSONL download controls. Downloaded Blob bytes were then imported through actual storage. No browser errors were observed; managed tab was closed.
- Independent repair review found and closed two native alias defects and two Transcript hydration/rebase defects. A subsequent actual wire smoke caught residual cumulative snapshot retransmission; tracked per-block updates reduced measured wire to 2306850 bytes without raising the 20 MiB smoke bound. Followup reviewer inspected the final helpers and parity scenarios without claiming execution. Settled-code reuse/quality/efficiency reviewers returned no actionable simplification; no cosmetic rewrites were added.
- The codebase-memory knowledge-graph service remained unavailable with the recorded WeakMap error. Exact source and available LSP were used; no exhaustive external-caller or cross-platform certification is claimed. This is separate from the repository's `check:entry-graphs` import-budget check, which passed under `npm run check`.
- `cargo fmt --check` was not clean: it reports formatting in both this repair's Rust additions and pre-existing `frame.rs`, `main.rs`, `pty.rs` and Windows code. No unrelated formatter sweep was applied. Rust compilation and behavioral tests pass; this formatting-only check is not represented as green.
- The pre-suite preservation check found all 749 protected daemon-target hashes matching, with HEAD/tree, `my-merge`, `crystal` and the empty index unchanged. The post-suite preservation result is recorded in Final local closure below.
- Both authoritative isolated `./test.sh` runs used the external rebuilt daemon. Their observed aggregates and correction history are recorded below; earlier suite totals are not reused as current proof.

### Full-suite followup

- First current-tree isolated run completed with **12506 passed / 4 failed / 944 skipped** (`artifact://11100`). Two failures exposed a real #16 over-attribution: opaque nested metadata on ordinary `read` results was included. The shared request collector now requires a retained replayable codemode parent and result, while nested extraction accepts only successful calls with available arguments. Existing partial-record semantics remain: `complete: false` does not discard already-known successful calls. The opaque-metadata and authorized-codemode compact/branch suites then passed (15 tests).
- The other failures were a 100-seed fuzz test exceeding its single 5000 ms budget under package concurrency, and a classifier test relying on a 10 ms sleep to observe exactly four concurrent calls. All 100 seeds × 100 operations and invariants are preserved as separately reported cases (100 passed); no timeout was raised. Classification now uses a controlled release promise, a bounded entry assertion, and unconditional release/drain cleanup rather than wall-clock overlap (25 passed). No product concurrency behavior changed.
- Independent followup source review inspected the request-attribution guard and deterministic test boundaries and returned no additional defect. The required isolated rerun after these corrections completed successfully, as recorded in Final local closure below; the first aggregate remains here rather than being hidden or relabeled green.

### Final local closure

- Final authoritative isolated `./test.sh`: **12609 passed / 0 failed / 944 skipped**, exit 0 (`artifact://11125`). The increase includes separately reported fuzz seeds; it does not mean 99 new behavioral scenarios were added. All previous fuzz operations remain covered.
- Final mandatory `npm run check`: **1978 files, no fixes applied**, exit 0; all dependency/import/graph/install-lock/type/browser-smoke stages passed. Final offline build passed. Built CLI smoke reports version `1.4.0`.
- Independent bounded reviews of Chord trust/control, storage/accounting, Agent/provider/export/queue/MCP/Radius consumers, native alias repair, Transcript reset/hydration and tracked-frame helpers returned no remaining actionable repair finding. These are source reviews combined with separately recorded parent execution, not a new complete 1509-path merge certification or external-model clearance.
- Final preservation: **749/749 protected daemon-target hashes match**. HEAD remains `db3f2fd865399983e5ef2af6e4470788e0085350`; tree `2019485c40a63ba0d8f2c83e5f61c49ff12796c1`; `my-merge` remains `cb3bee033ba853041609b874303dc625d5d30479`; `crystal` remains `8322aa1d6808711a6e46bfbe67d8a788ca8cbd1e`. Index is empty. No dependency or lockfile changes. Local repair inventory is 74 modified tracked paths plus the new owned `packages/durable/scripts/test.mjs`.
- Five owned throwaway smoke scripts were removed after execution; measured outputs, review receipts, browser download evidence and external native build are retained under `/tmp/pi-full-review-round3-fixes-040e3375`. No managed browser tab or experiment service remains running. No commit or push was performed.
- **Verdict: all 22 accepted findings are repaired and locally verified.** This is a local-uncommitted closure, not deployment approval. Native Windows/WSL, Linux/Android inotify execution, real browser IndexedDB scheduling, SSH/Cloudflare and release-matrix limitations remain as disclosed above. Rust formatting check remains non-green for the recorded mixed pre-existing/current formatting differences; no behavioral or typecheck failure remains.


## Complete maintained merge review - 626aad42

**Scope:** `839dc79197595a4285d711e37d02fb623e5b6b7b -> 626aad42db8903e3b515c5911147c55a7ac5a3c4`; **1525 changed paths**, including the complete maintained merge and every later commit. Reviewed tree `ab4ec3660bbef622ad48723ec62c71867c411a7c`. Full-change snapshot digest `01da07736d854a417fc720e18bc5e0a93c5e048fa42ce0fa708d6c7d9b05ede4`. Branch `fix/full-merge-review-8322aa1d`.

**Intent:** Preserve Crystal history/edit/swipe/delete/restore/shred/id0 behavior, retained Harness/experimental/client/server consumers, multimodal and token counting, summary budgets, receipt ownership, and native/storage safety. Review the full diff, not only the last repair commit.

**Mode:** markdown report-only. Only this requested ledger is appended. No product fixes, commits or pushes. Earlier repair closure remains historical evidence; it does not certify these newly inspected boundaries.

**Status:** validation-degraded, not a complete clean bill. All 22 local reviewer jobs completed: correctness in ten disjoint domains, project standards, testing, maintainability, agent-native, security, performance, API contract, data migration, reliability, adversarial, asynchronous UI races, and deployment notes. Testing covers changed harnesses; performance covers streaming transforms; API covers public/wire consumers; migration/deployment covers SQLite rebuilds; UI lens covers timers and asynchronous state. Swift and learnings lenses were inapplicable.

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
| --- | --- | --- | --- | --- |
| Session and worker admission | #1, #2, #7 | Retained processes and pending work outlive their publishing owner. | Apply queue: fence incompatible workers (#1), cancel reserved preflight before invalidation (#2), then replace rejected terminal receipts (#7). | A successful replacement must not retain incompatible peers or dispatch stale requests. |
| Chord consumer guarantees | #5, #12 | Binding compatibility and reused references promise unusable values/state. | Apply queue: repair optional-field coverage and state-mode-sensitive reference reuse. | Accepted contracts must match usable consumer views. |
| Streaming and remote settlement | #9, #22, #23 | Full JSON prefixes, file growth, and queued output cross boundary state. | Apply queue: incremental parser state; initial-size bounded reads; final abort check. | Preserve bounded work and truthful cancellation/read results. |

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 1 | `packages/coding-agent/src/experimental/session-worker-manager.ts:206` | Fence retained workers before the native protocol cutover | correctness-integrations | 75 |
| 2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2667` | Abort reserved queue preflight before replacing the session | correctness-interactive | 75 |

- **#1:** Upgrading a running experimental server across this merge can adopt its old session workers and then leave every attached session unable to hydrate or accept prompts. The new manager sends `chord` frames, but workers from the reviewed base accept only `operation`/`operation_cancel` and silently ignore `chord`; their unchanged worker_ready and session_demand messages still pass discovery and attachment. The unchanged coordinator protocol version 3 permits this mixed generation, so public protocol version 9 replacing the old server does not replace the incompatible retained worker. **Response:** Add a separately versioned worker-service protocol field to worker_ready and validate it before adopting discovered workers. Treat legacy/mismatched workers as incompatible: quiesce and stop them, await termination and release of their session ownership lock, then launch a current worker from durable session state before attaching. Do not reuse an old worker merely because its coordinator registration and demand protocol match; the coordinator can remain an opaque version-3 transport. **Independent validation:** The current manager adopted legacy-shaped worker_ready, completed attachment and sent chord in an offline probe, while the inspected BASE worker accepts only operation/operation_cancel and silently skips chord under the unchanged coordinator protocol 3. **Limit:** The probe proves current manager adoption and routing, not a full two-generation process upgrade; the old worker's silent rejection and coordinator retention are independently established from the exact BASE/current source and callers.
- **#2:** A message queued during compaction can still start a provider request on the outgoing session after the user switches sessions or runs /new. If its input or before_agent_start handler is awaiting work, Session.abort() sees an idle session and replacement proceeds; renderCurrentSessionState then drops the delivery token without aborting the submission's controller. Once the handler resumes, the old session can admit the prompt and start a fresh Agent run after its persistence listener has been disconnected, spending tokens without displaying or durably recording the response. Abort the reserved submission before invalidating the outgoing session, rather than relying on identity checks that run only after prompt dispatch completes. **Response:** In the runtime's beforeSessionInvalidate callback, abort compactionQueueDeliveryPending?.submitting?.controller before resetExtensionUI/session.dispose, then retire the delivery token and reserved messages. Also abort the submission controller before stop() clears the token. Reuse the cancellation mechanism already used by clearAllQueues; verify with a real queued prompt held in an input/before_agent_start hook, replace the runtime, release the hook, and assert that the outgoing provider receives no request and neither session admits the discarded input. **Independent validation:** An offline probe holding a real queued prompt in before_agent_start observed replacement finish while the old session was idle, clear its delivery token without aborting preflight, and then invoke the outgoing faux provider after the hook resumed. **Limit:** No real model request, paid token spend, or full initialized TUI switch was exercised; initial diagnostic runs that awaited only the flush returned before the captured prompt completed and were not treated as evidence of absence of the stale request; the final probe awaited both promises and idle settlement.

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 5 | `packages/chord/src/schema.ts:177` | Permissive result schemas bypass optional consumer field checks | correctness-chord | 100 |
| 7 | `packages/agent/src/agent.ts:828` | Remove rejected terminal responses from agent state | correctness-agent | 75 |
| 9 | `packages/ai/src/utils/assistant-message-frame.ts:438` | Incremental frame reads reparse complete tool arguments | performance | 75 |
| 12 | `packages/chord/src/object.ts:1888` | Reused object references ignore changed state requirements | correctness-chord | 75 |
| 22 | `packages/env/src/remote-env.ts:507` | Bound text reads by the remaining initial file size | correctness-env | 75 |
| 23 | `packages/env/src/remote-env.ts:925` | Honor aborts raised while delivering queued command output | correctness-env | 75 |

- **#5:** A same-version remote provider can bind successfully and return a number where the consumer contract promises an optional string. For example, provider result schema {type:'object',properties:{},additionalProperties:true} accepts {b:7}; consumer result schema {type:'object',properties:{b:{type:'string'}}} does not, but objectFits returns true because it only considers schema-valued additionalProperties. Results and state are not cleaned to the consumer schema, so this false-positive binding reaches callers and can break ordinary string operations. **Response:** For a named sup property absent from sub.properties, account for every way sub can supply it, including implicit or explicit additionalProperties:true when no matching pattern constrains it. Reject the fit when those allowed values are not a subset of the named property's schema; preserve the existing acceptance of genuinely absent fields and matching constrained patterns. Add the counterexample as both a fits assertion and a remote result/state binding case. **Independent validation:** Inspected objectFits ignores unconstrained additional properties for an absent optional named field, and the supplied source-importing probe both reports fits=true for an invalid consumer value and receives {b:7} through the narrow remote contract. **Limit:** Did not rerun the parent's observed RED; method-result transport is exercised, while the analogous state coverage direction was inspected in source only; unrelated script cases were excluded.
- **#7:** A message_end subscriber that rejects a completed response with TerminalResponseError leaves the rejected answer in Agent.state.messages and appends a second, content-free error carrying the same usage. processEvents has already pushed the terminal message and cleared streamingMessage before invoking subscribers, so handleRunFailure treats the response as absent and appends rather than replacing it in both public state and the active request context. Standalone Agent integrations consequently retain unpublished answer/tool-call content and two copies of one charge; removing the unpublished terminal from both histories before publishing its failure receipt preserves the intended single-response ownership. **Response:** When TerminalResponseError identifies an unpublished terminalMessage already inserted by processEvents, remove or replace that exact object in Agent.state.messages and execution.context.messages before emitting the failure receipt. Preserve any already-persisted response on ordinary finishTurn failures, and do not infer ownership merely from streamingMessage. Add a targeted one-shot message_end rejection case asserting that the terminal content is absent, exactly one charged failure receipt remains, and finishTurn receives the same reconciled context. **Independent validation:** processEvents appends the successful terminal before awaiting subscribers and handleRunFailure appends its charged receipt without removing that object, matching the supplied offline Agent probe's two assistant messages and doubled input usage after a one-shot TerminalResponseError. **Limit:** Did not rerun the parent's observed RED; supplied probe directly checks public Agent state, while the active-context append and real AgentSession wrapping caller were inspected in source.
- **#9:** Streaming a large write/edit tool call through the retained experimental client repeatedly parses the entire arguments prefix on both the session host and the client, blocking their event loops and allocating quadratically in response size. The new transcript provider reads reducer.message after every frame, and TranscriptReplay does the same; for 256 KiB of arguments delivered in 128-byte pieces, each side passes roughly 256 MiB of accumulated JSON through the full parser before the call finishes. Keeping an incremental argument parser per open block removes that repeated work while retaining the raw JSON needed by resumable checkpoints. **Response:** Use the existing StreamingJsonParser/ToolCallArgumentsStream incrementally for each open tool block instead of parseStreamingJson(state.json) in the message getter. Seed its parser once from checkpoint JSON when hydrating, replace it on toolcall_checkpoint, append only frame.delta thereafter, and retain authoritative toolcall_end arguments. Add a scoped allocation-growth check that reads message after every delta and exercises TranscriptReplay, matching the existing 50,000/500,000-character streaming argument allocation tests. **Independent validation:** Both transcript consumers read the new reducer getter per delta, which reparses the entire accumulated state.json, and the supplied instrumented source probe observed 537389089 JSON.parse input bytes for 262177 argument bytes. **Limit:** Did not rerun the parent's observed RED; timing is one environment-dependent observation, not a portable threshold, and the probe instruments the reducer rather than an end-to-end transcript session; both per-frame production callers were traced.
- **#12:** A facet that initially holds a remote object with state:false cannot start reading that object's state after a reload changes self.get to request state. The reload reuses the old RemoteRef solely by address and contract fingerprint, so its immutable wantsState remains false and no sub is sent; reading the newly used member fails not_ready, or an exposed derivation waits until ready_timeout. Include the state requirement in the reuse decision and acquire a replacement view when it changes. **Response:** When reusing an object-owned RemoteRef across runs, require its wantsState to equal options?.state !== false; otherwise acquire a new view and let normal declaration retirement release the old one. Define same-run duplicate acquisition behavior consistently so a later full-state request cannot silently inherit a method-only view. **Independent validation:** Self.get reuses a prior reference without comparing its immutable wantsState, and an independent offline probe reran the reader factory with state=true yet got not_ready while a separately acquired full-state view read 42. **Limit:** In-process memory transport rather than external processes; this independent scenario exercises the actual option-changing reload absent from the supplied script.
- **#22:** Reading an actively growing remote text/log file can return bytes appended after the initial stat, rather than the promised prefix up to that initial size. Every speculative text read requests the same full chunk, including the final partial chunk; if the file grows enough to fill that request, total skips past size and the equality exit condition can never fire. Limiting the final request and the speculative queue to the remaining initial bytes prevents excess reads and avoids chasing a continuously growing file to EOF. **Response:** For known-size text files, queue reads only while next < size and use Math.min(length, size - next) for each request. Preserve the ordered StringDecoder path, but stop at the initial size rather than depending on an exact equality after fixed-sized reads. **Independent validation:** The new text-read loop queues fixed-size preads without bounding next or the final request by initial size, contradicting the documented open-size prefix contract and matching the supplied probe returning 524395 bytes from an initially 524295-byte file. **Limit:** Did not rerun the parent's observed RED; the script imports reviewed TypeScript source but uses the existing external /tmp/pi-full-review-round3-fixes-040e3375/cargo-target/debug/pi-env binary, whose build provenance was not independently rebuilt or authenticated; the violated initial-size bound is independently evident in the inspected client loop.
- **#23:** Cancelling a command from its output callback can still return a successful exit when the remote process has already exited and its output/result are queued in transit. The callback only sends CANCEL, but the daemon removes its control before transmitting the result, so that cancellation cannot change the reply; the client then returns success without checking the aborted signal. Checking cancellation at final settlement, as NodeExecutionEnv already does, preserves the observable abort result even after remote execution has finished. **Response:** After the request resolves, check the original signal before returning success, after callbackError and respecting timeout precedence. Return ExecutionError('aborted', 'aborted') and copy json.spillPath when signal.aborted, matching NodeExecutionEnv's final settlement check. **Independent validation:** The new remote exec success path never rechecks the caller signal after output delivery, while daemon settlement removes cancellation control before queuing RESULT, matching nine supplied runs returning exitCode 0 despite aborting inside onOutput. **Limit:** Did not rerun the parent's observed RED; scheduling-dependent race was observed by the parent, not freshly repeated here; the pre-existing external daemon binary was not rebuilt/authenticated, and source inspection independently establishes removed daemon control and the missing final client signal check.

### Actionable Findings

| # | Severity | File | Required response | Route |
| --- | --- | --- | --- | --- |
| 1 | P1 | `packages/coding-agent/src/experimental/session-worker-manager.ts:206` | Fence retained workers before the native protocol cutover; suggested_fix present | `gated_auto -> downstream-resolver` |
| 2 | P1 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2667` | Abort reserved queue preflight before replacing the session; suggested_fix present | `gated_auto -> downstream-resolver` |
| 5 | P2 | `packages/chord/src/schema.ts:177` | Permissive result schemas bypass optional consumer field checks; suggested_fix present | `gated_auto -> downstream-resolver` |
| 7 | P2 | `packages/agent/src/agent.ts:828` | Remove rejected terminal responses from agent state; suggested_fix present | `gated_auto -> downstream-resolver` |
| 9 | P2 | `packages/ai/src/utils/assistant-message-frame.ts:438` | Incremental frame reads reparse complete tool arguments; suggested_fix present | `gated_auto -> downstream-resolver` |
| 12 | P2 | `packages/chord/src/object.ts:1888` | Reused object references ignore changed state requirements; suggested_fix present | `gated_auto -> downstream-resolver` |
| 22 | P2 | `packages/env/src/remote-env.ts:507` | Bound text reads by the remaining initial file size; suggested_fix present | `gated_auto -> downstream-resolver` |
| 23 | P2 | `packages/env/src/remote-env.ts:925` | Honor aborts raised while delivering queued command output; suggested_fix present | `gated_auto -> downstream-resolver` |

### Unvalidated source candidates - not confirmed findings

These 21 candidates remain unresolved. They were excluded from the confirmed primary/actionable set because the bounded independent batch did not cover them. This is a disclosed validation limitation, not evidence that the candidates are false or fixed. Numbers preserve first-pass mechanics, so the confirmed list intentionally has gaps. Do not apply them without checking the listed contract and evidence in the source report.

| Candidate # | Source severity | File | Candidate | Origin |
| --- | --- | --- | --- | --- |
| 3 | P2 | `packages/chord/docs/guide.md:45` | Add the required placement to the guide quickstart | correctness-docs |
| 4 | P2 | `packages/chord/docs/guide.md:717` | Use the WebSocket server acceptance helper in the guide | correctness-docs |
| 6 | P2 | `nix/package.nix:156` | Missing native clipboard assets still pass Nix install checks | adversarial |
| 8 | P2 | `packages/ai/src/api/classifier-shared.ts:79` | Bound classifier requests when callers omit timeouts | reliability |
| 10 | P2 | `packages/ai/src/utils/estimate.ts:15` | Share token estimates across compaction and adapter budgets | maintainability |
| 11 | P2 | `packages/chord/src/connection.ts:1210` | Result serialization failures leave remote calls unresolved | correctness-chord |
| 13 | P2 | `packages/chord/src/object.ts:1965` | Lifetime promotion retains the old registration prohibition | correctness-chord |
| 14 | P2 | `packages/coding-agent/src/core/agent-session.ts:1004` | Invalidate provider usage when the summary selection changes | correctness-session |
| 15 | P2 | `packages/coding-agent/src/core/agent-session.ts:3242` | Restore tool loadouts from the selected compaction checkpoint | api-contract |
| 16 | P2 | `packages/coding-agent/src/core/agent-session.ts:747` | Preserve direct AgentSession constructor loadout restoration | api-contract |
| 19 | P2 | `packages/durable/src/codemode/codemode.ts:383` | Disambiguate normalized tool identifiers before starting code mode | correctness-durable |
| 20 | P2 | `packages/durable/src/codemode/codemode.ts:389` | Advertise model helpers only when their tools are installed | correctness-durable |
| 21 | P2 | `packages/env/daemon/src/sys/windows.rs:322` | Resolve Windows executables against the actual child environment | correctness-env |
| 24 | P2 | `packages/env/src/ssh.ts:344` | Preserve POSIX shell classification on Windows SSH hosts | correctness-env |
| 25 | P2 | `packages/env/src/ssh.ts:456` | Concurrent daemon deployments delete each other’s verified executables | adversarial |
| 26 | P2 | `packages/env/src/terminal.ts:114` | Contain terminal output callback exceptions | reliability |
| 27 | P2 | `packages/tui/src/terminal.ts:529` | Clear program status during emergency exit restoration | julik-frontend-races |
| 28 | P2 | `scripts/issues/triage.ts:179` | Clear stale results when starting a retriage attempt | correctness-tooling |
| 29 | P2 | `scripts/issues/ui.html:78` | Discard stale issue-state responses before replacing the UI | julik-frontend-races |
| 30 | P3 | `packages/ai/src/api/openai-decisions.lazy.ts:5` | Use a top-level import for the new classifier | project-standards |
| 31 | P3 | `packages/chord/src/delta/pending.ts:136` | Inline newly introduced single-use single-line helpers | project-standards |

The standards candidates #30/#31 are rule-conflict/maintenance candidates, not demonstrated runtime failures. The classifier default-timeout candidate #8 requires checking the intended optional-timeout contract. Nix #6 concerns false-pass guard behavior, not proof that current assets are absent. These distinctions are retained instead of inflating the confirmed defect count.

### Testing gaps

- Candidate #17: `packages/coding-agent/test/export-html-system-messages.test.ts:79` checks source fragments rather than executing exported system-entry rendering.
- Candidate #18: `packages/coding-agent/test/native/tokenizer-count-ownership.test.ts:155` renders the footer manually with a no-op render request, so it does not establish asynchronous terminal redraw.
- These two testing-only candidates were moved to testing_gaps before validation, not counted as confirmed product defects.
- Native Windows/WSL, Linux/Android, live SSH, Cloudflare deployment, browser IndexedDB scheduling, and full release assets remain unexecuted here.

### Deployment Notes

- Before first SQLite schema-2 open, quiesce the sole owner and take a consistent whole-database backup under the same identity/prefix. Rehearse restoring it with the actual rollback binary.
- Capture schema version, allocator metadata, all task rows and seven task columns, other-table inventories, and five task indexes before deployment. Compare exact row JSON and identities after migration; require no leftover tasks_v2 table.
- Run read-only `SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name;` against the quiescent baseline and migrated clone; inspect schema metadata using the adapter's actual namespace. Rehearse failure between copy/drop/rename/index stages and representative disk/WAL/lock/resource use.
- Schema 2 intentionally cannot be opened by v1-only releases. Roll back with a schema-2-capable binary or restore the entire pre-upgrade backup and account for subsequent writes/external effects. Do not relabel schema version or silently switch prefixes.
- These are operational gates, not executed production checks. Migration source review found no additional confirmed data-rebuild defect.

### Coverage

- Correctness partitions account for all **1525 paths** exactly once with no missing/duplicate coverage entries. **1306 paths source-inspected; 219 insufficient evidence.** This is source/diff semantic inspection, not whole-file dynamic certification.
- Per-domain assigned/inspected/insufficient: ai 209/209/0; agent 49/49/0; chord 123/76/47; durable 229/229/0; env 38/38/0; session 131/130/1; interactive 108/108/0; integrations 249/249/0; tooling 131/128/3; docs 258/90/168. Exact arrays and reasons remain in per-reviewer JSON and coverage-audit.json.
- Cross-cutting lenses disclose narrower coverage separately. Security inspected 125 paths and marked 1400 insufficient; adversarial inspected 86 and marked 1439 insufficient. No exhaustive security or cross-component clearance is claimed.
- Initial prompt construction omitted the template tail; all 22 reviewers received corrected full templates and exact assigned artifact paths before final publication. Their final coverage arrays were audited. No missing reviewer was silently dropped.
- Cross-model pass not started: the host serving family could not be attested under the route contract. A Claude capability receipt and a prepared immutable snapshot are not dispatch/model-independence evidence. No provider egress job or unresolved external lifecycle remains. Independent local adversarial review supplied its lens, not serving-family independence.
- Graph discovery failed with `WeakMap keys must be objects or non-registered symbols`; exact source/history and available LSP were fallback. No complete dynamic/external caller claim.
- Mechanics: 31 raw candidates, zero malformed returns/findings, no quote/confidence suppressions, no semantic duplicate merge. Two testing-only candidates moved to testing_gaps. An overbroad 29-candidate validator was cancelled and its verdicts/observations excluded. A fresh replacement batch validated exactly eight selected candidates, including both P1s: **8 accepted / 0 rejected**. No cross-model shortcuts. **21 source candidates remain unvalidated**, so this run is explicitly degraded and does not claim every actionable candidate cleared the independent gate.
- Replacement validator did not read the cancelled validator's scripts, reports or transcript. It freshly ran P1 probes and the reference-state reload probe. Parent runtime evidence is separately attributed in bounded-validator-evidence.json.
- Actual runtime observations: optional-result remote call returned `{b:7}` despite consumer optional-string schema; one-shot rejected terminal left two charged assistant receipts (input 22 rather than 11); getter-per-delta parser passed **537389089 bytes** through JSON.parse for **262177 argument bytes**; growing text file returned **524395 bytes** from initial size **524295**; 9/10 fast exec runs returned success after onOutput aborted the signal. Parser timing is a single observation, not an RSS/allocation or portable performance benchmark.
- Parent additional probes confirmed guide quickstart rejection, referenced-to-host registration failure, emergency-exit status not cleared, and stale issue UI refresh. They do not replace independent validation for candidates outside the bounded eight; those stay in the unvalidated table. The parent's first state-reload probe did not prove a factory rerun; only the replacement validator's explicit two-invocation reload probe supports #12.
- Actual #1 probe uses the real current manager with a controlled coordinator; the BASE worker rejection is source/history confirmed, not a launched old worker process. Actual #2 uses real queued-prompt/runtime/session behavior with presentation shell stubs, not a full initialized TTY or paid provider.
- No product build/lint/full-suite rerun was used as review evidence. The preceding **12609/0/944** suite and green checks are historical verification of the committed repairs, not proof that these new boundaries are sound.
- Review-only preservation: HEAD `626aad42db8903e3b515c5911147c55a7ac5a3c4`, branch and index unchanged; my-merge/crystal refs unchanged; **749 protected target hashes match**. Only the requested closure report is appended. No paid provider/API calls. All parent probes used owned temporary files, in-process links, faux providers or a local external daemon. Managed browser tab closed.
- Artifacts: `/tmp/compound-engineering-501/ce-code-review/20261028-full-626aad42-940a2961`. Full source-detail maps, mechanics, coverage, unvalidated candidates, bounded validator verdicts/evidence, and independently observed probe outputs are retained.

---

### Verdict

**Not ready.** Fix confirmed P1 #1 retained-worker protocol fencing and #2 queued-preflight invalidation first. Six independently validated P2 defects also remain. This is a degraded complete-scope review with explicit semantic/validation gaps, not a new clean merge approval. No fixes were applied.

### Actionable Findings recap

- #1 P1 `packages/coding-agent/src/experimental/session-worker-manager.ts:206` - Fence retained workers before the native protocol cutover; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #2 P1 `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2667` - Abort reserved queue preflight before replacing the session; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #5 P2 `packages/chord/src/schema.ts:177` - Permissive result schemas bypass optional consumer field checks; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #7 P2 `packages/agent/src/agent.ts:828` - Remove rejected terminal responses from agent state; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #9 P2 `packages/ai/src/utils/assistant-message-frame.ts:438` - Incremental frame reads reparse complete tool arguments; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #12 P2 `packages/chord/src/object.ts:1888` - Reused object references ignore changed state requirements; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #22 P2 `packages/env/src/remote-env.ts:507` - Bound text reads by the remaining initial file size; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #23 P2 `packages/env/src/remote-env.ts:925` - Honor aborts raised while delivering queued command output; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.

## Local repair of the eight confirmed 626aad42 findings

This section supersedes the preceding report-only verdict only for confirmed findings **#1, #2, #5, #7, #9, #12, #22 and #23** in the local working tree. The **21 unvalidated source candidates remain unvalidated and unapplied**; this is not a clean full-merge certification. The earlier report and its evidence are preserved. Repair base remains `626aad42db8903e3b515c5911147c55a7ac5a3c4`, on `fix/full-merge-review-8322aa1d`. No commit or push is authorized or performed.

### Repair disposition

| Finding | Repair | Exercised boundary |
| --- | --- | --- |
| #1 | `worker_ready` carries an independent worker-service protocol version. Missing/mismatched workers are fenced, asked to shut down, and cannot be replaced until actual process exit and exclusive session ownership are established. Compatible adoption remains supported; the coordinator stays an opaque version-3 transport. | Real coordinator plus a legacy worker process that disconnects while retaining its session lock; no replacement before the cross-process exit gate opens, then current worker Transcript hydration and an offline prompt. Manager regressions cover missing/old/future versions, late events, unavailable ownership, retained-PID fail-closed behavior and launched-child exit after force-stop. |
| #2 | Runtime invalidation, session repaint and presentation stop abort reserved preflight before discarding delivery ownership. | Actual initialized InteractiveMode/AgentSessionRuntime tests hold ordinary queued input in `before_agent_start`, replace the session or stop the UI, release the hook, and observe no outgoing provider request or discarded input admission. |
| #5 | Strict schema compatibility rejects unconstrained optional output fields. A separate `cleaned-input` comparison is used only for normalized acquisition inputs/arguments; explicit permissive fields are not assumed stripped. | Public local/linked result and state bindings reject the counterexample. Nested additive inputs still clean correctly. Matching patterns, additional-property policies, arrays and function variance remain covered. |
| #7 | A `TerminalResponseError` removes the exact unpublished terminal from public history and replaces it in active request context before emitting one charged failure receipt. Ordinary finalizer failures retain accepted responses. | Public Agent smoke: one assistant receipt, input usage 11 rather than 22, one finalization. Regression checks accepted history, finalizer context and new-message receipts. |
| #9 | Each open tool block owns a `ToolCallArgumentsStream`. Deltas append once; hydration seeds once from raw checkpoint JSON; replacement checkpoints reset parser state; authoritative end metadata remains exact. | Per-delta getter allocation guard with 50K/500K payloads, interleaved/escaped/checkpoint tests, actual TranscriptReplay consumer, and smoke with a 262177-byte JSON argument plus midstream hydration: zero complete `JSON.parse` calls/input bytes, final content length 262144. Original review measurement was 537389089 complete-parser input bytes. |
| #12 | Object-owned remote references are reused only when the immutable state requirement agrees. Changed options acquire a replacement; normal commit/rollback retirement owns release. Same-run conflicting options reject explicitly. | Real consumer factory reload count changes from one to two; state reads 42 after method-only to full-state upgrade. Tests cover downgrade/unsubscribe, both rollback directions and conflicting duplicate gets. |
| #22 | Known-size text reads queue only offsets below the initial size and cap the final request to remaining bytes, preserving ordered decoding and short-read/abort semantics. | Actual file growth after real open/stat, including small files, partial final chunks, split UTF-8 and incomplete UTF-8; reads return exactly the original decoded prefix. |
| #23 | Successful remote exec settlement rechecks the original abort signal after callback-error precedence and preserves the spill path. Existing daemon timeout/error precedence is unchanged. | Actual daemon command events are delayed at the real Connection boundary until remote result/error settlement. Abort never reports success; callback errors and timeout retain their codes, and aborted/timed-out spill content remains readable. |

### Verification

- Authoritative isolated root `./test.sh`: **12639 passed / 0 failed / 944 skipped**, exit 0 (`artifact://11643`). External `PI_ENV_DAEMON` points to the prior source-aligned daemon build; this repair does not modify Rust or protected Cargo outputs.
- Mandatory `npm run check` passed: **1978 files, no fixes applied**. Pinned/runtime dependencies, TS imports, repository entry-point graph budgets, install-lock, typecheck and browser bundle smoke passed. This is distinct from the unavailable codebase-memory knowledge-graph service.
- `npm run build:offline` passed; coding-agent bundle contains 81 files, 9.4 MiB.
- Focused results: Agent receipt/loop/state 166 passed; interactive scheduler/preflight 69 passed; Chord contract/binding/reload/rollback 125 passed; AI codec/parser/allocation 143 passed; Transcript consumer 7 passed; remote/differential 31 passed/4 platform skips; worker manager/lifecycle/remote runtime 62 passed. After correcting a readonly child-test fixture assignment, the two worker suites passed again (33 tests).
- Two integration corrections were driven by observed checks, not relaxed product behavior: linked binding refusal uses the existing `upgrade_required` wire mapping containing `contract_mismatch`; a new-message assertion retains the accepted user prompt while checking exactly one assistant receipt. Typecheck caught a readonly ChildProcess test property; the fixture now sets its descriptor explicitly.
- Independent bounded source reviews covered settlement/IO/parser repairs, Chord compatibility/state lifetimes and worker fencing. Early partial reuse/quality/efficiency passes covered only the settlement/IO/parser cluster and found no justified behavior-preserving simplification; they excluded Chord and worker changes. The final whole-fix correctness reviewer inspected **all 25 fix-owned code/test/docs paths**, excluding the ambient ledger, and returned no actionable patch-introduced defect. Reviewers did not rerun parent verification and do not claim exhaustive external callers.
- Repeated preflight cancellation at invalidation, repaint and stop remains intentional: each is a distinct entry boundary and the abort is idempotent. The rejected-terminal reconciliation uses exact object identity, not content or usage equality, in public and active request histories. Helper extraction and tail-only lookup suggestions remain reviewed non-actionable alternatives; neither is claimed as an additional fixed defect.
- No new dependencies or lockfile changes. No Rust edits or new claim that the previously disclosed Rust formatting check is green. Native Windows/compiled-Bun worker lifecycle and Windows remote IO were not executed. An incompatible retained PID without portable identity/exit proof fails closed rather than risking SIGKILL of an unrelated process.
- Graph discovery still failed with the recorded WeakMap error; exact source and available LSP references were used. No graph-completeness claim.
- Before this append, all **749 protected target hashes matched**; HEAD, `my-merge`, `crystal`, branch and empty index remained unchanged. The final post-append preservation check and documentation-inclusive check are performed before delivery.
- Repair artifacts and observed outputs: `/tmp/pi-review-eight-fixes-f07b4630`. Independent source copies had no writable aliases into canonical source. Parent integrated explicit patches and ran authoritative verification. No real provider credentials or paid model calls were used.

### Local repair verdict

**All eight independently confirmed findings are repaired and locally verified.** No residual remains within that eight-item repair scope. The 21 unvalidated candidates and the full review's 219 insufficient-evidence paths remain explicit limitations; they are not declared fixed or disproved. The changes stay local and uncommitted. No push was performed.


## Complete maintained merge review - 0bf4594a

**Scope:** `839dc79197595a4285d711e37d02fb623e5b6b7b` -> `0bf4594aa820a2c98627ce2db74e6a2e623c7037`; tree `84fff0c72d82fd191cd1247e8efb7ba82ec79c8c`; **1526 changed paths**. This includes the full maintained merge and all later commits, not only the eight preceding repairs.
**Intent:** Find current reachable regressions while retaining Crystal history/edit/swipe/delete/restore/shred/id0 behavior, Harness and experimental consumers, multimodal/token counting, summary budgets, receipt ownership and native/storage safety.
**Mode:** markdown report-only. No product fixes, commit or push. The preceding eight repairs are now committed at `0bf4594aa`; the earlier uncommitted wording is historical.

**Reviewers:** 10 disjoint correctness domains plus project-standards, testing, maintainability, agent-native, security, performance, api-contract, data-migration, reliability, adversarial, julik-frontend-races and deployment-verification. All 22 completed. Conditional lenses were selected for written standards, test fidelity, structural contracts, callable agent capabilities, trust boundaries, streamed/data performance, external contracts, persisted-history migrations, failure settlement, cross-component interactions, UI lifecycle and forward-only data deployment respectively. Their assigned paths are relevant bounded subsets; only correctness partitions own global accounting.

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
| --- | --- | --- | --- | --- |
| Isolation and cancellation - apply queue | #1, #3, #33 | One caller/failure can affect unrelated work | Fix shared worker isolation #1, fail-fast reload #3, then nested memo ownership #33 | Preserve the correct fault/cancellation owner at each boundary |
| Persisted and typed context - apply queue | #2, #4, #9 | Policy loss and invalid values cross durable/typed boundaries | Preserve checkpoint #2, validate ingress #4, reject unsound bindings #9 | Prevent irreversible state loss and consumer contract violations |
| Historical HTML - apply queue | #12, #13 | Built-in renderer cutover loses recorded content | Finalize call rendering #12 and support full call content #13 | Final-state refresh and expansion are separate defects, not duplicates |

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 1 | `packages/coding-agent/src/experimental/session-worker.ts:564` | Duplicate native calls terminate the shared Session worker | correctness-integrations | 100 |
| 2 | `packages/agent/src/harness/session/jsonl/legacy-v3.ts:310` | Preserve system checkpoints when importing retain-none compactions | data-migration | 75 |
| 3 | `packages/chord/src/cluster.ts:83` | Abort failed cluster reloads before joining pending preparation | reliability | 75 |

- **#1** - One attached presentation can terminate the Session for every other viewer by sending two well-formed native call frames with the same ID before the first call finishes. The duplicate throws outside Chord; readCommands rejects into closeAndExit(), which closes the shared Harness and exits the process instead of disconnecting only the offending attachment. Chord already handles duplicate call IDs as a link-local protocol violation.
  - Response: Do not throw a duplicate-ID error into the worker-wide readCommands rejection handler. Forward a duplicate to its existing Chord attachment without replacing the existing activeCalls entry so Chord closes that link, or explicitly remove only the offending attachment and release its tracked retirement holds. Preserve the shared worker and other attachment scopes.
  - Evidence: packages/coding-agent/src/experimental/session-worker.ts:564 -- if (activeCalls.has(key)) throw new Error("Duplicate native request ID"); packages/coding-agent/src/experimental/session-worker.ts:353-354 -- else if (command.type === "session_demand") await handlers.onDemand(command); else handlers.onFrame(command); packages/coding-agent/src/experimental/session-worker.ts:656 -- }).catch(() => closeAndExit()); packages/coding-agent/src/experimental/session-worker.ts:526-531 -- closeAndExit calls close(), then process.exit(0) or process.exit(1). close() closes the shared services/Harness. packages/chord/src/connection.ts:1168-1170 -- if (this.incoming.has(frame.id)) { this.#violation(`duplicate call id ${frame.id}`); return; } packages/server/src/session-router.ts:47-52 forwards each frame from an authorized attachment without examining its native call ID; WorkerFrameSchema requires only a string t, and a duplicate of an otherwise valid call is admitted. provenance: 8322aa1d6 Nex 2026-10-26 - fix: merge upup/main 1.4.0 while retaining Crystal features
  - Independent validation: Source inspection confirms the newly introduced duplicate-ID guard in session-worker.ts:564 throws through readCommands into its worker-wide closeAndExit handler before Chord can apply its link-local duplicate-call handling, while SessionRouter forwards authorized attachment frames without deduplicating IDs.

- **#2** - Importing a producer-written retain-none compaction now succeeds but drops its saved system prompt and tool checkpoint from the active context. For example, append a system message, conversational messages and a compaction, then remove all retained messages with removeLastMessages(): the producer keeps the policy in compaction.systemMessage while rebasing firstKeptEntryId to the compaction itself. This new early return produces an empty retainedTail, and normalizeRetainedEntry neither copies systemMessage nor otherwise represents it; the Harness projector selects only the compaction, so the original system-message node cannot supply the missing policy. The first nonempty commit permanently publishes that lossy representation as v4; before this change the self-boundary was rejected instead of silently converted.
  - Response: Preserve the producer's optional systemMessage when normalizing a legacy compaction and extend the retained Harness compaction representation/projector to emit that checkpoint before its summary and retained conversational tail. Keep the self-boundary's conversational tail empty rather than walking summarized ancestors. Add a producer-driven regression that appends a system message containing sections and tool declarations before compaction, removes every retained conversational message, then checks checkpoint equality through closed-source fork, read-only open, first upgrading commit and reopen.
  - Evidence: packages/agent/src/harness/session/jsonl/legacy-v3.ts:310 -- if (compaction.firstKeptEntryId === compaction.id) return; packages/agent/src/harness/session/jsonl/legacy-v3.ts:358-367 -- normalizeRetainedEntry constructs the imported compaction from summary, retainedTail, tokensBefore, details, usage and fromHook, without the producer's systemMessage; LegacyV3CompactionEntry at lines 56-64 also omits that field. packages/coding-agent/src/core/session-manager.ts:1695 -- const systemMessage = getCurrentSystemMessage(this.buildSessionProjection().messages); packages/coding-agent/src/core/session-manager.ts:1709 -- ...(systemMessage ? { systemMessage: { ...systemMessage, timestamp: new Date(timestamp).getTime() } } : {}), packages/coding-agent/src/core/session-manager.ts:2247-2250 -- the surviving checkpoint's boundary is rebased to the next surviving visible entry, or its own id when none remains. packages/coding-agent/src/core/session-manager.ts:725 -- ...(index === 0 && latestCompaction?.systemMessage ? [latestCompaction.systemMessage] : []), packages/agent/src/harness/session/context.ts:21 -- return compaction === undefined ? [...pathEntries] : [compaction, ...pathEntries.slice(compactionIndex + 1)]; packages/agent/src/harness/session/context.ts:35-39 -- imported compactions project only their summary and retainedTail; packages/agent/src/harness/session/jsonl/storage.ts:175-177 writes source.writes(context) into the replacing v4 file. packages/coding-agent/test/session-manager/remove-last-messages.test.ts:303-344 -- the new producer-driven retain-none import test creates no system message and expects only a summary, leaving this policy-preservation case uncovered. provenance: db3f2fd865 Nex 2026-10-27 - fix: close full-merge review findings and repair boundaries (new self-boundary acceptance at legacy-v3.ts:309-310); 7a06074c5f Nex 2026-10-24 introduces compacted-tail preservation in session-manager.ts:2182-2205.
  - Independent validation: Source inspection confirms the newly accepted self-boundary produces an empty retainedTail, legacy-v3.ts:358-367 discards the producer's saved systemMessage, and the Harness projector excludes preceding message entries, so the checkpoint disappears from active context and the first upgrading commit publishes that lossy v4 representation.

- **#3** - A child vote timeout or rejection does not abort a cluster reload while the coordinator is still preparing a resource. Promise.allSettled waits for local preparation before the failure branch sends abort or rolls back; a resource open that is waiting for cancellation therefore leaves the reload pending indefinitely, and already-prepared children can keep exclusive resources and gated calls blocked. Detect the first rejection and initiate cancellation/rollback immediately, then join the remaining preparation work for cleanup.
  - Response: Replace the all-settled-before-error decision with a fail-fast rejection path that immediately sends abort to every participant and calls reload.rollback() (including when local prepare has not completed), then observes/joins all preparation promises before returning the original failure. Keep the existing commit path restricted to all successful votes and successful local prepare.
  - Evidence: packages/chord/src/cluster.ts:83 -- const results = await Promise.allSettled([ packages/chord/src/cluster.ts:84-95 -- reload.prepare() is included in that barrier; abort frames and reload.rollback() are only reached after all entries settle. packages/chord/src/reload.ts:413-417 -- prepareObject awaits object.open(..., this.abort.signal); packages/chord/src/object.ts:248 -- value = await this.spec.open({ signal }); packages/chord/src/reload.ts:526-529 -- rollback() sets rolledBack and aborts the preparation controller, but the coordinator cannot reach it while waiting for prepare. packages/chord/src/cluster.ts:31-34 -- awaitVote deletes the vote and rejects on its deadline; it does not cancel the local preparation or send an abort. provenance: 0104fef1e9 Mario Zechner 2026-10-12 introduced the all-settled coordination barrier (targeted head blame lines 83-96).
  - Independent validation: Source inspection confirms cluster.ts:83-95 waits for local preparation and all votes before aborting, while reload.prepare initially awaits resource opens without a deadline and only rollback aborts their signal, so a failed or timed-out child vote cannot release a cancellation-dependent local open.

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 4 | `packages/agent/src/harness/pico3/chord.ts:112` | Validate remote model messages before claiming their type | maintainability | 100 |
| 9 | `packages/chord/src/schema.ts:191` | Reject pattern keys outside a closed consumer object | correctness-chord | 100 |
| 12 | `packages/coding-agent/src/core/export-html/index.ts:200` | Serialize edit call HTML after applying its final result | correctness-session | 100 |
| 13 | `packages/coding-agent/src/core/export-html/tool-renderer.ts:114` | Export full write content instead of collapsed terminal previews | correctness-session | 100 |
| 33 | `packages/durable/src/harness/tool.ts:400` | Isolate the shared nested-call memo from caller cancellation | correctness-durable | 75 |

- **#4** - A caller of the newly exposed Chord conversation write method can persist a model message such as { role: "assistant", content: null }; the wire schema accepts every array item while Type.Unsafe labels it a valid NewEntry. The downstream entry validator checks only that role is a string, so a subsequent context read reaches content.filter and throws, leaving the malformed message in durable history. The cast defeats the invariant precisely where the new schema is supposed to establish it.
  - Response: Define schemas for the actual message/content-block unions accepted by Pico and use them for write.model and send.content; validate ContextEdit objects and their replacement messages as well. Derive the input types from those schemas, or add a compile-time compatibility check instead of Type.Unsafe<NewEntry>/Type.Unsafe<SendInput>. Reject malformed assistant content before calling conversation.write so no invalid entry is committed.
  - Evidence: packages/agent/src/harness/pico3/chord.ts:112 -- model: Type.Optional(Type.Array(Type.Unknown())), packages/agent/src/harness/pico3/chord.ts:109 -- Type.Unsafe<NewEntry>( packages/chord/src/object.ts:1632 -- if (validated?.args) assertValid("args", `${this.address}.${name} args`, validated.args, input); packages/agent/src/harness/pico3/session.ts:1194 -- if (typeof m !== "object" \|\| m === null \|\| typeof (m as { role?: unknown }).role !== "string") packages/agent/src/harness/pico3/session.ts:717 -- this.writes.push({ type: "entry", entry: record }); packages/agent/src/harness/pico3/context.ts:77 -- const calls = (m as StoredAssistant).content.filter((c): c is StoredToolCall => c.type === "toolCall"); provenance: 8322aa1d6 Nex 2026-10-26T20:25:18+08:00 - fix: merge upup/main 1.4.0 while retaining Crystal features
  - Independent validation: Source inspection confirms the new remote write schema accepts arbitrary model items, a permitted custom-kind entry containing an assistant message with null content passes validateEntry and is committed, and a subsequent context projection dereferences that content with filter in pico3/context.ts:77.

- **#9** - A same-version provider can bind to a consumer whose closed result/state schema it does not satisfy. Concretely, fits({type:'object', patternProperties:{'^x$':{type:'number'}}, additionalProperties:false}, {type:'object', properties:{}, additionalProperties:false}) returns true: the branch checks only explicit properties and the consumer has no patterns to trigger the later checks. The provider may then return {x:1}, which is valid for its schema but invalid for the promised consumer schema; results are returned without consumer-side validation.
  - Response: When sup.additionalProperties is false, account for sub.patternProperties as possible property names, not just sub.properties. Conservatively require exact compatible pattern policies or reject unmatched patterns when their allowed names cannot be proven to fit the consumer's explicit properties/patterns. Add a Value.Check counterexample for closed result and state schemas.
  - Evidence: packages/chord/src/schema.ts:191 -- if (Object.keys(subProperties).some((key) => !(key in supProperties))) return false; packages/chord/src/schema.ts:189-198 accepts equal additionalProperties:false with no explicit source properties, and skips all source-pattern checks when sup.patternProperties is empty; line 214 returns true. packages/chord/src/contract.ts:338-341 uses fits(provider result/state, consumer result/state) to authorize same-version binding. packages/chord/src/object.ts:1615-1620 validates direct calls using the provider method schema; lines 1646-1648 validate only that provider result and return it unchanged. node_modules/typebox/build/type/engine/record/record_create.mjs:3-6 constructs ordinary record schemas as type:object plus patternProperties, so pattern-only source objects are a supported schema shape. provenance: 0104fef1e Mario Zechner 2026-10-12 - feat(chord): replace the facet and service runtime with the chord2 host runtime; the closed-object branch was introduced in the reviewed range.
  - Independent validation: Source inspection confirms objectFits accepts a closed pattern-only provider against a closed empty consumer because it checks only explicit source properties and skips pattern checks when the consumer has none, allowing same-version result/state binding even though a provider-valid value such as {x:1} violates the consumer schema.

- **#12** - Interactive /export and /share now pre-render built-in edit calls, but successful edit diffs disappear from their HTML. The exporter snapshots the call component before the result arrives. editRenderers.renderResult then moves the saved diff into that call component and returns an empty result component; the exporter retains the stale callHtml string, so the viewer shows only the path and success sentence instead of the actual change. Re-rendering the finalized call component restores the recorded diff without reading current file contents.
  - Response: Extend the HTML renderer bridge to re-render and return the cached call component after renderResult has applied its final state, then replace renderedTools[id].callHtml with that finalized HTML. Exercise a successful built-in edit whose recorded diff is present and whose target file has since changed or disappeared; the exported HTML must contain the recorded additions/removals.
  - Evidence: packages/coding-agent/src/core/export-html/index.ts:200 -- const callHtml = toolRenderer.renderCall(block.id, block.name, block.arguments); packages/coding-agent/src/core/export-html/tool-renderer.ts:116-118 -- renderedCallComponents.set(toolCallId, component); const lines = component.render(width); return ansiLinesToHtml(lines); packages/coding-agent/src/core/tools/renderers/edit.ts:238-257 applies result.details.diff to context.state.callComponent and rebuilds that component; lines 261-271 return an empty result component when the result diff equals the call preview. packages/coding-agent/src/core/export-html/index.ts:220-225 preserves existing.callHtml after rendering the result rather than serializing the mutated call component again. packages/coding-agent/src/core/export-html/template.js:1054-1073 returns the pre-rendered branch and does not reach the existing details.diff fallback at lines 1131-1138. provenance: db3f2fd865 Nex 2026-10-27 removed the built-in exclusion at export-html/index.ts:199 (targeted blame against reviewed HEAD).
  - Independent validation: Source inspection confirms the built-in export cutover snapshots edit call HTML before renderResult installs the recorded diff into its cached call component, retains that stale string afterward, and enters a template branch that bypasses details.diff rendering.

- **#13** - After the built-in renderer cutover, every exported write longer than ten lines loses its remaining lines from the visible HTML. renderCall is invoked only with expanded=false; the built-in write renderer embeds a ten-line preview and a terminal keyboard expansion hint. Its successful result renderer contains no file content, and the viewer's pre-rendered path returns before its previous expandable full-content implementation. A shared session therefore cannot show the complete write even though the arguments still contain it.
  - Response: Render a full expanded call representation for exported historical calls, or add collapsed/expanded call HTML to the existing expandable viewer contract. Do not rely on a terminal-only keyboard hint inside a static HTML string. Verify a write of more than ten distinct lines exposes its final line in the actual exported viewer.
  - Evidence: packages/coding-agent/src/core/export-html/tool-renderer.ts:114 -- createRenderContext(toolCallId, renderedCallComponents.get(toolCallId), false, true, false), packages/coding-agent/src/core/tools/renderers/write.ts:117-122 -- const maxLines = options.expanded ? lines.length : 10; const displayLines = lines.slice(0, maxLines); subsequent output is only a terminal expansion hint. packages/coding-agent/src/core/tools/renderers/write.ts:159-166 derives expansion exclusively from context.expanded, while lines 170-175 return an empty component for successful results. packages/coding-agent/src/core/export-html/template.js:1054-1073 returns pre-rendered call HTML, bypassing the complete write args.content path at lines 1104-1120. packages/coding-agent/src/core/export-html/index.ts:199 now pre-renders built-in calls rather than excluding write as in the supplied base diff.
  - Independent validation: Source inspection confirms exported write calls are rendered only with expanded=false, limiting their call HTML to ten lines, while successful result rendering supplies no content and the pre-rendered template branch bypasses the full expandable arguments-content display.

- **#33** - Cancelling one nested-call admission can also reject a different concurrent call whose context is still healthy, so a batch can silently skip unrelated work or fail its whole tool invocation. The first call creates madeNestedMemo using its own callContext, and every concurrent call chains its admission onto that same promise; if the first context is already cancelled, or is cancelled before its queued memo commit runs, all those admissions reject before startNestedCall. Resetting the memo in catch helps only subsequent calls, not the healthy calls already attached to it.
  - Response: Create madeNestedMemo with the enclosing run() invocation context (runtime.memo(MADE_NESTED_CALLS, true, context)), not the first executeTool callContext. Continue passing each callContext to that call's startNestedCall and waitForTask, so its own cancellation remains isolated. Add a regression where an already-cancelled first executeTool call and a healthy second call start synchronously: only the first must reject and the second must execute once.
  - Evidence: packages/durable/src/harness/tool.ts:400 -- madeNestedMemo ??= runtime.memo(MADE_NESTED_CALLS, true, callContext).catch((error: unknown) => { packages/durable/src/harness/tool.ts:405 -- const admission = madeNestedMemo.then(() => packages/durable/src/session/session.ts:767 -- context.abortSignal?.throwIfAborted(); packages/durable/src/harness/scheduler.ts:2175-2184 -- runtime.memo stores its candidate through #gated(..., rest[1] as Context), which queues Session.commitWith under the supplied context. packages/durable/src/harness/types.ts:287-291 -- Concurrent nested calls are supported and cancelling context stops only the wait; the cancellation must not reject a separate call using a healthy context. Mechanical scenario: in one batch tool execute(), invoke p1 = api.executeTool("echo", {text:"cancelled"}, alreadyAbortedContext, {key:"a"}); immediately invoke p2 = api.executeTool("echo", {text:"healthy"}, invocationContext, {key:"b"}); observe both through Promise.allSettled. Before the memo promise catch runs, p2 reuses p1's promise. The queued memo rejects on its aborted context and both admissions reject; no echo task is created for b. packages/durable/test/harness-nested-tools.test.ts:614-645 tests cancellation only after the nested tool has started; lines 648-667 test concurrent calls only with the same healthy context. Neither covers cancellation of the shared prerequisite. provenance: 4ac0bd8c7 Mario Zechner 2026-10-10 - feat(durable): one document per nested call; TaskRuntime.ownedTasks()
  - Independent validation: Source inspection confirms concurrent executeTool admissions share madeNestedMemo created with the first caller's context, whose queued memo commit rejects on cancellation, so a healthy second admission already chained to that promise also rejects before startNestedCall despite the later catch resetting the memo.

### Actionable Findings

| # | File | Issue | Route | Notes |
| --- | --- | --- | --- | --- |
| 1 | `packages/coding-agent/src/experimental/session-worker.ts:564` | Duplicate native calls terminate the shared Session worker | `gated_auto -> downstream-resolver` | suggested_fix present; independent source validation; not applied |
| 2 | `packages/agent/src/harness/session/jsonl/legacy-v3.ts:310` | Preserve system checkpoints when importing retain-none compactions | `manual -> downstream-resolver` | suggested_fix present; independent source validation; not applied |
| 3 | `packages/chord/src/cluster.ts:83` | Abort failed cluster reloads before joining pending preparation | `gated_auto -> downstream-resolver` | suggested_fix present; independent source validation; not applied |
| 4 | `packages/agent/src/harness/pico3/chord.ts:112` | Validate remote model messages before claiming their type | `gated_auto -> downstream-resolver` | suggested_fix present; independent source validation; not applied |
| 9 | `packages/chord/src/schema.ts:191` | Reject pattern keys outside a closed consumer object | `gated_auto -> downstream-resolver` | suggested_fix present; independent source validation; not applied |
| 12 | `packages/coding-agent/src/core/export-html/index.ts:200` | Serialize edit call HTML after applying its final result | `gated_auto -> downstream-resolver` | suggested_fix present; independent source validation; not applied |
| 13 | `packages/coding-agent/src/core/export-html/tool-renderer.ts:114` | Export full write content instead of collapsed terminal previews | `gated_auto -> downstream-resolver` | suggested_fix present; independent source validation; not applied |
| 33 | `packages/durable/src/harness/tool.ts:400` | Isolate the shared nested-call memo from caller cancellation | `gated_auto -> downstream-resolver` | suggested_fix present; independent source validation; not applied |

### Unvalidated source candidates - not confirmed findings

The bounded batch selected all three P1 and five higher-impact P2. The following **32** source candidates did not pass through independent validation. They are neither confirmed defects nor disproved. Stable IDs are preserved from the full 41-candidate mechanics run. Details and proposed responses remain in `unvalidated-candidates.json`.

| Candidate | Severity | File | Source claim |
| --- | --- | --- | --- |
| #5 | P2 | `packages/ai/test/openai-completions-raw-tool-call.test.ts:266` | Keep terminal argument errors out of progress-only expectations |
| #6 | P2 | `packages/chord/docs/guide.md:45` | Declare host placement in the guide quickstart |
| #7 | P2 | `packages/chord/docs/guide.md:717` | Use the authenticated WebSocket server adapter |
| #8 | P2 | `packages/chord/docs/guide.md:752` | Supply the parent principal when connecting browsers |
| #10 | P2 | `packages/codemode/src/source.ts:195` | Block-ending regexps confuse the options scanner |
| #11 | P2 | `packages/coding-agent/README.md:79` | Hydrate model data before the first source build |
| #14 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:9639` | Stop live tool clocks when stopping the primary TUI |
| #15 | P2 | `packages/env/daemon/src/window.rs:183` | Retain stream attribution when windowed output is coalesced |
| #16 | P2 | `packages/tui/src/tui-main-screen.ts:561` | Do not discard image rows supplied by overlays |
| #17 | P2 | `scripts/preview-packages.mjs:99` | Preserve lifecycle suppression in preview installation commands |
| #18 | P2 | `packages/agent/src/agent-loop.ts:328` | Replace prefill on pre-stream low-level failures |
| #19 | P2 | `packages/agent/src/agent-loop.ts:360` | Initialize execution before emitting initial lifecycle events |
| #20 | P2 | `packages/ai/src/api/classifier-shared.ts:95` | Retry native fetch transport errors in classifier requests |
| #21 | P2 | `packages/chord/docs/guide.md:605` | Configure a loader before loading facet module URLs |
| #22 | P2 | `packages/chord/src/cell.ts:378` | Validate externally refreshed derivations before publishing |
| #23 | P2 | `packages/chord/src/manager.ts:406` | Handle fatal control messages after initial readiness |
| #24 | P2 | `packages/chord/src/object.ts:1973` | Check registration eligibility against the candidate lifetime |
| #25 | P2 | `packages/chord/src/reload.ts:102` | Resolve candidate state before evaluating dependent derivations |
| #26 | P2 | `packages/chord/src/schema.ts:220` | Check tuple additional-item policies during compatibility binding |
| #27 | P2 | `packages/chord/src/schema.ts:47` | Preserve explicit null contract inputs |
| #28 | P2 | `packages/coding-agent/src/core/compaction/branch-summarization.ts:441` | Do not fold unselected suffix policy into standalone branch summaries |
| #29 | P2 | `packages/coding-agent/src/core/compaction/utils.ts:68` | Scope nested-file attribution to the current tool-call owner |
| #30 | P2 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:373` | Avoid cumulative prefix comparisons on streamed tool arguments |
| #32 | P2 | `packages/durable/src/codemode/codemode.ts:389` | Standalone codemode advertises unregistered model tools |
| #34 | P2 | `packages/durable/test/provider-session-cache-e2e.test.ts:17` | Gate Durable live tests before reading real credentials |
| #35 | P2 | `packages/env/daemon/src/sys/windows.rs:353` | Honor SystemRoot when selecting legacy WSL command transport |
| #36 | P2 | `packages/env/src/ssh.ts:344` | Preserve the detected POSIX SSH shell on Windows |
| #37 | P2 | `packages/env/src/ssh.ts:456` | Concurrent deployments delete each other's not-yet-started daemon |
| #38 | P2 | `scripts/check-model-catalog-compat.mjs:97` | Normalize npm 12 pack output in catalog compatibility checks |
| #39 | P2 | `scripts/issues/triage.ts:179` | Clear stale triage results when starting another attempt |
| #40 | P2 | `scripts/issues/ui.html:78` | Reject stale issue-state responses before replacing the UI |
| #41 | P2 | `scripts/local-package-install.mjs:191` | Packed subpath smoke passes with broken transitive imports |

Candidate #5 is a disputed progress-only test expectation, not a demonstrated product defect or observed suite failure. #6/#7/#8/#11/#21 are documentation recipes. #17 is a scoped install-security instruction claim. #31 is testing-only and moved to testing gaps. The multi-version SSH topology in #37 remains unproven here, so it is only a residual source risk. None is silently promoted by the number of reviewers.

### Deployment Notes

- Before SQLite schema-2 open, stop overlapping writers, preserve the deployed namespace/prefix, and take a coherent WAL-aware whole-database snapshot. Rehearse restoration with the actual rollback binary.
- Capture schema metadata, allocator identities, exact task JSON/columns, other tables and indexes before migration. Run `SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name;` on quiescent baseline and migrated copies. Compare records exactly and require no temporary task table. Audit custom host schema objects and disk/WAL/lock requirements.
- Schema 2 is intentionally forward-only. A v1-only binary needs a coherent pre-upgrade snapshot; changing metadata or prefixes is not rollback. Account for subsequent external effects. Sleeping tasks also require compatible recovery.
- Preserve v3 JSONL originals before the first nonempty v4 write. Compare policy, selected leaf, IDs, configuration, usage and historical nodes before/open/upgrade/reopen. #2 blocks policy-preserving retain-none imports.
- Observe telemetry flush/close rejection and drop counters; availability alone does not prove delivery. Real workerd migration coverage exists but was not executed. These are release gates, not observed production checks.

### Coverage

- Global correctness assignments reconcile exact union **1526 paths**, each classified once: **1087 semantically source-inspected / 439 insufficient evidence**. Inventory/hunk traversal is not semantic certification.
- Assigned/inspected/insufficient: ai 209/208/1; agent 49/49/0; chord 123/101/22; durable 229/107/122; env 38/38/0; session 132/115/17; interactive 108/108/0; integrations 249/143/106; tooling 131/128/3; docs 258/90/168. The 161 historical review records were excluded as finding seeds.
- Conditional assigned/inspected/insufficient: project-standards 1365/85/1280; testing 751/352/399; maintainability 571/388/183; agent-native 136/136/0; security 174/174/0; performance 110/85/25; api-contract 536/280/256; data-migration 36/36/0; reliability 575/67/508; adversarial 1365/57/1308; julik-frontend-races 145/138/7; deployment-verification-agent 32/32/0. Narrow lenses do not fill unrelated global correctness gaps.
- Mechanics: **41 raw candidates**. Initial raw artifacts omitted explicit `first_evidence`, causing all 41 to be quote-gated to confidence 50. The compact-input repair restored each original quoted evidence anchor and reran the deterministic helper: **41 retained / 0 malformed / 0 suppressed**. This was not manual confidence promotion. Original and corrected inputs/results remain on disk. No semantic duplicates were merged.
- Validation: one fresh independent source-only batch, normal cap eight; **#1/#2/#3/#4/#9/#12/#13/#33 accepted, 0 rejected**. All P1 were selected. No cross-family shortcuts. **41 = 8 independently validated + 32 unvalidated + 1 testing-only gap (#31).** #31 was explicitly moved to testing_gaps because it checks source strings rather than viewer behavior; it was not silently dropped. This run is degraded, not a complete independent clearance.
- Cross-model not started: serving family could not be attested under the route contract. The local adversarial lens does not establish serving-family independence. No external job or unresolved lifecycle remains.
- Graph failed with `WeakMap keys must be objects or non-registered symbols`. Current source, lexical references and targeted history were used. Dynamic/external callsite completeness is not certified. No requirements plan was selected; settlement suppression was not evaluated.
- Runtime attempt: one owned scratch boundary script exited 1 at renderer setup (`TypeError` from undefined result). It was abandoned, not retried, and excluded from confirmation. No completed runtime receipt, HTML visual proof, worker reproduction or cluster runtime proof is claimed. Validator verdicts above are independent source evidence only.
- No product tests/build/lint/full-suite rerun this review. Earlier **12639 passed / 0 failed / 944 skipped** and green checks are historical evidence for the preceding commit, not validation of these new candidates. No paid provider calls.
- Testing gap #31: replace source-string export system-entry checks with actual viewer rendering. Other proposed gaps are retained verbatim in advisory outputs. Native Windows/WSL, Linux/Android, live SSH, Cloudflare deployment, browser IndexedDB and full release assets remain unexecuted.
- Final preservation is checked after this append: only the requested ledger may differ; index, HEAD, branch, `my-merge`, `crystal` and all 749 protected target hashes must remain unchanged. Exact receipt is retained as `preservation.json`.
- Artifacts: `/tmp/compound-engineering-501/ce-code-review/20261029-full-0bf4594a-1e3ec2d0`. Includes all 22 full reports, frozen scope/diffs/assignments, source details, mechanical gates, coverage, unvalidated candidates, validator verdicts, synthesized/actionable findings, advisories, report and metadata.

---

### Verdict

**Not ready.** Fix P1 #1 shared-worker duplicate-call isolation, #2 retain-none checkpoint preservation and #3 fail-fast cluster rollback first. Five independently source-validated P2 remain. Semantic coverage and validation are explicitly degraded; this is not a new clean merge approval. No fixes were applied.

### Actionable Findings recap

- #1 P1 `packages/coding-agent/src/experimental/session-worker.ts:564` - Duplicate native calls terminate the shared Session worker; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #2 P1 `packages/agent/src/harness/session/jsonl/legacy-v3.ts:310` - Preserve system checkpoints when importing retain-none compactions; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #3 P1 `packages/chord/src/cluster.ts:83` - Abort failed cluster reloads before joining pending preparation; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #4 P2 `packages/agent/src/harness/pico3/chord.ts:112` - Validate remote model messages before claiming their type; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #9 P2 `packages/chord/src/schema.ts:191` - Reject pattern keys outside a closed consumer object; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #12 P2 `packages/coding-agent/src/core/export-html/index.ts:200` - Serialize edit call HTML after applying its final result; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #13 P2 `packages/coding-agent/src/core/export-html/tool-renderer.ts:114` - Export full write content instead of collapsed terminal previews; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #33 P2 `packages/durable/src/harness/tool.ts:400` - Isolate the shared nested-call memo from caller cancellation; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.


## Local repair of the eight confirmed 0bf4594a findings

This section closes only full-review actionable findings **#1, #2, #3, #4, #9, #12, #13 and #33**, plus two independently validated repair-introduced followups. It does not close the original **32 unvalidated candidates**, **#31 testing gap**, or **439 insufficient-evidence paths**. Those remain outside this repair scope. Baseline is `0bf4594aa820a2c98627ce2db74e6a2e623c7037`; branch `fix/full-merge-review-8322aa1d`. No commit or push.

### Repair disposition

| Finding | Repair | Exercised boundary |
| --- | --- | --- |
| #1 | Duplicate native IDs reach Chord's attachment-local violation handling. Closed links release their active retirement holds and cannot be reopened by repeated demand or late traffic. | Real worker with two attachments; malformed scope closes while unrelated work and worker survive. Worker/lifecycle/remote/plugin suites: 64 passed. |
| #2 | Optional system checkpoint survives legacy normalization, active-context projection, JSONL upgrades/forks, SQLite payloads, durable preparation/result and later generated/hook compaction. Effective policy is folded separately from conversational partitions. | Producer retain-none and nonempty-tail imports, exact sections/tools, read-only open, upgrading commit, reopen, subsequent compaction and SQLite reopen. |
| #3 | First local/vote failure aborts before joining. Outstanding votes settle; cached rollback joins preparation and exclusive close before restoring resources and releasing gates. | Linked child rejection/timeout while local open waits for abort; exclusive-close race preserves upgrade_conflict until rollback completes, then old methods work. Chord suites: 78 passed. |
| #4 | Remote send/write schemas validate real message, content and context-edit structures before persistence. Core-only edits remain restricted. All canonical constrainedSampling variants survive cleaning. | Malformed wire messages reject with invalid/args and unchanged context; valid unions and tool declarations round-trip. Pico suite passed. |
| #9 | Closed consumer binding accounts for provider pattern keys and preserves sound identical pattern policies. | Provider-valid/consumer-invalid counterexample rejected for result/state binding; compatible patterns remain accepted. Contract/binding suites passed. |
| #12 | Export bridge reserializes cached call HTML after final result mutates it. | Real successful edit exported after target deletion or replacement retains recorded additions/removals. |
| #13 | Static call HTML renders expanded content rather than terminal-only ten-line previews. | Real write of more than ten lines exposes every line through exported viewer rendering. |
| #33 | Shared nested-call memo uses enclosing invocation context, not the first caller's cancellation context. | New regression failed before fix: healthy admission rejected. After fix all 34 nested-tool tests passed; only cancelled caller rejects and healthy tool runs once. |

### Independent repair review and followup

- Three behavior-preserving simplification lenses completed. No change applied: removing a pre-existing exported renderer type risks an external direct-module contract; three explicit compaction partition guards remain readable; unmeasured regex caching adds state without a demonstrated bottleneck.
- Fresh repair review inspected **25 owned paths: 24 tracked plus one explicitly included full added regression file**. Ten selected reviewers completed; no missing path. The existing ledger was excluded from product review. Graph failed with the recorded WeakMap error; source and canonical LSP references were used. No exhaustive dynamic/external caller claim.
- Thirteen raw reports reduced mechanically and semantically to two repair-introduced P2 defects. One fresh independent batch accepted both: missing Tool.constrainedSampling preservation and duplicate system deltas alongside imported folded checkpoint. Both were fixed with behavioral regressions.
- A proposed old-v1 Pico migration requirement was rejected: independently deployed old-client compatibility was not established, and the project defaults to a clean cutover without compatibility shims. No schema validation was weakened.
- Final narrow correctness review inspected all four final followup files/current hunks and returned no findings. Zero actionable residuals remain among the **eight original confirmed defects plus two validated followups**. This is not clearance of the original 32 unvalidated candidates, #31 testing gap or incomplete full-merge coverage.

### Verification

- Final affected Agent/Pico/JSONL/context/compaction/structural suites: **117 passed**. Producer deletion/import plus HTML suites: **35 passed**. SQLite storage: **21 passed**. Worker boundary suites: **64 passed**. Chord boundary suites: **78 passed**. Durable nested tools: **34 passed**.
- Final `npm run check` passed: **1979 files**; formatter changed one owned file, dependency/import/entry-graph/install-lock/typecheck/browser-bundle checks passed. Final review diff matches the post-format current four-file contents.
- First authoritative `./test.sh`: **12625 passed / 31 failed / 944 skipped**. All 31 failures used the protected stale default daemon, missing current listFiles/pty/watch operations. Protected outputs were not modified.
- Built current daemon with Rust 1.96 in external `/tmp/pi-eight-repairs-e99f8542/cargo-target`. Source-aligned isolated `PI_ENV_DAEMON=... ./test.sh`: **11197 passed / 1 failed / 940 skipped**. Env: 107 passed / 5 skipped. Remaining failure is unchanged `packages/durable/test/tools-images.test.ts:581`: timer gap 176.322 ms exceeds 100 ms. No threshold relaxation or retry-for-green. Durable runner exits before retention-zero/workerd phases; those phases were not verified by this run. No full-suite-green claim.
- Actual tool execution/export smoke generated `/tmp/pi-eight-repairs-e99f8542/export-smoke.html`. Browser helper failed internally with missing `__omp_display__`; no visual proof. An earlier ad-hoc Durable smoke failed import resolution and was abandoned, not counted as proof.
- No dependencies/lockfiles, Rust source or changelogs changed. Changelog omitted on this non-main branch per repository rule. No real provider requests or paid tokens. Windows/native compiled-Bun behavior not executed.
- No product/source experiment had writable aliases into canonical source. Parent integrated four isolated units; final two disjoint corrections were caller-owned canonical edits. Only this ledger's prior history is preserved and appended.
- Artifacts: `/tmp/pi-eight-repairs-e99f8542`; review receipt/report, exact diffs, source detail/validation outputs, final correctness result and verification receipts are retained. Final post-append preservation receipt records branch/HEAD/index/refs, exact path ownership and all 749 protected hashes.

### Local repair verdict

**All eight confirmed actionable findings and both validated repair followups are repaired; focused tests and mandatory checks pass.** No residual remains within that confirmed repair scope. Full-suite approval is withheld because of the unchanged image timing test failure. The original 32 unvalidated candidates, #31 testing gap and 439 insufficient-evidence paths remain explicitly unresolved. Changes are local, uncommitted and unpushed.


## Complete maintained merge review - 554a0504

**Scope:** `839dc79197595a4285d711e37d02fb623e5b6b7b` -> `554a0504a02fde0624fc07e9d402e12c16372174`; HEAD tree `be0dae6f9753a630fffbb832f6c5be7758691d09`; branch `fix/full-merge-review-8322aa1d`; **1532 changed paths**. Includes the complete maintained merge and every subsequent change, not only the latest repair commit.
**Intent:** Find current reachable regressions while retaining Crystal history/edit/swipe/delete/restore/shred/id0 behavior, Harness/experimental/client/server consumers, multimodal/token counting, configured summary budgets, prompt/receipt ownership and native/storage safety.
**Mode:** markdown report-only. No product fixes, commit or push. Earlier local repairs are committed at 554a0504; prior uncommitted wording is historical.

**Reviewers:** 10 disjoint correctness domains; project-standards for written rules; testing for changed behavioral tests; maintainability for structural/type boundaries; agent-native for tools/commands; security for trust and authentication; performance for streaming/storage/cache work; api-contract for wire/public consumers; data-migration for actual legacy/SQLite transforms; reliability for lifecycle/error settlement; adversarial for cross-component and false-pass scenarios; julik-frontend-races for UI timers/requests; deployment-verification for risky forward-only storage operations. All 22 have usable terminal reports after recovery.

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
| --- | --- | --- | --- | --- |
| Host/process ownership - apply queue | #1, #2, #7, #10 | OS descendants, terminal child state and reentrant resource ownership | Fix P1 #1/#2 first; reserve invocation before callbacks #7 and fence retired worker identity #10 | Exit/cleanup must belong to exactly one live owner |
| Durable invocation context - apply queue | #4, #24, #27 | Initial events and persisted session navigation can diverge from effective context | Initialize execution #4; restore checkpoint loadout #24; publish navigation only after persistence #27 | Keep callbacks, durable state and visible context on the same accepted transition |

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 1 | `packages/chord/src/manager.ts:219` | Clean Windows descendants on graceful and unexpected exits | reliability | 100 |
| 2 | `packages/chord/src/manager.ts:404` | Handle fatal reports after the child becomes ready | reliability | 100 |
| 3 | `packages/chord/src/websocket.ts:26` | Bound frames queued before WebSocket authentication completes | security | 75 |

- **#1** - On Windows, a normally exiting or crashing managed child leaves its spawned subprocesses running, even though manager.stop() or instance.exited reports completion. The exit handler calls killGroup(), but that function returns immediately on Windows; taskkill tree cleanup only runs when an explicit forced kill happened before the leader exited. The existing graceful-exit test itself creates an independently running grandchild, so the missing lifetime cleanup is observable without requiring a malicious child.
  - Response: Give each managed Windows child an owned process-tree lifetime mechanism, preferably a Windows Job Object with kill-on-close, and join/close that ownership on every exit path. A JavaScript-only alternative must track descendants before the leader disappears and terminate/join those recorded children on normal exit as well as forced stop; do not defer taskkill discovery until after leader exit.
  - Evidence: packages/chord/src/manager.ts:219 -- if (pid <= 0 || process.platform === "win32") return; packages/chord/src/manager.ts:265-268 -- child.once("exit") only calls killGroup() and resolves immediately when treeTermination is undefined. packages/chord/src/manager.ts:237 -- taskkill must discover the descendants before their parent exits. Join it before reporting exit. packages/chord/src/manager.ts:351-359 -- doStop() invokes killTree() only when the graceful exit wait times out. packages/chord/test/manager.test.ts:244-253 -- graceful exit test starts a real grandchild, stops the manager, and expects that grandchild not to remain alive. packages/chord/test/fixtures/worker.ts:31-47 -- grandchild runs a persistent interval and disconnects IPC; shutdown exits the worker without explicitly stopping the grandchild. packages/chord/docs/spec.md:286 -- The manager kills the child process group on every exit path. reliability.diff:26864-26914 -- this platform-specific exit cleanup is newly introduced in the reviewed diff.
  - Independent source validation: Source inspection confirms forkDriver's exit handler skips process-group cleanup on Windows and doStop invokes taskkill only after a grace timeout, so normally exiting workers can leave the fixture's independently running grandchild alive after exited resolves.

- **#2** - A child that reports a terminal initialization or host failure after its initial ready message remains advertised as running, and later start() calls return that same failed instance. The fatal handler only rejects the readiness promise; after ready resolved it, rejecting it does nothing, so the killTree/exit cleanup never runs. This also breaks the documented two-stage startup flow, which explicitly tells workers to announce local readiness before awaiting upstream-dependent host activation and report a later failure through the fatal path.
  - Response: Separate lifetime control handling from readiness settlement: reject readiness for fatal messages while starting, and schedule serialized termination of the matching current instance for fatal messages after readiness. Join its exit and leave the manager stopped so the next start can create a replacement; retain the instance identity fence.
  - Evidence: packages/chord/src/manager.ts:406 -- reject(new ChordError("unavailable", `child failed: ${message.message}`, { reason: message.reason })), packages/chord/src/manager.ts:403 -- if (message.type === "ready") settle(resolve); packages/chord/src/manager.ts:419-423 -- killTree() and the joined exit are only in the readiness promise rejection catch; a previously resolved promise cannot reject again. packages/chord/src/manager.ts:365 -- if (instance !== undefined && status === "running") return instance; packages/chord/docs/guide.md:300-314 -- announces control readiness before await worker.ready(), and directs a later failure through the worker fatal/startup-error path. packages/chord/docs/spec.md:263 -- A terminal host failure is picked up by the host manager keepAlive or fatal path, not inside Chord. reliability.diff:27049-27068 -- the ready/fatal settlement and rejection-only process cleanup are added in BASE..HEAD.
  - Independent source validation: The instance-fenced fatal handler only rejects the readiness promise, so a fatal report after ready cannot reach its rejection cleanup, while childControl.fatal only sends a message and subsequent start calls return the still-running failed instance.

- **#3** - An unauthenticated WebSocket peer can consume unbounded process memory while an asynchronous authenticator is waiting. The newly installed link immediately parses and retains every incoming frame, but no receiver, protocol validation, flow-control accounting, or connection keepalive exists until authentication resolves; a stream of individually valid small frames therefore bypasses any per-message WebSocket size limit. Bounding the pre-authentication queue and closing on overflow prevents that concrete denial-of-service path without dropping legitimate initial frames.
  - Response: Add a byte/count limit to frames buffered before a link receiver is installed and close the socket on overflow; apply a bounded authentication deadline in acceptWebSockets and do not call host.accept after that link has closed. Keep acceptPacked:false. Verify with an unresolved asynchronous authenticator, many small frames, and a separate successfully authenticated client.
  - Evidence: packages/chord/src/websocket.ts:26 -- 		const link = webSocketLink(socket, { compress: true, acceptPacked: false }); packages/chord/src/websocket.ts:28-32 -- options.principal(request) may return a Promise; host.accept(link, ...) runs only after it resolves. packages/chord/src/link.ts:87 -- 		if (this.#handler === undefined) this.#queue.push(frame); packages/chord/src/link.ts:379-383 -- The WebSocket message listener calls parseFrame and delivers immediately, including before authentication has resolved. packages/chord/src/connection.ts:445-446,455-464 -- Frame validation/receiver and keepalive are installed by Connection after host.accept; they cannot bound the earlier queue. Source-only constructible scenario: principal returns a pending external-auth Promise; an unauthenticated peer sends repeated JSON ping frames. Each decoded frame remains in BaseLink.#queue until the Promise settles or the socket closes. No runtime experiment was performed, as required.
  - Independent source validation: acceptWebSockets installs WebSocketLink before awaiting the asynchronous principal callback, and BaseLink retains every parsed non-bye frame without a count or byte cap until host.accept installs Connection's receiver and keepalive.

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
| --- | --- | --- | --- | --- |
| 4 | `packages/agent/src/agent-loop.ts:361` | Capture execution before initial subscriber callbacks | correctness-agent | 100 |
| 7 | `packages/chord/src/object.ts:1653` | Register invocations before entering user callbacks | correctness-chord | 100 |
| 10 | `packages/durable/src/images/node.ts:134` | Retire image workers once without clearing their replacement | maintainability | 100 |
| 24 | `packages/coding-agent/src/core/agent-session.ts:3242` | Restore tools from checkpoint-only system state | correctness-session | 75 |
| 27 | `packages/coding-agent/src/core/session-manager.ts:1507` | Keep branch selection unchanged when summary append fails | correctness-session | 75 |

- **#4** - A stateful Agent subscriber that rejects agent_start, turn_start, or an initial prompt's message_start/message_end bypasses the newly added failure finalizer entirely. The execution context and invocation message list are initialized only after those awaited callbacks, so finishAgentLoopFailure returns without calling finishTurn, and agent_end reports only the synthetic failure rather than any initial messages already published. Initial publication failures therefore cannot use the same durable cleanup/finalization contract as request-preparation and provider failures.
  - Response: Initialize execution.context and execution.newMessages in runAgentLoopInternal and runAgentLoopContinueInternal immediately after constructing their currentContext/newMessages and before the first emit. Retain the existing updates when request or next-turn preparation replaces the active context. Cover a one-shot rejecting initial subscriber after a prompt message has been accepted, asserting one finishTurn invocation and the correct invocation message list.
  - Evidence: packages/agent/src/agent-loop.ts:361 -- 		execution.context = currentContext; packages/agent/src/agent-loop.ts:362 -- 		execution.newMessages = newMessages; packages/agent/src/agent-loop.ts:199-206 -- runAgentLoopInternal awaits agent_start, turn_start and both initial message events before calling runLoop, where the execution fields are first initialized. packages/agent/src/agent-loop.ts:243-246 -- runAgentLoopContinueInternal likewise awaits agent_start and turn_start before calling runLoop. packages/agent/src/agent.ts:937-938 -- processEvents awaits each public subscriber, so subscriber rejection exits either initial entry function before execution registration. packages/agent/src/agent-loop.ts:52 -- 	if (execution.finishTurnStarted || !execution.context) return; packages/agent/src/agent.ts:851 -- 		const newMessages = execution.newMessages ?? []; packages/agent/src/agent.ts:857-859 -- handleRunFailure calls finishAgentLoopFailure and emits agent_end with that fallback list. packages/agent/test/agent-loop.test.ts:2341-2351 -- the new failure-finalization matrix starts with steering/transform/convert/API-key/dispatch/iterator failures; all occur after runLoop registration and do not cover initial subscriber rejection.
  - Independent source validation: Both loop entry functions await initial events before runLoop records execution.context and execution.newMessages, so an awaited Agent subscriber rejection there reaches handleRunFailure with no context, skips finishTurn, and loses the invocation's initial messages from agent_end.

- **#7** - Releasing the last reference synchronously from a method or a state listener can start disposal while that same invocation is still running. The callback begins before its promise is inserted into #invocations, so disposal snapshots an empty invocation set and closes resources while the callback is suspended. On resumption a previously valid resource facade throws not_ready, contradicting the runtime's guarantee that methods and listeners retain their resources until settlement.
  - Response: Install an invocation reservation before calling fn, then settle/remove it after fn resolves or throws. A deferred promise registered first can retain synchronous callback entry semantics without permitting #maybeIdle or forced disposal to miss the in-progress invocation. Cover both a direct method releasing its only external ref before an await and an immediate listener doing so before awaiting cleanup.
  - Evidence: packages/chord/src/object.ts:1653 -- const invocation = (async () => fn())(); packages/chord/src/object.ts:1654 -- this.#invocations.add(invocation); packages/chord/src/object.ts:1677-1691 release removes the ref, #maybeIdle sees zero refs and zero invocations, and calls dispose(false) immediately when linger is zero. packages/chord/src/object.ts:1733 -- await Promise.allSettled([...this.#invocations]); packages/chord/src/object.ts:1743-1747 closes resources after that already-captured invocation snapshot; ResourceImpl.close at lines 263-270 clears its value before calling the native close handler. Trace: an async method calls ref.release() synchronously, then awaits a controlled pending promise, then reads db.value. #dispose reaches Promise.allSettled([]) before #invoke adds the method promise; disposal resumes and closes db while the method remains pending. The existing review.test.ts:240-289 releases only after ticks, when invocation registration already happened, and therefore misses the entry-window race. provenance: 0104fef1e Mario Zechner 2026-10-12 - invocation entry and registration at object.ts:1652-1654 originate in the merged chord2 runtime (targeted blame follows the former record.ts path).
  - Independent source validation: ObjectImpl invokes user code synchronously before adding its promise to #invocations, allowing a last-reference release inside that callback to start disposal and snapshot an empty invocation set before the callback suspends, with no lease-based idle guard preventing resource closure.

- **#10** - Image reads arriving while an idle worker is terminating can lose ownership of the replacement worker and start additional workers for later reads. The idle timer calls #exit() before terminate(), then the worker exit event calls fail() and #exit() again; both callbacks unconditionally clear the factory's shared thread variable. If a new read installed a replacement between those callbacks, the old worker clears that replacement. Make retirement a once-only transition and clear the shared slot only when it still refers to the retiring instance.
  - Response: Add an idempotent retired/closed guard to PhotonThread.#exit(), set it before notifying #onExit(), and make the factory callback clear thread only when thread equals the instance that retired. Keep retirement-at-idle separate from the eventual Worker exit event so that a late old-worker event cannot mutate replacement ownership. Add a deterministic delayed-exit case that starts the replacement between the idle timeout and the old worker exit event.
  - Evidence: packages/durable/src/images/node.ts:134: 		this.#onExit(); packages/durable/src/images/node.ts:36-38: thread ??= new PhotonThread(idleMs, () => { thread = undefined; }); packages/durable/src/images/node.ts:98: 		this.#worker.on("exit", (code) => fail(new Error(`The Photon image worker exited with code ${code}`))); packages/durable/src/images/node.ts:93-95: fail() rejects pending requests, clears #pending, and calls this.#exit(). packages/durable/src/images/node.ts:124-126: the idle timer calls this.#exit() and then void this.#worker.terminate(); #exit() has no once-only state. packages/durable/src/tools/read.ts:155-157: image reads invoke the configured processor.prepare(bytes, mimeType, limits). packages/durable/test/tools-images.test.ts:597-608: the restart test waits 100 ms before the replacement read; it does not interleave a replacement with delayed old-worker exit. provenance: cdaf6c227d Mario Zechner 2026-10-11 - feat(durable): prepare images in a worker thread in /images/node; git blame at reviewed HEAD attributes node.ts:121-135 to this commit.
  - Independent source validation: The image worker's idle timeout calls #exit before asynchronous terminate, and the later worker exit calls the same unguarded #exit again, whose factory callback unconditionally clears thread even if an intervening prepare installed a replacement.

- **#24** - A resumed or selected session whose effective tool declaration is stored in a compaction checkpoint loses that loadout when there are no ordinary system-message entries carrying it. Restoration now scans only raw message/system records and returns early, leaving startup defaults or the abandoned branch's tools active instead of the checkpoint's tools. The next request can therefore declare and expose different tools than the retained canonical context.
  - Response: Seed tool restoration from the effective checkpoint in the canonical projection, then replay visible system deltas after that checkpoint; retain the current deleted-entry handling, pending-tool bookkeeping, invocation modifiers and new extension tool activation rules. Add a reopen/navigation case with declarations present only in CompactionEntry.systemMessage.
  - Evidence: packages/coding-agent/src/core/agent-session.ts:3242 -- entry.deletedAt === undefined && entry.type === "message" && entry.message.role === "system" packages/coding-agent/src/core/agent-session.ts:3246 -- if (systemMessages.length === 0) return; packages/coding-agent/src/core/session-manager.ts:723-731 explicitly projects latestCompaction.systemMessage as the effective leading system message, independently of whether a raw system message survives in the tree. packages/coding-agent/test/session-manager/build-context.test.ts:233-280 constructs supported checkpoints carrying their own system state, including a latest checkpoint whose content overrides earlier state. packages/coding-agent/src/core/agent-session.ts:743-747 calls this restoration on default-tool resume, and lines 3449-3463 call it after selected-branch navigation. A checkpoint with toolsAdded=[read], no ordinary system messages and startup read/bash/edit/write reaches the early return and leaves all four defaults active. The supplied diff replaces the previous getCurrentSystemMessage(this.sessionManager.buildSessionContext().messages) restoration with this raw-branch-only collection; the earlier path did observe CompactionEntry.systemMessage. provenance: db3f2fd86 Nex 2026-10-27T22:54:46+08:00 - fix: close full-merge review findings and repair boundaries; targeted blame attributes the message-only/deleted-entry predicate at 3241-3245 to this commit.
  - Independent source validation: Tool restoration now reads only undeleted raw message/system entries and returns when none exist, although the canonical projection independently restores latestCompaction.systemMessage, so checkpoint-only tool declarations are ignored on default-tool resume and branch navigation.

- **#27** - If publishing a branch summary fails, the manager's selected leaf has already moved to the navigation target even though no summary or successful navigation was published. The new persist-before-publish append ordering throws before advancing the revision or updating entries, while branchWithSummary mutates leafId before invoking it. AgentSession.navigateTree then exits without refreshing agent state, so the UI/agent messages and cached context usage remain on the old branch while the next durable append silently attaches to the target branch.
  - Response: Do not assign this.leafId in branchWithSummary before persistence: construct the entry with parentId=branchFromId and let the successful _appendEntry publish its ID as the leaf. Preserve fromId from the outgoing leaf. Verify failed append leaves selected leaf, revision, projection, cached usage and subsequent parentage unchanged.
  - Evidence: packages/coding-agent/src/core/session-manager.ts:1507 -- this._persist(entry, !this.flushed && this.persist ? [...this.fileEntries, entry] : this.fileEntries); packages/coding-agent/src/core/session-manager.ts:2886 -- this.leafId = branchFromId; packages/coding-agent/src/core/session-manager.ts:2887-2898 builds parentId explicitly from branchFromId and calls _appendEntry. Thus the earlier leaf assignment is unnecessary for constructing the entry and remains changed when persistence throws. packages/coding-agent/src/core/session-manager.ts:1508-1511 publishes indexes, increments contextRevision and updates leaf only after _persist succeeds. The failure leaves leaf changed by the caller but contextRevision unchanged. packages/coding-agent/src/core/agent-session.ts:6984-6990 invokes branchWithSummary before lines 7010-7013 refresh finalized context; its finally at 7027-7029 only clears the branch summary controller and resolves idle waiters. provenance: ebae31160 Nex 2026-10-21T18:32:02+08:00 - fix(coding-agent): persist entries before publishing appends; blame attributes the new _persist-before-publish line to this commit, whereas the caller's leaf assignment is retained from c58d5f20a4. This finding concerns that changed ordering's interaction with the retained caller, not a claim that branchWithSummary was newly added.
  - Independent source validation: branchWithSummary mutates leafId before the newly persist-first _appendEntry can throw, leaving the target leaf selected without publishing an entry or advancing contextRevision, and navigateTree's finally does not refresh or restore the abandoned agent context.

### Actionable Findings

| # | File | Issue | Route | Notes |
| --- | --- | --- | --- | --- |
| 1 | `packages/chord/src/manager.ts:219` | Clean Windows descendants on graceful and unexpected exits | `manual -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |
| 2 | `packages/chord/src/manager.ts:404` | Handle fatal reports after the child becomes ready | `gated_auto -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |
| 3 | `packages/chord/src/websocket.ts:26` | Bound frames queued before WebSocket authentication completes | `gated_auto -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |
| 4 | `packages/agent/src/agent-loop.ts:361` | Capture execution before initial subscriber callbacks | `gated_auto -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |
| 7 | `packages/chord/src/object.ts:1653` | Register invocations before entering user callbacks | `gated_auto -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |
| 10 | `packages/durable/src/images/node.ts:134` | Retire image workers once without clearing their replacement | `gated_auto -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |
| 24 | `packages/coding-agent/src/core/agent-session.ts:3242` | Restore tools from checkpoint-only system state | `gated_auto -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |
| 27 | `packages/coding-agent/src/core/session-manager.ts:1507` | Keep branch selection unchanged when summary append fails | `gated_auto -> downstream-resolver` | suggested_fix present; source-independently validated; not applied |

### Unvalidated source candidates - not confirmed findings

**31 candidates** remain outside the bounded independent batch. They are not confirmed defects and are not disproved. Selection included all three P1 plus five high-impact P2 covering failure settlement, resource identity, checkpoint loadout and failed navigation persistence; it was not simply the first five P2. Exact evidence and proposed fixes remain in unvalidated-candidates.json.

| Candidate | Severity | File | Source claim |
| --- | --- | --- | --- |
| #5 | P2 | `packages/chord/docs/guide.md:45` | Declare host placement in the Chord quickstart |
| #6 | P2 | `packages/chord/docs/guide.md:717` | Use the server WebSocket acceptance helper |
| #8 | P2 | `packages/codemode/src/runtime/execution.ts:543` | Prevent raw aliases from stealing declared script names |
| #9 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:9639` | Stop live tool clocks when interactive mode stops |
| #11 | P2 | `packages/tui/src/tui-main-screen.ts:531` | Allow overlays beside and below Kitty image anchors |
| #12 | P2 | `scripts/issues/ui.html:171` | Limit bulk none decisions to the displayed suggestion group |
| #13 | P2 | `scripts/local-package-install.mjs:191` | Package smoke passes without loading declared subpath exports |
| #14 | P2 | `packages/agent/src/agent.ts:813` | Do not cancel failure finalization on internal errors |
| #15 | P2 | `packages/ai/scripts/hydrate-model-catalog.ts:65` | Preserve catalog freshness when hydrating reproducible builds |
| #16 | P2 | `packages/chord/src/cell.ts:378` | Validate externally refreshed derivations before publishing |
| #17 | P2 | `packages/chord/src/host.ts:1296` | Terminate externally held bindings when closing their host |
| #18 | P2 | `packages/chord/src/manager.ts:378` | Retire managed children when their IPC link closes |
| #19 | P2 | `packages/chord/src/reload.ts:516` | Join stopped tasks before replacing their native resources |
| #20 | P2 | `packages/chord/src/remote.ts:707` | Decode implicit calls using current method projections |
| #21 | P2 | `packages/codemode/src/source.ts:195` | Recognize regular expressions after statement blocks |
| #22 | P2 | `packages/coding-agent/README.md:79` | Hydrate model data before the fresh checkout build |
| #23 | P2 | `packages/coding-agent/src/core/agent-session.ts:1004` | Invalidate response usage when the summary budget changes |
| #25 | P2 | `packages/coding-agent/src/core/compaction/branch-summarization.ts:431` | Near-window branch summaries exhaust two-token output caps |
| #26 | P2 | `packages/coding-agent/src/core/compaction/branch-summarization.ts:480` | Raw-policy pruning discards history before redaction can shrink it |
| #28 | P2 | `packages/coding-agent/src/extensions/mcp/oauth.ts:524` | Do not cancel in-flight refresh rotation during sign-in |
| #29 | P2 | `packages/durable/src/codemode/codemode.ts:245` | Standalone codemode advertises unregistered model tools |
| #30 | P2 | `packages/durable/src/codemode/codemode.ts:383` | Colliding normalized names disable all durable scripts |
| #31 | P2 | `packages/durable/src/harness/context.ts:219` | Count late baselines outside the previous usage prefix |
| #32 | P2 | `packages/durable/src/harness/scheduler.ts:740` | Avoid rescanning every cached context on each task transition |
| #33 | P2 | `packages/env/daemon/src/sys/windows.rs:324` | Resolve Windows executables against the effective child PATH |
| #34 | P2 | `packages/env/src/ssh.ts:482` | Use fish-compatible forwarding for login-shell daemon launches |
| #35 | P2 | `packages/env/src/terminal.ts:114` | Contain terminal output callback failures |
| #36 | P2 | `scripts/check-model-catalog-compat.mjs:97` | Accept package-keyed npm pack output in the catalog gate |
| #37 | P2 | `scripts/issues/triage.ts:179` | Clear superseded results before starting another triage attempt |
| #38 | P2 | `scripts/issues/ui.html:196` | Keep keyboard selection attached to the selected issue |
| #39 | P2 | `scripts/issues/ui.html:78` | Reject stale issue snapshots before replacing live state |

#5/#6/#22 concern current documentation recipes. #29/#30 depend on public standalone/custom tool loadouts; no normal repository collision was executed. #32 is source-derived scaling, not a benchmark. #25/#26 concern distinct summary output-headroom and post-conversion retention paths; no merge of their fix paths. These remain explicitly unvalidated rather than inflating the confirmed queue.

### Advisory and testing dispositions

- Raw count reconciliation: **45 = 39 source candidates + 1 semantic duplicate + 2 testing-only gaps + 2 released-history claims excluded + 1 standards-only advisory**. Of the 39 source candidates, **8 validated + 31 unvalidated**. No confidence/quote suppression or malformed findings.
- Initial mechanical tool-clock entries described the same missing permanent InteractiveMode.stop disposal and were merged; current stable candidate #9 retains both reviewers. Stale issue-response overwrite (#39), unstable keyboard identity (#38), retained triage result (#37), and bulk eligibility (#12) have distinct triggers/fixes and were not collapsed.
- Testing-only gaps: packages/coding-agent/test/native/tokenizer-count-ownership.test.ts:155 manually renders after a no-op requestRender; it does not prove completion-triggered repaint. packages/coding-agent/test/suite/agent-session-compaction-model-overrides.test.ts:206 drops the configured budget assertion during an awaited model change. Both moved to testing_gaps, not confirmed product defects.
- Standards-only advisory: packages/ai/src/api/openai-decisions.lazy.ts:5 and easter-egg-3d.lazy.ts use dynamic imports contrary to the top-level-import rule. Lazy loading is intentional; no runtime defect is proved. Resolving that rule/design conflict remains report-only, not a request to remove functionality.
- Deployment review suggested replacing retained-stack removal and model-output-limit-only claims in already released changelog sections. Those suggestions are excluded under immutable released-history rules; current fork behavior must be documented without rewriting historical release sections. No product code should be deleted to match upstream historical notes.

### Deployment Notes

- Quiesce overlapping SQLite writers and preserve exact namespace/prefix. Capture a coherent WAL-aware whole-database snapshot and rehearse restore with the actual rollback binary.
- On quiescent baseline and migrated clones, run `SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name;`. Compare allocator/schema metadata, exact task JSON and identities, unrelated tables and indexes; require no temporary task table. Audit custom host schema objects, WAL/disk headroom and lock duration.
- SQLite schema 2 is deliberately forward-only. A schema-1-only binary requires a coherent pre-upgrade snapshot; relabeling metadata or switching prefixes is not rollback. Account for later writes/external effects and sleeping-task recovery.
- Before first v3-to-v4 JSONL write, retain originals and exclusive ownership. Compare selected leaf, IDs, usage, system/tool checkpoints and historical nodes through read-only open, first write, fork and reopen.
- Observe telemetry flush/close rejection and dropped queue counters. Actual migration commands, production queries, backup recovery and workerd deployment were not executed this review. These are operational proposals, not observed passes.

### Coverage

- Correctness partitions reconcile all **1532 paths** exactly once: **846 semantically source-inspected / 686 insufficient-evidence paths**. Path inventory and hunk traversal are not semantic clearance.
- Assigned/inspected/insufficient by domain: ai 209/126/83; agent 52/52/0; chord 123/89/34; durable 231/84/147; env 38/38/0; session 132/117/15; interactive 108/106/2; integrations 250/89/161; tooling 131/124/7; docs 258/21/237. Historical review/closure documents were not used as finding seeds. Exact arrays and per-path reasons remain in full reports.
- Conditional assigned/inspected/insufficient: project-standards 1371/32/1339; testing 756/53/703; maintainability 574/71/503; agent-native 136/105/31; security 174/160/14; performance 111/92/19; api-contract 539/73/466; data-migration 36/36/0; reliability 578/71/507; adversarial 1371/74/1297; julik-frontend-races 146/84/62; deployment-verification-agent 33/33/0. Lens coverage does not close unrelated correctness gaps.
- Infrastructure recovery: initial 22 launches each exhausted retries waiting for the first model event and produced no report. All reached terminal failure. One env recovery completed, then the remaining 21 recovered reports completed. No initial timeout was counted as clean or as a completed source review. Failure and recovery receipts are retained; no active review job remains.
- Mechanics: 45 raw, zero malformed returns/findings, zero quote/confidence suppressions. Semantic decisions above reran mechanics before stable numbering. One independent validator batch accepted **#1/#2/#3/#4/#7/#10/#24/#27**, rejected zero. All P1 selected; zero cross-family shortcuts. 31 source candidates remain unvalidated, so overall review is **degraded**.
- External cross-model not started: host serving family was unattested under the route contract. Local adversarial supplies the lens only, not serving-family independence. No external egress job or unresolved peer obligation.
- Graph project discovery and coverage calls failed with `WeakMap keys must be objects or non-registered symbols`. Current source/history and available LSP are fallback; no exhaustive external/dynamic caller claim. Generic branch keywords did not establish a requirements plan; settlement suppression was not evaluated.
- Current bounded runtime observation: public createHostManager with controlled driver reaches ready, receives fatal, remains running, returns the same instance on next start, and invokes zero kills before cleanup. Public acceptWebSockets with controlled pending authenticator retains 256 small frames without closing; all 256 reach receiver after authentication. This proves boundary behavior, not a real OS child, network attack, heap growth rate or production DoS. Windows descendant finding is source-only; Windows not executed.
- No product source changes, paid provider calls, product build/lint/full-suite rerun. Earlier 11197/1/940 full-suite result and green repair checks belong to prior verification, not new review proof. The unchanged image timing threshold failure remains historical non-green evidence; it was not retried for this review.
- Final post-append preservation checks bind HEAD/tree/branch, empty index, my-merge/crystal refs, exact only-ledger ownership, all 749 protected hashes, ASCII and report/append equality. Exact observed receipt is preservation.json.
- Artifacts: `/tmp/compound-engineering-501/ce-code-review/20261029-full-554a0504-5c478b62`. Frozen full diff/inventory/provenance, all 22 reports, failed/recovered accounting, details, mechanics, semantic disposition, coverage, validator verdicts, bounded smoke, unvalidated candidates, advisory/deployment outputs, actionable queue, report and metadata.

---

### Verdict

**Not ready.** Fix P1 #1 Windows descendant ownership, #2 fatal-after-ready manager retirement and #3 pre-authentication frame bounds first. Five independently validated P2 remain. This is a complete-scope but coverage/validation-degraded review, not clean merge approval. No fixes were applied.

### Actionable Findings recap

- #1 P1 `packages/chord/src/manager.ts:219` - Clean Windows descendants on graceful and unexpected exits; manual -> downstream-resolver; suggested_fix present; confidence 100.
- #2 P1 `packages/chord/src/manager.ts:404` - Handle fatal reports after the child becomes ready; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #3 P1 `packages/chord/src/websocket.ts:26` - Bound frames queued before WebSocket authentication completes; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #4 P2 `packages/agent/src/agent-loop.ts:361` - Capture execution before initial subscriber callbacks; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #7 P2 `packages/chord/src/object.ts:1653` - Register invocations before entering user callbacks; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #10 P2 `packages/durable/src/images/node.ts:134` - Retire image workers once without clearing their replacement; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #24 P2 `packages/coding-agent/src/core/agent-session.ts:3242` - Restore tools from checkpoint-only system state; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.
- #27 P2 `packages/coding-agent/src/core/session-manager.ts:1507` - Keep branch selection unchanged when summary append fails; gated_auto -> downstream-resolver; suggested_fix present; confidence 75.


## Full findings repair - 554a0504 working tree

Status: INCOMPLETE / BLOCKED. 38 of 39 source candidates repaired; 2 testing gaps repaired. Candidate #1 remains unfixed. Repair commit authorized by the latest user instruction; no push. This entry records pre-commit verification.

The 31 source candidates previously labelled unvalidated were independently source-validated before edits. This supersedes their prior validation state without rewriting historical review records.

### Candidate dispositions

| Candidate | Issue | Disposition |
|---|---|---|
| #1 | Clean Windows descendants on graceful and unexpected exits | BLOCKED. No Windows ownership primitive integrated. Rejected isolated Job proposal: owner-close is not descendant-exit proof; bootstrap gate can escape assignment; ACTIVE_PROCESS_ZERO notification can be missed. Needs a live completion authority, atomic suspended-child assignment and Windows execution. |
| #2 | Handle fatal reports after the child becomes ready | Fixed. Fatal after readiness invalidates reusable child and synchronously starts tree retirement before serialized actual-exit join. |
| #3 | Bound frames queued before WebSocket authentication completes | Fixed. Pre-auth queue bounded at 256 frames / 1 MiB; authentication deadline defaults to 10000 ms; late authentication cannot acquire a closed socket. |
| #4 | Capture execution before initial subscriber callbacks | Fixed. Initial subscriber callbacks receive the captured execution context and newMessages in both agent-loop entry paths. |
| #5 | Declare host placement in the Chord quickstart | Fixed documentation. Quickstart declares hostNamed placement; public guide smoke observed count [0,2]. |
| #6 | Use the server WebSocket acceptance helper | Fixed documentation. Server example imports/calls acceptWebSockets, not the client connector. |
| #7 | Register invocations before entering user callbacks | Fixed. Invocation reservation precedes user callback entry, including synchronous callback reentrancy. |
| #8 | Prevent raw aliases from stealing declared script names | Fixed. Declared script names are installed before non-conflicting raw aliases. |
| #9 | Stop live tool clocks when interactive mode stops | Fixed. Permanent interactive stop disposes owned live tool clocks and pending map; temporary handoff remains intact. |
| #10 | Retire image workers once without clearing their replacement | Fixed. Image worker retirement is once-only and exact-instance fenced against late old-worker exit. |
| #11 | Allow overlays beside and below Kitty image anchors | Fixed. Overlay physical text rows and image coverage are separate; disjoint overlays preserve placement, overlap hides/restores placements. Real Kitty not exercised. |
| #12 | Limit bulk none decisions to the displayed suggestion group | Fixed. Bulk none affects only visible done/none suggestions in the displayed category. |
| #13 | Package smoke passes without loading declared subpath exports | Fixed. Consumer smoke imports literal exported subpaths; missing transitive module negative case is rejected. Browser-only exception stays bundler-checked. |
| #14 | Do not cancel failure finalization on internal errors | Fixed. Internal provider cancellation does not cancel caller failure settlement; explicit caller abort still cancels both. |
| #15 | Preserve catalog freshness when hydrating reproducible builds | Fixed. Immutable catalog generation timestamp is canonical and preserved through hydration/Nix/release, not replaced with build time. |
| #16 | Validate externally refreshed derivations before publishing | Fixed. Externally refreshed derived values validate before publication. |
| #17 | Terminate externally held bindings when closing their host | Fixed. Host close is terminal; late acquisitions are fenced and external remote bindings terminate after resource cleanup. |
| #18 | Retire managed children when their IPC link closes | Fixed. Unexpected IPC close retires current instance and joins exit before replacement. |
| #19 | Join stopped tasks before replacing their native resources | Fixed. Stopped tasks retain only their intersecting native resources until actual settlement; bounded restart gate and no-owner eager cleanup preserved. |
| #20 | Decode implicit calls using current method projections | Fixed. Implicit-call decoding resolves arity from the current method projection. |
| #21 | Recognize regular expressions after statement blocks | Fixed. Scanner distinguishes statement blocks from expression braces and recognizes regex after blocks/else/do without treating division as regex. |
| #22 | Hydrate model data before the fresh checkout build | Fixed documentation. Fresh checkout uses npm run build for hydration; offline build requires prior hydration. |
| #23 | Invalidate response usage when the summary budget changes | Fixed. Request-owned summary IDs determine context usage applicability. Unknown provenance stays unknown; historical billed usage is unchanged. |
| #24 | Restore tools from checkpoint-only system state | Fixed. Tool restoration seeds from canonical checkpoint and replays visible later deltas. |
| #25 | Near-window branch summaries exhaust two-token output caps | Fixed. Branch-summary input budget reserves the full target output allowance and native adapter safety. |
| #26 | Raw-policy pruning discards history before redaction can shrink it | Fixed. Policy conversion runs once before atomic-group pruning; redaction can shrink retained history and system authority remains ordered. |
| #27 | Keep branch selection unchanged when summary append fails | Fixed. Branch selection is published only after the summary append succeeds. |
| #28 | Do not cancel in-flight refresh rotation during sign-in | Fixed. Dispatched refresh rotation persists under lock despite UI cancellation; discovery/browser remain cancellable. |
| #29 | Standalone codemode advertises unregistered model tools | Fixed. Public createModelTools supports explicit standalone companion composition; tools-only callers set models:false. |
| #30 | Colliding normalized names disable all durable scripts | Fixed. Collision-safe deterministic allocation is shared by persisted start, prompt, namespace/search/describe. Existing persisted maps remain authoritative. |
| #31 | Count late baselines outside the previous usage prefix | Fixed. Entry identities invalidate old measurement after a late leading baseline, including fixed-clock timestamps. |
| #32 | Avoid rescanning every cached context on each task transition | Fixed. Affected-scope maintenance, indexed idle heap and one earliest timer replace repeated global scans. Batched ancestry collapse handles cached 20000-deep chains. |
| #33 | Resolve Windows executables against the effective child PATH | Fixed source. Windows resolution uses effective merged/deduplicated child PATH. Windows runtime unavailable; platform tests skipped. |
| #34 | Use fish-compatible forwarding for login-shell daemon launches | Fixed source. Fish-compatible login forwarding and family-specific deployment/probe dispatch. Fish unavailable; platform tests skipped. |
| #35 | Contain terminal output callback failures | Fixed. onData exception aborts only that terminal and exited preserves the exact first thrown value, including falsy values. |
| #36 | Accept package-keyed npm pack output in the catalog gate | Fixed. npm pack accepts sole-array or exact expected-package-keyed result with validated name/filename and path safety. |
| #37 | Clear superseded results before starting another triage attempt | Fixed. Retriage clears obsolete result/time before queuing without changing decisions. |
| #38 | Keep keyboard selection attached to the selected issue | Fixed. Keyboard selection tracks issue identity across regrouping and clears on removal; pending decisions suppress duplicates. |
| #39 | Reject stale issue snapshots before replacing live state | Fixed. Request generations and mutation invalidation reject obsolete issue snapshots. |

### Testing gaps

- Tokenizer completion now drives requestRender and captures the actual footer frame; the assertion no longer relies on an unrelated manual redraw.
- Model switch across awaited authentication retains both model identity and maxTokens=1600 in the oracle.

### Verification

- Final post-followup isolated ./test.sh on all 90 owned paths plus this ledger: 12787 passed / 0 failed / 947 skipped, exit 0; artifact://12517, job bg_685, 230.80 seconds. External PI_ENV_DAEMON and CARGO_TARGET_DIR avoided protected target writes. Earlier pre-followup run was 12777/0/947 (artifact://12466). A 120-second tool deadline interrupted bg_684 before total output; it is not counted as a completed suite.
- Initial full run: 11303 passed / 4 failed / 943 skipped; artifact://12451. Four integration regressions were corrected: no-owner retirement microtask delayed native unregister; honest native output usage changed the prefill oracle; repeated scheduler ancestor traversal timed out two 20000-deep chains. Latest full run is green. No timing threshold was changed.
- Mandatory npm run check: 1979 files, No fixes applied; dependency/import/entry-graph/install-lock/type/browser-bundle checks passed. This check does not prove browser visual correctness.
- Focused tests: manager 20 passed / 2 Windows skips; Chord 174 passed / 2 skips; agent 157; coding-agent 206; durable 259; scheduler deep/ownership/retention/index 85; codemode 199; OAuth 29; MCP 16; env 23 / 4 skipped; issues 6; interactive 27; TUI 43; release scripts 29; hydration 34; remote freshness 12; Rust 20. Counts are separate focused runs, not additive to the full-suite total.
- Public guide runtime smoke returned {"count":[0,2]}. Catalog immutable HEAD returned 200 and Last-Modified matching pinned generatedAt.
- Scheduler paired 10000-cycle measurement: baseline retained 50947 ms vs patched 18289 ms; zero-retention 18275 vs 18849 ms; late transition 21.487 vs 2.609 ms; heap 49.7 vs 50.2 MiB. One paired workload, not a platform-wide guarantee.
- Simplification: 4 changes applied (abort-race reuse, one message-token count, attempt-local namespace name map, one overlay coverage computation); 2 suggestions rejected because task sets/maps have separate ownership roles and regression comments retain traceability.
- No Windows, fish, real Kitty or Nix runtime. Windows PATH/fish implementations have skipped platform tests, not executed passes. Kitty has virtual-terminal/protocol proof, not real graphics proof. Browser helper failed with __omp_display__ runtime error; fallback CLI opened only about:blank then was closed. No actual issue-UI browser smoke is claimed.

### Independent repair-diff review

- Frozen scope: HEAD 554a0504 -> 86 owned repair paths, including complete new test additions; historical ledger excluded. All 11 selected reviewers reached usable terminal completion and reported exact 86-path source inspection. No failed reviewer, malformed finding, quote/confidence suppression or external peer job.
- Nine raw candidates -> seven distinct after merging two semantic duplicate pairs with reviewer/evidence union. One fresh independent validator accepted five and rejected two as pre-existing coverage limitations. No cross-family shortcut. Full details: `/tmp/pi-full-findings-fix-4ca37d63/review`.
- Applied review #1: shared credential-store settlement joins detached sign-in refreshes during session shutdown and CLI teardown. Settlement tracks finite promises, removes fulfilled/rejected operations and is not awaited inside lock callbacks. Regression proves cancellation returns while drain stays pending, then resolves after refresh-2 is saved.
- Applied review #6: logout deletes credentials under the same per-server refresh lock; both CLI and interactive callers await removal. Delayed-refresh/logout regression failed before the fix with resurrected access-2/refresh-2, then passed.
- Applied review #4: disable priority/category/bulk controls synchronously through authoritative refresh; event-entry guards preserve disabled semantics. Keyboard repeats remain suppressed. No implicit queued decision behavior added.
- Applied review #5: root test:scripts now includes nested UI tests and runs triage through its existing source resolver. Observed 93 + 1 script tests passed, including all seven nested issue tests.
- Applied review #2: deterministic WebSocketLike tests accept exactly 256 frames / 1 MiB and synchronously close on first excess with receive queue overflow. They do not depend on the authentication timer. Real-socket late-auth cases remain.
- Rejected review #3: partial-viewport Kitty overlap was already skipped by opaque image-row composition at baseline; retained as pre-existing limitation. Rejected review #7: source-only Workers guard does not establish an installed-graph guarantee, but no new shipped failure was demonstrated; retained coverage limitation.
- Post-followup validation: OAuth/store/CLI/extension 58 passed; WebSocket 14 passed; issue UI 6 passed; scripts 93 + 1 passed; npm run check passed with No fixes applied. Final isolated full suite: 12787/0/947, artifact://12517, exit 0. This supersedes the earlier pre-followup 12777/0/947 run.
- Final product/test/docs inventory is now 90 owned paths plus this ledger, because followups added root test discovery and three MCP consumers/tests. No dependency version or lockfile change.
- Self-review: one shared credential lifetime rather than per-caller duplicate trackers; asynchronous remove contract and all six LSP references migrated; no lock callback calls settled; shutdown aborts and joins outer actions before draining. Auth/concurrency changes remain priority diff-review surfaces despite green tests.

### Remaining blocker and delivery status

Original #1 is still P1 and unfixed. The isolated Windows Job prototype was not integrated: owner death lacks surviving descendant-exit join authority; the pre-assignment bootstrap gate can survive outside the job; completion-port ACTIVE_PROCESS_ZERO notification is not guaranteed. A safe atomic suspended-child/job assignment and independently surviving completion authority, exercised on Windows, remain prerequisites. Non-Windows suite success does not discharge this item.

Status: INCOMPLETE / BLOCKED, not fix-all complete and not merge approval. A post-commit full merge plus subsequent-diff review was explicitly requested and will be appended separately.


## Post-commit complete merge review - 63b666a45

**Scope:** `839dc79197595a4285d711e37d02fb623e5b6b7b` -> `63b666a4503aed3d2237697746f1c9a590321d81`, 1536 changed paths. Includes upstream merge and every later repair commit, not only the latest 90 repair files.
**Intent:** Preserve intentional Crystal behavior while checking current provider/session/tool, storage, UI and resource ownership contracts.
**Mode:** markdown report-only. No product fixes were applied after this repair commit.
**Commit:** `63b666a45` - fix: repair validated merge lifecycle and consumer defects. No push.

**Reviewers:** Ten correctness slices (ai, agent, chord, durable, env, session, interactive, integrations, tooling, docs), project-standards, testing, maintainability, agent-native, security, performance, api-contract, data-migration, reliability, adversarial, julik-frontend-races, deployment-verification-agent.
- Testing covers changed assertions/harnesses; maintainability covers structural changes; agent-native covers tools/MCP; security covers auth/trust/public inputs; performance covers streaming/cache/wake complexity; API covers external contracts; reliability covers async ownership/timeouts.
- Data migration and deployment are selected by actual changed migration artifacts, not prompt prose: Chord SQLite migrations, durable SQLite migrations/schema, legacy-v3 JSONL conversion. Durable migration lines 94-106 create/copy/drop/rename a task table.
- UI races cover event/timer/recovery transitions. Local adversarial covers persistence/concurrency and silent-pass guards. External cross-model not started because host serving family is unattested; no cross-family independence claim.

### Triage Groups

| Group | Findings | Context | Preferred Resolution | Why |
|---|---|---|---|---|
| Runtime and resource ownership (apply-queue) | #2, #3, #4, #5 | Confirmed lifetime and shutdown ordering failures; Windows env defect differs from prior Chord manager blocker. | Stop duplicate terminal start; preserve candidate lifetime; close resources in reverse open order; implement real Windows process-tree ownership. | Each path needs actual owner/join semantics rather than suppression. |
| Chord input and result contracts (apply-queue) | #6, #7 | Confirmed schema coverage/normalization accept or reject wrong values. | Preserve union sibling constraints and explicit null inputs; verify via public acquisition/dispatch. | Public contract validation must describe actual accepted input and returned results. |

### P1 -- High

| # | File | Issue | Reviewer | Confidence |
|---|---|---|---|---|
| 1 | `.github/workflows/nix.yml:114` | Nix jobs discard the timestamp required by hydration | adversarial, correctness-tooling | 100 |
| 2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4921` | Avoid restarting an already-running terminal during shutdown recovery | julik-frontend-races, correctness-interactive | 100 |
| 3 | `packages/env/daemon/src/sys/windows.rs:542` | Preserve Windows descendants until shutdown cleanup completes | correctness-env | 75 |

- **#1** - Every Nix build job replaces the valid two-field catalog pin with a revision-only JSON object before evaluating the flake. The current derivation now reads modelCatalogPin.generatedAt, so normal PR, scheduled, manual, and release-tag builds fail with a missing-attribute error, and release tags can never advance stable. Forwarding the timestamp with the revision preserves the immutable catalog identity that the hydrator requires. Response: Expose generatedAt from the pin job alongside revision, pass both outputs into the build and commit-pin jobs, and write both fields when reconstructing nix/model-catalog.json at lines 114 and 175. On tag builds preserve the committed pin unchanged instead of rewriting it.
- **#2** - A failed signal-triggered shutdown starts the same live ProcessTerminal a second time, so each subsequent key is delivered twice and the original stdin/resize handlers remain registered. The signal branch has not stopped the TUI when it enters showShutdownRecovery; repeated failed recovery retries compound the listeners, and the eventual stop removes only the newest handlers and restores the second start's already-raw state. Recovery must distinguish a stopped interactive-quit renderer from the still-running signal renderer rather than unconditionally calling start(). Response: Track whether shutdown actually stopped the renderer and pass that state into showShutdownRecovery; call ui.start() only for the stopped interactive-quit path. On signal recovery and subsequent failed retries, replace the editor and request a render without starting the existing terminal again. Keep the fix local; no additional dependency is needed.
- **#3** - Closing a Windows connection can leave the command's subprocesses running. The job explicitly permits every descendant to escape, while shutdown starts taskkill asynchronously and immediately exits; job-handle closure can kill the tracked shell before taskkill enumerates its tree, leaving the escaped children without a live root to find. This contradicts the connection's promise to kill everything it started, even though these flags mirror libuv's deliberately weaker ownership model. Response: Use a daemon-owned job that retains descendants (remove silent/explicit breakaway permissions unless a documented separate detached-process capability requires them), and ensure shutdown waits for process-tree termination before exiting. Preserve per-command cancellation isolation; a per-command job whose handle is retained until its cleanup completes is the most robust default on supported Windows versions.

### P2 -- Moderate

| # | File | Issue | Reviewer | Confidence |
|---|---|---|---|---|
| 4 | `packages/chord/src/object.ts:2030` | Update lifetime eligibility when reusing objects across reloads | correctness-chord | 100 |
| 5 | `packages/chord/src/reload.ts:514` | Close dependent exclusive resources before their dependencies | correctness-chord | 100 |
| 6 | `packages/chord/src/schema.ts:142` | Preserve sibling constraints when comparing union schemas | correctness-chord | 100 |
| 7 | `packages/chord/src/schema.ts:47` | Preserve null contract inputs during normalization | api-contract | 100 |
| 10 | `scripts/issues/ui.html:102` | Keep decisions gated when another mutation skips their refresh | julik-frontend-races | 100 |

- **#4** - Changing an already-live referenced type to lifetime "host" fails as soon as its new factory registers a registry entry: register still sees the object's original false lifetime flag and aborts the reload. Conversely, an object changed from host to referenced retains permission to register. Reload explicitly supports these lifetime transitions, but only changes the service and lifecycle pin, not this eligibility flag. Response: Evaluate register eligibility against the service of the factory run being recorded (pass its lifetime into SelfImpl), and update the committed object lifetime at install. Keep prepare/abort from mutating the installed lifetime; cover both directions with a surviving external reference and registry entries.
- **#5** - Reloading two exclusive resources where B depends on A closes A before B, even though B was opened after A. A normal B.close that needs A.value then fails with not_ready, aborting an otherwise valid reload and potentially leaving external cleanup incomplete. The ordinary disposal and retirement paths already close resources in reverse open order; the destructive gate must use that same dependency-safe order. Response: Sort replaced resources by descending position in object.openOrder before closing them at the gate. Record their actual close order and reopen rollback resources in dependency/open order (reverse of that close order). Add a scenario where an exclusive dependent's close reads its dependency.
- **#6** - An incompatible same-version contract can pass coverage and reload checks when the consumer schema combines anyOf with a sibling validation constraint. For example, fits({type:"number"}, {anyOf:[{type:"number"},{type:"string"}], minimum:1}) returns true through the number branch, although 0 is valid only for the provider. In-process remote-contract consumers can consequently receive values outside their promised schema because direct dispatch validates the provider's schema, not the consumer's. Response: Do not discard sibling validation keywords when descending into sup.anyOf. Conservatively require equality when a union has unmodeled siblings, or check the siblings conjunctively in addition to branch containment. Cover results/state and same-version reload with the numeric minimum counterexample.
- **#7** - A contract declaring input: Type.Null() can be constructed and its typed host.get(token, null) call is valid, but acquisition always rejects invalid/input because normalization changes null to {} before checking the schema. A nullable object contract can instead select the empty-object instance when the caller requested the null instance. Preserving explicit null retains the declared input domain and distinguishes those identities. Response: Replace value ?? {} with value === undefined ? {} : value in normalize, so only omitted input receives the empty-object fallback; add a focused host acquisition scenario for Type.Null() and a nullable object union.
- **#10** - A decision can re-enable priority controls before its authoritative state has been fetched when a concurrent retriage or sync request is still pending. load() returns immediately while pendingMutations is nonzero, but the decision finally block nevertheless clears decisionPending; a second click derives its toggle from the old data and can send p0 again instead of clearing the successfully saved p0. Retriage and Sync remain reachable while a decision is pending, so this is not prevented by the disabled decision buttons. Response: Keep the decision gate latched until pendingMutations reaches zero and a fresh state response reflecting the decision has actually been installed. Centralize the final refresh/gate release in the last mutation completion (or serialize mutation completion and refresh), rather than interpreting a skipped load() as a completed authoritative refresh. Preserve the existing generation check and use the current counters instead of introducing a dependency.

### Actionable Findings

| # | File | Issue | Route | Notes |
|---|---|---|---|---|
| 1 | `.github/workflows/nix.yml:114` | Nix jobs discard the timestamp required by hydration | `manual -> downstream-resolver` | Independently validated; suggested_fix present; not applied |
| 2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4921` | Avoid restarting an already-running terminal during shutdown recovery | `gated_auto -> downstream-resolver` | Independently validated; suggested_fix present; not applied |
| 3 | `packages/env/daemon/src/sys/windows.rs:542` | Preserve Windows descendants until shutdown cleanup completes | `manual -> downstream-resolver` | Independently validated; suggested_fix present; not applied |
| 4 | `packages/chord/src/object.ts:2030` | Update lifetime eligibility when reusing objects across reloads | `gated_auto -> downstream-resolver` | Independently validated; suggested_fix present; not applied |
| 5 | `packages/chord/src/reload.ts:514` | Close dependent exclusive resources before their dependencies | `gated_auto -> downstream-resolver` | Independently validated; suggested_fix present; not applied |
| 6 | `packages/chord/src/schema.ts:142` | Preserve sibling constraints when comparing union schemas | `gated_auto -> downstream-resolver` | Independently validated; suggested_fix present; not applied |
| 7 | `packages/chord/src/schema.ts:47` | Preserve null contract inputs during normalization | `gated_auto -> downstream-resolver` | Independently validated; suggested_fix present; not applied |
| 10 | `scripts/issues/ui.html:102` | Keep decisions gated when another mutation skips their refresh | `gated_auto -> downstream-resolver` | Independently validated; suggested_fix present; not applied |

### Unvalidated source candidates - not confirmed findings

These 18 have source-review evidence but were outside the one eight-finding independent validator batch. They are not cleared, not confirmed, and not in the validated actionable queue. Stable candidate numbers are retained.

| Candidate | Severity | File | Source claim |
|---|---|---|---|
| #8 | P2 | `packages/client/README.md:23` | Declare the documented presentation host as a client |
| #9 | P2 | `packages/coding-agent/src/core/export-html/index.ts:199` | Key exported builtin renderings by owning message |
| #11 | P2 | `packages/ai/src/api/classifier-shared.ts:95` | Retry Decisions transport failures within the configured retry policy |
| #12 | P2 | `packages/chord/docs/guide.md:606` | Configure a loader before the plugin loading example |
| #13 | P2 | `packages/chord/src/connection.ts:930` | Stage new remote contracts during coordinated breaking reloads |
| #14 | P2 | `packages/coding-agent/src/core/remote-catalog-provider.ts:226` | Personalize OpenRouter even when the optional catalog is down |
| #15 | P2 | `packages/coding-agent/src/core/sdk.ts:368` | Assemble identity headers before invoking header hooks |
| #16 | P2 | `packages/coding-agent/src/experimental/services/connection.ts:156` | Preserve cancellation while hydrating attached session services |
| #17 | P2 | `packages/coding-agent/src/experimental/services/connection.ts:78` | Join shared-host cleanup when disposing the client runtime |
| #18 | P2 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:373` | Apply tool argument deltas without rescanning growing prefixes |
| #19 | P2 | `packages/coding-agent/src/extensions/codemode/tool.ts:131` | Keep model API help reachable without file-reading tools |
| #20 | P2 | `packages/durable/src/harness/scheduler.ts:506` | Avoid full live-task scans on every wake update |
| #21 | P2 | `packages/env/daemon/src/list.rs:98` | Enforce hidden exclusion independently of gitignore negations |
| #22 | P2 | `packages/env/daemon/src/main.rs:478` | Keep blocking FIFO operations off the shared file pool |
| #23 | P2 | `packages/env/package.json:27` | Daemon tests build outside the pinned Rust toolchain directory |
| #24 | P2 | `packages/env/src/ssh.ts:460` | A newer connection deletes a pending connection's daemon |
| #25 | P2 | `packages/tui/src/tui-main-screen.ts:633` | Preserve horizontal image offsets when restoring overlay placements |
| #26 | P3 | `packages/ai/src/utils/transcript.ts:184` | Remove compatibility-only helper after the clean cutover |

Each candidate retains full why_it_matters, evidence and suggested_fix in unvalidated-candidates.json. #26 is a scoped clean-cutover standards claim, not proof that deleting an external API is harmless; external consumers were not enumerated.

### Testing and advisory dispositions

- Counts: **31 raw = 26 source candidates + 2 semantic duplicates + 2 testing-only gaps + 1 P3/50 standards advisory suppressed**. Of 26 source candidates: **8 independently accepted / 18 unvalidated**. No malformed return/finding or missing-detail drop. No P0. All three P1 selected and accepted.
- Nix timestamp reports share one defect and fix; terminal restart P1/P2 reports share one defect and fix. Reviewer/independent-reviewer sets and all source evidence were unioned before mechanics rerun. Distinct Windows env and prior Chord-manager ownership problems were not merged.
- Testing-only native-platform CI gap (`packages/chord/test/manager.test.ts:152`): add actual macOS/Windows manager execution. Testing-only audit fixture gap (`scripts/npm-audit.mjs:55`): cover accepted GHSA/package pairing, mixed/indirect advisories, stale acceptance and malformed audit errors. Both arrived as structured P2/75 and are explicitly routed to testing_gaps under the absence-of-coverage soft-bucket rule, not claimed false, settled or implemented.
- Single-use expression helper suggestion (`packages/tui/src/terminal-image.ts:389`) is P3/50, below primary confidence gate. No undefined stable number leaks into primary/actionable output.
- Existing reported gaps include tool-argument work scaling, sleeping-population wake scans, codemode-only model-help discoverability, exported branch tool-call identity, attach cancellation and shared-host close joins. These remain candidates or advisory test scenarios as recorded, not silently treated as fixed.

### Deployment Notes

- Production NO-GO until an owner binds actual storage paths and proves backup/restore, migration-only comparison, production-sized time/disk headroom, exclusive ownership and unchanged namespace/prefix. Suggested checks were not executed against production.
- SQLite v2 rebuilds tasks and indexes atomically. Older schema-1 binaries reject v2; code-only rollback is insufficient. Restore a coherent WAL-aware snapshot, accounting for later writes and external tool effects. Compare sqlite_master, allocator metadata, exact task JSON/IDs, unrelated tables/indexes and absence of a temporary task table.
- Preserve legacy JSONL before its first non-empty upgrade commit. Compare selected leaf, IDs/reminted relationships, configuration/system/tool checkpoints and exactly-once usage across conversion/reopen. Actual production conversion and native Workers transactions/alarms were not exercised.
- Observe telemetry flush/close rejection as well as dropped counters. Full operational checklist and SQL are in deployment-verification-agent.json.

### Coverage

- All 22 successful launches reached usable terminal completion before synthesis; zero failed/timed-out reviewer. One concurrent harness task batch plus blocking collection was used. Async launch receipts were never counted as completion; no detached shell reviewer, status polling or partial-roster synthesis.
- Correctness partitions account for all 1536 paths exactly once. Conservative current-source evidence establishes some semantic ranges in **407** assigned paths; **1129** have no separately established current-source semantic range. Diff/document/hunk review also occurred. **1109** paths retain at least one reviewer-declared insufficient range. These sets overlap; neither inventory nor hunk traversal is whole-path clearance.
- Assigned / some current-source semantic ranges by correctness slice: ai 209/39; agent 52/28; chord 123/62; durable 231/89; env 38/37; session 132/37; interactive 108/19; integrations 250/44; tooling 135/41; docs 258/11. Exact arrays, source windows, missed ranges and reasons remain in coverage-audit.json and each report.
- One deterministic independent validator batch accepted #1/#2/#3/#4/#5/#6/#7/#10, rejected zero. Zero cross-family shortcuts. Eighteen unselected source candidates explicitly remain unvalidated; overall coverage/validation is degraded despite complete reviewer lifecycle.
- Graph discovery failed with WeakMap keys must be objects or non-registered symbols. Current source/history and available parent LSP were fallback; child source/text tracing does not establish exhaustive dynamic/external caller coverage. No requirements plan was established; settlement suppression not evaluated.
- Repair commit verification: isolated ./test.sh **12787 passed / 0 failed / 947 skipped**, exit 0, artifact://12517 (bg_685); npm run check and pre-commit hook: **No fixes applied**. These prove executed paths, not absent workflow or platform defects.
- Actual review smoke executed the workflow build pin shell step in an isolated directory with GITHUB_REF_TYPE=tag. It wrote revision only and dropped committed generatedAt=2026-10-21T12:12:47.000Z. Nix package line 47 requires that field. Both workflow writers were source-inspected; native Nix was not available.
- No Windows, fish, native Nix, real Kitty or actual issue-UI browser validation. No paid cloud-provider execution. Prior known Windows Chord-manager #1 was not rediscovered by the blind reviewers and therefore has no new report number; it remains independently recorded **unfixed/blocked**, not discharged by omission or green non-Windows tests. New #3 is the separate env-daemon Windows breakaway/shutdown problem.
- Post-commit review changes only this ledger. HEAD/branch/my-merge/crystal refs, empty index, full source manifest and all 749 protected hashes are checked after append; exact receipt is preservation.json. No product source change, dependency/lockfile change, push or follow-on fix commit.
- Artifacts: `/tmp/compound-engineering-501/ce-code-review/20261029-postcommit-63b666a4`. Complete full diff/manifest, 22 reports, source detail map, mechanics, semantic/test disposition, eight verdicts, unvalidated candidates, operational outputs, actual smoke, report and metadata.

---

### Verdict

**Not ready.** Address #1 Nix pin serialization, #2 terminal recovery start ownership and #3 env Windows tree shutdown first; then five confirmed P2. Prior Chord-manager Windows #1 also remains blocked. This is complete-scope but partial-source/validation-degraded review, not fix-all completion or merge approval. No post-commit product fixes were applied.

### Actionable Findings recap

- #1 P1 `.github/workflows/nix.yml:114` - Nix jobs discard the timestamp required by hydration; manual -> downstream-resolver; suggested_fix present; confidence 100.
- #2 P1 `packages/coding-agent/src/modes/interactive/interactive-mode.ts:4921` - Avoid restarting an already-running terminal during shutdown recovery; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #3 P1 `packages/env/daemon/src/sys/windows.rs:542` - Preserve Windows descendants until shutdown cleanup completes; manual -> downstream-resolver; suggested_fix present; confidence 75.
- #4 P2 `packages/chord/src/object.ts:2030` - Update lifetime eligibility when reusing objects across reloads; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #5 P2 `packages/chord/src/reload.ts:514` - Close dependent exclusive resources before their dependencies; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #6 P2 `packages/chord/src/schema.ts:142` - Preserve sibling constraints when comparing union schemas; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #7 P2 `packages/chord/src/schema.ts:47` - Preserve null contract inputs during normalization; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.
- #10 P2 `scripts/issues/ui.html:102` - Keep decisions gated when another mutation skips their refresh; gated_auto -> downstream-resolver; suggested_fix present; confidence 100.



## Post-commit review repair - 63b666a45 working tree

Status: INCOMPLETE / BLOCKED overall. Of this round's 26 source candidates, 24 have retained implementation and local behavior verification, #3 has a retained cross-compiled Windows implementation without native execution, and #13 remains unimplemented. Both testing gaps are addressed. Original Chord-manager Windows #1 remains a separate unfixed blocker. No push.

The 18 previously unvalidated source candidates were independently source-validated before mutation. Their prior historical labels remain unchanged above. Source-confirmed is not runtime-confirmed; #26 is a clean-cutover rule issue, not a runtime bug. Testing raw IDs 15/29 refer to native CI/audit coverage, not source #15 headers.

### Source dispositions

| Candidate | Issue | Disposition |
|---|---|---|
| #1 | Nix jobs discard the timestamp required by hydration | Fixed and runtime-checked. Carry generatedAt through both workflow jobs; release tags keep committed pin byte-for-byte. Actual workflow shell and local bare Git publication fixtures pass. |
| #2 | Avoid restarting an already-running terminal during shutdown recovery | Fixed. Restart recovery UI only if interactive quit stopped it; real ProcessTerminal listeners/raw-mode and repeated retry regression red 2 -> green 20. |
| #3 | Preserve Windows descendants until shutdown cleanup completes | Implemented, platform proof BLOCKED. Atomic CreateProcessW JOB_LIST per command, noninheritable kill-on-close job, ActiveProcesses join; removes taskkill/global breakaway. Windows GNU tests type-check and independent audit pass; actual Windows execution unavailable. |
| #4 | Update lifetime eligibility when reusing objects across reloads | Fixed. Candidate factory registration uses candidate service lifetime; committed object lifetime changes only at install. Abort retains old lifetime and registry. |
| #5 | Close dependent exclusive resources before their dependencies | Fixed. Close replaced exclusive resources in reverse actual openOrder using a Set; rollback reopens dependency order. |
| #6 | Preserve sibling constraints when comparing union schemas | Fixed. anyOf with sibling validation constraints requires exact equality conservatively; result/state binding and reload regressions reject widening. |
| #7 | Preserve null contract inputs during normalization | Fixed. Only undefined receives object fallback; null acquisition and null/object identities remain distinct. |
| #8 | Declare the documented presentation host as a client | Fixed active docs. Presentation host declares kind client; real native Chord handshake/call smoke returned 23. |
| #9 | Key exported builtin renderings by owning message | Fixed. Assistant owner plus call ID keys HTML/components/state; result-entry keys and selected-branch ancestry resolve output/status/images. Actual viewer builtin/custom/fallback red 3 -> green 17. |
| #10 | Keep decisions gated when another mutation skips their refresh | Fixed. Decisions remain gated until newest authoritative snapshot installs, even across overlapping mutations. HTTP/network refresh errors are visible; Sync retries state without another mutation. Ten UI cases pass. |
| #11 | Retry Decisions transport failures within the configured retry policy | Fixed. Normalize fetch/body transport failures for bounded retry; abort, malformed JSON and hooks remain terminal. AI retry/replay 31 pass. |
| #12 | Configure a loader before the plugin loading example | Fixed active docs. Plugins snippet configures nodeLoader; actual temporary facet URL load/reload smoke passes. |
| #13 | Stage new remote contracts during coordinated breaking reloads | BLOCKED / NOT IMPLEMENTED. Protocol-7 proposal was fully rolled back. Candidate-reference ownership and child abort completion need a complete coordinated protocol design; no partial frames, candidate views or tests landed. |
| #14 | Personalize OpenRouter even when the optional catalog is down | Fixed. Optional catalog overlay failure does not prevent independent OpenRouter personalization. Saved personal data remains if personalization fails; abort prevents publication. |
| #15 | Assemble identity headers before invoking header hooks | Fixed. before_provider_headers observes identity defaults beneath configured case-insensitive precedence; documented null suppression preserved, no new delete-property contract. |
| #16 | Preserve cancellation while hydrating attached session services | Fixed. Individual attachment waits race caller abort without cancelling shared hydration; all capability acquisitions receive the caller signal. |
| #17 | Join shared-host cleanup when disposing the client runtime | Fixed. Shared-host close promise is owned/observed and joined by runtime dispose after client disconnect, including delayed/rejected cleanup. |
| #18 | Apply tool argument deltas without rescanning growing prefixes | Fixed common streaming hot path. Parser/reducer expose snapshot-consistent touched edits; ordinary object strings append without prefix rescans. Exceptional scalar/deep/credit-lag frames reconcile exact preview. First hydrated argument delta reconciles to avoid lost prefix characters. |
| #19 | Keep model API help reachable without file-reading tools | Fixed discovery. Codemode-only loadout contains runnable classifier/image help without requiring read/bash; examples executed using faux/local fixtures. |
| #20 | Avoid full live-task scans on every wake update | Fixed measured hot path. Indexed sleep deadlines and per-task wake invalidation avoid unrelated live-task scans while retaining paused/read-only/restart/registry/backwards-clock semantics. |
| #21 | Enforce hidden exclusion independently of gitignore negations | Fixed. hidden:false rejects dot/Windows-hidden entries independently of gitignore negation; selected hidden root stays traversable. |
| #22 | Keep blocking FIFO operations off the shared file pool | Fixed Unix read boundary. Bounded quick/slow raw-open helpers preserve real FIFO rendezvous and descriptor ownership; queued/active cancellation uses standalone daemon-owned SIGUSR2. Ordinary file workers remain independent. Write-mode FIFO semantics unchanged. |
| #23 | Daemon tests build outside the pinned Rust toolchain directory | Fixed. npm daemon build runs Cargo in daemon cwd, discovering pinned toolchain; external CARGO_TARGET_DIR honored. Initial local mise shim failure required rustup PATH, not product fallback. |
| #24 | A newer connection deletes a pending connection's daemon | Fixed. SSH deployment retains other content hashes; every start revalidates its binary. Delayed first-start multibuild fixture preserves both connections. |
| #25 | Preserve horizontal image offsets when restoring overlay placements | Fixed. Kitty printable prefix origin flows through intersection/protected painting/retained restoration; padded colored Box anchor/continuation regressions pass. Real Kitty graphics not executed. |
| #26 | Remove compatibility-only helper after the clean cutover | Clean cutover. Removed public compatibility-only hasToolRedefinitions plus two helper-only assertions; hasNonAdditiveToolChanges behavior and released history retained. LSP found no production caller, not proof of external absence. |

### Verification and integration

- Final frozen-product isolated ./test.sh: **12864 passed / 0 failed / 948 skipped**, exit 0, job bg_783, artifact://13278, 289.68 seconds. SHA-256 manifests of all 64 product paths before and after execution match exactly; no product edits occurred during this final run. Earlier bg_780 reached 12864/0/948 (artifact://13263), bg_766 reached 12860/0/948 (artifact://13196), and bg_761 reached 12860/0/948 (artifact://13187); those are historical, not the final receipt. No paid provider calls.
- Mandatory npm run check: bg_784, 1979 files, **No fixes applied**; pinned/runtime deps, imports, entry graphs, install lock, TypeScript and browser bundle guard passed. This is not browser visual proof.
- Rust: 25 unit tests pass, Clippy --all-targets -D warnings passes, and final Windows GNU cargo check --locked --target x86_64-pc-windows-gnu --tests (bg_785) passes with existing pinned windows-sys plus Win32_Globalization feature. All Cargo targets are external under /tmp/pi-postreview-fix-63b666a4. No protected daemon target writes.
- Focused: retained Chord protocol-6 suite 854 passed / 2 Windows skips; real terminal recovery 20; provider AI 31 and coding-agent 67; export/MCP/whitespace 17; client lifetime 36; transcript 11; parser/frame 132; scheduler 116; TUI rendering 58; env 27 / 6 platform skips; scripts 108 + 1. Counts are separate runs, not additive to root total.
- Scheduler same 64-turn workload with 250/500/1000/2000 retained sleepers: baseline unrelated record.state reads 32000/64000/128000/256000, patched 0/0/0/0. Measurement is deterministic property visits, not a universal scheduler runtime claim. Temporary measurement file removed.
- Transcript baseline 50k write-style stream compared 39062496 prefix characters; 500k exhausted worker heap. Optimized 50k/500k workloads and exact per-frame preview cases pass. Array-string concatenation and exceptional full reconciliation retain their existing cost; universal linear allocation is not claimed.
- Docs smoke observed {"pluginLoadReload":true,"clientHandshakeAndCall":23}. Throwaway script removed; its initial fixture import error is not counted as product evidence. Workflow fixtures execute actual shell steps and local bare-Git publication without network.
- Native CI gap: macos-latest/windows-latest Chord job added; local Darwin command executed 854/2. Actual Windows CI was not triggered in this session. Audit gap: eight offline subprocess fixtures exercise acceptance identity, severity, indirect advisories, stale warning and malformed/top-level errors.

### Independent implementation audits and corrections

- Windows audit found cwd canonicalization resolving junctions and relative shell paths losing daemon-cwd anchoring. Both fixed, native fixtures added, Windows target recompiled, follow-up audit found no further concrete defect. Native Windows tests remain unexecuted. Minimum Windows 10 / Server 2016 and fail-closed job nesting requirement documented.
- Argument audit found checkpoint-credit-lag hydration losing pre-hydration characters. The exact 4096-element lag/hydrate/next-delta case failed before correction and passed after; first nonempty hydrated tool delta now forces reconciliation. Raw-only/empty deltas keep the alignment marker. Follow-up source audit is clean.
- FIFO audit found Darwin/device EOF readiness mismatch, descriptor close/reopen losing an empty writer rendezvous, and quick deferral before first syscall starving a regular open. Corrected with direct nonblocking reads, one real descriptor transferred after blocking open, and deferral only after an actual EINTR. Native fixtures cover 40 pending opens, queued/active cancellation, idle writer, 20 empty writers, intentional quick misclassification and initially deferred ordinary open. Final safety audit found no further concrete defect. SIGUSR2 handler ownership/mask/registration and raw libc::open EINTR behavior were reviewed; no process-wide handler is silently overwritten.
- Coordinated reload #13 did not converge: six baseline failures motivated protocol-7 staging; later audits found an unowned pending activation and an overbroad shared-activation join; after those corrections, immediate next-batch failure exposed missing remote abort completion. All protocol-7 product/tests/spec changes were restored to pre-#13 state, retaining #4-#7. Proposal, failures and audits remain only in scratch. No abort-ack scaffold or compatibility path landed.
- Simplification: three full-rubric reviewers completed. Applied three: one canonical renderer interface, unreachable branch removal, one reactor buffer for idle reads. Successful payload takes ownership of that buffer; only one idle scratch capacity is retained, not reuse across completed payloads. Initially skipped three optional event-channel/cache/navigation optimizations; the later independent latency finding justified and validated the bounded event-channel fix recorded below. Cache/navigation changes stayed out of scope.

### Platform limits and remaining blockers

- Original Chord-manager Windows #1 remains unfixed. No safe JS/native ownership primitive or Windows execution proof was introduced there.
- This round #13 remains a source defect, blocked on complete coordinated candidate/abort-completion protocol design. Runtime stays protocol 6.
- This round #3 source implementation is retained, cross-compiled and audited, but native Windows process-tree behavior has not run. Windows CI must exercise immediate descendants, normal leader exit, isolated cancellation, timeout, EOF and abrupt daemon death, Unicode environment, junction cwd and shell path parity.
- No Windows, fish, native Nix, real Kitty or actual browser visual verification. Virtual-terminal/protocol and actual export-viewer function execution are bounded evidence, not real graphics/browser clearance.

### Final retained repair review and followups

- Review scope: 63 frozen repair paths versus HEAD 63b666a45, not another whole-merge review. All 11 selected reviewers completed and all full artifacts/details were loaded before mechanics; zero failed reviewer or malformed return. Reported hunk/source coverage is bounded, not exhaustive unchanged-source or external-caller clearance. Graph WeakMap remains unavailable; current-source/history and parent LSP are fallback.
- 13 raw findings -> seven distinct primary candidates + five semantic duplicates + one testing-only DOM/cache gap. One independent validator accepted six (#1/#2/#3/#4/#5/#7), rejected #6 as an existing sibling-result rendering gap at baseline. No cross-family validation shortcut; host serving family is unattested, so only local adversarial coverage ran.
- Corrected final review #1: native Chord CI now builds telemetry before tests. A clean archive with no telemetry dist reproduced actual Node loader ERR_MODULE_NOT_FOUND; telemetry build followed by the same loader exited zero. Dependencies were linked from the existing install; no fresh npm ci or Windows CI execution is claimed.
- Corrected #2 and #5: identical ToolCallArgumentsStream.replace refreshes edits via append even for an empty suffix; authoritative toolcall_start/checkpoint/end expose undefined reconciliation rather than empty edits. New getter-driven regressions failed before fixes; parser/frame 134 passed afterward.
- Corrected #3 initially used the precise identity target type, then a narrow audit found that captured virtual selections could recreate attribution on the wrong physical provider. ModelsRequestTransforms.transformHeaders now receives the effective physical model after auth baseUrl resolution in both AI Models and coding ModelRuntime. SDK derives defaults from that argument, not the virtual selection. Two actual native SDK cross-provider cases failed before the fix; coding 55 and AI 85/1 focused tests passed afterward. LSP traced all 14 transform references. Subsequent audit found no concrete issue; auth-baseUrl override is source-traced, not independently exercised by the new virtual fixtures.
- Corrected #4: Nix fixture evaluates the supported actual workflow predicate and rejects unsupported expressions; branch input starts with a different committed revision/time, so skipped replacement is observable. Tag exact-byte preservation and actual shell/local Git publication remain covered. Isolated always-true and always-false mutations each failed the relevant tag/branch assertion with exit 1; neither modified product files.
- Corrected #7: helper completions and arrivals share one bounded reactor event channel; idle reactor blocks, active cancellation/reads retain periodic polling. New ordinary/error/cancellation completion tests pass without relying on a latency threshold. Same local 50 sequential ordinary reads measured 696.65 ms before and 12.91 ms after; one paired observation, not an SLA. Rust 25 and env 27/6 pass; narrow audit found no concrete regression. In-process idle drop would leave helper senders connected, but the standalone production path exits after serve; no embedding lifetime guarantee is added.
- Validator-rejected-as-introduced #6 was still fixed as a bounded pre-existing dependency followup: rerender each result from original owner arguments with fresh call/result components and state. Builtin edit success/error/pending sibling cases failed twice before and passed after. Public renderer signatures and provider toolCallId remain unchanged from this repair's owner-qualified cutover. Export/related consumers 43 passed; narrow audit is clean. Actual DOM navigation/cache behavior remains a testing limitation.
- Three narrow post-fix audits reached terminal completion. Getter audit's effective-target finding was fixed and re-audited; export and event-channel audits found no further concrete defect. Final root suite above was run after these product edits. No accepted incremental review finding remains unapplied.
- Final retained source/test/docs footprint: **64 owned product paths + this existing ledger**. Four new files (special.rs, native Windows process tests, Nix workflow fixtures, npm-audit fixtures) were explicitly staged for complete review capture; they are work-owned, not pre-existing index content. Unrelated cargo-fmt churn in frame.rs/pty.rs/watch.rs was restored to baseline; it changed no semantics. No dependency version, lockfile, released changelog or protocol-7 proposal is included. The existing windows-sys feature addition is explicit.
- Artifacts: `/tmp/pi-postreview-fix-63b666a4`; complete source dispositions/evidence matrix, validator packets, isolated implementation results, failing-before/passing-after observations, measurements, rejected protocol proposal, simplification decisions, full final review at `review/report.md`, mechanics, verdicts, narrow audits, verification and preservation receipts.

### Final status

**INCOMPLETE / BLOCKED**, not fix-all complete and not merge approval. Twenty-four of this round's source items have retained locally verified fixes, #3 has a retained cross-compiled Windows implementation without native execution, and #13 is unimplemented with its candidate protocol fully rolled back. Both testing gaps and all accepted final incremental findings are addressed. Original Chord-manager Windows #1 remains separately unfixed.

The authorized repair commit contains only the exact owned paths and this ledger, including the prior post-commit review append whose prefix is preserved. No push. HEAD/branch/my-merge/crystal, staged ownership, all 749 protected hashes and absence of protocol-7 assets are checked before committing; exact final receipt is preservation-final.json.


## Post-commit complete merge review - f3937b090

Status: DEGRADED validation gate / NOT READY. This new review covers the complete original merge and every follow-on commit from 839dc79197595a4285d711e37d02fb623e5b6b7b through f3937b090f5b4dd9949786837b45d9dda84bc2c5: 1541 changed paths. It is not a review of only the latest 65-path repair. Candidate numbers in this section belong to a new review namespace.

All 52 local reviewer jobs reached terminal completion. Aggregate changed-hunk inspection reached 1541/1541 paths after eight exact gap reviews covered the initial 211 omitted paths. Aggregate local adversarial inspection reached 1541/1541 through the initial 123 paths and 16 residual packets covering 1418. Individual security, standards, API and other risk lenses were prioritized and partial; complete path inspection is not exhaustive bug, unchanged-source, dynamic-caller or platform clearance. Graph project/generation discovery and coverage failed with the WeakMap error; source/history and available LSP fallback were used. No cross-model review ran because the host serving family was unattested.

Mechanics: 71 raw findings -> 60 distinct candidates after 11 semantic duplicate removals. Ten testing-only observations were separated before validation. One fresh source/history validator returned every one of the remaining 50 stable IDs exactly once: 44 accepted, six rejected. No cross-family shortcut. The 50-item batch exceeded the normal cap of eight with only seven P1 inputs. The bounded validation gate is therefore DEGRADED, not complete; these 44 source-supported candidates are not presented as canonically validated or universally runtime-reproduced. No follow-on split batch or additional validation-independence claim is made.

### Source-supported candidates - degraded validation

| # | Priority | Location | Observable issue and response |
|---|---|---|---|
| 1 | P1 | `packages/coding-agent/src/core/session-manager.ts:1512` | Partial JSONL append failure can corrupt a successful retained-record retry. Restore the prior file boundary before retry and latch unrecoverable repair failures. |
| 2 | P1 | `packages/env/daemon/src/exec.rs:327` | Unix shutdown can miss a process spawned before registration. Serialize exec/pty creation and registration against a stopping gate. |
| 5 | P1 | `packages/ai/src/providers/openrouter.ts:31` | Catalog personalization ignores replacement auth headers and sends the original stored key to a configured proxy. Carry effective auth headers/baseUrl with inference-equivalent precedence. |
| 6 | P1 | `packages/chord/src/host.ts:1217` | Pending remote bindings can resolve with an invalidated principal. Revoke pending bindings and fence route resolution before forwarding holds. |
| 7 | P1 | `packages/chord/src/host.ts:1383` | A dependency retains revoked privileges while holder cleanup stalls. Revoke all matching references/calls synchronously before ordered cleanup. |
| 8 | P2 | `packages/ai/src/api/openai-decisions.lazy.ts:5` | New inline dynamic import violates the active top-level import rule. Resolve the loader contract without inventing a blanket exception. |
| 9 | P2 | `packages/ai/src/telemetry.ts:192` | Cancellation during authentication is reported as provider failure. Preserve aborted classification across setup and telemetry. |
| 10 | P2 | `packages/ai/src/utils/assistant-message-frame.ts:265` | Encoder catch-up uses a parser that loses whitespace-preserving tool previews. Use matching incremental preview semantics. |
| 11 | P2 | `packages/chord/src/object.ts:1311` | New dependency methods fail in reload cell initializers because roots use the old version. Give initialization the pending-version context. |
| 12 | P2 | `packages/chord/src/reload.ts:423` | Exclusive dependency closes before its displaced nonexclusive dependent. Include affected dependents in reverse-open-order gate cleanup and rollback. |
| 13 | P2 | `packages/chord/src/schema.ts:233` | Tuple compatibility ignores additionalItems. Compare permitted tail policies before accepting result/state compatibility. |
| 14 | P2 | `packages/chord/src/sqlite/cloudflare.ts:69` | Buffer.slice exposes the pooled backing allocation as the blob. Copy the bounded Uint8Array view. |
| 15 | P2 | `packages/chord/test/flow.test.ts:266` | ACK and peer-role tests close for protocol mismatch before reaching their guards. Negotiate PROTOCOL_VERSION and assert the intended close reason. |
| 16 | P2 | `packages/codemode/src/source.ts:229` | A class-following regexp can hide a misplaced timeout directive. Track declaration-class closing braces as statement boundaries. |
| 18 | P2 | `packages/coding-agent/src/core/radius.ts:6` | Custom Radius login offers MCP against the default gateway. Resolve the live provider endpoint. |
| 19 | P2 | `packages/coding-agent/src/experimental/plugins/package.ts:81` | Plugin bundling ignores chord.facets overrides and false disables. Resolve configured entries before conventional fallbacks. |
| 20 | P2 | `packages/coding-agent/src/extensions/mcp/oauth.ts:226` | Refresh can restore credentials after sign-out with a custom backend and no lockDir. Serialize refresh/remove ownership in process. |
| 21 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:2913` | Reentrant dialog disposers mutate the iterated stack and skip cleanup. Detach the stack and settle/dispose entries idempotently. |
| 23 | P2 | `packages/durable/test/examples/22-subagent-background.ts:151` | Background-subagent example returns removed content rather than output. Migrate its shared reply helper. |
| 24 | P2 | `packages/env/daemon/src/exec.rs:397` | Large valid output windows create oversized frames and terminal E2BIG errors. Fragment output at UTF-8-safe payload boundaries with correct skipped metadata. |
| 26 | P2 | `packages/mcp/src/oauth/flow.ts:420` | Refresh-only cancellation falls through to browser authorization. Check the effective refresh signal in recovery. |
| 27 | P2 | `packages/tui/src/terminal.ts:529` | Abrupt exit leaves OSC 7501 status active. Include program-status clear in synchronous restoration. |
| 28 | P2 | `packages/tui/src/tui-main-screen.ts:515` | Overlays disappear over partially offscreen Kitty placements. Handle visible intersections and safe crop restoration. |
| 29 | P2 | `packages/tui/src/tui-main-screen.ts:580` | Overlay materialization discards text beside Kitty anchor controls. Preserve the text/style layer separately from graphics. |
| 30 | P2 | `scripts/biome-check.mjs:72` | Android WASM checking reads indexed paths deleted from the working tree. Exclude missing paths and isolate ENOENT. |
| 31 | P2 | `.github/workflows/nix.yml:171` | Pin publication can check out/rebase onto main newer than the verified source. Bind publication to the verified SHA and reverify advances. |
| 32 | P2 | `.pi/extensions/import-repro.ts:77` | Signed JSONL URLs with query parameters are rejected. Test URL.pathname while preserving query parameters for fetching. |
| 33 | P2 | `packages/agent/src/agent-loop.ts:514` | Tool-batch cancellation still reports canContinue true. Include the abort state in continuation eligibility. |
| 34 | P2 | `packages/agent/src/harness/pico3/chord.ts:330` | Projection failure silently freezes a held native Chord view. Publish terminal/fault state or replace/resnapshot the failed watch. |
| 36 | P2 | `packages/chord/src/cluster.ts:158` | Reconciliation retries prepare before asynchronous child rollback frees its reload slot. Add and await abort-completion ownership. |
| 37 | P2 | `packages/coding-agent/src/core/export-html/vendor/marked.min.js:39` | Task-marker processing modifies a later paragraph instead of its own task label. Match the inline-queue entry by its token ownership. |
| 38 | P2 | `packages/coding-agent/src/core/remote-catalog-provider.ts:210` | Cache-only refresh can restore a previous OpenRouter credential's personalized models/limits. Bind entries to credential and endpoint identity. |
| 39 | P2 | `packages/coding-agent/src/experimental/services/transcript-provider.ts:98` | Void watch adaptation loses async ordering during navigation rebase. Preserve completion ownership before releasing resumed events. |
| 40 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:1086` | Shutdown recovery can await dialogs while shutdown consumes all input. Cancel shutdown-time dialog requests rather than mounting unanswerable UI. |
| 45 | P2 | `packages/coding-agent/test/mcp-conformance/run.ts:168` | Conformance can pass after runner timeout/crash if success files already exist. Fail abnormal termination independently of those files. |
| 51 | P2 | `packages/durable/docs/spec.md:336` | Normative SubmissionDraft forbids supported custom InputEntry. Define and permit the implementation's entry contract. |
| 52 | P2 | `packages/durable/src/harness/partial-changes.ts:102` | Partial persistence replaces nonempty toolcall_start arguments with empty reconstructed arguments. Preserve authoritative initial arguments until parser alignment. |
| 53 | P2 | `packages/durable/src/harness/task-graph.ts:168` | Hydration scans conversations once per live task while holding the Session line. Scan pages once and group by owner. |
| 54 | P2 | `packages/durable/src/session/session.ts:1297` | Zero-limit scan raises TypeError and permanently fails the Session. Validate positive safe-integer limits as isolated request errors. |
| 55 | P2 | `packages/env/daemon/src/sys/unix.rs:270` | Relative configured shell can resolve to a different executable after cwd changes. Anchor the validated path against daemon cwd. |
| 56 | P2 | `packages/env/daemon/src/sys/windows.rs:368` | Daemon legacy-WSL recognition ignores custom SystemRoot unlike Node. Match SystemRoot-aware launcher classification. |
| 57 | P2 | `packages/env/src/connection.ts:300` | Ignored stdin failure can leave requests pending indefinitely while inbound pings continue. Tear down the failed write transport. |
| 58 | P2 | `packages/env/src/ssh.ts:347` | Git Bash SSH detection chooses a PowerShell launcher. Preserve the POSIX-on-Windows shell family. |
| 60 | P2 | `scripts/issues/ui.html:107` | Failed mutations are hidden by a successful state refresh. Check mutation status and preserve a separate visible mutation error. |

Every candidate above has a concrete suggested fix and downstream-resolver route in `actionable-findings.json`; classification is not permission to apply and the validation gate remains degraded. Stable numbering intentionally has gaps for rejected and testing-only candidates.

### Rejected candidates

| Candidate # | Reason |
|---|---|
| 3 | Strict complete daemon assets for local artifact packing are intentional and explicitly documented; do not weaken production artifact validation. |
| 4 | Bedrock unfinished-argument acceptance already exists at base 839dc791; no newly exposed behavior established by this finding. |
| 17 | Manual swipe usage double counting already exists at base 839dc791; not introduced or newly exposed by this diff. |
| 25 | External Cargo target restriction governs agent operations, not the product's documented default checkout build command. |
| 50 | Error-output paragraph was misread; it preserves schema-less error output and scopes omission to schema-declaring tools. |
| 59 | Disconnected handshake shutdown gap already exists at base 839dc791; no new interaction established. |

### Testing-only observations

These ten source-supported coverage observations were not put through the oversized validator and are not current product defects: #22 exported system rendering source-string assertions; #35 classifier offline cases skipped with cloud metadata; #41 presentation reload generation identity; #42 post-hydration multi-block continuation; #43 delayed clipboard completion after login transitions; #44 login timeout versus immediate failure; #46 replacement of an existing MCP cancellation handler; #47 healthy resources around a failed package install; #48 first-login configured model versus catalog order; #49 recovery summary/request byte limits. Full evidence and specific test responses are in `testing-only-candidates.json` and the report.

### Verification, limitations and preserved blockers

- Parent current-code smoke bg_799 ran the actual exported vendored parser in a VM. Input `- [ ] first` followed by a normal item and a `[ ] literal` continuation produced an extra task-label marker and removed the continuation marker, confirming #37. No product source changed. The prior committed-snapshot 12864/0/948 full suite and no-fix checks remain historical green receipts, not evidence that these new scenarios pass.
- Some first-wave reviewers ran scoped tests/runtime despite the final no-runtime instruction. Those results are reviewer observations, not parent-executed proof. Subsequent gap/adversarial and validator passes were static-only. No tracked/index/ref changes were observed before this ledger append; ignored caches/output were not exhaustively inventoried. One reviewer JSON artifact required escaping literal control characters; its author repaired serialization without changing findings or coverage.
- No fresh Windows, fish, Nix, real Kitty, actual browser graphics, production Cloudflare, live SSH or paid-provider verification. No implementation plan selected from ambiguous generic branch keywords. Ledger is historical output, not implementation requirements. Settlement suppression not evaluated. No PR previous-comments, Swift, migration or solutions-corpus lens.
- Original Chord Windows manager ownership remains unfixed. Coordinated breaking reload proposal remains rolled back at protocol 6. Env Windows implementation remains without native runtime proof. New #36 is child reconciliation abort completion, not closure of the larger coordinated-reload blocker.
- HEAD `f3937b090f5b4dd9949786837b45d9dda84bc2c5`, my-merge `cb3bee033ba853041609b874303dc625d5d30479`, and crystal `8322aa1d6808711a6e46bfbe67d8a788ca8cbd1e` are preserved. All 749 protected target hashes match. Only this requested ledger changed; no product fixes, new commit or push in this review.
- Prior focused parser/frame counts 132 and later 134 are separate recorded epochs; final historical root total is 12864, not the sum of focused runs.
- Complete diff, 52 reports, per-path ranges, normalized 1541/1541 ordinary/adversarial coverage, mechanics, 11 semantic merges, 50 verdicts, six rejection reasons, ten testing-only observations and degraded lifecycle metadata: `/tmp/compound-engineering-501/ce-code-review/20261030-postcommit-f3937b090`.

### Verdict

**NOT READY / VALIDATION DEGRADED.** Five P1 and 39 P2 source-supported candidates remain; no fixes applied. Resolve persistence #1, process shutdown #2 and authority/credentials #5/#6/#7 first. The oversized single-validator result does not constitute a canonical bounded validation pass. Existing Windows/protocol blockers remain. This section preserves the full scope and honest limitations rather than claiming fix-all or merge approval.


## Fix-all repair closure after f3937b090

User authorization: fix all findings from the preceding complete merge review. This is a repair batch, not a second 1541-path review. The historical sections above remain byte-for-byte unchanged.

### Disposition of all 44 source candidates

All 44 have retained implementations. Forty-three have focused local behavioral proof; #56 has Windows GNU test compilation only and remains blocked on native execution. The six rejected candidates from the preceding review remain rejected; no rejected behavior was silently implemented.

| # | Retained repair | Verification status |
|---|---|---|
| 1 | Rollback failed JSONL append bytes before retry; poison on rollback failure until atomic rewrite. | Focused behavior verified; final root receipt below |
| 2 | Serialize Unix exec/PTY creation and registration against shutdown stopping state. | Focused behavior verified; final root receipt below |
| 5 | Catalog refresh carries resolved auth headers/endpoint; null/case-insensitive precedence preserved. | Focused behavior verified; final root receipt below |
| 6 | Fence unresolved and active remote bindings, force-end calls, block reentrant acquisitions during invalidation. | Focused behavior verified; final root receipt below |
| 7 | Fence all authority before callbacks; collect every readable/listener cleanup error and dispose holders first. | Focused behavior verified; final root receipt below |
| 8 | Static top-level Decisions classifier binding after graph inspection. | Focused behavior verified; final root receipt below |
| 9 | Preserve setup cancellation through every lazy/Models/ModelRuntime/provider boundary. | Focused behavior verified; final root receipt below |
| 10 | Catch-up uses identical incremental tool argument semantics. | Focused behavior verified; final root receipt below |
| 11 | Private initializer context permits pending-only dependencies, joins descendants; current implementations win. | Focused behavior verified; final root receipt below |
| 12 | Gate closes displaced nonexclusive dependents before exclusive dependencies and restores dependency order. | Focused behavior verified; final root receipt below |
| 13 | Compare tuple tail additionalItems constraints. | Focused behavior verified; final root receipt below |
| 14 | Copy exact Uint8Array/Buffer view bounds. | Focused behavior verified; final root receipt below |
| 15 | Protocol fixtures negotiate actual protocol and assert intended guard rejection. | Focused behavior verified; final root receipt below |
| 16 | Class/member/initializer and object/property lexical phases avoid phantom class headers. | Focused behavior verified; final root receipt below |
| 18 | MCP endpoint comes from live Radius provider, not default/catalog. | Focused behavior verified; final root receipt below |
| 19 | Honor configured facet strings and false disables. | Focused behavior verified; final root receipt below |
| 20 | One in-process per-key refresh ownership queue, plus optional cross-process lock. | Focused behavior verified; final root receipt below |
| 21 | Detach/cancel every dialog idempotently, including custom deferred factories/overlays. | Focused behavior verified; final root receipt below |
| 23 | Background example returns output under current tool contract. | Focused behavior verified; final root receipt below |
| 24 | UTF-8 frame fragmentation; oversized windows use bounded passthrough/backpressure without invalid omission proof. | Focused behavior verified; final root receipt below |
| 26 | Respect effective refresh-specific cancellation without browser fallback. | Focused behavior verified; final root receipt below |
| 27 | Synchronous exit clears OSC7501 program status. | Focused behavior verified; final root receipt below |
| 28 | Restore supported partial Kitty placements by visible crop; no transcript replay. | Focused behavior verified; final root receipt below |
| 29 | Retain styled text beside image anchors and actual terminal columns. | Focused behavior verified; final root receipt below |
| 30 | Skip absent indexed files, propagate other WASM read errors. | Focused behavior verified; final root receipt below |
| 31 | Verify exact pin source SHA; never rebase unverified main; negative old-script fixture fails. | Focused behavior verified; final root receipt below |
| 32 | Signed JSONL URLs use pathname while preserving query/fragment. | Focused behavior verified; final root receipt below |
| 33 | Cancelled tool turns report no natural continuation and stop before explicit continuation/queue arbitration. | Focused behavior verified; final root receipt below |
| 34 | Watch terminal notification publishes explicit failed native view; version2 cutover, no automatic fake recovery. | Focused behavior verified; final root receipt below |
| 36 | Protocol7 aborted acknowledgement joins stale child reconciliation rollback; ordinary abort contract unchanged. | Focused behavior verified; final root receipt below |
| 37 | Rebuild pinned readable Marked source with small task-token ownership backport; vendor not hand-edited. | Focused behavior verified; final root receipt below |
| 38 | Persist non-secret auth/endpoint identity digest; offline pure derivation restores matching account only. | Focused behavior verified; final root receipt below |
| 39 | Own full async transcript handler/reset ordering and join shutdown tail. | Focused behavior verified; final root receipt below |
| 40 | Shutdown-time dialogs cancel before mount, preventing reactivation deadlock. | Focused behavior verified; final root receipt below |
| 45 | Abnormal runner completion cannot pass from previously written success reports; expected check failures remain baselined. | Focused behavior verified; final root receipt below |
| 51 | Normative InputEntry type matches actual custom input API. | Focused behavior verified; final root receipt below |
| 52 | Preserve authoritative nonempty tool start arguments through partial persistence/recovery. | Focused behavior verified; final root receipt below |
| 53 | One streamed paginated conversation scan, grouped by live task owner; no N+1 or all-record retention. | Focused behavior verified; final root receipt below |
| 54 | All scan families reject invalid limits as StorageRequestError without failing Session. | Focused behavior verified; final root receipt below |
| 55 | Anchor configured Unix shell before changing cwd. | Focused behavior verified; final root receipt below |
| 56 | SystemRoot-aware WSL launcher parity with native subprocess test matrix; not executed on Windows. | Cross-compiled; native Windows execution blocked |
| 57 | Write-pipe failure tears down session and reconnects next operation. | Focused behavior verified; final root receipt below |
| 58 | Detect actual outer cmd/PowerShell independently from child sh uname, retaining POSIX Windows startup. | Focused behavior verified; final root receipt below |
| 60 | Mutation failures remain visible independently of successful state refresh. | Focused behavior verified; final root receipt below |

### Disposition of all ten original testing-only gaps

| # | Executed behavioral coverage |
|---|---|
| 22 | Execute exported-viewer system-entry rendering; source-string assertions removed. |
| 35 | Run synthetic classifier, mocked routing and credential cases offline; remove incidental generated-catalog assertion rather than repinning it. |
| 41 | Activate generation-specific presentation fixtures after build/load/reload. |
| 42 | Retain hydrated replay instances and assert subsequent corrected multi-block frames. |
| 43 | Deferred clipboard success/failure across cancellation, focus and authentication transitions. |
| 44 | Await a real initialize request, assert login is pending and the deadline factory receives 50 ms, then abort that controlled deadline and assert its specific diagnostic. Other timeout signals retain native behavior. |
| 46 | Replace an existing cancellable status and prove its previous callback is removed. |
| 47 | Activate healthy local resources before and after a failing offline package installation. |
| 48 | Select the configured post-login default from an alternative-first catalog. |
| 49 | Bound Copilot overflow-summary normalized context to 32 MiB; retain the newest fitting distinct images and leave stored history unchanged. This is not an exact wire-body guarantee. |

### Independent repair review and followups

- Eighteen local reviewers completed the frozen 114-product-path repair review. Every assigned path was reported inspected; no reported insufficient path. Subsequent source/caller/test changes received narrow independent audits; the initial snapshot is not claimed to cover future edits.
- Fifteen raw findings became ten distinct after five semantic merges: seven source findings and three testing-only observations. A single bounded validator batch of seven, below the normal cap of eight, accepted all seven source findings. The earlier oversized full-merge validator remains historically degraded; this smaller pass does not rewrite that history.
- All seven were applied: active remote-call revocation, fallible readable cleanup, reentrant gone/abort authority fences, public custom-result cancellation types, Kitty viewport-only restoration without history duplication, object-property scanner phases, and SSH outer-shell classification.
- Further independent checks exposed and closed fresh-root dispatch from abort observers, reentrant local/remote acquisition during revocation, custom onHandle cleanup, unbounded output-window buffering, native watch registration after stop, and scanner class/member edge cases.
- The three new testing gaps now cover all Pico watch terminal outcomes, distinct chronological Copilot image retention, and transcript failed-resnapshot/close ordering. Narrow final audits report no remaining new actionable finding. These are local independent reviews, not cross-model certification.
- Full-suite failures prompted semantic fixture repairs, not skipped tests or larger test timeouts: journal synchronization now awaits actual failed Harness closure; restart timeout asserts the naturally persisted deadline and advances the injected clock; resize uses a proportionally smaller image with explicit limits and the same coordinate mapping. The reviewer rejected manufacturing a stored deadline; that intermediate fixture was replaced and the final audit is correct.

### Public cutovers and maintenance decisions

- Chord protocol 7 adds child abort-completion acknowledgement solely for stale reconciliation retry. Ordinary abort rejection semantics are unchanged. This does not implement the larger coordinated breaking-reload candidate protocol.
- Pico conversation publication is version 2 and explicitly live or failed. A failed watch cannot advertise its last revision as live; no automatic fake recovery. Owners reacquire.
- Extension custom UI returns Promise<T | undefined>; runner, RPC/mock implementations, maintained examples and documentation all migrate together. Shutdown and late factories settle cancellation and dispose mounted surfaces.
- Marked remains pinned to 18.0.11. A reproducible generator reads readable upstream Tokenizer source from its installed source map, verifies source SHA 2140b1d34433b175421ca86d8d847e429a48556cc40be7b853e45d697699335a, applies the task-token ownership backport, and bundles with the existing esbuild dependency. The vendored output is generated, not hand-edited; no new dependency or viewer inline-queue hook.
- OpenRouter cache identity is a non-secret digest of effective authentication and endpoint. Offline restore uses a pure cached-auth resolver, never arbitrary commands, network or OAuth refresh.
- Supported Kitty PNG/RGB/RGBA and registered geometry use viewport-only cropped restoration. Unknown custom placements without recoverable geometry are retained rather than deleted/replaying scrollback; overlays cannot fully occlude those placements. Real Kitty graphics were not executed.
- Non-main branch: no changelog entries. Existing public/API documentation is updated in the owning package.

### Verification receipts

- Exact final authoritative command: `PI_ENV_DAEMON=/tmp/pi-fixall-f3937b090/cargo-target/debug/pi-env ./test.sh`, through rtk proxy. bg_901 / artifact://14373: **13034 passed, 0 failed, 938 skipped**, exit 0, 379 seconds. Isolated HOME/credentials/network policy; cloud providers disabled. No concurrent parent check or other test. All 130 product-path SHA-256 values match the pre-run freeze.
- `npm run check` bg_900: **No fixes applied**; pinned/runtime dependencies, relative imports, entry graphs, install-lock, TypeScript and browser smoke all passed. The commit hook repeats this against the docs-inclusive candidate.
- Earlier root epochs remain failures: bg_887 13000/3/938, bg_897 13023/11/938. The latter overlapped parent check and showed startup/worker/benchmark timing failures; resource contention is an inference, not a proven sole cause. No unrelated benchmark threshold or subprocess timeout was relaxed. Exact final isolated run is the green receipt.
- Native Rust bg_851: 31 passed. Final `cargo clippy --all-targets -- -D warnings` bg_902 passed. Windows GNU `cargo check --tests` bg_889 passed; no Windows binary was executed. Cargo used the external scratch target, never the protected checkout target.
- Latest focused followups: authority 18, custom UI 51, TUI 69, Pico terminal outcomes 20, transcript shutdown/failure 14, Copilot retention 3, scanner 15, natural-deadline/journal 2, bounded real-image resize 1, controlled login deadline 1. These are separate runs and are not added to the root total.
- Real Chromium loaded the actual issues UI against a controlled local server: mutation HTTP 503 stays visible after a successful refresh; successful retry clears it; desktop and 390px viewport had no console errors or horizontal overflow. Tab/server closed. This is not production GitHub proof.
- Actual offline background-subagent example bg_896 executed spawn/send/stop/status/missing-name operations and restart. Status and “No subagent named missing” reached the model-visible result. Faux provider only; no paid requests.
- Generated Marked check bg_891 and browser-global/CommonJS/AMD runtime contracts passed; six export tests passed 84 cases. Final commit does not hand-edit generated vendor bytes.
- Full receipts and 44-source/10-gap dispositions: `/tmp/pi-fixall-f3937b090`. Independent repair report: `/tmp/pi-fixall-f3937b090/ce-code-review-final/report.md`. Final exact source freeze: `exact-final-product-hashes.json`.

### Preserved limitations and blockers

1. Original Chord Windows manager ownership is still unfixed. PID/taskkill enumeration does not establish atomic descendant ownership or manager-crash cleanup. No incomplete shim or failed historical prototype was landed.
2. Larger coordinated breaking reload is still unimplemented. Private remote candidate references and cross-host activation/commit-abort ownership require a coherent contract; protocol 7 reconciliation acknowledgement is not that contract.
3. Env Windows native execution remains unavailable on this Darwin arm64 host, with no configured SSH runner. GNU compilation is not native proof. #56 SystemRoot-aware WSL classification is implemented with authored native regressions but shares this missing execution proof.

No fresh native Windows, real Kitty, fish, Nix publication, production Cloudflare or live SSH certification. Controlled browser/VM/subprocess/faux-provider results are scoped to the actual scenarios below, not substitute native evidence. Graph project/coverage tools failed with WeakMap errors; exact source, history and available LSP references were used, without claiming external or dynamic callers exhaustive. Cross-model review was not started because the host serving family was unattested.

### Preservation and verdict

- Base HEAD before this repair commit: `f3937b090f5b4dd9949786837b45d9dda84bc2c5`; branch `fix/full-merge-review-8322aa1d`.
- `my-merge` remains `cb3bee033ba853041609b874303dc625d5d30479`; `crystal` remains `8322aa1d6808711a6e46bfbe67d8a788ca8cbd1e`.
- All 749 protected target-file hashes matched. The preceding 333163-byte ledger prefix remains unchanged. No dependency version or lockfile changes, no changelog changes, no unrelated staged paths.
- Commit candidate: 130 explicitly owned product/docs/test paths plus this append-only ledger. Product hashes match the green full-suite epoch; commit hook checks the docs-inclusive candidate. No push or PR.

**NOT COMPLETE / NOT MERGE APPROVAL.** All reachable reviewed repairs and regression gaps are integrated, but the original Windows manager and larger coordinated reload remain unfixed, and native Windows proof is missing. A local repair commit does not close those blockers. No push or PR.


## Complete merge and subsequent diff review - 6a243f805

Scope: `839dc79197595a4285d711e37d02fb623e5b6b7b` -> `6a243f805acb5c57baf8df594a5b6120d9f15852`, 1552 changed paths and 3546 hunks. This includes the complete merge interaction and every subsequent repair, not only the latest commit. Markdown report-only; no fixes, new commit, push or PR.

### Review outcome and limits

**NOT READY / REVIEW AND VALIDATION DEGRADED.** Twenty thematic correctness owners report all assigned hunks inspected across 1552/1552 paths. Forty-five selected reviewers returned terminal artifacts. Three initial split adversarial jobs were cancelled, excluded from the canonical roster, and contributed no findings. The fresh sole canonical adversarial reviewer inspected only 68/1552 paths; 1484 remain insufficient. This is not complete adversarial clearance or merge approval.

Testing coverage was completed as a union of the original 70-path slice and ten thematic passes: 738/738 assigned paths. Maintainability union covers 594/598 paths; four generated/deleted bodies remain insufficient. Standards mechanically scanned all paths but manually checked only 65 candidate/context paths. Security inspected 96/358 paths with 262 insufficient; API inspected 242/403 nonhistorical paths with 161 historical documents insufficient; agent-native inspected 75 complete paths plus 15 partial, leaving 507 unread. Module-local checks do not erase those lens limitations.

Cross-model review was not started: host serving family unattested. Graph project/coverage tools failed with WeakMap errors; exact source/history and available LSP fallback were used. No exhaustive external/dynamic caller claim. No unambiguous implementation plan selected; this ledger is historical evidence, not implementation requirements. Settlement suppression was not evaluated.

### Source-supported findings

65 raw returns -> 64 quote/confidence-gated candidates plus one suppressed advisory -> 60 distinct after four semantic duplicate removals. Twelve testing-only gaps and one low-impact standards advisory are separated below. One oversized source/history validator evaluated 48 candidates: 46 accepted, two rejected. The batch exceeds the normal cap of eight and is explicitly noncanonical; it does not clear degraded validation. Moving assertion-only #15 to testing leaves **45 source-supported findings: six P1 and 39 P2**. Of these, **43 are new source candidates (five P1, 38 P2)**; **#2 and #24 are already-known retained blockers**, not new discoveries. They remain diff-relative primary findings because their introducing code is within this complete BASE..HEAD range; this does not reset their historical status.

Stable numbers below belong to this review epoch only; gaps are intentional. All items remain unapplied. Full impact/evidence/fix detail is preserved in the external report and hydrated JSON.

| # | Priority | Location | Observable defect and concrete response |
|---|---|---|---|
| 1 | P1 | `.github/workflows/env.yml:126` | Build telemetry before the environment test matrices. Add npm run build --workspace packages/telemetry after dependency installation in both release-daemons and tests, before invoking Vitest. Verify each matrix from a fresh checkout without existing dist directories; do not rely on artifacts built by the separate check job. |
| 2 | P1 retained | `packages/chord/src/manager.ts:265` | Terminate Windows descendants on graceful worker exit. Give Windows workers a process-tree lifetime primitive such as a kill-on-close Job Object, and join its termination before settling Instance.exited. At minimum, the graceful shutdown protocol must terminate and acknowledge descendants while the parent PID still exists; attempting taskkill only after the exit cannot reliably discover the tree. |
| 3 | P1 | `packages/chord/src/link.ts:411` | Handle WebSocket errors before authenticating ws clients. In WebSocketLink's constructor, register socket.addEventListener("error", () => this.ended("socket error")) immediately when taking ownership of the socket. Keep the listener installed for the socket lifetime, including pre-authentication and connection failure. Add a bounded child-process regression using the existing ws server integration: complete a raw HTTP upgrade, send an unmasked frame while authentication is unresolved, assert that only that socket ends and a second authenticated client can still call a method. Also cover a failed outbound ws connection. |
| 4 | P1 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:5015` | Cancel active extension dialogs before awaiting shutdown abort. Extract idempotent cancellation of extensionCustomDialogs and extensionDialogs from resetExtensionUI and invoke it immediately after marking shutdown in progress, before either runtimeHost.dispose({ fromSignal: true }) or session.abort(). Keep the remaining full UI/resource reset at invalidation, preserving the existing persistence-recovery ordering. |
| 5 | P1 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:6582` | Cancel scheduled preflight before replacing its session. Capture the delivery session and an AbortController before calling prompt; pass preflightSignal for initial, streaming, and retry admissions, cancel unaccepted deliveries in before-session-invalidate and stop(), and suppress callbacks from retired session/generation owners. Retain cancellation ownership until preflightResult accepts the input, matching promptQueued in flushCompactionQueue. |
| 6 | P1 | `packages/env/daemon/src/exec.rs:542` | Retain Unix process ownership until descendants are cleaned. Add a Unix completion cleanup before removing the PID: kill the owned process group, preserving the already recorded leader exit status, as Windows finish_job and Unix PTY completion do. Add a targeted case where the leader exits with a redirected background child, then verify that the child is no longer alive and the leader exit code is preserved. |
| 8 | P2 | `packages/chord/src/cell.ts:208` | Consume rejected promises at synchronous callback boundaries. Before throwing the synchronous-only error in Cell.change, Derived.compute and ObjectImpl.run, attach a rejection handler to the rejected asynchronous result, following MutableReplicatedStateImpl.change's Promise.resolve(result).catch(() => undefined) pattern. Keep rejecting the callback synchronously and aborting/unwinding exactly as now; do not await or accept asynchronous callbacks. Add a focused regression that catches the synchronous error and lets an async callback reject after an await without producing an unhandled rejection. |
| 9 | P2 | `packages/chord/src/object.ts:857` | Preserve teardown after readable cleanup throws. Make RefImpl.release remove its object reference and publish status in a finally block even when stopping readables fails. In ObjectImpl.#dispose, accumulate ref.gone cleanup errors and continue cancellation and all teardown steps, throwing the aggregate only after final disposal bookkeeping. |
| 10 | P2 | `packages/chord/src/output.ts:191` | Count UTF-8 across string chunk boundaries. Account for a high-surrogate/low-surrogate pair spanning adjacent accepted string chunks when updating total and stored byte counts, before deciding that a head buffer is full. Preserve the trailing high surrogate until the next chunk/end establishes whether it is paired (and preserve the same interpretation through snapshots and tail compaction). Add a regression comparing split-string pushes against pushing the concatenated text, including maxBytes=6 head retention with an emoji followed by 'ab'. |
| 11 | P2 | `packages/chord/src/remote.ts:185` | Complete pending shapes when their state demand disappears. When switching state off, discard pending state values and apply a pending shape whose missing set has become empty, then update the remaining views. Preserve the independent call-projection metadata and do not require a further provider frame to settle method-only readiness. |
| 12 | P2 | `packages/chord/src/remote.ts:417` | Preserve ordinary JSON keys during argument projection. Replace Value.Clone at remote JSON argument/input ownership boundaries with a JSON-preserving clone that defines reserved names as own data (reuse copyJson with the boundary's existing undefined-omission policy where its strictness is appropriate); keep consumer/provider Value.Clean projection. Migrate remote.ts, object.ts and normalize together. Cover a real linked Pico write and a keyed input containing own constructor/prototype/__proto__ values, asserting exact data and distinct identities without prototype pollution. |
| 13 | P2 | `packages/coding-agent/src/core/agent-session.ts:7216` | Invalidate exact counts after same-leaf history mutations. Capture sessionManager.getContextRevision() alongside leafId before building the final chat-token request, store that revision in _postCompactionContextTokens, and require it to equal the current revision before using counted.tokens. Reject late publication if that revision changed while counting. A conservative invalidation for state-only revisions is acceptable, or use a separately tracked model-context revision if preserving those counts is required. |
| 14 | P2 | `packages/coding-agent/src/core/remote-catalog-provider.ts:223` | Preserve authoritative empty personalized catalogs. Make personalModels undefined until a personalized catalog is available and return personalModels ?? builtinModels(). Restore matching stored lists, including [], as defined values; use undefined only for unmatched or unverifiable stored identities. Keep successful personalized=[] intact on publication. |
| 16 | P2 | `packages/agent/src/harness/pico3/kinds/frames.ts:61` | Preserve append intent for streamed raw tool tokens. Carry rawDelta append intent through the Pico transaction/membrane layer and apply it with Chord appendText on the underlying draft, initializing the optional raw member only once. Match the explicit append approach already used by packages/durable/src/harness/partial-changes.ts rather than assigning the full growing raw string on every flush; keep authoritative toolcall_end replacement behavior unchanged. |
| 17 | P2 | `packages/agent/src/harness/pico3/view.ts:125` | Accept tracker fallback roots in the Pico bridge. Teach bridgeWatch/applyTracked to apply a legitimate root replacement as the new Pico view, retaining the bridge-owned publication status and replacing commit.events with that envelope's events, with one atomic publication. Preserve subsequent ops if the batch contains them. Add a namespace-projection regression that changes more than 4096 pre-existing scalar fields in one commit, compares the held Chord view with a fresh raw snapshot and then verifies another ordinary update still arrives. |
| 18 | P2 | `packages/ai/src/api/openai-decisions.ts:174` | Enforce image capability in direct Decisions calls. Inside the Decisions classify try block, call assertClassifierInputSupported(model, context) before constructing or posting the payload, or add the same context.images?.length && !model.input.includes("image") guard used by classifySystemOne. Add a direct-adapter text-only-model case that asserts an error result and zero fetches. |
| 19 | P2 | `packages/ai/src/providers/radius.ts:43` | Bind authoritative Radius catalogs to the current account. Persist a credential-and-gateway personalization fingerprint with Radius catalogs, derive the same identity during cache-only refresh, and restore only matching entries. When identity changes or cannot be established, publish dynamicModels = undefined so the shipped baseline is available until the current account's catalog is fetched; retain [] as authoritative only for a matching identity. |
| 20 | P2 | `packages/ai/src/tokenize.ts:122` | Complete tokenizer migration to the canonical user agent. Import formatUserAgent from ./utils/identity.ts in tokenize.ts and use it for the default User-Agent in both countTokens and countChatTokens. Remove packages/ai/src/utils/pi-user-agent.ts once those remaining pi-ai callers are migrated; keep model/request header precedence unchanged. Add a focused counting-request assertion for the canonical default format. |
| 23 | P2 | `packages/chord/src/connection.ts:1378` | Recheck cancellation after resolving the relay route. Immediately after awaiting the route race, check signal.aborted and throw abortError() before allocating RelayCall or forwarding. Also preserve an already-aborted check when handing ownership to onCancel if any synchronous extension hook can abort during that handoff. Add a controlled route-resolution/cancellation interleaving test asserting no downstream call frame or side effect. |
| 24 | P2 retained | `packages/chord/src/connection.ts:942` | Carry candidate contract binding across coordinated reload holds. Add transaction-scoped candidate hold/drop metadata for trusted reload participants so candidate holds bind pending providers and compatibility checks exclude old holds the same transaction replaces; activate those bindings only on commit and discard them on abort. Keep ordinary/client holds bound to committed providers. |
| 25 | P2 | `packages/chord/src/host.ts:1382` | Fence pending reloads when the host closes. Reject reload/install/serve after closing starts, and make close abort and join the currently owned reload operation before final teardown. Recheck the host shutdown signal after asynchronous module resolution and before setup/publication, aborting candidate facet-run signals and rolling back owned work rather than committing it. |
| 26 | P2 | `packages/chord/src/reload.ts:103` | Evaluate derived consumers against candidate provider state. Resolve reference-backed sources through the candidate provider implementation and candidate migrated/derived values during dry runs, in dependency order. Do not invoke a typed derivation with undefined merely because its provider's new view is not yet current; preserve the all-candidate preflight before publication. |
| 30 | P2 | `packages/codemode/src/source.ts:291` | Recognize declarations after automatic semicolon insertion. Preserve JavaScript statement boundaries across automatic semicolon insertion before function/class declarations, rather than deciding declaration versus expression solely from statementStart left by the preceding token. Add regressions with a semicolon-free variable statement followed by a declaration and a regexp containing a backtick or quote: actual later options comments must throw, while options-looking text inside a subsequent template literal must remain accepted. |
| 32 | P2 | `packages/coding-agent/src/core/export-html/template.js:1061` | Keep empty collapsed read results expandable. Retain collapsed when it differs from expanded even when it is an empty string, then select the expandable branch by presence of the collapsed field rather than its truthiness. Supply a small visible expand hint for an empty preview so a collapsed read remains locally clickable; retain the O toggle's existing .tool-output.expandable handling. |
| 33 | P2 | `packages/coding-agent/src/experimental/services/worker.ts:137` | Finish worker cleanup when attachment disposal fails. Cache the complete disposal promise and collect attachment-removal errors without exiting early. Always join reloadTail, then close the host and dispose the loaded plugin generation, aggregating their errors with the attachment failure; repeated dispose calls should join the same cleanup rather than return immediately. |
| 34 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3425` | Preserve drafts when cancelling an unmounted custom factory. Track whether this inline interaction actually mounted and only restore its captured editor state when it owned the editor slot. An unmounted cancellation/factory rejection must leave the current editor text untouched; also avoid restoring a hidden older interaction over a newer owner. |
| 35 | P2 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts:3490` | Reserve dialog stack order before awaiting custom factories. Allocate an interaction/stack token when showExtensionCustom starts and mount the resolved component into that reserved position without stealing focus from newer dialogs. Keep the currently visible dialog focused and reveal the custom component only after entries above it close; retain the existing late-cancellation disposal checks. |
| 36 | P2 | `packages/coding-agent/src/package-manager-cli.ts:150` | Preserve managed releases still used by open sessions. Do not delete a release merely because it differs from the current updater's VERSION. Add per-release process leases with stale-owner cleanup and prune only releases proven unused; until such ownership exists, retain old releases rather than removing code from live processes. Verify with an older live process across two updates, then exercise a previously uninitialized lazy feature. |
| 40 | P2 | `packages/durable/docs/spec.md:2128` | Remove obsolete retry promise after scheduler storage failure. Replace the final sentence at spec lines 2128-2130 with the current rule: a rejected scheduler fault or handover write ends the invocation and fails the Session; its durable running record is recovered and reserved only after reopening. Preserve the existing production behavior and regression test. |
| 41 | P2 | `packages/durable/src/harness/partial-changes.ts:109` | Preserve pending scalar values in partial tool arguments. Before replacing tracked arguments with {}, ensure the collected changes reproduce the provider snapshot. For unclosed scalar values and depth-limited containers, assign the captured argument snapshot and stop delta tracking for that call (or explicitly reconcile those preview paths); keep the append fast path only when exactness is established. Add a regression that commits after '{"count":12' and after '{"flag":tr', before either delimiter/end event. |
| 42 | P2 | `packages/durable/src/harness/scheduler.ts:1871` | Keep read-only inspection of running tasks truthful. For a read-only scheduler, map a committed record.state.status==="running" to the running inspection state before applying local readiness/definition checks. Extend the existing read-only running-session test to assert inspection.tasks' derived state, not only inspection.scheduling. |
| 43 | P2 | `packages/durable/src/harness/scheduler.ts:542` | Exclude impossible migrations from paused Harness wake readiness. In wake(), also classify a fitting newer task with migrates:true and definition.migrate===undefined as blocked, matching blockedReason() and #inspectTask(), without executing migration code. Cover wake()/onWake before resume() with a stored version-1 task and an installed version-2 definition lacking migrate. |
| 44 | P2 | `packages/durable/src/storage/scan.ts:33` | Reject null cursors without failing the Session. Before destructuring a supplied cursor, reject null and non-object values with StorageRequestError. Keep undefined as the no-cursor case. Add a regression through a Session/Conversation read proving null rejects with StorageRequestError and a subsequent valid commit still succeeds. |
| 45 | P2 | `packages/durable/src/tools/image.ts:89` | Accept short lossless WebP headers. Move the WebP length checks into their chunk branches: require 25 bytes for VP8L and 30 bytes for VP8 and VP8X. Add a valid sub-30-byte lossless WebP fixture and verify that createReadTool() without an image processor returns its image block unchanged. |
| 47 | P2 | `packages/durable/test/env-node.test.ts:685` | Launch the shell fixture with source export conditions. Insert "--conditions=source" before the fixture filename in this execFile argument array, matching env-truncate.test.ts; verify the focused transport cases with workspace dist outputs absent or stale. |
| 48 | P2 | `packages/env/daemon/src/exec.rs:299` | Bound output before the reader-to-exec handoff. Bound queued raw Data bytes at the reader-to-exec boundary rather than only the final Output queue. Use a bounded data channel or byte-budgeted handoff with cancellation-aware waits, keeping exit/cancel notifications on a nonblocking control path so a full data queue cannot deadlock shutdown. Apply the equivalent bound to the PTY reader handoff, which repeats the same pattern. |
| 50 | P2 | `packages/env/src/remote-env.ts:230` | Recheck cancellation after receiving line scan results. Immediately after awaiting the scanLines reply, return abortResult<LineScan>(context.abortSignal, this.#path) when present, and only otherwise return the decoded scan. Verify with a real completed daemon scan whose reply is held until after the local signal aborts. |
| 51 | P2 | `packages/env/src/remote-env.ts:615` | Stop queued write chunks when cancellation arrives. For writeFile, carry its AbortSignal on write/writeChunk requests and check the request's Control before truncating/opening or starting a queued chunk (and after parent creation). Serialize signal-bearing chunks, or otherwise cancel queued chunks before they begin physical writes; retain the existing non-cancellable appendFile semantics. Verify cancellation behind an intentionally held first chunk and assert later queued bytes are not written. |
| 52 | P2 | `packages/env/src/ssh.ts:403` | Hash filenames without checksum output escaping. Hash redirected standard input instead of passing the pathname as a checksum operand, e.g. sha256sum < "$1" and shasum -a 256 < "$1", then extract the digest. Add a GNU-sha256sum-backed deployment case with a backslash in remote.home so this is checked independently of the host's preferred hash implementation. |
| 53 | P2 | `packages/mcp/src/oauth/flow.ts:403` | Persist challenged scopes through the OAuth code exchange. Add pending-authorization scope storage to OAuthClientProvider/McpOAuthProvider alongside the code verifier, save the resolved scope before redirecting, and use that stored scope when an authorization-code response omits scope. Clear it with verifier/all invalidation. Keep explicitly returned token scopes authoritative. |
| 54 | P2 | `packages/mcp/src/oauth/flow.ts:409` | Honor OAuth cancellation before the cached redirect path. Check options.signal.throwIfAborted() at runFlow admission and immediately before saving the new verifier and invoking redirectToAuthorization, including after asynchronous provider/PKCE work. Preserve the explicit refreshSignal:null behavior for an already-dispatched refresh so rotated tokens are still saved. |
| 56 | P2 | `packages/tui/src/tui-main-screen.ts:699` | Render image-bearing overlay rows instead of skipping them. Keep transcript-image protection separate from overlay-image output: identify image placements produced by overlay rendering, emit their anchor sequences at the overlay coordinates after the required text clears, and track/delete those placements on update/hide. Do not simply skip composed rows because isImageLine returns true. |
| 57 | P2 | `packages/tui/src/tui-main-screen.ts:716` | Preserve native wrap metadata while repainting overlay footprints. Preserve soft-wrap relationships when painting/restoring physical rows. For text rows use a non-wrap-clearing cell erase such as ECH plus positioned writes where possible, and explicitly restore any wrap boundaries that must change; retain enough physical-row metadata to distinguish native continuations from real newlines. Add assertions on the emulator's isWrapped flags, not only translated row strings. |
| 58 | P2 | `packages/tui/src/utils.ts:632` | Materialize independently rendered constituents as separate terminal cells. Reuse the terminal-glyph decomposition used by graphemeWidth/advanceTerminalCell when building materialized row cells. Represent independently advancing constituents as separate placements while continuing to treat actual two-cell glyphs such as CJK and emoji atomically; only delete the overwritten placement, not an entire Intl cluster that contains multiple terminal glyphs. |
| 59 | P2 | `scripts/issues/triage.ts:178` | Cancel the running attempt before retriaging. Capture the current conversation ID, invalidate the prior attempt atomically, and explicitly abort the superseded conversation through Harness.conversation(id).abort(context), awaiting its settlement before the replacement is admitted. Keep routing available until the old run is stopped, or make superseded submit_triage calls terminate rather than returning a retryable Unknown conversation error. Preserve decision fields and the attempt/conversation ownership checks. |

### Known retained blockers, not new findings

- #2: original Chord Windows manager process-tree ownership. Retained; not fixed or newly discovered.
- #24: larger coordinated breaking reload candidate binding. Retained; protocol 7 abort acknowledgement does not close it.

The new source queue contains 43 items. The total 45 source-supported items includes these two historical blockers. Diff-relative pre_existing is false because both implementations were introduced within 839dc791..6a243f805; historical status is carried separately.

### Testing-only gaps

These twelve observations are narrower regression/fidelity gaps, not current product defects. #15 was source-validated as a blind assertion then moved here; the other eleven were soft-bucketed before source validation.

| # | Location | Specific test response |
|---|---|---|
| 15 | `packages/durable/test/harness-lifecycle.test.ts:345` | Measure actual document observer registrations in cancellation test. Instrument SessionImpl.observeCommits rather than subscribeCommits, or assert the document-cache attached count returns to its pre-acquisition baseline. Include a successfully acquired watch as a positive control and a cancellation scheduled across the registration boundary, then prove a later commit cannot reach the cancelled observer. |
| 21 | `packages/ai/test/bedrock-stream-state.test.ts:123` | Exercise malformed arguments through Bedrock and Mistral. Add one Bedrock contentBlockStop case and one Mistral terminal tool-call case whose streamed JSON has a valid prefix followed by invalid syntax (for example {"path":"a","mode":.5}). Assert the terminal toolcall_end and returned message contain arguments: {} plus argumentsError containing the received JSON, and pass that call to validateToolArguments with an optional-only schema to prove it rejects rather than executing defaults. |
| 22 | `packages/ai/test/streaming-tool-arguments.test.ts:354` | Require actual intermediate tool preview progress. Gate delivery of the remaining upstream chunks with a deferred promise, consume the first argument deltas, and assert a specific non-empty strict prefix of content before releasing the final chunks. Assert a later strict increase before toolcall_end and retain the final exact-arguments assertion. Apply the same gate/assertion to bedrock-stream-state.test.ts so zero intermediate previews fails. |
| 27 | `packages/chord/test/state-init.test.ts:428` | Actually observe the gated initializer admission boundary. Keep an old root suspended after it acquires the object's activation lease, start the gated reload without awaiting it, and assert the added initializer has not run while that root blocks the gate. Release the root and then assert the initializer runs and the initialized value is published. Prefer also having the initializer read a replaced exclusive resource so ordering against opening the new resource is behaviorally observable. |
| 28 | `packages/chord/test/state-init.test.ts:84` | Assert initializer notifications without filtering undefined. After waiting until init has started but before opening the initializer latch, assert that seen is empty; after activation, assert seen equals [["a", "b"]] directly. Remove the misleading comment that describes undefined as a normal reference value before live. |
| 29 | `packages/client/test/client.test.ts:80` | Actually queue frames in the reconnect regression. Exercise reconnect with inbound native frames queued before a link exists, reconnect to the second MemoryByteServer using the same server route, register a receiver on the fresh link, and assert it receives no former frames but does receive a newly sent frame. Keep the old-link shutdown check in a separate case or parameterize the queue stage to cover both pre-link and pre-receiver buffering. |
| 37 | `packages/coding-agent/test/model-registry.test.ts:766` | Run the new sampling-merge regression in offline CI. Move the newly added samplingParamsByThinkingLevel custom-model merge case into an ungated describe using a synthetic custom provider. Keep the builtin-specific assertion in a separately locally enabled case using enableBuiltinProviders(), with Vitest env restoration; run the custom case with PI_DISABLE_CLOUD_PROVIDERS=1. |
| 38 | `packages/coding-agent/test/native/tokenizer-fixture.ts:91` | Reject foreign tokenizer URLs in the native fixture. Before recording/answering tokenizer requests, require the exact fixture URLs https://tokenizer.invalid/tokenize and https://tokenizer.invalid/v1/chat/completions/input_tokens, or derive these from the explicitly selected fixture model. Add a negative-control case for another origin and a wrong /v1 prefix, asserting the fixture rejects rather than providing a synthetic successful count. |
| 39 | `packages/coding-agent/test/suite/agent-session-prompt.test.ts:93` | Move request assertions outside swallowed faux callbacks. Capture the observed system sections and declared tool names in each faux callback, return the scripted response unconditionally, then assert the captured values after await session.continue()/session.prompt(). Also assert the expected successful assistant text or stopReason so an unrelated provider error cannot satisfy the scenario. Apply the same adjustment to agent-session-tool-orchestration.test.ts:91-98. Verify with counterfactual rejected discovery and wrong request-only tool declarations that each test fails. |
| 46 | `packages/durable/test/codemode.test.ts:425` | Compare deterministic values before the restart. Issue the echo containing Date.now()/Math.random() before awaiting hold, so the first attempt durably records its arguments and the resumed attempt must match them; keep the assertion that echo executed once and assert the entire successful result. Confirm the revised test fails when codemode execute passes a fresh startedAt or seed on resume. |
| 49 | `packages/env/daemon/src/special.rs:553` | Exercise interruption in the misclassified FIFO regression. Extend the Rust regression with a synchronized quick-pool interruption scenario: wait until a misclassified FIFO helper has registered, invoke quick.interrupt(true), receive the deferred completion and drive its transfer to the slow pool, and prove an ordinary open completes while the FIFO remains blocked. Add a successful-writer overlap case that invokes interruption around the rendezvous and verifies the transferred original descriptor yields EOF without requiring another writer. Install the daemon's SIGUSR2 handler in an isolated subprocess for these signal-bearing cases so the test runner's global signal state is not changed. |
| 55 | `packages/telemetry/src/testing/conformance.ts:187` | Require fallback spans to exist in conformance. After the three operations, capture getSpans() once, require exactly three snapshots, and use findSpan(spans, `fallback-${index}`) for each carrier to assert parentContext and parentId are null. A focused counterfactual adapter that delegates ordinary spans but extracts fallback carriers to NOOP_TELEMETRY_CONTEXT should fail this case. |

### Rejected and advisory findings

- #7 raw-tool progress expectation: rejected. Queued events contain mutable partial snapshots and cloneToolCall copies argumentsError; terminal finalization can affect the consumed start snapshot. Parent current-code run of openai-completions-raw-tool-call.test.ts passed all six cases.
- #31 user startup ownership: rejected. Baseline already prepares user hooks before run ownership; new foreign-preflight tests intentionally preserve that boundary. No newly introduced defect established.
- #60 single-use image-row forwarding helper: low-impact standards advisory, not a validated source defect. One confidence-50 avoidable-any advisory is suppressed from primary findings.
- Windows-manager reports were merged into #2; worker-cleanup product/testing reports into #33; empty-personalized-catalog product/testing reports into #14. Original detailed evidence and independent producer identities are retained.

### Current-code verification

Parent ran local throwaway smoke scripts without changing product source:

- #3: real loopback WebSocket HTTP upgrade before authentication, then an unmasked frame. The isolated Node process exits 1 with unhandled error, MASK must be set and WS_ERR_EXPECTED_MASK. This is a current unauthenticated denial-of-service reproduction.
- #6: current external pi-env daemon executes a shell that exits after spawning a redirected sleep child. Exec returns exitCode 0 while the child remains alive. Owned child explicitly killed in finally; connection and temporary directory cleaned.
- #10: string chunks high surrogate, low surrogate, a, b under six-byte head limit retain only emoji+a and report three dropped bytes; the combined input emoji+ab is six bytes and should fit.
- #19: a different synthetic Radius credential restores a prior empty catalog during cache-only refresh; baseline balanced disappears. No network.
- #30: an ASI-separated function declaration followed by a regexp containing a backtick hides a misplaced timeout directive; parser accepts it with no timeout.
- #54: cached OAuth discovery/client plus an already-aborted signal still writes a verifier and redirects. No network.
- Counterevidence #7: focused raw-tool-call file six passed. No full suite was rerun in this report-only review. Historical bg_901 13034/0/938 and precommit No fixes applied remain baseline receipts, not proof that the newly reported scenarios pass.

No paid-provider requests, native Windows, real Kitty/WezTerm graphics, production Cloudflare, Nix publication, fish or live SSH certification. Native Windows proof, including previous #56 classification, remains unavailable.

### Scope integrity and artifacts

Complete tracked manifest digest: `72f08eb7e7cad5aa722ca83b40d39a6daba0566647606c80f6ee04b86153c746`. Complete diff SHA-256: `399313a5a500cb5191f4b51be93d1d180b224d49bc4630727c7e528dcdf15167`. Snapshot includes 1552 changed paths and 2752 tracked files. The prior exact-final-product-hashes.json exists and binds the earlier 130-path bg_901 epoch; it is not reused as this full-review integrity proof.

All source hashes matched the full captured manifest before this append. The preceding ledger bytes are preserved. HEAD remains `6a243f805acb5c57baf8df594a5b6120d9f15852`; my-merge remains cb3bee033ba853041609b874303dc625d5d30479; crystal remains 8322aa1d6808711a6e46bfbe67d8a788ca8cbd1e. Protected target files are not edited. Only this requested ledger append is left uncommitted.

Full report, all 45 terminal artifacts, exact inspected/insufficient paths/ranges, mechanics, source details, semantic merges, 48 independent verdicts, current-code smoke receipts and honest coverage limits: `/tmp/compound-engineering-501/ce-code-review/20261030-complete-6a243f805`.

### Verdict

**NOT READY / REVIEW AND VALIDATION DEGRADED.** Address #3 WebSocket process crash, #1 fresh-CI telemetry dependency, #4/#5 shutdown and scheduled preflight, and #6 Unix descendant ownership first. #2 Windows manager and #24 coordinated breaking reload remain retained blockers. No fixes applied; no commit or push.

## Fix-all repair closure after 6a243f805

User authorization: fix all accepted findings from the preceding complete merge review. This is a local repair batch, not renewed whole-merge approval. The preceding ledger bytes remain unchanged; this ledger is excluded from the product commit.

### Disposition of the 45 source findings

43 new source findings have retained local repairs. Historical #2 and #24 remain blockers, not closed findings.

| # | Retained repair | Verification |
|---|---|---|
| 1 | Build telemetry before the environment test matrices | Focused behavior exercised; exact final validation receipt below |
| 2 | Terminate Windows descendants on graceful worker exit | Blocked; see retained blockers below |
| 3 | Handle WebSocket errors before authenticating ws clients | Focused behavior exercised; exact final validation receipt below |
| 4 | Cancel active extension dialogs before awaiting shutdown abort | Focused behavior exercised; exact final validation receipt below |
| 5 | Cancel scheduled preflight before replacing its session | Focused behavior exercised; exact final validation receipt below |
| 6 | Retain Unix process ownership until descendants are cleaned | Focused behavior exercised; exact final validation receipt below |
| 8 | Consume rejected promises at synchronous callback boundaries | Focused behavior exercised; exact final validation receipt below |
| 9 | Preserve teardown after readable cleanup throws | Focused behavior exercised; exact final validation receipt below |
| 10 | Count UTF-8 across string chunk boundaries | Focused behavior exercised; exact final validation receipt below |
| 11 | Complete pending shapes when their state demand disappears | Focused behavior exercised; exact final validation receipt below |
| 12 | Preserve ordinary JSON keys during argument projection | Focused behavior exercised; exact final validation receipt below |
| 13 | Invalidate exact counts after same-leaf history mutations | Focused behavior exercised; exact final validation receipt below |
| 14 | Preserve authoritative empty personalized catalogs | Focused behavior exercised; exact final validation receipt below |
| 16 | Preserve append intent for streamed raw tool tokens | Focused behavior exercised; exact final validation receipt below |
| 17 | Accept tracker fallback roots in the Pico bridge | Focused behavior exercised; exact final validation receipt below |
| 18 | Enforce image capability in direct Decisions calls | Focused behavior exercised; exact final validation receipt below |
| 19 | Bind authoritative Radius catalogs to the current account | Focused behavior exercised; exact final validation receipt below |
| 20 | Complete tokenizer migration to the canonical user agent | Focused behavior exercised; exact final validation receipt below |
| 23 | Recheck cancellation after resolving the relay route | Focused behavior exercised; exact final validation receipt below |
| 24 | Carry candidate contract binding across coordinated reload holds | Blocked; see retained blockers below |
| 25 | Fence pending reloads when the host closes | Focused behavior exercised; exact final validation receipt below |
| 26 | Evaluate derived consumers against candidate provider state | Focused behavior exercised; exact final validation receipt below |
| 30 | Recognize declarations after automatic semicolon insertion | Focused behavior exercised; exact final validation receipt below |
| 32 | Keep empty collapsed read results expandable | Focused behavior exercised; exact final validation receipt below |
| 33 | Finish worker cleanup when attachment disposal fails | Focused behavior exercised; exact final validation receipt below |
| 34 | Preserve drafts when cancelling an unmounted custom factory | Focused behavior exercised; exact final validation receipt below |
| 35 | Reserve dialog stack order before awaiting custom factories | Focused behavior exercised; exact final validation receipt below |
| 36 | Preserve managed releases still used by open sessions | Focused behavior exercised; exact final validation receipt below |
| 40 | Remove obsolete retry promise after scheduler storage failure | Focused behavior exercised; exact final validation receipt below |
| 41 | Preserve pending scalar values in partial tool arguments | Focused behavior exercised; exact final validation receipt below |
| 42 | Keep read-only inspection of running tasks truthful | Focused behavior exercised; exact final validation receipt below |
| 43 | Exclude impossible migrations from paused Harness wake readiness | Focused behavior exercised; exact final validation receipt below |
| 44 | Reject null cursors without failing the Session | Focused behavior exercised; exact final validation receipt below |
| 45 | Accept short lossless WebP headers | Focused behavior exercised; exact final validation receipt below |
| 47 | Launch the shell fixture with source export conditions | Focused behavior exercised; exact final validation receipt below |
| 48 | Bound output before the reader-to-exec handoff | Focused behavior exercised; exact final validation receipt below |
| 50 | Recheck cancellation after receiving line scan results | Focused behavior exercised; exact final validation receipt below |
| 51 | Stop queued write chunks when cancellation arrives | Focused behavior exercised; exact final validation receipt below |
| 52 | Hash filenames without checksum output escaping | Focused behavior exercised; exact final validation receipt below |
| 53 | Persist challenged scopes through the OAuth code exchange | Focused behavior exercised; exact final validation receipt below |
| 54 | Honor OAuth cancellation before the cached redirect path | Focused behavior exercised; exact final validation receipt below |
| 56 | Render image-bearing overlay rows instead of skipping them | Focused behavior exercised; exact final validation receipt below |
| 57 | Preserve native wrap metadata while repainting overlay footprints | Focused behavior exercised; exact final validation receipt below |
| 58 | Materialize independently rendered constituents as separate terminal cells | Focused behavior exercised; exact final validation receipt below |
| 59 | Cancel the running attempt before retriaging | Focused behavior exercised; exact final validation receipt below |

### Disposition of the 12 testing-only gaps

| # | Strengthened coverage |
|---|---|
| 21 | Exercise malformed arguments through Bedrock and Mistral |
| 22 | Require actual intermediate tool preview progress |
| 27 | Actually observe the gated initializer admission boundary |
| 28 | Assert initializer notifications without filtering undefined |
| 29 | Actually queue frames in the reconnect regression |
| 37 | Run the new sampling-merge regression in offline CI |
| 38 | Reject foreign tokenizer URLs in the native fixture |
| 39 | Move request assertions outside swallowed faux callbacks |
| 46 | Compare deterministic values before the restart |
| 49 | Exercise interruption in the misclassified FIFO regression |
| 55 | Require fallback spans to exist in conformance |
| 15 | Measure actual document observer registrations in cancellation test |

### Independent repair review

- Sixteen local reviewers completed the initial 90-path repair review. All assigned changed hunks were reported inspected, including the sole complete-scope adversarial pass. Fourteen raw reports became nine distinct findings: eight source defects and one testing-only gap. One normal-cap batch of eight independently accepted all eight source defects.
- Repairs cover independent schema projections and getter snapshots, live-only candidate preflight, cancellation-owned retirement waits, scheduled preflight shutdown ordering, scalar preview reconciliation with resumed appends, and image clipping and stacking. The candidate-close regression now independently holds both resource open and asynchronous close.
- A four-reader narrow review found three further distinct source defects; one bounded independent batch accepted all three. Actual adapter regressions exposed empty/raw-only parser cadence mismatch; graphics regressions exposed left-hand text erasure; six recovery scenarios exposed retained canceled-preflight ownership. All were repaired with observed red/green evidence. A later two-reader pass corroborated a fourth transport-layer defect: empty credit-bearing deltas were discarded by frame encoding/reduction. An independent one-candidate validator accepted it; actual OpenAI-to-frame roundtrips failed before the two guarded codec changes and passed afterwards. Both readers then returned zero new findings for the codec closure.
- New source epochs invalidate older review snapshots. Final narrow rereview and final exact source hashes are recorded below. Local independent reviews are not cross-model certification. The original 1552-path review remains historically DEGRADED; the old oversized validator is not retroactively canonicalized.

### Maintenance and API decisions

- Managed releases are retained rather than pruned by age; a live old process successfully loads a previously unused module after two updates. This deliberately uses more disk space, as documented; automatic bounded garbage collection or retroactive process leases are not claimed.
- Remote appendFile keeps its documented complete-operation-then-report-abort semantics. Cancellable writeFile stops queued chunks; append semantics were not silently changed.
- OAuth code-verifier persistence includes challenged scope and required authorizationScope() access; maintained implementations and docs migrate together. Explicit returned scope remains authoritative.
- AI utility exports now honor the source condition, avoiding stale dist parser semantics in source-based Durable verification. No unnecessary parser API was retained.

### Retained blockers

- #2, packages/chord/src/manager.ts:265: Windows graceful worker exit still lacks creation-owned process-tree lifetime and joined descendant termination. GNU cross-compilation is not native Windows proof.
- #24, packages/chord/src/connection.ts:942: coordinated breaking reload still lacks transaction-private candidate hold/drop binding and atomic commit/abort activation. Protocol 7 abort acknowledgement does not implement that contract.

### Verification and integrity

- Final exact-epoch root `./test.sh`, bg_1019: **13175 passed, 0 failed, 939 skipped**, exit 0, 504.76 s. Vitest worker count was bounded to two through a temporary npm launcher; original PATH and the runner's empty-environment credential isolation remained intact. No tests were excluded, assertions weakened, or per-test timeouts raised. Full output: `artifact://15408`.
- Final `npm run check`, bg_1011: checked 1980 files, **No fixes applied**; pinned/runtime dependencies, import paths, entry graphs, install lock, TypeScript and browser smoke passed. Normal precommit checks run again on the same owned paths.
- Final native Rust daemon: 34 passed, zero failed; Clippy `-D warnings` passed. Windows GNU test metadata compiled; zero native Windows tests executed. All Cargo output stayed in the external target directory.
- Frame closure: actual OpenAI-to-frame regression was red in four cases, then 50 focused AI tests and 14 downstream transcript tests passed. Two independent narrow readers reported no remaining actionable finding.
- Actual export HTML desktop/mobile interactions passed with no console errors; screenshot capture timed out, so no pixel screenshot claim. Actual TUI renderer output and xterm text cells prove clipping, stacking, left-text preservation and restoration; not native graphics pixels.
- Exact final product source manifest: `/tmp/pi-fixall-6a243f805/product-frame-final-epoch.json`, 98 product paths, zero before/after drift. Protected target manifest: 749 files, zero changed hashes. Lockfiles and changelogs unchanged; ledger excluded from the product commit.
- Complete repair artifacts, per-finding packets, red/green receipts, failed attempts, exact hashes and independent reviews: `/tmp/pi-fixall-6a243f805`.

Historical attempts are retained, not counted as green: bg_957 had nine failures, bg_976 and bg_991 timed out, bg_1007 passed on the preceding 97-path epoch but was superseded by the codec repair, and bg_1012 completed with two native-watch failures (13173/2/939). The exact Env remote file then passed twice in separately isolated homes with the same daemon (33/0/3 each); this establishes nondeterminism, not a proven OS/load root cause. No native-watch assertion, overflow report, or timeout was suppressed.

The later unchanged-source bg_1016 attempt timed out after a legacy WSL fixture remained in its temporary win32 platform state; the complete fixture then passed 35/0/1 and its exact case passed alone. These observations support nondeterministic execution, not a proven load-only root cause. The final bounded-concurrency run above passed every package.

**Verdict: bounded repair batch verified; whole merge remains NOT READY because #2 and #24 are retained blockers.** No push or PR. No native Windows, real Kitty/WezTerm pixel rendering, production Cloudflare, Nix publication, fish, or live SSH certification. Virtual-terminal cells and emitted graphics controls are not native graphical proof.

## Complete merge review attempt - 93e5f034

**Scope:** `839dc79197595a4285d711e37d02fb623e5b6b7b` -> `93e5f034cf20792a5b697cd35eaf674a1eb477cb`, including pre-existing tracked ledger WIP. The immutable capture contains 1558 changed paths and 2753 tracked files. This is the full merge plus subsequent changes, not just the latest 98-path repair commit.

**Intent:** Reassess the complete merge and all later repairs.
**Mode:** markdown report-only; no product fixes, tests, commit, push or PR.

### Actionable Findings

No new finding conclusion is available. This is not "Actionable findings: none" and is not a clean review. No independent reviewer returned usable evidence. Do not treat historical ledger findings or fixes as newly reviewed results.

### Known Retained Blockers

These retain their historical identifiers and are not new discoveries or independently revalidated findings in this attempt.

| Historical ID | Location | Unclosed requirement |
|---|---|---|
| #2 | `packages/chord/src/manager.ts:265` | Windows graceful worker exit still needs creation-owned descendant lifetime and joined termination, with native Windows proof. |
| #24 | `packages/chord/src/connection.ts:942` | Coordinated breaking reload still needs transaction-private candidate hold/drop binding and atomic commit/abort activation. |

Parent spot reads found the same relevant exit and ordinary-acquire branches. These two small reads do not constitute independent validation or whole-scope coverage.

### Coverage

- **FAILED / INCOMPLETE:** 0 of 1558 paths have usable independent review evidence in this attempt; all 1558 remain insufficient. Partition assignment is not inspection.
- 39 canonical reviewers were selected. Five initial launches failed. Thirty-two replacement launches then produced 22 transport failures and ten cancellations. Total: 37 launches, 27 failed transports, ten cancelled, zero usable reports. All started jobs are terminal. Seven selected risk lenses were never dispatched after the transport failure stop.
- Failures reported first-event stream timeouts or a closed socket after ten transport retries. No finding was reconstructed from these errors. The unchanged large packets and replacement fanout were workflow deviations; they did not produce coverage.
- The deterministic mechanics helper ran on an empty return array only. There were no candidate findings to deduplicate or independently validate. Validator status: not started. No validation success or clean-result claim.
- Cross-model review: not started; host serving family unattested. Graph project/coverage devices failed with WeakMap errors. No exhaustive external or dynamic caller claim.
- No unambiguous implementation plan was selected; settlement suppression was not evaluated. The requested closure ledger is historical evidence, not implementation requirements.
- No new tests or runtime reproductions were run. The earlier `13175 passed, 0 failed, 939 skipped` receipt belongs to the preceding repair verification and is not a new review result. Native Windows, actual terminal graphics pixels, production Cloudflare, Nix, fish and live SSH proof remain unavailable.

### Scope Integrity and Artifacts

- Complete tracked-change digest: `7530c9dbb250c3d9075ddfead3a596f3dd5dc593327df1098d99dcb635f6e359`.
- Captured diff SHA-256: `f105bc651a52e209aaaf34fcac5c38886a98897c7ec08ff1a7784908a1284297`.
- The pre-existing dirty ledger was frozen before this attempt. This new appendix was not part of reviewer input. No historical bytes are rewritten.
- Run artifacts: `/tmp/compound-engineering-501/ce-code-review/20261031-complete-93e5f034`. See `failed-review-receipt.json`, `initial-reviewer-failures.json`, `transport-stop-receipts.json`, `transport-failure-disposition.json`, `partition-coverage.json`, the captured manifest/snapshot and `metadata.json`.

---

### Verdict

**NOT READY / COMPLETE REVIEW NOT PERFORMED.** The requested full review remains blocked by reviewer transport failure. Restore a working review channel and rerun the frozen complete scope; do not use this failed attempt as merge approval. Historical blockers #2 and #24 remain unclosed.

### Actionable Recap

1. Review infrastructure: rerun the complete 1558-path scope after the transport is usable. Required review work, not a source finding.
2. Historical P1 #2, `packages/chord/src/manager.ts:265`: Windows descendant ownership and native termination proof; design/implementation gate remains.
3. Historical P2 #24, `packages/chord/src/connection.ts:942`: coordinated candidate binding across reload commit/abort; design/implementation gate remains.

## Retained blocker reassessment after failed review - 93e5f034

User requested fixes after the failed complete-review attempt. That attempt produced zero usable independent reports, so it provides no new validated finding queue. Its 1558-path frozen input included the pre-existing dirty closure ledger; it was not a clean code-only diff.

### #2 Windows worker process-tree lifetime - not fixed

- `packages/chord/src/manager.ts:203` starts the worker with Node `fork`; no creation-owned Job is attached. The graceful exit branch at lines 265-268 can settle `Instance.exited` without descendant termination.
- The existing kill-on-close Job implementation belongs to the Rust env daemon, not the Chord Node IPC worker launcher. Reusing it would require a new launcher/IPC ownership architecture; depending on the TUI native module would put platform process control in the wrong dependency layer.
- A correct implementation must create the worker inside a noninheritable kill-on-close Job before user code executes, terminate remaining descendants on normal/fatal/crash/parent-loss paths, and wait for zero active Job processes before replacement. Native Windows tests must exercise immediate descendants, detached descendants, parent death and replacement.
- No Windows execution host is configured in this session. The repository does have a Windows `chord-native` CI matrix, but it was not executed here. No delayed Job assignment or taskkill-after-exit fallback was added.

### #24 Coordinated breaking-reload binding - reproduced, not fixed

A throwaway script used the real Chord runtime and a memory link: server provider v1 and worker consumer v1 were upgraded together to v2 with `remote: { worker: ["consumer"] }`. Observed result:

```json
{"success":false,"code":"contract_mismatch","message":"contract_mismatch: reload aborted: contract_mismatch: repro.provider: provider version 2, consumer version 1, no accepts adapter","versions":[1,1],"oldStillUsable":"old"}
```

- `SelfImpl.get` passes candidate intent to `HostImpl.acquire`, but remote routing at `host.ts:583` drops it; `connection.ts:942` always acquires against the committed provider. LSP found eight `acquire` references.
- `reload.ts:514-529` computes dropped references only from local candidate declarations. It cannot exclude an old remote hold that another participant replaces in the same transaction. LSP found the prepare call and declaration of `checkRefs`.
- The current `hold` schema has no transaction-scoped candidate/drop identity. Fixing only the candidate flag or skipping `checkRefs` would either leave preparation blocked or violate committed-provider isolation for ordinary/client holds.
- The required protocol must bind trusted participant candidate holds privately, carry replacement/drop intent, supply private migrated/derived candidate state for readiness, validate surviving holds after participant intent collection, then activate on commit or remove all private authority on abort/disconnect. This complete contract and implementation were not introduced in this session. No partial protocol bump or acknowledgement is claimed as a fix.

### Verification and disposition

The actual reproduction ran with `node --conditions=source`, exited 0 after reporting the expected failure, and closed both hosts in `finally`. The temporary script was removed. Exact evidence and prerequisites: `/tmp/pi-retained-blockers-93e5/reassessment.json`. No product or permanent test files changed; no build, full tests or `npm run check` were run for this investigation. Earlier green receipts are not new proof.

**Not fixed:** both historical blockers remain open. No new successful repair, commit, push or merge-readiness claim.

## Retained blocker implementation - 070350b40

This appendix supersedes the preceding investigation-only disposition for the implementation described here. Historical receipts and findings above remain unchanged. The user requested both repairs and explicitly selected an atomic native Windows launcher preserving the application PID, all Node flags including startup snapshots, and genuine fork IPC. Verification ran on uncommitted product changes based on `070350b40`; the user subsequently authorized saving this implementation and its evidence in a local commit. No push or PR.

### #2 Windows worker ownership - implemented, native acceptance still open

- Chord owns a noninheritable kill-on-close Job in a small stable N-API addon. A trusted native `execPath` launcher creates the actual Node worker suspended with `PROC_THREAD_ATTRIBUTE_JOB_LIST` and a restricted inherited handle list, then closes its temporary Job handle before resuming application instructions. Preloads and snapshot callbacks therefore start inside the Job by construction.
- The launcher forwards the original libuv CRT descriptor table, stdio and fork IPC, plus the complete original `execArgv`. `Instance.pid` is the actual application PID. Normal/fatal/crash/forced-stop paths terminate remaining Job processes and join zero active processes before exit settles or replacement proceeds. Parent loss closes the owning Job. No `taskkill` fallback or post-start assignment remains.
- Native cleanup failures reject `Instance.exited`; manager rejection observers settle startup promptly and clear the unusable instance. A portable regression first reproduced startup timeout, stale stopping state and four unhandled rejections, then passed after explicit rejection routing and finalization.
- Four checked-in prebuilds cover x64/arm64 addon and launcher. Both architectures cross-compiled successfully with the SHA-256-verified llvm-mingw toolchain; COFF inspection confirmed the expected machines and KERNEL32-only imports. Evidence: `/tmp/pi-two-blockers-070350b40/windows-build-evidence.json`, `artifact://15523`. Cross-compilation is not native execution proof.
- npm packing includes all four native assets. Windows standalone packaging copies the selected architecture explicitly. The current coding-agent JS bundle tree-shakes the unused host-manager module and has no native lookup path. The unexercised conditional Chord asset-copy/assertion branch was removed rather than retained as hypothetical packaging support.
- The launcher depends on libuv's private CRT descriptor layout and rejects unknown layouts. Windows Node 22/24/26 CI coverage is authored but was not executed here. No Windows execution host is configured; all ten Windows-specific tests remain skipped locally. **Native Windows acceptance remains open; #2 is not fully closed.**

### #24 Coordinated candidate binding - repaired and locally verified

- Protocol 8 is a clean peer cutover: trusted transaction participants, declaration/materialization receipts, acknowledged revocable replacement intents, transaction-private candidate holds, and separate binding pools. Ordinary and client holds cannot coalesce with candidate holds or call pending methods.
- Private snapshots contain validated migrated and derived candidate state. Commit installs before promoting private holds; abort/disconnect releases private authority and restores old subscriptions/resources. Reconciliation through a synchronized sibling uses its installed provider without recruiting it into the private transaction.
- Fourteen behavioral regressions cover all three provider/consumer placement directions, ordinary/client isolation, forged candidate access, rollback, invalid derived state, disconnect, receipt failure/reconnect, behind reconciliation, fresh changed addresses, unchanged fresh activations and registry publication.
- Independent review found two additional defects: an unchanged fresh local object could expose private dependency state (observed 99 instead of installed 7), and an asynchronously activated pending provider could lose its registry entry (observed undefined instead of registered). Both failed before repair. Fresh unchanged objects now retain installed dependencies; tables are rebuilt after dependency activation before the final vote and synchronously revalidated before publication. Both regressions and the original initializer contracts pass unchanged.
- Source smoke bg_1065 and compiled-runtime smoke bg_1070 each exited 0 after exercising a blocked breaking change with a surviving ordinary hold, successful coordinated migration (`UP:11!/up:11`), and failed preparation retaining `up:11`. The compiled-runtime receipt is the emitted-artifact proof; the source receipt is historical supporting evidence. **The bounded #24 implementation requirement is locally verified.** This is not whole-merge approval or a persisted distributed commit decision.

### Exact verification and integrity

- Root authoritative isolated `./test.sh`, bg_1067: **13191 passed, 0 failed, 947 skipped**, exit 0, 401.60 seconds. Original credential isolation remained intact; a temporary npm launcher bounded Vitest workers to two, with no test exclusions or timeout increases. Full output: `artifact://15594`.
- Complete Chord suite, bg_1064: **916 passed, 0 failed, 10 skipped** across 55 files. Root suite independently reports the same Chord counts. No unhandled rejection was reported.
- `npm run check`, bg_1066: 1983 files, **No fixes applied**; dependencies, imports, entry graphs, install lock, TypeScript and browser smoke passed. `npm run build:offline`, bg_1068, passed; the actual bundled CLI reported 1.4.0. Final npm pack, bg_1069, contains 256 files including four native assets.
- Two bounded independent source reviews inspected native/lifecycle/packaging and transaction authorization/state/lifetime paths. The native pass found no residual concrete defect; the transaction pass found the two reproduced defects above and subsequently confirmed their narrow closure. These are not a new complete 1558-path review and do not repair that earlier failed coverage attempt.
- The implementation's 30-path epoch is frozen in `/tmp/pi-two-blockers-070350b40/verification-epoch.json`; the later archive acceptance follow-up has its own final manifest. The 749 protected Cargo-target files retained their hashes during verification. Verification HEAD was `070350b40f9392d5461c1726ff3b1cc516d711c0`; `my-merge` and `crystal` were unchanged at `cb3bee033ba853041609b874303dc625d5d30479` and `8322aa1d6808711a6e46bfbe67d8a788ca8cbd1e`. No lockfile or changelog changes.
- Prior failing/superseded attempts are retained as diagnosis, not green evidence: bg_1041 and bg_1042 exposed initial transaction regressions; bg_1043 retained an unhandled barrier rejection; bg_1044 reproduced manager exit rejection ownership; bg_1051 found initializer regressions; bg_1060 had one invalid remote-lifetime fixture, corrected before bg_1061 reproduced both review defects. The earlier root bg_1058 was cancelled after those findings; only bg_1067 is the final root receipt. Smoke fixture authoring failures are not product passes.
- Detailed implementation packets, hashes, red/green receipts, toolchain provenance and review outcomes: `/tmp/pi-two-blockers-070350b40/closure-receipts.json` and sibling artifacts. Throwaway runtime smoke removed after execution.
- Archive acceptance follow-up: `scripts/create-source-archive.sh` now requires all four Chord prebuild paths. An actual source-archive smoke (bg_1071) used a temporary Git index and isolated object store containing the owned working-tree changes: complete archive creation and model-data validation passed, all four assets were present, and four independent missing-asset snapshots each failed without publishing an output archive. The canonical index and refs were untouched. This proves archive validation, not Windows execution or a published release.
- After removing the unused bundle branch and unused import, bg_1074 rebuilt the actual bundle (80 files, 9.4 MiB) and its CLI printed `1.4.0`, exit 0. After the preceding ledger update, bg_1073 completed `npm run check`: 1983 files, **No fixes applied**, all dependency/import/entry-graph/install-lock/TypeScript/browser-smoke gates passed, exit 0. These observed outputs are recorded in `/tmp/pi-two-blockers-070350b40/archive-followup-receipt.json`. The root-suite receipt predates the archive-only follow-up; no claim is made that a released Windows binary or the full release pipeline executed.

**Disposition: #24 locally closed; #2 code implemented but native Windows proof remains open. Whole merge remains NOT READY.** Local commit authorized after verification; no push, PR, native Windows certification or complete-merge review claim.

