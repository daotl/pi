# Review: existing edit and startup heartbeat constraints

## Source and scope

V05 candidate #23 `243015b85e9159c785bdfa09053bb9eac12aab74` edited tool arguments guidance and candidate #19 `513e503a4ecf728e39a12333f94c66e7749ca4ed` CLI heartbeat option guidance. Current message-edit.ts397-407 rejects valid JSON arrays, null and scalar arguments; main.ts654-658 rejects heartbeat startup outside interactive mode except plain runtime metadata commands. Product behavior already exists.

Add one sentence beside the editable XML sections and mark the existing heartbeat option description interactive-only. No parser, startup mode, command routing, trust or scheduling change. Read current edit/option sections and source contracts; no unrelated README restyling or model-example updates.

## Verification and delivery

Existing message-edit safety/startup heartbeat consumers **18 passed / 2 files, 5.06s**. These cover startup subprocess mode rejection and lossless edit formatting refusal, not a newly executed argument-object parser matrix. The object-only statement is checked directly against parseToolCallArguments source. No new runtime test for copied prose or full recurring heartbeat cadence claim.

Code review: skipped (ce-code-review unavailable). Both bounded native source/proof reviews report no actionable findings; neither executed tests or independently verified timings. These are supplemental, not CE/cross-model receipts. No physical-terminal or all platform/option-combination claim. Documentation-only unit owns coding-agent README and this review; normal hook validates checks, no new root aggregate claimed.

Normal documentation commit `b7f7ac58f` passed its full hook: **1770 files / No fixes applied, 11.58s**. Both independent reviews completed before commit. The following review-only amendment records the hook receipt; coding-agent README content stays unchanged. No new root aggregate is claimed.
