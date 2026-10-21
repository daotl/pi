# Review: restore accepted tail after failed selected removal

Date: 2026-10-21
Migration base: `c5c96ba70`
Provenance: `243015b85` transactional tail publication, adapted to current removeEntries clone/superseded/swipe/tool-shred semantics.

## Problem and proof

removeEntries clones a tail, marks source aliases superseded and remaps references before atomic rewrite. A failed rename leaves uncommitted clones selected and changes original compaction/label references despite old disk bytes. RED: **1 failed / 14 passed**; extra entries, superseded markers and reference changes were directly observed.

## Adaptation

After validating actual active-path targets, capture persisted membership and top-level source properties. On rewrite failure restore the original objects in place, original membership, indexes/labels and selected leaf, then rethrow. Nested messages and deleted-tool maps are not modified in place by this algorithm. No snapshot for no-op or in-memory cases. Success behavior is deliberately unchanged; historical sibling reference remapping and dependent result invalidation remain independent candidates.

## Verification

Rewrite/publication, soft-delete, tree traversal, AgentSession soft-delete and swipe suites: **84 passed** across five files. Fault verifies accepted entries/projection/tree/leaf, held source identity and superseded marker, original disk bytes, then successful retry and real reopen membership parity. Existing soft-delete tests exercise tool-call shredding and compaction-entry removal. No provider call.

Added a post-fix partial toolCallRemovals fault control: an already soft-deleted call is shredded while another call and text remain. Failed rename preserves held entry/message/content/deletion-map identities, projection and bytes; retry removes just that call and its stale deletion mark with reopen parity. This additional control was not observed RED. Five owning suites now pass **85 tests**.

`npm run check` passed after both regression additions (1712 files; test formatting applied). Final post-format owning suites: **85 passed**.
