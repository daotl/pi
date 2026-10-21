# Review: wait for OAuth callback shutdown before login settles

Date: 2026-10-21
Migration base: `f46a61095`
Source: `e3f076aa` authored merge resolution, authored-merge-resolutions.diff:2048-2084. Shared async callback close and Anthropic awaiting it are already present upstream; do not reimplement them.

## Problem and observed RED

OpenRouter, OpenAI Codex browser login and Radius browser login call async callback.close without awaiting it. Login cancellation can settle before the listener is released; a subsequent login can race its callback port. Three provider cancellation scenarios fail the pending-until-close assertion (**3 failed**).

## Adaptation

Await the existing close promise in those three finally blocks. Keep optional Codex callback/manual fallback, device-code flows, credential exchange and shared callback server unchanged. No authentication policy or new integration.

## Verification

OAuth login shutdown, shared callback server, OpenRouter, Codex and Radius suites: **41 passed** with one worker. New control runs each real provider login through cancellation with a real loopback callback server; its port is invocation-owned/ephemeral, and a delayed close wrapper exposes settlement ordering deterministically. After releasing shutdown, login rejects and an actual replacement TCP server binds the same port. Existing provider suites cover successful browser/manual/device flows and exchange failures. Remote discovery/exchange are stubbed; no real OAuth credentials or external auth requests.

`npm run check` passed (1714 files; test formatted). Post-format owning suites: **41 passed**.

Follow-up updates all existing shared callback test owners to await Promise<void> shutdown in afterEach/finally, including the native port blocker. Same five suites: **41 passed**. This is fixture lifecycle completion, not another production fix or RED claim.
