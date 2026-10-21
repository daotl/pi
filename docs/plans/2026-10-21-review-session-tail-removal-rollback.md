# Review: restore tail membership after failed removal

Date: 2026-10-21
Migration base: `ebae31160`
Source: `243015b85` transactional history publication, narrowly adapted to current removeLastMessages soft-delete/harness and branched-descendant rules.

## Problem and proof

removeLastMessages filters membership and updates indexes, labels and selected leaf before rewriting. Failed rename preserves the file but leaves live conversation deleted. Current-source regression: **1 failed / 12 passed**; expected five accepted entries, received an empty list.

## Adaptation

Retain the old array reference and selected leaf immediately before filtering. On rewrite failure restore membership, rebuild derived indexes/labels, restore the exact selected leaf and rethrow. Entries themselves are not mutated by this algorithm, so no property copies or full-history deep snapshot are needed. No-op returns remain before capture. Successful descendant selection and removal rules are unchanged.

This is not generic transaction support; removeEntries/subtree/session-switch callers remain separate. Disk atomic replacement and best-effort temporary cleanup retain their previously documented limits.

## Verification

Rewrite/publication, remove-last-messages, soft-delete and labels suites: **45 passed** across four files. Regression includes a sibling branch, both labels and a selected leaf before trailing metadata. It checks restored entries/tree/projection/exact leaf and committed bytes, real reopen membership, then successful retry and empty reopen. Existing controls cover harness skipping, metadata placement and descendant removal.

`npm run check` passed (1712 files; regression formatting applied). Post-format owning suites passed **45 tests** again.
