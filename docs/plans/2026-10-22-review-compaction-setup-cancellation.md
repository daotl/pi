# Review: preserve queued compaction cancellation through SDK setup

Date: 2026-10-22
Migration parent: `2a0157598`.
Source: final repair `06023b8cbaacae6ba27c4d8ed68c359dd7104e63`, following the broader queued-compaction ownership chain ending in `a820049ee4ff71fb8f35dd62c386181dce6e9222`. Only the locally aborted error identity fix and its actual SDK controls are migrated; queued-before-retry/other settlement changes remain separate S3 work.

## Problem and RED

The SDK stream wrapper may turn an async summary auth/setup rejection into a terminal assistant error; summarization then throws a plain failure. Manual compaction correctly emits an aborted outcome from its signal, but rethrows the plain failure. The queued caller classifies that as ordinary failure and resumes runnable work after cancellation.

Three standard-SDK/faux-provider cases hold the summary's inner async auth resolution after a real tool turn, then cancel, reject normally, or cancel with already accepted follow-up. Before source changes, the cancel-only case fails on one unwanted continuation request; normal failure and accepted-follow-up controls already pass (**1 failed / 2 passed / 4 filtered**). No private method is substituted for the public prompt/queue/cancel path.

## Adaptation

Capture the operation's original signal before publishing compaction_start. In its catch, use that signal for cancellation classification and throw canonical `Compaction cancelled` with the original error as cause when locally aborted/extension-cancelled. Genuine errors remain unchanged. Preserve existing event reporting and cleanup. No new retry grant, queue policy, tokenizer API downgrade or broad transaction wrapper.

## Verification

Queued-compaction, public pre-prompt regression and existing chat-tokenize integration: **13 passed**. The new SDK cases verify cancel-only sends no continuation, genuine failure resumes with tool result context, accepted follow-up remains ordered, no compaction checkpoint is published, pending state clears and final event is agent_settled. The original RED is cancel-only; controls were already green before production changes.

Controlled auth gate listeners are removed in finally; tool/setup gates are released, active prompt is aborted/awaited, session disposed and invocation-owned temp directory removed. An intermediate fixture-cleanup edit omitted an if closer; it was immediately corrected before verification. No runtime/source claim is based on that failed syntax edit. Scripted faux responses and local auth callbacks are used; no paid provider request or tokenizer privacy claim. Existing shared harness is unchanged.

`npm run check` passed (1719 files; one test file formatted). Post-format owning suites: **13 passed**. Normal commit hooks remain enabled.
