# Review: synchronize concurrent fixtures with actual stream startup

Date: 2026-10-22
Migration parent: `8031fb88f`.
Source: authored fixture repair `e9163107058b60b091617c98c5d6d7e58480b966` replaces fixed sleeps with streaming-state waits; final backup retains that repair. Adapt the wait to the actual assistant stream rather than the earlier session-active flag, and settle invocation-owned promises before deleting their auth directory.

## Aggregate evidence

At `8031fb88f`, two unchanged isolated aggregates each report **8105 passed / 1 failed / 945 skipped**. Artifact2328 times out the followUp-while-streaming test; artifact2334 fails the fixed 10ms streaming assertion and reports a late unhandled missing-auth rejection after teardown. The full owner file passed 7 alone and exact followUp passed 1 alone between aggregates; those passes did not justify declaring the repeated aggregate green or simply labeling it flaky.

The source starts async prompt preflight then waits a fixed 10ms before asserting an active run. Failed assertions bypass inline abort/await; teardown disposes session and removes auth storage while the pending prompt can still advance. The shared fixture also stores its abort signal outside the stream closure, allowing later invocations to replace it.

## Adaptation

Use bounded vi.waitFor on the actual assistant streaming message in the four existing startup sites, matching the final authored wait intent. Capture each stream's signal locally. Track the four invocation-owned prompt promises, attach immediate rejection observation without changing their original outcomes, and abort/await them in teardown before disposing/removing auth files. Existing behavioral assertions and 30s test timeout remain unchanged. No production lifecycle, retry, credentials or timeout increase.

## Verification and limits

Concurrent owner plus queue-only matrix: **11 passed** in credential-free allowlisted environment. This validates the changed fixture and queue ordering; no claim that the first aggregate's timeout cause is fully established from source alone. The second aggregate's early assertion/late-auth sequence is observed evidence. Final aggregate must still run on the committed fixed tree.

`npm run check` passed (1723 files, no fixes applied). Post-check concurrent/retry/queue-only owners: **17 passed**. Normal hooks remain enabled.

After moving prompt settlement outside the conditional session cleanup and before disposal, the complete concurrent file passed **7 tests in each of five consecutive isolated runs** (35 executions total). No test timeout was increased. Repetition exercises the owned fixture lifecycle; it does not establish exhaustive scheduler or full-suite stability.
