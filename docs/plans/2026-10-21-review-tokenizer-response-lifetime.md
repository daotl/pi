# Review: retain tokenizer cancellation through response-body consumption

Date: 2026-10-21
Migration base: `1eb7d14ab`
Local source chain: `778e0120721a2978abedd9ce60f945427f5c9ee2` → `3891c85a2d698b87546873ddc42f3d400406db13`

## Problem and current proof

Both token counters detach caller cancellation and clear their timeout after response headers, before JSON body consumption. A server that flushes headers then leaves an unfinished JSON body keeps the counter pending despite caller abort or the request deadline. Fetch failures also retain the caller abort listener. Rejected response bodies are not disposed.

A new bounded real-HTTP regression on the current source produced **8 failed**: text/chat cancellation and timeout exceeded a two-second watchdog, both network-error cases retained an abort listener, and rejected-response bodies were not cancelled. Every native test routes header/fetch failure into its handshake and bounds both handshake and operation settlement; cleanup aborts, closes connections/server, clears the watchdog and awaits the operation. No provider request or credentials are used.

## Final repair and rejected intermediate

Keep the existing controller, timer and forwarded caller signal active until body processing finishes; always remove timer/listener in finally. Start best-effort rejected-body cancellation without awaiting its independent promise, and suppress cancellation rejection so it cannot replace HTTP classification.

The earlier combined attempt `0b80968e7` was reverted by `daae72f19`. Independent review found that awaiting `body.cancel()` introduces a hang if its underlying cancel callback never resolves. This repair explicitly does not repeat that historical final implementation blindly: a dedicated regression uses a pending cancellation promise and requires the unavailable result to settle before a watchdog. The promise is released during cleanup. This is a correctness correction discovered while adapting the final local chain.

## Scope

No URL, HTTP status, completed-JSON classification, retry-budget or retry-sleep changes. Preserve header-only repair, current text payload, and upstream chat-template endpoint/messages/model behavior. Timeout remains transient; explicit caller abort returns undefined.

## Verification

- Native response-lifetime, header and existing tokenizer suites after repair: **35 passed** across three files.
- The pending-cancel case verifies that the repaired counter initiates cancellation and settles without waiting for its unresolved promise. No await-cancellation mutant was executed; sensitivity to that independently identified hang is inferred from the watchdog, not recorded as observed RED. The observed original-source failure was missing body disposal. Native stalled-body cases use actual fetch/HTTP rather than a synthetic body rejection.

- `npm run check`: passed with 1706 files, formatting the source and new regression. Post-format owning suites again passed **35 tests**. Normal commit hooks provide final no-fixes verification.