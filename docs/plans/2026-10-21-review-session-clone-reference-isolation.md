# Review: remap references only in the cloned branch

Date: 2026-10-21
Migration base: `ff14fbb84`
Source chain: `e3f076aa` authored-core-merge-resolutions.diff:1757-1793 limits remapping to selected new branch and includes context_edit targets; `243015b85` final _cloneTailEntry scopes reference updates to each clone (backup session-manager.ts:2112-2135).

## Problem and observed proof

replaceMessages/removeEntries update compaction, branch-summary and label references across all fileEntries, corrupting abandoned/sibling history. Cloned context edits retain old target IDs, losing their projected content.

Current focused RED: **2 failed / 17 skipped**, both directly on stale cloned context_edit target. Assertions for historical references occur later and were not reached in RED; their baseline risk is source-evidenced, not separately observed failure.

## Adaptation

Iterate idMap values and look up only new clone entries, rather than scanning all historical entries. Include context_edit alongside label target remapping. Preserve current supersededBy markers, swipe versions, removed-boundary follower handling, soft deletion and all rollback paths. This is narrower than the late transaction/leaf-checkpoint architecture; neither schema nor public methods change.

## Verification

Rewrite/publication, context-edit, soft-delete, actual AgentSession swipe and message-edit suites: **121 passed**. Both replacement/removal controls assert new compaction/edit/label targets and edited projection; original/sibling references retain old IDs, and real reopen plus selecting the old branch reconstructs its original projected messages. No provider call.

`npm run check` passed (1712 files; regression formatting applied). Post-format owning suites passed **121 tests** again.

Follow-up adds direct branch_summary fromId assertions for the new clone, selected source and separate abandoned sibling summary in both replacement/removal cases. Selecting the original summary after real reopen retains original projected messages. Rewrite and tree suites passed **50 tests**. These are post-fix controls; add3423e4 did not include direct branch_summary assertions.
