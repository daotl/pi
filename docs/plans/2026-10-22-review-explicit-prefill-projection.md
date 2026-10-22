# Review: carry prefill intent explicitly into canonical request projection

Date: 2026-10-22
Parent: `9522879ef`.
Source chain: `deede133ff5bc52ba82ea52f01ea27acd712a430` adds PrepareRequestContext.returnPrefill and replaces object-identity guessing; `e13924536243de16b20af0b0eb8d117056f22ec8` gates tracked prefixes to the active first prefill request. Final backup `cb3bee033ba853041609b874303dc625d5d30479` Session918–950 and Agent types179–184. Only those semantic hunks, not saved-prompt/routing/receipt architecture, are migrated.

## Defect and RED

The existing helper guessed prefill from a different last-assistant object and historical content equality. A projected context edit creates a new assistant object; post-tool preparation appended that copy again. Conversely, an explicit direct-Agent prefix matching an earlier answer's text was incorrectly considered already persisted and omitted after a new user message.

Initial boundary fixture used malformed replacement array and failed validation; it was corrected to the actual `{ content: [...] }` schema before interpreting behavior. That ordinary custom-boundary case then passed and remains a control. The actual post-tool final-source case omits tool results and replaces the assistant contribution; it demonstrated two `replacement assistant` messages instead of one. Same-text direct-Agent case demonstrated a three-text request missing its explicit fourth prefix. Authoritative RED: **2 failed / 1 control passed**. No malformed-fixture failure counted as migration evidence.

## Final adaptation

- Optional PrepareRequestContext.returnPrefill communicates request intent independent of projection object identity. The loop always supplies boolean `config.returnPrefill === true`; first continuation true, later tool/ordinary requests false.
- Session request projection selects a prefix only when that request flag is true: tracked Session pending prefix or the explicit trailing assistant supplied by direct Agent callers.
- Next-turn compaction/projection uses canonical messages alone; no implicit prefix reattachment on ordinary tool turns.
- Delete both obsolete text/reference heuristic helpers, migrate all four projection-helper uses and the sole identity-helper caller. No shim or duplicate convention.
- Keep optional public field exactly as final authored/backup source; a received suggestion to make it required would introduce a separate public type break not needed for this behavior. Missing intent is non-prefill, never guessed from content.
- README/SDK guide describe explicit intent and canonical edits. No changelog on crystal, Session durable-capture architecture, provider origin policy, transport authorization or experimental harness change.

LSP references before exported change: PrepareRequestContext declaration/callback; `_projectedMessages` four uses and `_isRealTranscriptMessage` two uses. Actual loop construction supplies the field. Compiler validates other structural consumers. Graph project/generation/coverage remains unavailable due WeakMap; exact source fallback, no exhaustive caller claim.

## Verification

Seven Session consumer files: **96 passed**, again post-format. Includes new explicit projection, continuation, queue-only, durable system-tail recovery, boundaries, queued compact and virtual models. Five Agent files: **159 passed**, strengthening the existing 24-row wire matrix to observe prepareRequest flags `[true,false]` as well as provider flags and exact call/result ownership. No new duplicate flag-only test.

Native Node existing source resolver with real createAgentSession/DefaultResourceLoader/faux provider exercised same-text direct-Agent continuation. Actual request texts: `[older question, same prefix, current question, same prefix]`; final answer `same prefix completed`. In-memory credentials and local controlled provider, no HTTP. Temporary source removed.

Initial check passed **1734 files, Fixed 1** (new test formatted). Final check and normal commit hooks passed **1734 files, No fixes applied**, including browser smoke. Committed source/test/public-doc tree `64ba74321` passed root `rtk proxy ./test.sh`: **8197 passed / 0 failed / 945 skipped**, exit 0, **88.57 seconds**, full output `artifact://2615`. No next-unit source/test changes occurred during that aggregate; this amendment changes only this review record. Protected artifacts rechecked on committed tree: **749 files / 0 mismatches**.

Parent source/test tree `73837e536` aggregate: **8194 / 0 / 945**, 88.50 seconds, `artifact://2583`; `9522879ef` amended its review only. Not current-unit aggregate evidence.

## Limits

Current Session capture still removes its prefix and restoration remains the existing multi-write path; S2 durable held-prefix/atomic transactions are not claimed. Fresh tokenizer authorization, effective saved prompt parity, usage identity and completed-but-unpublished receipt completion remain separate. No immutable context promise or real-provider validation.

ExplicitPrefillIntentAudit and CanonicalProjectionAudit independently returned correct/no findings for bounded static review of flag propagation, ordinary/post-tool canonical projection, direct/tracked prefix ownership and deleted-helper callers. Neither ran tests/builds/checks/formatters; runtime evidence is parent execution above. Protected artifact manifest: **749 SHA256 / 0 mismatches**. Optional field matches the inspected final backup; no extra public type break is introduced.
