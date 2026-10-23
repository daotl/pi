# Review: retain inflight components through appearance rebuilds

## Source and prerequisite scope

P08 prerequisite from candidate #26 `f5825ecd7744162d449e247eb7c452570d8413aa`, final source patch's rebuild component retention. P06 unified summary presentation and P08 live projection/reconciliation remain pending independent work. This unit does not expose a projection API, change transcript notifications, or alter persisted messages.

Appearance callbacks for padding, wrapping, backgrounds and separators rebuild chat from saved context. Before the fix, clearing the chat detached the still-active streaming assistant and replaced live tool components, although subsequent events continued updating the old instances. Captured pending tool progress/renderer state was lost.

## Change

Snapshot pending tool instances only while `session.isStreaming` owns the agent run, before clearing/rebuilding saved history. This flag covers tool execution and between-response gaps, not just assistant streaming. Reattach the streaming assistant. For each live tool, replace the rebuilt placeholder in place when present, otherwise append it; register the original live instance and invalidate the rebuilt container. Idle historical unresolved tools are reconstructed from the current registry. No extra model dispatch or message persistence change.

## Actual proof

New suite owner uses existing harness/faux provider with real AgentSessionRuntime and initialized InteractiveMode/VirtualTerminal. Actual /settings selection and terminal Enter/Escape trigger each of four appearance callbacks during an assistant delta, tool progress, and follow-up assistant streaming. Assertions cover visible partial text/progress, attached assistant/live tool identities, continued deltas, exact final text multiplicity and final xterm scroll buffer. Real gated tool execution supplies partial and final results. Cleanup releases gates, ends streams, aborts/drains the session, stops/disposes runtime and restores global display preferences.

Current-source RED **4 failed / 0 passed, 3.63s**: each first appearance toggle removed unfinished answer from actual chat output. Initial post-format focused owners **32 passed / 4 files, 5.74s**, check **1767 / No fixes applied, 12.32s**. Native source review then found unconditional retention kept stale extension renderers through idle `/reload`. A fresh extension registry supplied by the test resource loader reproduces actual submitted `/reload`: **1 failed / 4 appearance controls passed, 4.33s**, visible renderer v1 after successful reload instead of v2. The ownership gate fixes this without retaining historical idle components. This exercises the real reload/runner/registry/UI path, not filesystem extension cache invalidation.

Final post-format focused owners **40 passed / 5 files, 6.44s** (new owner, 4167 unresolved-tool, 5943 reload/session-start, interactive compaction and TUI controls). Final check **1767 files / No fixes applied, 12.41s**. The preceding check formatted one owned test (**13.79s**). No paid provider/network, physical terminal, file-backed reopen, arbitrary navigation during streaming, full projection or notification completion claim.

## Independent review and delivery

Code review: skipped (ce-code-review unavailable). Bounded native source/proof reviews are supplemental, not portable CE or cross-model coverage. Source review identified the stale historical-renderer regression above; actual RED and the active-run ownership gate resolved it. Both read-only source and proof follow-up reviews report no additional actionable findings; neither reviewer independently executed tests.

Owned InteractiveMode source, new existing-suite test, sessions guide and this review only. Normal explicit-path implementation commit precedes fixed source/test/guide aggregate; review-only amendment records actual tested SHA separately from final SHA. P08 whole cluster and full migration remain open.

## Fixed committed-tree aggregate

Normal implementation commit `be5f3693a` includes the three product paths and this review; pre-commit check passed with **1767 files / No fixes applied, 12.39s**. Root isolated `./test.sh` on that fixed committed source/test/guide tree: **8678 passed / 0 failed / 936 skipped, 96.48s**, full output `artifact://4769`. No subsequent product changes occurred during the aggregate. The following review-only amendment records this receipt; the tested SHA remains `be5f3693a`, not the amended SHA. Recovery-snapshot-only protection check: **749 files / 0 mismatches**; original protection manifest remains unavailable.

