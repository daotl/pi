# Review: honor nullable tokenizer credential overrides

Date: 2026-10-21
Migration base: `daae72f19`
Final local source: `667e13ca60785e573d2d121be37780a5fd4a95c7`, retained through `my-merge` `cb3bee033`

## Problem and current proof

Text and chat tokenizers merge headers by case-sensitive object assignment. A caller's lowercase `authorization` therefore does not replace the model's `Authorization`; native Headers joins the two values. A nullable override becomes a literal `null` header value alongside credentials instead of suppressing the credential.

Header-only regressions on current source: **6 failed / 21 passed**. Both endpoints sent `model, caller`, `Bearer generated, null`, or `model, null` where the caller requested replacement or removal. Each scenario also asserted a successful count of 1, exactly one dispatched request, and the existing endpoint/body contract; returning early cannot make the test pass. Generated-key and model-header precedence controls passed.

## Final repair

Use the existing canonical `providerHeadersToRecord` helper with ordered defaults, model headers, and caller headers. Generated API-key auth belongs to defaults; model/caller values retain their precedence, case-insensitively, and null removes the earlier value. Expose the existing `ProviderHeaders` shape in both tokenizer option interfaces.

Preserve upstream's newer chat endpoint and messages/model payload. This unit changes no response classification, URL policy, timeout/body lifetime, retry sleep, or downstream tokenizer authorization.

## Rejected prior attempt and review

The combined attempt `0b80968e7` was backed up and reverted by `daae72f19`. Independent semantic review found an introduced hang from awaiting unbounded rejected-body cancellation; independent proof review found unbounded native fixture waits and a possible non-dispatch false-green in the old nullable probe. Those findings are not hidden by reusing the prior green counts. This header-only repair uses separate strengthened regressions and does not contain the rejected disposal code.

## Verification

- Header-only plus existing tokenizer suite after repair: **27 passed** across two files.
- Both real request shapes are exercised through native `Request`/`Headers` normalization and injected successful token-count responses. No external HTTP/provider request or credentials were used.

- `npm run check`: passed with 1704 files, formatting the new header test. Post-format owning suites again passed **27 tests**. Normal commit hooks provide the final no-fixes check.