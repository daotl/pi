# Review: retain response metadata through edit and swipe

Date: 2026-10-21
Migration base: `123d8db23`
Source: `2093b87f` shallow-spread original assistant before replacing content/stopReason (commit diff:378-387). Signed-body validation in the same historical commit remains a separate candidate.

## Problem and RED

editBlockToMessage reconstructs only api/provider/model/usage/timestamp. Editing discards physical responseModel, responseId, requested/native effort, rawStopReason and endTurn. Both actual AgentSession id0 version and pi_swipe paths fail the metadata assertions (**2 failed / 61 skipped**).

## Adaptation

Accept optional additional AssistantMessage metadata while retaining the existing required base fields. Spread it before replacing role/content/derived stopReason. Existing AgentSession current-tail aborted/tool-result stop handling stays authoritative. New assistant base construction, version count and swipe timestamps are unchanged; no new schema field.

## Verification

Message edit, swipe and lexical suites: **85 passed** with one worker. Actual apply paths verify response identity/effort/termination metadata survives while body changes and stopReason remains current upstream aborted semantics. No standalone disk reopen or provider replay proof is claimed for this unit.

`npm run check` passed (1713 files; two changed files formatted). Post-format owning suites passed **85 tests** again.

Follow-up on descendant 6d7b8475a: explicitly ran `test/virtual-models.test.ts` and `test/suite/virtual-models.test.ts` with one worker, **30 passed**. This is existing routing consumer regression coverage, not a new edited-response end-to-end routing scenario.
