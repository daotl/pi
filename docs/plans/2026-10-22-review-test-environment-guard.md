# Review: scrub omitted cloud credentials from offline AI tests

Date: 2026-10-22
Migration parent: `524556f91`.
Source: authored merge `e3f076aa28c4d7c1373a3e68a35cbfd07a199bff`, `authored-merge-resolutions.diff` lines 2684–2717; final backup `cb3bee033ba853041609b874303dc625d5d30479` retains the exact additions. No original upstream commit is migrated as an independent candidate.

## Problem and RED

The shared AI Vitest setup guard omits 15 current credential/identity/endpoint environment inputs. Current provider auth consumes Anthropic bearer/federation values and Qwen/TypeSafe/Baseten keys; Azure request construction consumes base URL/resource/version/deployment configuration. Existing non-`*-e2e` test files also activate Qwen/Baseten provider suites from API keys. Excluding named E2E files alone does not isolate those tests.

New root Node subprocess regression imports the actual setup guard in an allowlisted process, supplying synthetic values only. All four tests fail before the repair: omitted Anthropic inputs, provider keys and Azure inputs remain visible both with E2E unset and with `PI_E2E_TESTS=0`. No real credential is read or emitted; no provider test or request is executed.

## Adaptation

Add exactly the final backup's six Anthropic inputs, five provider API keys and four Azure inputs to the existing deletion list. Preserve exact `PI_E2E_TESTS=1` opt-in semantics. Do not add a second credential-discovery abstraction or change production authentication.

## Verification

`scripts/setup-e2e-guard.test.mjs`: **4 passed** after repair. It checks default scrub, exact opt-in precedence, preservation of explicitly enabled synthetic inputs and preservation of an unrelated environment value. The opt-in preserved-value assertion is a post-fix control: the original RED stopped at the disabled-mode assertion first.

Combined environment guard, coding-agent catalog override, AI E2E collection and isolated-runner suites: **19 passed**. Collection-only tests do not run E2E bodies; subprocess catalog tests deny network. `npm run check` passed: 1719 files, no fixes applied; types, dependency/lock checks and browser smoke passed. The regression lives under root `scripts/*.test.mjs`, so normal `./test.sh` runs it without ambient provider keys.

Remaining catalog-dependent mocked-suite activation is separate and still pending. This guard reduces accidental ambient activation; no claim that every future provider environment variable is exhaustively covered.
