# Review: JSON tool-call raw token increments

## Source and scope

V05, candidate #30 `26cb5df97f1fbe6266113f2a6be681605fca81cc`, exact behavior `json.md rawDelta row`. Existing AssistantMessageEvent.toolcall_delta includes optional rawDelta independently from delta, including raw-only updates. JSON conversion removes only partial snapshots and retains the other fields. The reference table omitted this existing wire field.

Read the complete JSON guide, declared event contract at packages/ai/src/types.ts:793-805, and complete json-event.ts conversion. Change only the toolcall_delta table row: name optional rawDelta and distinguish raw tokens from serialized argument data, including an empty JSON delta. No runtime/type/wire changes, new examples or unrelated guide restyling.

## Verification and review

Existing JSON conversion/framing controls: **7 passed / 2 files, 3.25s**, test/suite/regressions/7911-json-stream-usage.test.ts and test/rpc-jsonl.test.ts. These controls cover usage/partial omission, retry conversion and framing, not an independent rawDelta runtime scenario. Source proves spread retention; existing Agent proxy raw-only tests are separately committed evidence and were not rerun here. No new permanent test for a copied table row.

Code review: skipped (ce-code-review unavailable). The initial documentation commit preceded independent review; subsequent bounded native source/proof reviews both report no actionable findings. They inspected types, conversion and proxy raw-only consumers without executing tests or independently verifying timings. These supplemental reviews are not CE/cross-model receipts. No physical terminal, provider HTTP or measured cache behavior claim.

Owned paths are packages/coding-agent/docs/json.md and this review. Documentation-only commit; normal hook validates repository checks. Actual tested committed-tree aggregate, if run, is recorded separately from any review-only amendment. Remaining V05 guides are separate units.

Normal initial documentation commit `425f45caa` passed its hook: **1770 files / No fixes applied, 29.29s**. This review-only amendment adds the independent review results and exact hook receipt; the JSON guide itself is unchanged. No new root aggregate is claimed for this documentation-only change.
