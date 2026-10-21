# Review: preserve the selected tail after a failed message replacement

Date: 2026-10-21
Migration base: `44fa7765a`
Local final provenance: `243015b85` staged-tail publication repair, adapted to upstream's superseded swipe sources

## Problem and current proof

replaceMessages clones a retained tail, marks original entries superseded and remaps compaction/summary/label references before writing. A failed atomic rename preserves disk but leaves the live leaf, tree, aliases and prompt projection on the uncommitted tail.

Current-source targeted regression: **1 failed / 9 passed**. Failure left extra cloned entries, supersededBy markers, changed compaction keep IDs and changed label targets despite the thrown error.

## Adaptation

After replacement validation identifies an actual active-path target, snapshot persisted file membership and existing entries' top-level properties. Keep current clone/remap success algorithm. If rewrite fails, restore original objects in place, restore membership, rebuild derived indexes/labels and restore the previously selected leaf, then rethrow. Preserve nested message/deletion objects, which this replacement algorithm does not mutate in place.

No snapshot occurs for no-op targets or in-memory sessions. This repair is scoped to replacement; tail removal, subtree deletion, branch creation and append publication remain independent candidates. It does not correct existing branch-wide reference-remapping semantics on successful replacement.

## Verification

Rewrite fault, session context-edit, message-edit and swipe suites: **100 passed** across four files. The regression checks live entries/tree/projection/leaf, a held source assistant's superseded marker, committed bytes and successful retry. No provider/network request is used.

`npm run check` passed with 1711 files, formatting the regression. Post-format owning suites again passed **100 tests**; normal hooks provide the final no-fixes gate.
