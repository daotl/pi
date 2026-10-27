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

