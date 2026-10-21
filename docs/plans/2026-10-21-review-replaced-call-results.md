# Review: invalidate only results owned by changed tool calls

Date: 2026-10-21
Migration base: `23f488758`
Source: `243015b85` replacement scan for changed call identity/name/structural arguments and obsolete content edits (commit diff:1821-1858), final backup _commitTail boundaryIds:2063-2084. Adapted to current superseded swipe clones and operation-specific rollback, not the backup transaction/leaf architecture.

## Problem and observed RED

Replacing a calling assistant leaves results from changed/removed calls in the active projection; older context edits can also overwrite an explicit replacement. Four current regressions fail (**4 failed / 18 passed**): argument/name/removal cases retain STALE EDIT, and an unchanged call replacement remains hidden by the obsolete source edit.

## Adaptation

Scan the selected tail before mutation. Compare call ID/name/deep structural arguments; mark only dependent results until the next user/custom/assistant conversation boundary. System deltas are transparent. Omit edits of removed results and edits superseded by explicit message replacement. Clone only retained entries and map removed compaction/branch-summary boundaries to the next retained clone. Historical source branches remain stored; existing rollback still restores accepted membership/properties/selection on rewrite failure.

Self-referencing compaction is an existing retain-none contract (appendCompaction null maps to its own ID; existing session-context-edit regression verifies it). If an invalidated result directly precedes compaction, the compaction clone is its valid next retained boundary. No schema, durable selection or mixed edit transaction change.

## Verification

Context-edit, rewrite fault/reopen, actual AgentSession edit and swipe suites: **133 passed**. Reused ID appears in a later actual calling assistant and its result survives; structurally equal arguments with reordered keys retain the original result. Real disk fault preserves held compaction identity/old bytes/projection; retry maps the boundary to retained compaction and real reopen matches live projection. Additional disk control is post-fix, not separate RED. No provider HTTP or whole-session transaction claim.

`npm run check` passed (1714 files; three changed files formatted). Post-format owning suites: **133 passed**.
