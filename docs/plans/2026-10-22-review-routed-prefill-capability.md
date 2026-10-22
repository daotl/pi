# Review: validate prefill capability on the resolved request API

Date: 2026-10-22
Parent: `2a14c81e4`.
Source chain: authored `ff0f22eb780decb94a196a2700cc6ba44446116e` Agent/loop hunks defer selected-model validation until routing; `deede133ff5bc52ba82ea52f01ea27acd712a430` supplies later low-level error-settlement controls. Final backup: `cb3bee033ba853041609b874303dc625d5d30479`, Agent continue and loop post-prepareRequest capability check. Existing stream settlement/execution-model tracking is already landed through `551975eab`; it is reused, not overwritten with the backup's older stream architecture.

## Defect and RED

The initial selected API was treated as final. A virtual selection routing to openai-completions was rejected before its router ran, while an openai-completions selection routed to an incompatible API was dispatched with returnPrefill anyway. Low-level start/continue consumers had the same capability mismatch at different stages.

Before production changes, **4 failed / 1 ordinary-request control passed**:

- Public Agent compatible virtual route rejected before dispatch.
- Public supported selection routed to anthropic-messages dispatched once instead of zero.
- Low-level start dispatched the incompatible request once.
- Low-level continue threw at initial selection validation instead of settling the routed failure stream.

## Final adaptation

- Agent.continue and the low-level initial assistant-context validator reject selected incompatible APIs immediately only when no prepareRequest router exists.
- After each request preparation/update, returnPrefill requires actual config.model.api to be openai-completions, before context conversion/auth/provider dispatch. A router returning no update cannot evade this final check.
- Existing selected-model state remains unchanged, returnPrefill remains first-response-only, and ordinary non-prefill requests retain all APIs.
- Low-level execution.model is still updated before validation, so its failure lifecycle carries the routed model identity. Error publication/iteration/result settlement reuse the existing implementation.
- README and continue JSDoc state physical API validation. Public signatures unchanged; LSP Agent.continue references identified 36 consumers including Session continuation paths before the change.

This is capability validation only, not the Session same-provider/model prefill-origin policy. The generic public Agent error receipt still uses its existing selected-model attribution; changing that broader RAW contract is not part of this unit. Completed rejected echo receipt attribution remains as landed. No route authentication, transport permissions, system-patch ordering, durable capture, Session architecture or experimental harness changes.

## Verification

Agent routed/terminal/natural/core/loop owners: **142 passed / 5 files**, both before and after formatter. Session continuation/terminal-receipt/queue-only/virtual-model owners: **27 passed / 4 files**. The new low-level tests await both stream iteration and result, assert zero provider dispatch, routed failure metadata, zero completed charge, balanced message lifecycle and one agent_end; no incidental error wording pin.

`npm run check` passed **1728 files, Fixed 1** (new routed test formatted), including browser smoke. Normal commit hooks passed **1728 files, No fixes applied**. Committed source/test/public-doc tree `32879513f` passed root `rtk proxy ./test.sh`: **8149 passed / 0 failed / 945 skipped**, exit 0, **85.07 seconds**, full output `artifact://2466`. No next-unit source/test changes occurred during the aggregate; this amendment changes only this review record. Protected artifact manifest was rechecked afterward: **749 files / 0 mismatches**.

Native Node with existing workspace source resolver exercised actual public Agent.continue: compatible virtual route **1 provider request / stop**; incompatible route **0 provider requests / error**; virtual selection remained `auto` in both. Controlled local stream, no HTTP/provider credentials. Temporary smoke removed.

Parent source/test tree `bdec68914` aggregate passed **8144 / 0 / 945**, 86.43 seconds, `artifact://2436`; parent amendment 2a14c81e4 changes only its review. Not current-unit aggregate evidence.

## Remaining migration

S2 still owns durable prefix capture/replacement/restoration, physical origin compatibility and trailing-system reconciliation. S9 owns fresh tokenization authorization/direct-transport permission. S10 owns stable usage identities, pending receipts and full RAW failure attribution. This unit does not claim those completed.

Compatibility control: the existing Agent unsupported-prefill/no-router test was strengthened in place (not duplicated). It now asserts rejection before any stream dispatch or lifecycle event, unchanged user history and idle state, replacing its incidental error-wording assertion. The five Agent owners again passed **142** after this strengthening. The selected model uses the existing unsupported default; it has no router. Current owned paths therefore also include `packages/agent/test/agent.test.ts`.

Independent bounded static audits RoutedPrefillGuardAudit and RoutedStreamSettlementAudit returned correct/no findings. They checked all three guard sites, virtual/undefined/ordinary route behavior, first-response flag reset, physical low-level error identity and stream iteration/result settlement. Neither performed runtime tests, builds, checks, formatters or edits; runtime evidence is parent execution above. Protected user artifacts: **749 SHA256 checked / 0 mismatches**. Graph generation/coverage remains unavailable (WeakMap); exact source/LSP fallback used.

Final compatibility-control check passed **1728 files, Fixed 1** (formatter expanded the strengthened subscriber callback); the five Agent owners passed **142** again afterward. The earlier pre-strengthening check had No fixes applied; these are distinct executions, not a claim that the last formatter changed nothing.
