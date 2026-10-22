# Review: system patches are transparent to continuation tail selection

Date: 2026-10-22
Parent: `623269a79`.
Source chain: authored `e13924536243de16b20af0b0eb8d117056f22ec8` effective non-system validation and trailing notification trimming; final backup `cb3bee033ba853041609b874303dc625d5d30479` Session candidate/source lookup and complete prefix/suffix restoration. Adapt current Session capture/replay rather than importing the backup's atomic continuation architecture.

## Defect and RED

Trailing system patches hid the effective assistant role from Agent and low-level continuation validation. System-only contexts dispatched, completed answers could regenerate, empty harness notifications leaked into requests, and follow-up input triggered an unwanted extra old-context request.

Agent public/stream/run consumer RED: **7 failed / 1 steering control passed**. Four rejection cases dispatched system-only/completed-assistant contexts; two request cases retained empty notifications across patches; follow-up dispatched twice instead of once. No production edit preceded this RED.

The first Agent fix exposed a Session integration gap: `_detectPrefillCandidate` still read literal last system, and `_capturePrefill` could target that system entry. Public Session success/mismatch tests produced **2 failures** before dispatch. Canonical non-system detection and existing source-ID resolution fixed success, but mismatch then demonstrated discarded trailing patch: **1 failed / 11 passed** across three files. `appendTrailingEntries` skipped all message entries, including policy patches. System-only suffix replay now retains them.

## Final adaptation

- Agent.continue and both low-level continuation entry points validate the last non-system message; undefined effective tail rejects before dispatch.
- `stripTrailingHarnessMessages` scans across system patches and removes only trailing empty harness notifications. Policy order and older history are unchanged. No allocation when nothing is removed.
- Session auto-prefill detection follows the same effective tail. Capture resolves the actual projected contribution through existing `_findPersistedMessageEntryId`, not a backward raw scan that can select a system patch.
- Existing suffix replay builds fresh system-message entries with explicit type/ID/parent/timestamp/message fields and only preserves deletedAt visibility state; it does not spread historical entries or copy supersededBy. Conversational messages remain excluded. Success keeps patches on the active branch; rejected echo restoration replays them in order without reviving soft-deleted policies.
- README and session guide document effective tail and policy preservation. No changelog on crystal. Current swipe/soft-delete/restore/shred behavior and experimental harness remain intact.

LSP references: stripTrailingHarnessMessages has 15 references including Agent, Session and UI; appendTrailingEntries has only its declaration and Session restoration caller. Existing projected source-ID helper was inspected and reused. Graph project/generation/coverage remains unavailable due WeakMap; no exhaustive graph claim.

## Verification

Agent owners passed **140 / 5 files**, including existing routed/terminal/core/loop consumers; post-format again **140**. Session owners first passed **46 / 5 files** after replay correction. Expanded file-backed Session proof plus continuation, receipt, queue, queued compact, swipe and soft-delete owners passed **72 / 7 files**. File-backed proof checks two ordered patches and exactly one effective original/restored or completed assistant after success/mismatch, both live and actual JSONL reopen.

Actual Node source-resolver public Agent smoke: **one request**, request roles `[user, assistant, system, user]`, queued follow-up drained; no regeneration or provider HTTP. Temporary smoke removed.

Check chronology: first Agent/new test formatting check passed **1729 files, Fixed 2**. Session durable proof then passed **1730 files, Fixed 1**. Final post-format check/hooks and fixed-tree aggregate recorded after execution.

## Explicit remaining scope

This is not signed-empty classification: isHarnessMessage signature handling is unchanged and pending. It is not low-level explicit returnPrefill patch rotation or PrepareRequest returnPrefill identity: those authored hunks remain separate. Existing Session capture still invokes deleteMessage and restoration still uses multiple writes; S2 durable held-prefix/atomic restore and S10 usage identities/receipts remain pending. No claim that generic Session completed-assistant fallback or all boundary preview semantics are fully migrated.

Parent routed capability source/test tree32879513f aggregate passed **8149 / 0 / 945**, 85.07 seconds, artifact://2466; amendment623269a79 changed its review only. Not current-unit aggregate evidence.

Independent SystemTailAgentAudit returned correct/no findings (static only). SystemTailSessionAudit found a concrete introduced stale-cache edge: earlier surgical deletion clones the active tail while reusing message objects; the cached source ID points to an abandoned entry. The new canonical capture then found no target, retaining duplicate partial on success or losing preceding history on mismatch recovery. Added cloned-tail success/mismatch rows produced **2 failed / 2 controls passed** before repair: success retained both old partial and completed response; mismatch lost both retained user messages.

The central `_findPersistedMessageEntryId` now accepts a cached ID only when it belongs to the active branch and still owns that same message object. Otherwise it resolves active-branch identity, refreshes the cache, then uses the existing projected-contribution fallback. No separate cache convention or capture-only exception. Nine Session consumer files passed **119** after repair, including boundary hooks and retry lifecycle in addition to the seven earlier owners. The durable matrix verifies preceding conversation, ordered policies and one effective assistant live and after reopen for both cloned and ordinary tails. Earlier 72-pass evidence did not cover this discovered edge and is not substituted for the new run.

SystemTailSessionAudit re-review returned correct/no findings after the central cache repair, including projected-copy fallback for context edits and deleted-tool-call filtering. All audits were source-only, no independent runtime claims. The last cache-repair check passed **1730 files, Fixed 1** (expanded cloned-tail test formatting); final post-format owners are recorded below. Protected artifacts rechecked: **749 SHA256 / 0 mismatches**.

Final post-format Session consumer run: **119 passed / 9 files**. Agent source/test changes remained fixed since their post-format **140 / 5 files** run. The temporary Agent source smoke was removed; actual JSONL reopen is retained as a permanent Session consumer regression.

Final metadata/order tightening removes the source entry spread and asserts the exact request `slice(-3)` as first patch, second patch, original partial. deletedAt is deliberately preserved because dropping it would reactivate a soft-deleted system policy. The four-row durable matrix now also soft-deletes a third policy and checks it stays excluded from requests and live/reopened effective context while retaining its deletion mark in the raw branch. This preserves current upstream soft-delete semantics rather than silently resurrecting instructions.

Final hidden-policy check passed **1730 files, Fixed 1** (new raw-branch assertion formatted), then the same nine Session owners passed **119** after formatting. SystemTailSessionAudit's final metadata re-review returned correct/no findings: fresh identity fields, no abandoned supersededBy/assistant-only metadata, preserved system message and deletedAt. Retaining deletedAt is intentional upstream visibility compatibility, not stale lifecycle copying. Normal commit hooks passed **1730 files, No fixes applied**.

Committed source/test/public-doc tree `84871810e` passed root `rtk proxy ./test.sh`: **8161 passed / 0 failed / 945 skipped**, exit 0, **86.67 seconds**, full output `artifact://2514`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifact manifest rechecked on the committed tree: **749 files / 0 mismatches**.
