# Review: protect existing opaque reasoning bodies during edits

Date: 2026-10-21
Migration base: `143dc6df1`
Source chain: `2093b87f` occurrence-matched body/redaction validation; `444bce20` exact unredacted Completions field-selector exception. Metadata spread was migrated separately.

## Problem and RED

Current edit/version/swipe paths allow changing reasoning text while retaining opaque provider signatures. Two actual AgentSession version/swipe regressions failed (**2 failed / 3 passed / 63 skipped**); three exact unsigned Completions selector controls already passed.

## Adaptation

Match existing signature occurrences in original content order. Retaining an existing opaque signature requires unchanged body/redacted state; an exhausted repeated occurrence rejects. Exact reasoning_content/reasoning/reasoning_text markers are editable only for unredacted openai-completions source content. New signatures remain allowed; this is replay integrity, not signature authentication. No parser ordering/refusal or mixed-edit persistence transaction claim.

The lexical swipe fixture previously targeted a root assistant after a later user; no assistant swipe group exists without a parent. This had passed under coincident entry timestamps by selecting the wrong role, exposed as a content.findIndex type error by the new guard. Fixture now creates a user anchor and selects the intended assistant before formatting swipe. No direct timestamp mutation remains; no product collision/role-selection repair is claimed.

## Verification

Three edit/swipe/lexical suites: **95 passed** with one worker. Coverage includes actual opaque rejection before a version/swipe publishes, unchanged signature Responses replay, unsigned field selectors, repeated-order/exhausted/new-signature controls, cross-API/opaque/redacted cases. Repeated/negative API controls are post-fix tests, not separate observed RED. No full mixed edit atomicity or live provider HTTP proof.

`npm run check` passed (1713 files; two changed files formatted). Post-format owning suites: **95 passed**.

Aggregate follow-up at `02e50bf46`: isolated `./test.sh` reported **7962 passed / 3 failed / 999 skipped**; one failure was this lexical swipe fixture, two were durable shell timeouts outside changed paths. Failed-assistant filtering correctly drops a trailing edited/aborted assistant from ordinary Responses replay. Fixture now uses a real tool-call/result suffix for swipe (visible swipe unit remains assistant; result makes edited stopReason toolUse), while edit retains its later user/stop control. No direct timestamp mutation or manual branch is needed. Three edit/swipe/lexical suites passed **95 tests** after correction. Subsequent isolated suites passed **7965 / 0 / 999** at99f3654bb and **7968 / 0 / 999** after audited invalidation corrections atdf452532c; durable source/timeouts remained unchanged, so load sensitivity is only an inference.
