# Review: keep live deletion state when restore persistence fails

Date: 2026-10-21
Migration base: `5e7ca1e9d`
Local provenance: mutation-before-publication repair contract from `243015b85`, adapted to current upstream restore APIs

## Problem and current proof

restoreDeletedUnits and restoreDeletedEntryIds remove live deletion marks before rewriting. A failed rename preserves disk but exposes restored content in live model context. The current targeted regression produced **2 failed / 7 passed**, observing missing deletedAt and deletedToolCalls after restore threw.

## Final adaptation

Record only affected persisted entries' original deletion fields/maps. On rewrite failure restore deletedAt and the original tool-map object/content, then rethrow. Selected-entry restore needs only the original deletedAt values. Preserve current restore ordering, batch count, soft-deleted compaction behavior and successful swipe navigation. No whole-session snapshots, new schema or general rollback framework.

This repair applies only to these restore operations, not tail replacement/removal or append publication.

## Verification

Rewrite/restore fault, existing soft-delete and swipe suites passed **39 tests** across three files. Tests assert live entries/projection, held tool-map identity, committed disk bytes/reopen and successful retry. No provider/network requests were used.

`npm run check` passed with 1711 files, formatting two changed files. Post-format owning suites again passed **39 tests**; normal hooks provide the final no-fixes gate.
