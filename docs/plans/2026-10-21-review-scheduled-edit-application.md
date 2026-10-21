# Review: continue only accepted scheduled edits and keep unsent drafts

Date: 2026-10-21
Migration base: `ae021afe0`
Source chain: `0a9acad1` edit application returns success and scheduled continuation checks it; `aecd4434` explicit editor-origin clear policy. Keep current edited/added/versioned/swiped counters.

## Problem and RED

runScheduledAction continues after empty or rejected edits because handleApplyMessageEdits swallows errors/returns void. Successful scheduled edits also clear an unrelated user draft. Four regressions fail: accepted scheduled edit erased draft; empty/invalid edits each continued; editor-origin result did not report false (**4 failed**).

## Adaptation

Return boolean acceptance from the existing UI helper. Scheduled caller uses clearEditor:false and returns without continue on failure/no-op; actual editor submit uses clearEditor:true. Preserve current refresh, error reporting, stopReason and swipe product semantics. No new scheduler preflight/queue/cadence policy or transactional mixed edit claim.

## Verification

Scheduled edit application, schedule, heartbeat and actual AgentSession edit suites: **175 passed**. New integration uses real AgentSession edits behind prototype UI methods; draft state and accepted changed user content are asserted, failed/no-op history remains unchanged, continue is invoked once only for accepted edit. Existing editor control proves rejected text stays and accepted edit clears. This is UI method/state proof, not physical terminal interaction; no provider/network request.

`npm run check` passed (1717 files; test formatted). Post-format owning suites: **175 passed**.

Fixed scheduler source tree47c63bed0 passed authoritative `./test.sh`: **7998 passed / 0 failed / 999 skipped** (artifact2052), including existing packed SDK/CLI consumer smoke. This is combined verification with deferred cancellation, not completion of remaining scheduler claim/preflight/cadence groups.
