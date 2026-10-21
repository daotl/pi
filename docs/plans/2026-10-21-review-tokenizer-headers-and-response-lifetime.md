# Review: tokenizer credentials, unavailable endpoints and response lifetime

Date: 2026-10-21
Migration base: `d42ee7461`
Reference final tree: `my-merge` at `cb3bee033ba853041609b874303dc625d5d30479`

## Problems and current evidence

The text and chat token counters independently construct headers using case-sensitive assignment, detach cancellation immediately after response headers, and leave timers/listeners active on fetch failures. Permanent optional-endpoint failures such as 401/403/405 become transient errors and can enter the caller's unlimited retry policy. Completed HTML/empty responses similarly retry as if a network transfer failed. Unresolved endpoint templates are dispatched rather than treated as unavailable.

The initial current-source two-file run produced **24 failed / 23 passed**. Failures included actual outgoing `Authorization: Bearer secret, null` despite nullable suppression, permanent 4xx misclassification, undisposed 404 bodies, completed-invalid-JSON classification, lost internal abort propagation, retained caller listeners after network failure, and unresolved endpoint dispatch. Existing valid-response and transient-error controls passed.

## Final local repair chain

- `667e13ca60785e573d2d121be37780a5fd4a95c7`: generated bearer credentials enter defaults before canonical nullable model/caller header merging.
- `778e0120721a2978abedd9ce60f945427f5c9ee2`: keep timeout/cancellation through response-body consumption and clean up in `finally`.
- `0a9acad131b79844ce5afd677368090ef95684f7`: reuse listener-cleaning retry sleep.
- `6f1cfc1f5511b7ce600843d31eb72661587f9a80`: reject unusable endpoints and treat permanent 4xx except 408/429 as unavailable.
- `243015b85e9159c785bdfa09053bb9eac12aab74`: completed invalid JSON and 204 are unavailable, not transport retries.
- `3891c85a2d698b87546873ddc42f3d400406db13`: dispose rejected response bodies without replacing HTTP classification if disposal fails.

## Adaptation to current upstream

Preserve upstream's newer `countChatTokens` and `/chat/completions/input_tokens` API, including exact messages/model payload and multimodal/chat-template counting. Apply the same lifecycle/header safeguards to that existing implementation rather than replacing it with backup's text-only module. Existing API-key/model/caller precedence remains defaults → model headers → caller headers; the canonical helper makes comparison case-insensitive and lets null remove a default.

No downstream transport-provenance or compaction-policy callback is added here; those are separate coupled consumers. Public return shapes and retry budgets remain unchanged. Timeout remains transient; explicit caller cancellation returns undefined.

## Verification

- Initial repaired two-file suite: **47 passed**.
- Replaced the synthetic response-body cancellation case with real loopback HTTP servers that flush headers and an incomplete JSON body. Final owning suites: **49 passed**, including native text/chat cancellation and timeout, permanent/transient controls and existing counting/retry cases.
- Separate actual-source Node smoke with real HTTP and no fetch/body mocks: text cancellation, text timeout, chat cancellation and chat timeout all settled with **0 remaining caller abort listeners**.
- Loopback servers and timers are invocation-owned and closed in cleanup. No cloud/provider API or credentials were used.
- `npm run check`: passed with 1704 files and formatted the new lifecycle test. The post-format owning suites again passed **49 tests**. Normal commit hooks provide the final no-fixes check.

## Limits

This unit does not authorize tokenizer uploads across custom transports or hooks, implement operation-local capability caching, or change summary/count ownership. Those remain separate selected migration chains. Compatibility verification uses the disclosed version-matched published ignored catalog data, not an attested exact Git catalog snapshot.
