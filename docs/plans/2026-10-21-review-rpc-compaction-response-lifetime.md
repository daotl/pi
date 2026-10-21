# Review: retain RPC compaction until its terminal response

Date: 2026-10-21
Migration base: `e5d5f8a4b`
Final source repair: `243015b85e9159c785bdfa09053bb9eac12aab74`

## Problem and current reproduction

`RpcClient.compact` shares the generic 30-second command deadline even though compaction can legitimately spend longer preparing/tokenizing/retrying a summary. A timed-out command's eventual response then falls through `handleLine` into the event channel because its pending request is gone.

Real child-process regression on the current source: **2 failed / 1 passed**. A held compact settled at 30,001 ms rather than remaining pending. A held ordinary bash command correctly timed out, but its later response was delivered as an event. The existing child-exit rejection control passed.

## Final repair

Permit the existing private send helper to disable its deadline only for compact. Preserve all ordinary 30-second command deadlines. Treat every `type: response` message as a response-channel message, resolving it only when the ID is still pending and otherwise ignoring it. Do not change the RPC protocol, retention API, server algorithm, or public event types in this unit.

## Verification strategy

The regressions use real Node child processes and JSONL pipes. An emitted event confirms the request reached the child before fake time advances; a following get_messages response is a pipe-order barrier for late responses. No provider, credentials or network is involved. Cleanup restores real timers and stops the invocation-owned child.

After repair, both owning suites passed **3 tests**, including the existing process-exit control. `npm run check` passed with 1705 files and formatted the new lifecycle test; the post-format suites again passed **3 tests**. Normal commit hooks retain the final no-fixes gate.
