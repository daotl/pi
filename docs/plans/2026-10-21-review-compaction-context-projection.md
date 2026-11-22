# Review: project one current checkpoint and retain later system deltas

Date: 2026-10-21
Migration base: `462b881ec`
Local provenance: authored compaction checkpoint/summary composition in `e3f076aa`, with manager setting ownership retained by `a820049`

## Problem and current proof

Current context projection emits each cumulative summary's historical checkpoint and excludes every system message from the kept tail. Repeated compaction therefore replays obsolete prompts and drops prompt/tool updates after the latest checkpoint; legacy compactions without checkpoints also lose their system instructions. The manager's projection ignores its summary budget, and undefined setting contradicts the documented keep-all contract.

Current-source regressions: **3 failed / 33 passed**. The actual projection contained old+new checkpoints and no later delta, lost a legacy prompt, and bypassed the manager limit. Soft-deleted boundary controls passed.

## Final adaptation

Select compactions from the already deletion-filtered active path. Emit one latest visible checkpoint before oldest-first retained summaries. Suppress only pre-checkpoint system messages folded by an actual checkpoint, retain later deltas, and retain legacy system messages when no checkpoint exists. Preserve current context edits, deleted-tool-call filters and soft-deleted checkpoint un-compaction.

The manager default applies when options omit summaryBlockMaxTokens or pass undefined; only a numeric option overrides it. Setting the manager limit to undefined keeps all summaries. A follow-up regression caught the initial adapter's empty-options bypass (one assertion failed); own-field detection fixed it first and was later replaced by the numeric-only rule (review round 5).

`prepareCompaction` now projects with `settings.summaryBlockMaxTokens`, matching the summaries its request actually sends. Counting excluded summaries inflated the summary-window estimate; the cut then fell back to the keep-recent budget and sent a head larger than the summary model's window (regression in `compaction.test.ts`). `AgentSession` now hands `SessionManager` a getter for the summary limit instead of a snapshot, so a setting changed without `reload()` reaches live requests as well as compaction (regression in `agent-session-boundaries.test.ts`). `prepareCompaction` also takes each previous summary as the summary message itself: a checkpointed compaction projects as `[systemMessage, summary]`, so taking item 0 handed extensions (`session_before_compact`), head-less `compact()` callers and file-operation extraction the checkpoints instead of the summaries. Pi's built-in path was unaffected because it summarizes over the live projection head. `SessionManager.buildSessionProjection` treats an undefined `summaryBlockMaxTokens` option as "use the session limit"; only a number overrides it, so forwarding a possibly-undefined value cannot disable the limit. No other cutoff, tokenizer policy or raw history changes belong here.

## Verification

Canonical context, soft-delete, context-edit and AgentSession soft-delete suites: **62 passed** across four files, including older/latest checkpoint selection, ordered summaries, post-checkpoint deltas, legacy no-checkpoint projection, deletion visibility, manager default/empty-options/explicit-undefined precedence. No provider/network request is used.

After rebasing onto upstream `crystal`, `continue-after-compaction-prefill.test.ts` compares only non-system request messages: the post-checkpoint prompt delta is now intentionally retained.

The boundary preview manager (`AgentSession._createBoundaryPreviewManager`) now copies the configured summary limit, so `turn_end`/`agent_before_settle` previews show the same summaries block as the real request (regression in `agent-session-boundaries.test.ts`).

`npm run check` passed with 1711 files, formatting two changed files. Post-format owning suites again passed **62 tests**; normal hooks provide the final no-fixes gate.

## Review rounds (2026-11-21, after rebasing onto upstream `crystal`)

Each round reviewed the whole staged change, including fixes from earlier rounds.

### Round 1

- **Found:** two tests in `continue-after-compaction-prefill.test.ts` expected the post-compaction request to hold only the summary. The projection now also keeps a post-checkpoint system prompt delta, which is intended.
- **Fixed:** both tests compare only non-system messages and still assert that summarized history does not return.

### Round 2

- **Found:** the `buildContextEntries` comment still said every compaction summary is kept.
- **Fixed:** the comment now says only summaries within the limit are kept, and the latest always is. This note records the round 1 test change.
- **Checked, not changed:** in a legacy session without checkpoints, a system message inside the summarized range is still omitted. This predates the change. The next request recovers: `_preparePromptAndToolLoadout` diffs current prompt sections against an empty baseline and re-sends them all (`agent-session.ts:3148-3162`), and the agent loop re-declares every tool when the transcript declares none (`agent/src/agent-loop.ts:401-446`). No end-to-end test covers this.

### Round 3

- **Found:** `AgentSession._createBoundaryPreviewManager` did not copy the summary limit, so `turn_end`/`agent_before_settle` previews could show different summaries than the real request.
- **Fixed:** the preview copies the limit; regression in `agent-session-boundaries.test.ts`.
- **Found, then fixed as a follow-up:** `prepareCompaction` projected without the limit. Counting summaries the request never sends inflated the summary-window estimate; the cut fell back to the keep-recent budget and the summarization head (about 195k tokens in the regression) exceeded the summary model's 71,808-token head budget. It now projects with `settings.summaryBlockMaxTokens`; regression in `compaction.test.ts`.

During this round a malformed `git stash push` stashed nothing and the following `git stash pop` applied an unrelated stash. Every file it touched was reset to HEAD, the round's fix was reapplied, and all stashes remained.

### Round 4

- **Checked:** both compaction paths (`/compact` at `agent-session.ts:4909`, auto-compaction at `:5275`) pass settings containing the limit; every `SessionManager` projection caller gets the limit by default.
- **Found, then fixed as a follow-up:** the session copied the limit only at construction and `reload()`, so changing the setting without a reload left live requests on the old limit while compaction used the new one. `AgentSession` now passes a getter that reads the setting on every projection; the reload-time sync was removed. Regression in `agent-session-boundaries.test.ts`.

### Round 5 (full multi-reviewer review)

Reviewers: correctness, project-standards (root `AGENTS.md`), testing, adversarial. The cross-model pass to Codex skipped itself because the host session runs through a third-party relay and its model family could not be attested, so the adversarial lens ran in-process. All reviewers shared one model.

- **Found (testing and adversarial independently):** `prepareCompaction` took item 0 of each previous compaction's context messages. A checkpointed compaction projects as `[systemMessage, summary]`, so `messagesToSummarize` held old checkpoints instead of summaries. Pi's built-in compaction was unaffected because it summarizes over the live projection head (`agent-session.ts:4619`); `session_before_compact` extensions, head-less `compact()` callers and file-operation extraction were affected. Pre-existing. **Fixed:** the summary message is built explicitly; regression with checkpointed compactions in `compaction.test.ts`.
- **Found (project-standards):** `SessionManager.buildSessionProjection` used `Object.hasOwn` to tell an absent option from an explicit undefined, contrary to `AGENTS.md`, and a forwarded undefined would disable the limit. **Fixed:** only a numeric option overrides the session limit.
- **Raised, not changed:** a `context_edit` targeting a compaction is ignored by the new inline projection. Not reachable: `appendContextEdit` rejects compaction targets (`session-manager.ts:1629`).
- **Testing gaps:** no test runs compaction with a post-checkpoint system delta in the kept tail. Two successive compactions through `appendCompaction` are now covered by `build-context.test.ts` ("folds a delta into the next checkpoint across successive compactions"), which fails on HEAD's projection.

After round 5: `npm run check` passed; coding-agent suite 3,413 passed, 0 failed. `agent-session-swipe.test.ts` ("edits a non-current swipe version in place") fails intermittently with and without this change (1 of 3 runs each way).
