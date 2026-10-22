# Review: reject unsupported completed-answer continuation without deletion

Date: 2026-10-22
Parent: `ebfc2ffdb`.
Source: `6f1cfc1f5511b7ce600843d31eb72661587f9a80` AgentSession fallback hunk1038–1058; final backup `cb3bee033ba853041609b874303dc625d5d30479` Session2876–2887. Preserve current upstream soft-delete/swipe/restore/shred semantics, no replacement Session architecture.

## Problem and RED

Session's no-prefill fallback permanently deleted any meaningful literal assistant tail and retried the preceding input. Completed answers were therefore regenerated without user authorization; error/aborted responses also lost their raw history and usage instead of being omitted only from the retry context.

Four public Session cases before production edit: **3 failed / 1 trailing-policy control passed**. Bare completed continuation resolved/regenerated instead of rejection. Error and aborted retry cases dispatched from the correct input but deleted the original entry (getEntry returned undefined). A completed answer behind system policy already rejected under the landed Agent effective-tail guard, providing a no-mutation control.

## Final adaptation

Fallback uses last non-system assistant and the final source's strict condition: only error/aborted, no queued messages, meaningful content. It invokes the existing append-only `_omitRecoveryAttempt`, retaining original response/usage in raw history while rebuilding request context. Completed answers remain authoritative; Agent.continue rejects without provider dispatch or deletion. Existing queued-input early delegation and approved retry path unchanged.

No new schema, receipt, retry policy, generic recovery abstraction or helper. Public session guide documents refusal versus interrupted omission. No changelog on crystal; harness exports, swipe/soft-delete/restore/shred implementations and origin-route rules are unchanged.

## Fixture correction chronology

The first owning run after production fix had **1 failed / 34 passed**: the old abort-after-echo fixture began with a completed default faux answer and merely changed selected API before continuing. It depended on the deleted-answer fallback rather than actually capturing a supported interrupted prefill. The final backup still carries that stale fixture, but its final production guard explicitly refuses completed answers.

Corrected only that fixture to create the real openai-completions faux API and begin with stopReason aborted. Its existing abort-after-complete-echo and retained-new-tokens assertions remain. No error suppression or restored buggy fallback. Other continuation mismatch, queue, terminal receipt and durable policy cases unchanged.

## Verification

Expanded owners: **61 passed / 8 files**, including new authoritative refusal, retry/continue lifecycle, queue-only, prefill, durable system-tail, signed-empty, swipe and soft-delete. Completed cases use actual file-backed JSONL reopen: unchanged entries/leaf and answer, zero new provider requests, idle state. Interrupted cases assert raw entry retained, append-only null context edit, user-only retry request and final response.

Native Node existing source resolver with actual createAgentSession/DefaultResourceLoader and controlled faux provider: **0 extra requests**, `completed answer` retained, history unchanged, idle true. No HTTP/real credentials. Temporary smoke removed.

Initial check passed **1735 files, Fixed 1** (new test formatted), including browser smoke. Final check and normal commit hooks passed **1735 files, No fixes applied**. Committed source/test/public-doc tree `05d1ab147` passed root `rtk proxy ./test.sh`: **8201 passed / 0 failed / 945 skipped**, exit 0, **95.72 seconds**, full output `artifact://2650`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifacts rechecked on committed tree: **749 files / 0 mismatches**.

Parent explicit-projection source/test tree `64ba74321` aggregate **8197 / 0 / 945**, 88.57 seconds, `artifact://2615`; `ebfc2ffdb` amended its review only. Not current-unit aggregate evidence.

## Limits

No S2 durable in-flight capture/atomic restore, S4 effective saved loadout, physical prefill origin guard or S10 usage identity completion. This preserves existing raw usage rather than promising global billing dedup. It does not grant continuation from arbitrary completed assistant/length/toolUse tails without supported prefix or queued input.

Final post-format owners again **61 passed / 8 files**; final check **1735 files, No fixes applied**, including browser smoke. AuthoritativeAnswerAudit and ContinueFixtureContractAudit independently returned correct/no findings for bounded static review of refusal, raw-history omission, queue precedence and corrected abort-after-echo fixture. Neither ran tests/checks/builds/formatters; runtime evidence is parent execution above. Protected artifacts: **749 SHA256 / 0 mismatches**. Graph generation/coverage unavailable (WeakMap); source/LSP fallback, no exhaustive caller claim.
