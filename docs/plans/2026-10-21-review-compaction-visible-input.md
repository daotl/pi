# Review: prepare compaction from canonical visible context

Date: 2026-10-21
Migration base: `2ac0cecce`
Provenance: `e3f076aa` authored checkpoint/ordered-summary composition, adapted to current deletion-aware projection; depends on projection `b5599b1c3` and cutoff `2ac0cecce`.

## Problem and observed RED

Preparation recollects raw compactions after projection, ignoring deletion visibility. It selects sessionEntryToContextMessages(c)[0], which is a checkpoint rather than the summary when present. It also drops ordinary system deltas from summary input. Result: deleted private summary is resurrected, stale checkpoint replays, visible summary text and later tools delta disappear.

Compaction + context-edit RED: **2 failed / 53 passed / 2 skipped**. One updated contract demonstrates missing initial system state; the new composition regression directly shows stale checkpoint, deleted summary and missing current summaries/delta. Undefined summary-limit branch fails first; zero-limit branch is a post-fix control.

## Adaptation

Build the canonical projection with the effective summary limit. Retain the cutoff's new-history boundary after the latest visible compaction; previous summaries alone do not justify another compaction. Preserve system messages in history/split prefix, but require non-system new conversation before preparing. Prepend the exact visible projected prefix once, including one current checkpoint and ordered summaries. Remove obsolete raw collection/helper/import.

No storage schema, summary privacy authorization, direct tokenizer policy, native output clamp or live setting synchronization change. Canonical projection consistency does not itself prove these separate policies.

## Verification

Compaction, context-edit, build-context and soft-delete suites: **91 passed / 2 skipped**. Actual AgentSession compaction lifecycle plus summary reasoning/serialization/nested-call suites: **44 passed**. Existing repeated-compaction controls still decline work when the retained conversation fits; replacement/omission recovery boundaries remain covered. No paid provider or live tokenizer call.

`npm run check` passed (1712 files; two changed files formatted). Post-format combined eight suites: **135 passed / 2 skipped**.
