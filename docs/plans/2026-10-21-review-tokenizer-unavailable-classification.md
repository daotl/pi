# Review: stop retrying unavailable optional tokenizer endpoints

Date: 2026-10-21
Migration base: `235e94c42`
Local final chain: `6f1cfc1f5511b7ce600843d31eb72661587f9a80` → `243015b85e9159c785bdfa09053bb9eac12aab74`

## Problem and current proof

Only 404 is classified unavailable. Other permanent client/auth failures are treated as transient, so the existing unlimited caller retry policy can stall compaction forever. Completed empty/HTML/204 responses also become transient JSON errors. Unresolved templates and non-HTTP endpoints are dispatched before fallback.

Current-source regression: **24 failed / 8 passed** across the text/chat APIs. For text, HTTP400/401/403/405/422 made four requests under a three-retry policy rather than one. Chat tests called countChatTokens directly and observed TokenizeTransientError, not a chat retry loop. Completed empty/HTML/204 bodies threw transient errors in both APIs; unusable endpoint cases dispatched. Existing404 and HTTP408/429/503 controls passed.

## Final repair

Both counters return undefined for HTTP4xx except408/429, HTTP204, and SyntaxError from completed JSON parsing. countTokensWithRetry consequently stops on those undefined results; this unit adds no chat retry helper. Transport/body interruptions, request timeout and server failures remain transient. Empty/unresolved/whitespace/non-HTTP(S) bases return unavailable before dispatch. Existing version stripping and chat messages/model payloads remain unchanged.

This is separate from credential merge and response-lifetime repairs. Do not add validation to ordinary inference endpoints, change provider catalogs or alter retry budgets. Existing nonblocking body disposal remains unchanged.

## Verification

All four tokenizer suites after repair passed **67 tests**, including real stalled native response-body timeout/cancellation and header precedence controls. Endpoint tests explicitly assert non-dispatch; valid header/count tests assert successful counting and actual request shape. No cloud/provider requests were used.

`npm run check` passed with 1710 files, formatting the new regression. Post-format owning suites again passed **67 tests**; normal hooks retain the final no-fixes gate.
