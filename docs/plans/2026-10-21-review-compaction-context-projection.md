# Review: project one current checkpoint and retain later system deltas

Date: 2026-10-21
Migration base: `462b881ec`
Local provenance: authored compaction checkpoint/summary composition in `e3f076aa`, with manager setting ownership retained by `a820049`

## Problem and current proof

Current context projection emits each cumulative summary's historical checkpoint and excludes every system message from the kept tail. Repeated compaction therefore replays obsolete prompts and drops prompt/tool updates after the latest checkpoint; legacy compactions without checkpoints also lose their system instructions. The manager's projection ignores its summary budget, and undefined setting contradicts the documented keep-all contract.

Current-source regressions: **3 failed / 33 passed**. The actual projection contained old+new checkpoints and no later delta, lost a legacy prompt, and bypassed the manager limit. Soft-deleted boundary controls passed.

## Final adaptation

Select compactions from the already deletion-filtered active path. Emit one latest visible checkpoint before oldest-first retained summaries. Suppress only pre-checkpoint system messages folded by an actual checkpoint, retain later deltas, and retain legacy system messages when no checkpoint exists. Preserve current context edits, deleted-tool-call filters and soft-deleted checkpoint un-compaction.

Manager default applies when options omit summaryBlockMaxTokens; an explicitly owned undefined field keeps all summaries. Setting undefined also keeps all. A follow-up regression caught the initial adapter's empty-options bypass (one assertion failed), then explicit own-field detection corrected it.

No cutoff, summary preparation, tokenizer policy or raw history changes belong here. Those remain separate dependent groups.

## Verification

Canonical context, soft-delete, context-edit and AgentSession soft-delete suites: **62 passed** across four files, including older/latest checkpoint selection, ordered summaries, post-checkpoint deltas, legacy no-checkpoint projection, deletion visibility, manager default/empty-options/explicit-undefined precedence. No provider/network request is used.

`npm run check` passed with 1711 files, formatting two changed files. Post-format owning suites again passed **62 tests**; normal hooks provide the final no-fixes gate.
