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
