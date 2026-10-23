# Review: reject non-assistant runtime prefills at the Session boundary

## Problem and final source chain

Parent `65e9b5be2`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #28 `2093b87fe2af9714f877d279fe1db3674fc278a8`, final backup AgentSession2758-2761 adds runtime role rejection before lifecycle work. Other proxy/origin/edit portions of that candidate have separate migrated-unit evidence.

`AgentSession.continue(prefill?: AssistantMessage)` had only a TypeScript role contract. JavaScript callers could supply user/system/toolResult prefixes: the Session cleared flags, prepared and appended its policy, and restored the invalid prefix into history before low-level Agent rejection. Finally cleanup did not undo those published entries. Rejecting late is not a prepublication boundary.

## Adaptation

At the first line of `continue`, reject a supplied non-assistant role using the existing low-level error text. Leave missing prefixes, valid assistant prefixes, run/compaction guards, capture/restoration, retry, prompt policies and provider origin validation unchanged. No schema expansion or arbitrary runtime shape validator.

The existing explicit-prefill consumer file uses Reflect.apply to exercise the actual JavaScript API boundary without falsely claiming TypeScript accepts the input. Three wrong roles must reject with unchanged entries/leaf/messages, no events/provider calls and idle state. Existing legitimate prefix, boundary projection, multi-turn continuation and physical origin cases run unchanged. SDK guide documents the early runtime rejection contract.

## Evidence

- Current-source RED **3 failed / 3 passed**, **2.43s**. Each wrong role threw the expected role error but appended a system policy and the rejected prefix into SessionManager first; assertions observed nonempty history instead of the original empty entries.
- After the entry guard: explicit-prefill, continue-prefill and origin-route owners **20 passed / 3 files**, **3.57s**. These verify valid continuation as well as rejection without side effects.
- Full check **1765 / No fixes applied / 16.67s** before the guide-only sentence and smoke. Final hook/check result follows after final owned state.
- Actual Node source SDK smoke used real createAgentSession, DefaultResourceLoader, SettingsManager and SessionManager with tools disabled; invalid user prefix rejected before history/events, remained idle. Output `{"actualSDK":true,"invalidPrefixRejected":true,"historyUnchanged":true,"events":0,"idle":true}`, **15.46s**. It does not dispatch a provider or test valid output; positive continuation proof is the focused suite. Owned script and temporary directory removed.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host has skill reads but no skill invocation primitive; bounded independent native review results are supplemental, not portable CE or cross-model evidence.

No provider network, paid tokens, full interactive UI, crash-durability, broad shape-validation or unrelated P13/scheduler/TUI claim. No dependency/lock/generated/changelog changes. Source/test/SDK guide and this review are the only owned paths. Normal path-limited commit precedes root aggregate; only review receipt is amended afterward. Exact tested/final SHA and aggregate result are recorded after execution. Entire 44-candidate migration remains open.

Final verification chronology: the first post-guide full check timed out after reaching `check:ts-imports` (Biome No fixes); a second timeout emitted no completion. Neither is counted as passed. A subsequent complete PTY-backed `rtk proxy npm run check` finished all stages: **1765 / No fixes applied / 105.07s**. No foreign process was stopped or modified. The final owning rerun again reported **20 passed / 3 files**; its background-run clocks are retained separately in the external receipt rather than combined with the earlier 3.57s run.

PrefillRoleSourceReview and PrefillRoleProofReview completed bounded read-only source/proof review with **no actionable findings**. They confirmed first-entry rejection, unchanged valid/omitted prefix paths, real Reflect.apply side-effect assertions and positive continuation/origin coverage. Neither reran verification. New regressions cover fresh idle sessions and wrong roles, not arbitrary object validation or every concurrent/recovery state. The actual SDK smoke only exercises invalid user rejection.

## Fixed committed-source/test aggregate

Normal path-limited implementation commit `db89da806` contains exactly source/test/SDK guide/this review; its normal hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that committed source/test tree passed **8595 / 0 failed / 936 skipped**, exit 0, **92.61s**, full output `artifact://4186`. No next-unit source/test changes occurred during execution. Following review-only amendment preserves the tested source/test/guide blobs; aggregate is attributed to `db89da806`, not the amended SHA. Recovery snapshot again matched **749 / zero mismatches**. This closes P12 only; the overall migration remains open.