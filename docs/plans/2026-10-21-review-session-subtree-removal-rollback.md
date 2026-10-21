# Review: restore selected subtree after failed removal

Date: 2026-10-21
Migration base: `fd3c728d0`
Provenance: `243015b85` staged history publication; adapted narrowly to current removeEntriesWithDescendants used by swipe-version shred.

## Problem and proof

Subtree removal changes selection, membership and labels before rewrite. A failed rename preserves old disk bytes but deletes the selected subtree from live state. Current regression: **1 failed / 13 passed**; selected assistant and its label disappeared from accepted entries.

## Adaptation

Capture old membership reference and selected leaf before the first mutation. On rewrite failure restore the array, rebuild indexes/labels, restore the exact leaf and rethrow. No deep copy: original entry objects are not mutated by this operation. Preserve current successful ancestor selection, sibling retention and return counts. Unknown targets remain a no-op.

This does not address durable successful non-tail selection: reopening may choose the last physical entry, not the live ancestor. Reopen assertion intentionally covers membership, not selected-leaf equality. Other mutation algorithms remain separately scoped.

## Verification

Rewrite/publication, soft-delete, tree traversal and actual AgentSession swipe suites: **75 passed**. New fault checks entries/tree/projection/exact leaf, strict identity of a held selected entry and old bytes. Retry removes the selected assistant and descendant label, keeps its sibling and has real disk reopen membership parity. No paid provider call.

`npm run check` passed (1712 files; regression formatting applied). Post-format owning suites passed **75 tests** again.
