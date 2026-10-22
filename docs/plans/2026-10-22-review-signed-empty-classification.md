# Review: retain empty assistant blocks carrying replay signatures

Date: 2026-10-22
Parent: `f85a3a356`.
Source chain: authored reasoning-signature predicate in `e3f076aa28c4d7c1373a3e68a35cbfd07a199bff` merge hunk 45373–45389, completed by text-signature preservation in `243015b85e9159c785bdfa09053bb9eac12aab74` lines116–132. Final backup `cb3bee033ba853041609b874303dc625d5d30479` uses both predicates. These are selected behavioral hunks, not the merge's imported file inventory.

## Problem and RED

isHarnessMessage considered only visible thinking/text and tool calls. Empty text/thinking carrying opaque replay identity was therefore dismissed as an empty harness notification, allowing continuation to regenerate the preceding user request and hiding the signed assistant from Session edit/deletion indexing.

Before production changes, direct Agent matrix **3 failed / 1 unsigned control passed** at signature classification. Assertions were then ordered consumer-first and run again: the same **3 failures** observed public Agent.continue resolving instead of rejecting after it regenerated the user, while unsigned empty notification retry still passed. Cases cover ordinary opaque text signature, structured Responses metadata and reasoning signature.

Session consumer RED: **2 failed**; getEditableMessage(0) selected the preceding user rather than the signed empty assistant, for text and thinking variants. Tests also retain soft-delete and restore assertions rather than pinning classification alone.

## Final adaptation

One predicate now treats nonempty textSignature or thinkingSignature as real assistant content, even with empty visible text. No allocation, parsing, signature normalization or provider dispatch policy. Unsigned empty notifications remain harness messages. Non-assistant and tool-call paths unchanged.

Public README explains preservation and context-only continuation behavior. No changelog on crystal. LSP isHarnessMessage references identified 24 uses in Agent trimming, Session deletion/edit/swipe/recovery and UI counts before changes; consumers reuse the predicate and require no parallel implementation. Current provider signature validation and signed edit refusal remain unchanged. No harness export or upstream swipe/restore/shred removal.

## Verification

Agent signed/system-tail/core/loop owners passed **125 / 4 files**, again after formatter. Session signed/soft-delete/swipe/continue/system-tail owners passed **41 / 5 files**, again after formatter. The Session tests verify exact targeted entry, user preservation during deletion and full signed message restoration.

Native Node with existing workspace source resolver exercised actual public Agent.continue with empty signed reasoning behind a policy patch: **0 provider requests**, same signed turn retained, idle true. Controlled stream fallback was not dispatched; no credentials/HTTP. Temporary smoke removed.

`npm run check` passed **1732 files, Fixed 2** (two new tests formatted), including browser smoke. Final check and normal commit hooks passed **1732 files, No fixes applied**. Committed source/test/public-doc tree `b4a134217` passed root `rtk proxy ./test.sh`: **8167 passed / 0 failed / 945 skipped**, exit 0, **87.73 seconds**, full output `artifact://2548`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifacts rechecked on committed tree: **749 files / 0 mismatches**.

Parent source/test tree `84871810e` aggregate passed **8161 / 0 / 945**, 86.67 seconds, `artifact://2514`; `f85a3a356` changes its review only. Not current-unit aggregate proof.

## Boundaries

No provider replay transformation, foreign signature policy, Session atomic capture, usage identity or explicit prefill patch rotation change. Signature-only turns remain meaningful but do not automatically become supported prefills for every model/API. Existing consumers decide continuation eligibility separately.

Final pre-commit check passed **1732 files, No fixes applied**, including browser smoke. SignedEmptyAgentAudit and SignedEmptySessionAudit independently returned correct/no findings for bounded source review of classification, continuation, edit/deletion/swipe and metadata preservation. Neither ran tests/builds/checks/formatters; runtime evidence is parent execution above. Protected artifact manifest: **749 SHA256 / 0 mismatches**. Graph coverage unavailable (WeakMap); source/LSP fallback, no exhaustive external-caller claim.

Direct helper closure: all three signed cases now assert `stripTrailingHarnessMessages` returns the original `[user, signed, system-patch]` array, in addition to public Agent history/zero-dispatch behavior. Agent owners again **125 / 4 files** and check **1732 files, No fixes applied** after this assertion. Test count unchanged; no duplicate row added.
