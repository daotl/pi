# Review: keep assistant prefills on their physical provider and model

Date: 2026-10-22
Parent: `cbf1d12cc`.
Source chain: `ff0f22eb780decb94a196a2700cc6ba44446116e` introduces virtual-origin candidate/route checks; `e13924536243de16b20af0b0eb8d117056f22ec8` validates the same explicitly selected request prefix; `6b96c54b1769743cfded773928104d7bfe460c2b` broadens the final validator to physical selections/direct-Agent callers too. Final backup `cb3bee033ba853041609b874303dc625d5d30479` Session967–998. No unrelated virtual-router architecture or old whole-file restoration.

## Defect and RED

A virtual selection's API is not the prefix's physical API, so Session auto-detection discarded an interrupted Completions prefix and regenerated from the user. Request projection also trusted an arbitrary target with the same API, allowing an explicit foreign provider/model prefix through.

Before production edit: **4 failed / 1 same-origin control passed**. Compatible virtual route sent an ordinary user-only request without prefill; switched virtual model still dispatched; direct-Agent prefixes with foreign provider or model each dispatched once instead of zero. Actual response/request snapshots, not hypothetical routing claims.

## Final adaptation

- Virtual-selection candidate eligibility uses the assistant response API; physical selections keep their current API eligibility. Existing completed stop and queue policies remain unchanged in this unit.
- Validate the actual selected prefix for every explicit prefill request, whether Session-owned or direct-Agent: resolved physical API must be openai-completions and provider/model ID must equal the prefix's provider/model.
- Nonvirtual routes validate before returning. Virtual routes validate immediately after resolution, before publishing returned router state, compaction side effects or stream dispatch.
- Virtual selection stays in state; only the request targets a physical model. Failure follows existing content-free error/Session original-prefix restoration. Direct-Agent caller still owns its prefix restoration.
- No new receipt framework, auth policy, queue semantics or broader prefix metadata normalization. Public virtual-model guide documents same-origin requirement. No changelog on crystal, experimental harness exports or upstream swipe/restore/shred removals.

The final authored guard compares physical API/provider/ID; it does not introduce an additional prefix.api check absent from that source. Current generic Agent route-error attribution and Session durable capture remain separate pending contracts.

## Verification

First full owners: **38 passed / 6 files**. Expanded router-state rejection control: **39 passed / 7 files**, including origin, explicit projection, prefill, durable system tail, virtual routing, queue-only and terminal receipt. Five new rows cover compatible/incompatible virtual continuation plus same/foreign-provider/foreign-model direct-Agent physical requests. An incompatible virtual route returns new router state but tests verify no state entry is published, no provider call occurs and the original partial is restored; compatible route sends the actual prefix with returnPrefill true. Virtual selection remains auto and Session settles idle.

Native Node existing workspace source resolver with actual SDK/DefaultResourceLoader/faux runtime and virtual selection routed original→different: **0 extra provider requests**, original partial retained, selection auto, idle true. No real credentials/HTTP. Temporary smoke removed.

Check chronology: initial **1736 files, Fixed 2** (source/new test formatted), passed including browser smoke. Final check and normal commit hooks passed **1736 files, No fixes applied**. Committed source/test/public-doc tree `9a9b7e5db` passed root `rtk proxy ./test.sh`: **8206 passed / 0 failed / 945 skipped**, exit 0, **94.38 seconds**, full output `artifact://2685`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifacts rechecked on committed tree: **749 files / 0 mismatches**.

Parent authoritative source/test tree `05d1ab147` aggregate **8201 / 0 / 945**, 95.72 seconds, `artifact://2650`; `cbf1d12cc` amended its review only. Not current-unit aggregate evidence.

## Limits

No S2 durable in-flight capture/replacement/atomic restore, approved-retry candidate reconciliation, effective saved prompt/loadout, tokenization permission or usage identity migration. Current stopReason and accepted queue behavior are intentionally unchanged; complete final-backup candidate policy has further dependencies. Real providers and unavailable external routers are not tested.

Router-state assertion check passed **1736 files, Fixed 1**; final check **1736 files, No fixes applied**, including browser smoke. Final post-format seven Session files passed **39**. PhysicalPrefillOriginAudit and VirtualPrefixEligibilityAudit independently returned correct/no findings for bounded static review of prefix eligibility/ownership, validation ordering, state publication, dispatch and restoration. Neither ran tests/checks/builds/formatters; runtime evidence is parent execution above. Protected artifacts: **749 SHA256 / 0 mismatches**. Graph generation/coverage unavailable (WeakMap); exact source/LSP fallback, no exhaustive external-router claim.
