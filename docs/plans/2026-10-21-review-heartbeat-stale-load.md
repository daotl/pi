# Review: discard heartbeat file reads owned by an outgoing lifecycle

Date: 2026-10-21
Migration base: `362f2da92`
Final local source: `2093b87fe2af9714f877d279fe1db3674fc278a8`

## Problem and current proof

A pending heartbeat file read can complete after heartbeat clearing, session stop or runtime replacement. The old implementation then parses/arms its outgoing instructions and publishes status into the new lifecycle.

The current-source existing-suite regression produced **2 failed / 62 passed**: a controlled read completed after clear or owner identity replacement and installed the outgoing heartbeat. The test uses the established prototype fixture and actual load/parser/entry-creation methods, gating only filesystem read. It is an ownership-method test, not a full runtime replacement integration claim.

## Final repair

Capture session identity and a heartbeat-load generation before reading. Ignore stale success and failure outcomes. Increment the generation at the existing clear boundary, already used by stop/rebind. No new cancellation timer, file format, scheduler cadence, or preflight behavior.

The larger backup heartbeat suite is not imported. Atomic save and startup trust are separate selected fixes and remain outside this unit.

## Verification

The owning heartbeat suite after repair passed **64 tests**. Deferred reads are released and awaited before mock/temp cleanup. Existing normal file load/save and scheduler cases remain unchanged.

`npm run check` passed with 1706 files and `No fixes applied`, including TypeScript and browser smoke.

## Independent follow-up audit and real lifecycle coverage

An independent source review confirmed the exact `2093b87` repair and found no introduced production defect. The original prototype replacement case is valid owner-identity unit coverage, not runtime replacement proof.

The additional suite uses actual `AgentSessionRuntime.newSession()` and `InteractiveMode.stop()` on an initialized VirtualTerminal host. Four content/failure cases leave no outgoing heartbeat, ticker or stale status; a fresh real file load succeeds after replacement. Combined follow-up verification with existing heartbeat/RPC suites: **73 passed** across five files. All file writes use harness-owned absolute temporary paths.

Boundary: guards apply after clear/rebind or owner identity replacement. Standalone runtime.dispose() does not itself change heartbeat generation, and the pre-apply replacement interval is not newly guarded by this repair. No disposal-alone or pre-apply suppression guarantee is claimed.
