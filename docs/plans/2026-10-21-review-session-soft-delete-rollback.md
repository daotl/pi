# Review: restore live soft-delete state after persistence failure

Date: 2026-10-21
Migration base: `9bf5bf94d`
Local repair provenance: staged mutation/publication contract from `243015b85e9159c785bdfa09053bb9eac12aab74`, adapted to upstream's newer reversible deletion fields

## Problem and current proof

The preceding atomic rewrite preserves the committed file, but softDeleteUnits sets live deletedAt/deletedToolCalls before writing. Rename failure leaves the live model context hidden while reopened disk retains the conversation. Current-source fault regression: **1 failed / 6 passed**, observing both an added deletedAt and an extra deletedToolCalls key after the operation threw.

## Adaptation

Retain only affected persisted entries' deletion fields before mutation. On rewrite failure restore those fields and restore an already-held tool-deletion map in place, then rethrow the original error. Existing batch ordering, timestamps, return count, object identities and success semantics remain unchanged. In-memory operations do not copy deletion maps.

Do not import the proposed whole-session snapshot wrapper across nine operations: it copies all history/indexes on every call. This unit handles only soft-delete; restore, tail replacement/removal and selected-session publication remain separate dependent candidates.

## Verification

Rewrite fault, existing soft-delete and swipe suites: **37 passed** across three files. The new case asserts live entries/projection, held map identity/contents, committed bytes, reopened projection and successful retry. No provider/network request is used.

`npm run check` passed with 1711 files, formatting two changed files. Post-format owning suites again passed **37 tests**; normal hooks provide the final no-fixes gate.
