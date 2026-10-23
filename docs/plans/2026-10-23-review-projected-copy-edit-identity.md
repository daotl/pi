# Review: canonical substring copy and shared editable indices

## Problem and final source chain

Parent `53aa776d5`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #24 `3891c85a2d698b87546873ddc42f3d400406db13` projected substring-copy repair depends on the final shared editable inventory already present in the backup: AgentSession2092-2102, numeric lookup2000-2002, copy6162-6180. Migrate the final behavior, not an isolated last hunk.

Current copy iterated raw context entries, excluded custom_message and ignored replacement/omission. Numeric edit lookup and the private editable inventory also independently used raw entries. Copy XML IDs therefore could not describe the visible projected editable sequence.

## Final adaptation

Use canonical SessionManager projection for copy matching and editable inventory; keep sourceEntry.id for mutation/fork identity, projected content for matching and display, and only user/assistant entries in editable numbering. Numeric public lookup delegates to that inventory. Custom-message projection participates in copy with no editable index, including display:false content that remains in model context. Harness exclusion, case-sensitive haystack/XML matching, chronological order, tool/bash copy formatting and current swipe/id0 behavior remain.

Regression oracles cover replacement, omitted user/custom entries, shown/hidden custom content, exact chronology/indices, unchanged stored history before an explicit edit, numeric lookup, substring edit lookup, fork inventory and actual id1 edit application. Shared guide documents the projected view without promising rewritten raw history.

## Verification chronology and rejected intermediate

- Original source RED **2 failed / 4 passed / 2.18s**: omitted raw text returned instead of replacement, indices reflected omitted entries, and custom entries were absent.
- An incorrect intermediate adaptation kept raw2/1 indices and only migrated copy. Its **79 passed / 2 files / 3.00s** is not final-candidate proof and was not committed. Source/backup review showed the omitted shared helper/numeric lookup prerequisite; expected projected1/0 was restored.
- Explicit intermediate index RED **1 failed / 5 passed / 2.42s**: projected copy content still carried raw2/1 IDs. After the final shared cutover, eight edit/copy/runtime/swipe/fork owner files reported **136 passed / 3 existing skipped / 6.79s**. The skipped file is the existing cloud-gated branching suite; no skip was introduced.
- First full check **1765 files, Fixed 1 / 12.67s**, all stages passed; it formatted the owned regression. Final post-format same eight files **136 passed / 3 skipped / 6.66s**; full check **1765 / No fixes applied / 12.17s**.
- Actual source Node SDK + file-backed session/reopen smoke returned `needle user` index1, projected answer index0, custom content without index; fork inventory shared1/0; id1 application changed the correct user and kept the projected answer. Output `{"actualSDK":true,"reopened":true,"copyMatches":[{"text":"needle user","index":1},{"text":"needle projected answer","index":0},{"text":"needle custom"}],"sharedIndices":[1,0],"editedCorrectUser":true}`, **0.47s**. Real createAgentSession/DefaultResourceLoader/SessionManager; no provider dispatch, clipboard or visual UI claim. Temporary executable/directory removed.

- Final assertion follow-up explicitly verifies omitted/raw content remains absent from copy/edit lookup after actual id1 mutation, and the numeric lookup still has no third editable entry. Focused owner **6 passed / 2.22s**; full check **1765 / No fixes applied / 11.90s**. Guide wording is limited to forkable-message inventory, not actual runtime fork execution. Native review follows this final state.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host has no skill invocation primitive; native bounded independent source/proof reviews supplement verification and are not portable CE/cross-model receipts. Results recorded after delivery.

No broad deletion/scheduler/live-inflight UI or command grammar change; no new model request, dependency/lock/generated/changelog changes. Owned paths: AgentSession, existing regression, sessions guide and this independent review only. Normal path-limited commit before root aggregate; review-only amendment records exact tested/final hashes without changing product blobs. The full 44-candidate migration remains open.

ProjectedCopySourceReview and ProjectedCopyProofReview completed independent bounded read-only review with **no actionable findings**. They verified the final shared projection architecture, source-entry mutation identity, reverse indices, omission/replacement/custom behavior, actual edit application and post-edit exclusions, while retaining current id0 behavior. Neither executed verification; all timing/runtime receipts above belong to parent execution. Fork evidence is inventory-only and the source smoke is not clipboard/UI/provider proof. Protected recovery snapshot: **749 / zero mismatches** before staging.

## Fixed committed-source/test aggregate

Normal path-limited implementation commit `93e827420` includes exactly source/test/guide/this review, with normal hook **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that committed source/test tree passed **8597 / 0 failed / 936 skipped**, exit 0, **102.38s**, full output `artifact://4228`. No next-unit source/test changes occurred during execution. Following review-only amendment records this exact tested SHA; the verified source/test/guide blobs are unchanged and the aggregate is not attributed to the new amended SHA. This closes P13 only, not the entire migration.
