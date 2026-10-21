# Review: settle public Agent streams on asynchronous failure

Date: 2026-10-21
Migration base: `d4a6ddd13`
Local chain: `deede133ff5bc52ba82ea52f01ea27acd712a430` → `26cb5df97f1fbe6266113f2a6be681605fca81cc` → `a820049ee4ff71fb8f35dd62c386181dce6e9222`

## Problem and baseline evidence

The public event-stream adapters handle only a successful runner promise. Asynchronous request/next-turn preparation or provider iterator failure rejects outside the stream and leaves its iterator/result unsettled.

The original current-source regression hit 10 test timeouts and 10 unhandled rejections; this is a liveness observation, not semantic assertion RED. A temporary bounded probe then produced 10 explicit unsettled-stream assertion failures with two normal controls passing. Those temporary 100 ms probes are not permanent tests. Permanent tests await both iterator and result and assert exact lifecycle/result semantics; the existing test runner's outer timeout detects non-settlement.

## Final repair and independent correction

Use one adapter tracking current invocation's completed messages, open-turn state and latest partial assistant. Rejection preserves partial text/signatures/usage, balances existing message/turn events, emits agent_end and settles consumers. Failure message_end adds the failure exactly once before agent_end. Direct promise runners retain their original rejection and public signature; initial invalid continuation remains synchronous.

Independent source review confirmed event pairing and partial/completed preservation but found that pre-partial failures after model routing were attributed to the initial model. Targeted start/continue regressions reproduced two wrong-identity assertions. The incomplete unit was backed up and restored to HEAD before rebuilding.

Correct attribution with private execution model state passed through internal runner implementations, updated centrally where runLoop applies prepareRequest/prepareNextTurn results. No hook functions are wrapped or replaced, no WeakMap is introduced, and no public runner parameter is added. Four request/next-turn × start/continue cases verify actual dispatched and reported model identities.

The related test-fidelity repair captures provider context and asserts outside the provider callback, whose thrown assertions can otherwise normalize to assistant failures. Experimental harness, prefill policy and tool algorithms remain unchanged.

## Verification

- Full owning agent-loop suite: **67 passed**, including initial/between-turn preparation error/abort, iterator partial error/abort, complete result ordering, signature/usage preservation, model attribution and direct promise rejection controls.
- Earlier actual-source Node smoke exercised a preparation error without provider dispatch and observed balanced terminal events and settled iterator/result; no provider/network request was used.
- Current source is rebuilt from the clean advancing base, not a wholesale backup file/package replacement; final changes are limited to public stream adaptation and private execution-state transport.
- Independent source follow-up confirmed the model-attribution P2 is fixed and reported no further introduced defect; it did not rerun tests. `npm run check` passed with 1708 files and formatted the test; post-format agent-loop plus Agent consumer suites passed **113 tests**. Normal hooks provide the final no-fixes gate.
