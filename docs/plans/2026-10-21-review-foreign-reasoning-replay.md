# Review: keep native reasoning metadata within its originating model

Date: 2026-10-21
Migration base: `b401d5f3c`
Final local chain: `ff0f22eb780decb94a196a2700cc6ba44446116e` → `f5825ecd7744162d449e247eb7c452570d8413aa`

## Problem and current proof

transformMessages preserves every signed thinking block, even when source provider/API/model differs. Native Responses then JSON.parse's foreign field selectors/opaque signatures; Anthropic sends them as native thinking/redacted data. Chat Completions also replays legacy encrypted tool details without checking origin.

Current-source actual adapter/converter regressions: **11 failed / 12 passed**. Four Azure Responses handoff cases threw JSON parsing errors, four Anthropic payloads contained foreign native/opaque reasoning instead of text, and three Completions payloads retained foreign legacy reasoning_details. Native controls and message-ID behavior passed.

## Final repair

Preserve native signed/redacted reasoning only for exact provider/API/model origin. Foreign visible reasoning becomes untagged ordinary text; foreign redacted/opaque-only blocks are omitted on wire. Restrict legacy tool thoughtSignature fallback to exact origin while keeping structured calls usable. Stored messages remain unchanged.

Keep current provider IDs, current adapter APIs/sampling, text signatures, tool calls and native replay IDs. No failed-assistant filtering, system-patch ordering, whitespace-prefill, proxy/raw-token or transport-provenance changes belong here. Update public handoff documentation to the exercised behavior rather than its obsolete thinking-tag claim.

## Verification

Six owning/related replay suites passed **40 tests** after repair, including actual Anthropic payload capture before network dispatch, actual Responses conversion, mocked Completions SDK request capture, native signed/redacted controls, stored-history immutability and current prefill controls. No provider/network requests or real credentials were used.

`npm run check` passed with 1711 files and formatted three changed files. Post-format replay suites again passed **40 tests**; normal hooks provide the final no-fixes gate.
