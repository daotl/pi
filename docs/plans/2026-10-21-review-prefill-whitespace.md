# Review: preserve trailing Completions prefill whitespace

Date: 2026-10-21
Migration base: `c286c4233`
Source: `12ae8641` exact trailing prefill text/raw reasoning serialization, commit diff:148-190. Later failed-response/system-patch fixes already landed; Agent echo enforcement unchanged.

## Problem and RED

Whitespace-only text/thinking blocks are filtered even for explicit prefill, and multiple raw reasoning blocks gain inserted newlines. The request no longer contains the original byte prefix. Current converter suite RED: **3 failed / 9 passed** (text, thinking, mixed).

## Adaptation

Identify the trailing prefill once per assistant. Retain its text blocks and nonempty raw reasoning verbatim, joining raw reasoning without inserted separators. Keep ordinary replay whitespace filtering and newline joining, structured/raw tool-call selection and echo validation unchanged.

## Verification

Completions prefill serialization, transform prefill and reasoning-details suites: **29 passed**. Exact text/reasoning/raw values and unchanged input are asserted; ordinary replay controls retain existing filtering. Existing Agent suite: **46 passed**. These are converter and Agent consumer regressions, not a newly added end-to-end HTTP echo/execution scenario.

Additional no-tool whitespace-only text/thinking controls retain the trailing assistant in prefill and preserve exactly the user item in ordinary replay. These are post-fix controls. Final post-format AI suites: **31 passed**; `npm run check` passed (1714 files; final test formatted).
