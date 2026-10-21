# Review: share live user prefix conversion without wrapping raw converters

Date: 2026-10-21
Migration base: `826622a37`
Source chain: `b65b01b1` shared pure mapping and SDK metadata/string preservation; `243015b85` effective direct converter intermediate design superseded by `3891c85a` raw convertToLlm plus convertForRequest. Preserve current experimental/harness exports and architecture.

## Problem and observed RED

Bare Agent stores incomingMessagePrefix but never uses it. SDK applies its setting only to array user content and rebuilds text without textSignature. Three bare-Agent regressions fail on missing initial/live prefix, and one SDK regression fails on unchanged string history/lost metadata (**3 Agent +1 SDK failed**).

## Final adaptation

Export prefixUserMessages, copying changed user/text values while retaining metadata/images. Keep raw convertToLlm replaceable/composable. Effective convertForRequest reads live Agent prefix once, and loops use it. Coding-agent direct compaction/branch summaries and both tokenizer conversion boundaries use effective conversion too. SDK reuses the helper in its live-settings converter without also enabling the Agent prefix. Cache warmer remains on captured converted requests. No echo/raw receipts/tokenizer authorization change or fallback shim for structural objects outside the typed Agent API.

## Verification

Agent request-prefix/Agent/loop suites: **116 passed**. SDK prefix, direct summary/branch summary, compaction-cache fidelity and tokenizer suites: **27 passed**. Actual Agent streams and SDK faux requests verify converter capture/wrap/restore, initial/changed prefix, historical/new string/array users, metadata/image preservation and unchanged storage. Direct compaction/branch summary captures verify historical prefix but generated instructions unprefixed. Existing token-count consumers run; no new HTTP authorization or exact cache-warm replay scenario is claimed. Broad source references identified all production raw Agent converter consumers in this contract; dynamic external consumers are not exhaustive evidence.

`npm run check` passed (1719 files; final SDK regression formatted). Post-format Agent **116 passed**, coding-agent owning **27 passed**.

Follow-up: existing `test/cache-warmer.test.ts` passed **9 tests**; no new exact live-prefix/cache-warm scenario is claimed. Fixed-tree `./test.sh` ataf4b4f05f passed **8004 passed / 0 failed / 999 skipped** (artifact2072), including packed SDK/CLI smoke. Prior attempt had one existing footer native watcher exact-call-count wait timeout (8003/1/999); full footer file passed8 alone and unchanged-tree aggregate then passed. No footer production/test timeout or counter assertion was changed; duplicate-event/load cause remains inference.
