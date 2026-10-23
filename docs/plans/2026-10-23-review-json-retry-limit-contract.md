# Review: explicit unlimited retry limits in JSON/RPC events

## Problem and final source chain

Parent `c2dc16869`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #22 `6f1cfc1f5511b7ce600843d31eb72661587f9a80`, frozen json-event patch1105-1135, defines retry wire limits separately from internal Session events.

Internal unlimited retry already uses Infinity; JSON.stringify already converts that number to null. The bug is that toJsonEvent still returned Infinity and JsonAgentSessionEvent still advertised only number, contradicting the record that JSON/RPC consumers receive. This repair does not add unlimited retry or change retry budgets.

## Adaptation

Distribute a nullable maxAttempts override over the two retry event variants, preserving their discriminants and other fields. Exclude their internal variants from JsonAgentSessionEvent, and project only positive Infinity to null using a fresh event copy. Finite configured limits remain unchanged, and original AgentSessionEvent/TUI/retry policy retains Infinity. Existing message-update snapshot removal and tool metadata stay unchanged. Public RPC/root wire consumers were located with LSP before editing; no caller requires the old incorrect number-only wire assumption.

Existing JSON usage regression gains finite/unlimited cases for auto_retry_start and summarization_retry_scheduled, asserting pre-serialization projection, JSON consumer result and original-event immutability. JSON and RPC guides document null/unlimited versus finite numbers.

## Evidence

- Actual source RED **2 failed / 1 passed / 2.30s**: both retry projections returned Infinity rather than explicit null. The existing usage update control passed. JSON serialization alone is not the failing oracle because it already coerced Infinity to null.
- After repair, four JSON streaming/tool metadata/JSONL owner files **9 passed / 3.37s**.
- First full check **1765 / Fixed 1 / 14.04s** passed; formatted the owned test, not a no-fixes result. Final post-format owners **9 passed / 4 files / 3.91s**; full check **1765 / No fixes applied / 15.36s**.
- Actual Node source projection/JSONL smoke emitted four lines with consumer limits `[null,3,null,3]` across the two kinds, while original Infinity remained unchanged: `{"actualSourceProjection":true,"eventKinds":2,"internalInfinityPreserved":true,"consumerLimits":[null,3,null,3]}`, **0.09s**. It exercises toJsonEvent and JSON stdout records, not a full RPC retry child or provider loop. Temporary script removed.
- Final type-oracle follow-up annotates each projected wire value as the exported `JsonAgentSessionEvent` and checks the finite-or-null expected object with `satisfies JsonAgentSessionEvent`. A number-only retry contract cannot accept that nullable construction under the full TypeScript gate. Owners again **9 passed / 4 files / 3.42s**; full check **1765 / No fixes applied / 13.46s**. Native review follows this final state.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host exposes skill reads but no skill invocation primitive; bounded independent native source/proof review is supplemental, not portable CE or cross-model coverage. Results recorded on delivery.

No retry policy, TUI maxAttempts, provider transport, arbitrary nonfinite validation, compaction lifecycle, dependencies/lock/generated/changelog changes. Owned source/test/two guides and this independent review only. Normal path-limited commit precedes fixed-tree root aggregate, followed by review-only receipt amendment. Exact tested/final hash and aggregate recorded after execution. Full 44-candidate migration remains open.

RetryWireSourceReview and RetryWireProofReview completed bounded read-only review with no actionable runtime/test findings. Both identified the same residual illustrative TypeScript union in json.md: it still transformed only message_update. That example now excludes both internal retry variants and includes a distributive nullable retry union, matching the completed candidate. No production or test change followed the reviews. Neither reviewer ran verification; source/JSONL smoke is not a full child-process retry. Final guide-only correction does not widen the feature scope.

## Fixed committed-source/test aggregate

Normal path-limited implementation commit `17ccad8d1` includes exactly source/test/two guides/this review; its normal hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on this committed source/test tree passed **8599 / 0 failed / 936 skipped**, exit 0, **92.79s**, full output `artifact://4272`. No next-unit source/test changes occurred during execution. Following review-only amendment preserves verified source/test/guide blobs and records the aggregate against `17ccad8d1`, not the future amended SHA. This closes P10 only; full migration remains open.
