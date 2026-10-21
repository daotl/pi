# Review: settle pending RPC requests when forced stop completes

Date: 2026-10-21
Migration base: `08dd8df72`
Final local source: `243015b85e9159c785bdfa09053bb9eac12aab74`

## Problem and current proof

`RpcClient.stop()` sends SIGKILL at its one-second deadline and resolves before the operating system necessarily delivers `exit`. It then drops the process identity and clears pending requests without rejecting them. The existing exit listener ignores the later event because that identity no longer matches. A held compact with no generic deadline can therefore remain pending forever after stop has completed.

A real child-process regression held the compact, advanced only the client's shutdown timer synchronously, and observed **1 failed / 2 passed**: stop completed but the pending request was not settled. Ordinary deadline and long-compaction controls passed.

## Final repair

Capture the child being stopped and use that identity for both signals and the one-shot exit listener. Before dropping it, explicitly reject every pending request with the existing exit error or an intentional-stop error. `start()` already resets exitError before launching a new child, so restarting retains its current contract.

This is a separate lifecycle fix, not a modification of the prior deadline/event-demultiplexing unit. It adds no automatic restarts or retry behavior.

## Verification

The test uses the actual JSONL client and invocation-owned child, no provider/network. Fake time covers only client timeout functions; synchronous advancement exposes the interval before the OS exit callback. Cleanup returns to real timers and stops the child.

After repair, the owning lifecycle/process-exit suites passed **4 tests**. The initial post-fix assertion awaited too few promise microtasks and was corrected to yield through setImmediate before inspecting the public outcome; the same final fixture is used for post-format verification. `npm run check` passed with 1705 files and formatted the test; the owning suites then again passed **4 tests**. No change to start()/restart implementation was made.
