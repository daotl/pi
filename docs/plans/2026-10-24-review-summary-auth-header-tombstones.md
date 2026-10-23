# Review: preserve resolved auth header tombstones through summaries and counting

## Source and problem

P18 is the remaining nullable ProviderHeaders boundary from candidate #23 `243015b85e9159c785bdfa09053bb9eac12aab74`. Final source removes Session's `withoutDeletedHeaders` conversion and propagates `ProviderHeaders` through request auth, compaction helpers, branch summaries and bug-report summaries. Existing direct tokenizer precedence is already correct and is not rewritten.

Session auth resolution previously filtered out null-valued headers. Optional tokenizer requests merge generated Authorization, model headers and caller headers afterward, so a discarded null marker could no longer suppress the generated bearer value. Native summary adapters independently resolve auth, so the defect must not be generalized into a claim that all summary HTTP requests leak headers.

## Change

Remove the obsolete stripping helper. Both native-required and custom-stream summarization auth exits retain `result.auth.headers`; RequestAuth and their return shapes use ProviderHeaders. Public generateSummary/generateSummaryWithUsage/compact headers, internal createSummarizationOptions, GenerateBranchSummaryOptions and bug-report summary options now accept ProviderHeaders. No old types/compat shims remain at this scoped boundary. Provider-generated defaults are still consumed by the existing case-insensitive final merge; no permission/transport policy, retry, upload eligibility or API-key behavior changes.

## Consumer-visible proof

Existing `tokenizer-authorization.test.ts` actual native fixture resolves auth normally, adds a lower-case authorization:null tombstone through getAuth, then runs real Session compact/tree-summary/bug-report/custom-stream requests. Fetch captures the final actual HTTP headers; no mocked forwarded-options or call-count assertion is used. Compact also verifies /tokenize and full chat-template /chat/completions/input_tokens requests both suppress Authorization while exact context count remains 100.

RED on current source: **1 failed / 3 passed / 31 skipped, 2.49s**. Compact summary itself already omitted Authorization; fragment tokenizer incorrectly sent `Bearer offline-tokenizer-key`. Branch, bug-report and custom-stream summary suppression were passing controls, not additional reproduced defects. After the cutover all four cases passed (**2.54s**).

Final post-format owners: **115 passed / 7 files, 5.51s** (tokenizer auth, summary budget, compaction publication, compaction reasoning, branch summary, bug-report UI/redaction, retry policy). Existing AI tokenizer precedence owners: **10 passed / 1 file, 0.32s**. Full final check **1766 / No fixes applied, 14.33s**. Earlier check passed but fixed two owned files (**13.46s**); final focused tests followed formatting.

Runtime is actual source Session/SDK/native OpenAI adapter/tokenizer HTTP construction with scripted local fetch responses, no network or paid providers. Auth injection isolates the resolved-auth boundary; it is not a Cloudflare login or all-provider transport proof. Summary controls prove their listed HTTP requests only. No retries/auth-refresh matrix, all-adapter suppression, full interactive Enter or crash claim is made. Public type acceptance is checked by the full TypeScript check; no permanent wiring-only type tests were added.

## Review and delivery

After requested payload-security assertions and guide precision: final actual seven-file owners again **115 passed / 7, 5.23s**, AI tokenizer control **10 / 1, 0.32s**, full check **1766 / No fixes applied, 13.75s**. Every listed summary HTTP body contains neither authorization nor the fixture API key. The guide now explicitly limits optional token counting to compaction. The RED remains compact-only **1 failed / 3 passing controls**; these additions do not invent further pre-fix failures.
Code review: skipped (ce-code-review unavailable). Two bounded native source/proof reviews are supplemental, not portable CE or cross-model coverage; their delivered results are recorded below.

Owned four source files, existing tokenizer auth test, compaction guide and this review only. No changes to AI tokenizer merge implementation, model catalog, dependencies, branches/worktrees/push or changelog. Normal explicit-path commit precedes fixed committed source/test/guide aggregate; review-only amendment records actual tested SHA separately from final SHA. Full 44-candidate migration remains open.

HeaderTombstoneSourceReview and HeaderTombstoneProofReview completed bounded source/proof review with **no actionable findings**, including final payload-security assertions and compaction-only counting wording. They verified both auth exits/types, unchanged permission gates, final fetch header oracle and unshared runtime spy lifetime. Neither ran tests/checks. Four runtime cases do not exercise the distinct compat `streamSimple` / `_getRequiredRequestAuth` branch, arbitrary custom transports consuming supplied options, other providers, auth refresh/retries or UI. Those paths have source review only. Recovery-only protection hashes matched **749 / zero mismatches**.

SDK identity was verified from construction: `sdk.ts:401-412` creates its own standardStreamFunction and passes it to Agent at line 423, so it is not compat streamSimple. Cases are named sdk-compact, sdk-branch, sdk-bug-report and wrapped-sdk-compact; both original and delegating SDK paths use the summarization-auth branch. The `_getRequiredRequestAuth` runtime limitation remains accurate. No P18 temporary smoke/loader scripts were created; the previously removed D04 drafts remain outside this unit.

After path-label clarification, final focused owners again passed **115 / 7, 5.30s**; AI tokenizer control **10 / 1, 0.32s**; full check **1766 / No fixes applied, 12.01s**. Only labels/condition literals and review accuracy changed after the reviewers' final source pass; production propagation and payload assertions are unchanged.

## Fixed committed-source/test/guide aggregate

Normal explicit-path implementation commit `d42b3a3b1` includes exactly the seven owned source/test/guide/review paths; hook passed **1766 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed source/test/guide tree passed **8631 passed / 0 failed / 936 skipped**, exit 0, **100.18s**, full output `artifact://4546`. No next-unit source/test/guide edits occurred during execution. The following review-only amendment preserves product blobs and records the aggregate against `d42b3a3b1`, not the future final SHA. P18 is closed after canonical receipt synchronization; remaining product clusters and the full migration remain open.
