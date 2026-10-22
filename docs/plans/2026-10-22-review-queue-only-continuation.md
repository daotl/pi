# Review: distinguish queued input from an approved prefix retry

Date: 2026-10-22
Migration parent: `f1cddcc44`.
Source: final queue-only repair in `7cfc4563ad539607c1f02ef56bd76b38d5fcacf5`, retained in backup `cb3bee033ba853041609b874303dc625d5d30479`; Agent's skip-initial-steering companion is present in the authored merge `e3f076aa28c4d7c1373a3e68a35cbfd07a199bff`. Select request ordering only, not that commit's durable capture/receipt/provenance architecture.

## Problem and RED

After disabled/exhausted retry, accepted steering/follow-up causes `_continueOnce` to recapture the errored partial as if another prefix retry had been approved. Four public-session rows fail before source changes: repeated returnPrefill requests or steering echo mismatch; a bounded five-response script clears the queue on the broken path to avoid an indefinite test.

## Adaptation

If there is queued input but no explicit prefill, pending prefill or approved failed response, delegate directly to Agent.continue rather than auto-capturing a partial. For an actual prefill continuation, skip the first steering poll so accepted input cannot replace the approved prefix request. Queued steering remains available for the subsequent ordinary request.

After the session-only change, three new rows passed but one approved-steering row still failed, proving the Agent companion was required. Applying it exposed an old regression fixture that expected accepted steering never to be delivered. Adapt it to the final authored four-response sequence and assert original completed prefix followed by the steering answer. Remove its overwritten first response setup and replace incidental total-entry counts with semantic last-message deletion checks.

## Verification

Queue-only/continue-prefill/retry-lifecycle/queued-compact files: **47 passed**. Four new rows verify disabled or one-attempt budgets across steering/follow-up, exact request prefill transition, accepted input in the final request, final answer and drained idle queues. Existing retry control now proves approved prefix priority followed by delivery, not loss of steering. Agent and Agent-loop owners: **113 passed**.

Faux/scripted requests only; no live provider or durable in-flight capture claim. Trailing system-patch queue reconciliation and physical-route guards remain separately pending. No new test fixes provider wording, mocks copied config, or widens retry limits.

`npm run check` passed (1723 files; two test files formatted). Post-format owning runs: coding-agent **47 passed**, Agent/loop **113 passed**. Normal commit hooks remain enabled.
