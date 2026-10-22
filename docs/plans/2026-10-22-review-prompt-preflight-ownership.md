# Review: recheck prompt ownership after asynchronous preflight

Date: 2026-10-22
Parent: `4a0090aa1`.
Source: authored `f5825ecd7744162d449e247eb7c452570d8413aa` AgentSession hunks (214–300), final backup `cb3bee033ba853041609b874303dc625d5d30479` prompt arbitration. The same source review's active automatic-compaction confirmation is preserved as a control, not a newly introduced queue policy. No interactive scheduler migration is included.

## Defect and RED

Prompt A can suspend in before_agent_start while prompt B starts a real run. On resuming, A published its prompt/tool loadout and reported `started` before Agent rejected the concurrent request. `_runAgentPrompt` had already claimed B's lifecycle cleanup; its finally could settle and clear B's run state. With followUp/steer options A still failed rather than queueing.

New deterministic gates hold A's preflight and B's provider response. Before production edits: **3 failed / 3 controls passed / 2 files**. Reject variant observed the false `started` disposition; followUp and steer variants received the low-level already-processing error instead of queue success. Both active-run threshold-compaction queue controls and the existing independent manual/RPC compaction rejection passed. No timeout or default unlimited retry was used to diagnose the race; retry is disabled and all gates are released in finally.

## Final adaptation

- `_runAgentPrompt` rejects foreign active run/signal before changing cancellation, failed-response, selection or cleanup ownership.
- `prompt()` rechecks current run/compaction after auth, pre-prompt compaction, before_agent_start and image normalization. The existing initial post-input/template queue point shares the same dispatch helper.
- The helper is called only under a current busy guard. It queues active-run steer/followUp using existing methods/disposition, rejects missing queue policy, and rejects compaction without an active run. It returns void rather than importing the backup's unused boolean return path.
- Loadout publication, pending-next-turn consumption and `started` stay after the final check. No mutex, reserved idle-preflight owner, new auth transport or retry policy added.
- Existing extension-command dispatch remains first; initial manual compaction guard and active-run automatic compaction queue behavior are unchanged. Source shows `_compactionAbortController` is independent/manual state, while automatic compaction remains owned by `_isAgentRunActive`.
- Public SDK guide documents yield/recheck, foreign-run settlement ownership and manual versus active compaction behavior. Signature unchanged; no changelog on crystal.

TypeScript references for public AgentSession.prompt returned 488 callers (UI, RPC, print, SDK and tests); no caller signature migration required. Source getter lookup confirms isStreaming uses session-owned `_isAgentRunActive`. Graph metadata/coverage unavailable due previously reported WeakMap device failure; no graph completeness claim.

## Verification

First green: **30 passed / 4 files** (new ownership, existing prompt, manual RPC7150, concurrent owners). After formatting: **60 passed / 5 files**, adding full queued compaction regression owner. Assertions verify accepted dispositions, no foreign prompt publication, active system prompt identity, waitForIdle not resolved early, no premature agent_settled, exact user requests, successful B completion and exactly one final settlement; steer/followUp each reach the next request once. Threshold compaction controls retain accepted queue input and exactly one final settlement.

`npm run check` passed **1727 files, Fixed 1** (new test formatted), including browser smoke. Final pre-commit check and normal commit hooks passed **1727 files, No fixes applied**. Committed source/test/public-doc tree `bdec68914` passed root `rtk proxy ./test.sh`: **8144 passed / 0 failed / 945 skipped**, exit 0, 86.43 seconds, full output `artifact://2436`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record.

Actual SDK smoke uses existing Node workspace source resolver, createAgentSession, real DefaultResourceLoader inline hook, in-memory ModelRuntime/credentials and controlled faux provider. Observed foreign rejection with **no disposition**, B still streaming and no settlement before release; B then completed with **one settlement**. No real credentials/provider HTTP. Initial smoke imported AuthStorage from the public SDK incorrectly and failed before execution; installed source exports showed its internal source path, then the corrected smoke succeeded. Temporary file removed.

Parent source tree `359048384` aggregate: **8139 / 0 / 945**, 82.01 seconds, `artifact://2410`; its doc-only amendment is 4a0090aa1. Not new-unit aggregate evidence.

## Limits

Only a foreign still-active run is rechecked; this does not serialize two entirely idle preflights or revert direct side effects a user extension deliberately performs while awaiting. Saved effective prompt parity, physical routing, durable prefill capture/replacement, completed-summary receipts and usage identity are separate pending units. No branch navigation, scheduler or provider adapter change is claimed.

Final pre-commit `npm run check`: **1727 files, No fixes applied**, including browser smoke. ForeignPreflightAudit and PreflightCompactionAudit independently returned correct/no findings for bounded static review of dispatch/loadout ordering, run cleanup ownership, active queues, compaction and RPC dispositions. Neither ran tests/checks/builds/formatters; runtime evidence is parent execution above. Protected artifact manifest: **749 SHA256 checked / 0 mismatches**.
