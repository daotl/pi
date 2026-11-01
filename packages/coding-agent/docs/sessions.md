# Sessions and Context

Pi saves a conversation as a session. The active branch of that session supplies conversation history for the next model request. Use session commands to continue work, explore another branch, or reduce the amount of history sent to the model.

## Continue or switch sessions

Pi saves sessions automatically unless you start it with `--no-session`.

```bash
pi --continue
pi --resume
```

`--continue` opens the most recent session for the current working directory. `--resume` opens the session picker. In interactive mode, `/resume` opens the same picker and `/new` starts a new session.

Use `/name` or `--name` to assign a recognizable session name. Run `/session` to verify the current session file, ID, message count, token usage, and cost.

The session picker lets you search, rename, and delete sessions. It can also show paths, change sorting, and limit results to named sessions. See [Keybindings](keybindings.md#sessions) for its shortcuts.

| Command | Description |
|---------|-------------|
| `/resume` | Browse and select previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set the current session display name |
| `/session` | Show session info |
| `/tree` | Navigate the current session tree |
| `/fork` | Create a new session from a previous message (selector, index, or substring) |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Summarize older context; see [Compaction](compaction.md) |
| `/export [file]` | Export session to HTML |
| `/share` | Upload as private GitHub gist with shareable HTML link |
| `/bug [description]` | Report a bug to the Pi developers; see [Reporting Bugs](#reporting-bugs) |

## Choose how to branch

Pi stores entries as a tree, so returning to an earlier point does not erase the branch you leave.

| Action | Result | Use it when |
|---|---|---|
| `/tree` | Moves within the current session file | Related alternatives should stay together |
| `/fork` | Creates a new session from an earlier user message | The alternative should become separate work |
| `/clone` | Copies the active branch into a new session | You want a separate copy of the current state |

In `/tree`, select a user message to put its text back in the editor. Edit and submit it to create another branch. Selecting an assistant response or another entry continues after that entry with an empty editor.

When you leave a branch, Pi can summarize it and attach that summary to the branch you enter. This preserves relevant work from the abandoned path without including every message from it.

A submitted batch of `pi_edit`/`pi_swipe` blocks is one durable history change: replacements, additions, new versions and in-place swipe edits either all publish or none do. A stale swipe or storage failure keeps the previous branch, transcript and file unchanged. Id0 keeps its current new-version behavior (root messages use replacement); `pi_swipe` keeps existing version timestamps and positions. Editing does not dispatch a model request.

Substring copy searches the active projected content, including custom messages, with context replacements applied and omitted messages excluded. Editable user/assistant indices are shared by copy output, numeric edit lookup, substring editing and the forkable-message inventory; custom messages carry no editable index. Projection changes this view without rewriting the original stored messages.

Failures returned by an interactive editor submission are displayed as errors instead of escaping the asynchronous submit callback. Existing command-specific error messages and storage rollback rules still apply; this boundary does not roll back earlier command side effects or catch detached background tasks.

`/system-prompt set` accepts a space, tab or newline before its prompt text; bare `set` only shows the existing policy. For `/copy`, a number on the command line selects an editable message, while a payload beginning on the next line is copied literally, even when it contains only digits.

Session deletion and restoration methods, including soft-delete, shred and swipe-version delete/restore, reject while an agent run, compaction or branch summary owns the session. The check happens before selecting or changing history. Wait for idle before retrying; successful idle deletion/restoration retains its existing semantics.

A numeric `/shred` that selects both swipe-version subtrees and ordinary entries commits the complete selection atomically. If persistence fails, the previous file, selected branch and live transcript remain unchanged; retry after resolving the storage failure. Existing deletion-unit order and swipe-subtree expansion still apply.

SDK `deleteLastMessages(count)` / `SessionManager.removeLastMessages(count)` count message entries in the current projection, not raw stored messages: omissions, system messages and assistant entries whose projected content is harness-empty do not consume the count. When removal crosses a compaction checkpoint, summaries and saved state remain, and retained boundaries are rebased without reviving summarized history, including on surviving sibling branches after reopening. Without a crossed checkpoint, suffix deletion still removes trailing entries and descendants. This SDK message-count contract does not change the CLI's separate deletable-unit order.

For the persisted tree and entry types, see [Session Format](session-format.md).

## Manage conversation context

The model receives the active branch, not every branch in the session file. Pi combines that history with the system prompt, discovered context files, available tools, and loaded skill descriptions. [How Pi Works](how-pi-works.md#context) describes how those inputs are assembled.

Changing padding, wrapping, message backgrounds or separators during a response rebuilds the saved transcript without detaching the current assistant or live tool-output components. Subsequent assistant deltas and tool progress continue in those same components; display changes do not restart the request or change stored conversation text.

The footer shows current context usage. When the active context approaches the model's limit, Pi normally compacts older history automatically. Compaction adds a summary and keeps recent messages. It does not delete the original session entries.

Run `/compact` to compact manually. You can add instructions when the summary should preserve a particular topic or decision. Configure automatic compaction and retained history through [Settings](settings.md#compaction).

Compaction can fail if the provider is unavailable or cannot accept the summarization request. Correct the provider problem and run `/compact` again. Disabling automatic compaction does not disable the manual command.

When GitHub Copilot overflow recovery generates its built-in summary, Pi bounds the serialized normalized summary context below 32 MiB. It keeps bounded conversation text and fitting recent images, omitting older images only when necessary; saved history is unchanged. If the remaining context still exceeds the bound, recovery fails before dispatch. This bound is not a guarantee about the provider's final wire payload, which can differ after adapter conversion or payload hooks. Ordinary requests, manual compaction and other providers do not enable this recovery-specific bound.

Accepted steering and follow-up input does not grant another retry. When automatic retry is disabled or exhausted, queued input is sent as an ordinary request rather than recapturing the interrupted assistant prefix. An already approved prefix retry keeps its first request ahead of queued steering; that input is delivered afterward.

Trailing system-policy patches do not hide an interrupted assistant from continuation. Successful continuation keeps those patches; if its echo is rejected, restoring the original partial also restores the ordered trailing patches. A system patch alone does not make a completed assistant answer runnable again.

While an interrupted assistant is being continued, its original prefix and suffix remain selected in the session file. A verified completion replaces them in one atomic write. A failed or truncated continuation restores the original prefix together with replayable recovery entries; failed restoration is retried before the next request. Selecting another branch through the tree discards that abandoned branch's pending recovery. Recovery state not yet written remains in memory and does not survive process exit.

Initial transcript loading and rebuilds use projected content: context replacements are shown and omissions are hidden, while state-only extension rows and cache-warming notices remain visible. During interrupted prefill continuation, the live transcript hides the captured original contribution without deleting it from storage. It reconciles the replacement after the completed response is persisted at `turn_end`; restoration updates the transcript immediately. Cache-miss notices remain attributed to the original billed assistant even when its displayed content is replaced.

Capture-triggered transcript reconciliation remains active through run settlement. If restoring the saved prefix fails to persist after the last turn, settlement refreshes the display from the finalized projection before shutdown or scheduled work; the storage error is still shown and pending recovery semantics are unchanged.

Continuing a completed assistant answer without supported prefill or new queued input rejects without deleting or regenerating that answer. Interrupted error/aborted responses on providers without prefill support can retry from their input; their original response stays in raw history and an append-only context omission removes it from the retry request.

Settled-trigger schedules and deferred edit/continue actions drain only while the session is idle. Eligible numbered entries use their original creation IDs, including timed actions that became due in reverse order. One settled delivery excludes later settled work during asynchronous prompt preflight. Accepted run/queue dispatch waits for a subsequent settlement; handled inputs/commands and rejected or no-op edits advance without requiring an unrelated run. This does not change ordinary timed-message follow-up behavior during an active run.

Time- and message-count-triggered delivery follows the same dispatch arbitration when idle or while another settled, queue or heartbeat delivery owns preflight. Ordinary messages, edits and bare continuations keep their creation IDs while waiting. A due ordinary message during an active run still enters follow-up when no such delivery owner is pending; compaction still queues ordinary input for its existing post-compaction flush.

Compaction-queued delivery keeps an independent owner while its first prompt passes preflight and runs. Later queued input drains before settled schedules, including when the parent extension command has already returned. The rest of a batch is queued only after the first prompt is accepted or handled. If that first prompt is rejected, the original batch remains ahead of newer queued input for explicit retry, and settled schedules do not bypass it; existing steering/follow-up modes are preserved.

Scheduled edit blocks continue only after a nonempty edit is accepted. Rejected or no-op edits do not start a continuation, and applying a scheduled edit does not clear an unsent editor draft.

When settlement defers the first queued prompt, the flush call can return to its awaiting settlement handler without releasing the delivery owner. The rest of the batch enters steering/follow-up only after that first prompt is accepted; the owner remains until the deferred execution, including those queued turns, completes. Deferred rejection restores the original batch ahead of later queued input.

Replacing a session or stopping its interactive presentation cancels any reserved compaction-queue submission still in asynchronous preflight. Releasing the old input/authentication hook afterward cannot dispatch an outgoing provider request or admit the discarded batch into the replacement session.

Tree navigation through the selector or an extension command wakes queued input and due scheduled work after success, cancellation or failure. Selector navigation restores its Escape handler and clears its branch-summary indicator before dispatch resumes. Existing queue ownership and idle checks still decide when work may run, and navigation does not overwrite an unsent draft.

Interval heartbeats track individual deadlines and dispatch at most one most-overdue beat per idle tick. A run started by an interval beat preserves the other beats' deadlines; ordinary activity resets interval countdowns. Typing during heartbeat preflight withdraws that cadence preservation without releasing its dispatch exclusion. Handled or rejected heartbeat input wakes eligible settled schedules; daily beats skip busy or owned-preflight occurrences and rearm for the next local wall-clock occurrence. Bare heartbeat continuation uses the existing synchronous Session run-ownership handoff.

Heartbeat saves write the accepted snapshot through an exclusively created sibling temporary file, close it, then rename it over the target. Write, close or rename failure preserves the previous target; status from an outgoing lifecycle is suppressed. This does not guarantee fsync or recovery after a process or power failure.

See [Compaction Reference](compaction.md) for thresholds, retained boundaries, branch-summary behavior, and extension hooks.

## Control session storage

By default, Pi stores sessions under `~/.pi/agent/sessions/`, grouped by working directory. Use `--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, or the `sessionDir` setting to choose another location. The CLI option has highest precedence.

Use `--no-session` for an ephemeral run. An ephemeral session cannot be resumed after Pi exits.

Use `--session` when you already know the session path or ID. Use `--fork` to create a new session from an existing session before interactive mode starts.

If persisting deferred bash output or context-only extension messages fails, the active prompt or continuation reports the storage error and releases its run ownership. Successfully appended records are not replayed; records not yet written remain pending for the next accepted prompt. Graceful shutdown and runtime replacement also drain these retained records before invalidating the outgoing session, without another provider request or redisplaying custom messages. A failed initial drain leaves the session available for retry. This recovery state is in memory and does not survive a process crash before it is written.

If the first conversation write fails after exclusively creating its session file, Pi removes that failed attempt's file and leaves the entry unpublished, so the next append can retry. An exclusive-open collision never removes another writer's file. This is recoverable write/close error handling, not a guarantee against process crashes or independent concurrent writers.

Edits, surgical deletions and failed-prefill restoration can create context-only copies of earlier entries. Session stats, footer, cost breakdowns and HTML export count each recorded charge identity once, including abandoned history. Independent equal-valued provider calls, including regenerated swipe responses, remain separate charges; equal amounts alone never identify a replay. Existing histories without replay identities are not retroactively deduplicated.

## Export or share a session

Use `/export` to write the current session as HTML or JSONL. Use `/share` to upload it and get a viewer link. By default, Pi uses a Radius artifact when Radius authentication is configured; otherwise, it uses a private GitHub gist. Set [`sessionShareDestination`](settings.md#sessions-and-context) to `gist` or `radius` to force one destination.

Review exported or shared sessions first. They can contain prompts, model responses, tool arguments, command output, file contents, and extension messages.

HTML exports retain tool arguments even when an extension customizes only the result display. If the first recorded system state on a branch is a compaction checkpoint, the viewer shows its baseline prompt and available tools before later system updates; that baseline is also searchable.

The HTML viewer vendors Marked 18.0.11 with a task-list tokenizer backport that associates each checkbox marker with its own paragraph, preserving literal markers in later paragraphs. To regenerate it from a checkout with dependencies installed, run `node scripts/generate-export-marked.mjs` at the repository root, then `node scripts/generate-export-marked.mjs --check`. The generator authenticates the installed Marked source map by exact version and SHA-256, applies the readable TypeScript backport, and bundles it with pinned esbuild 0.28.2 while preserving the upstream license and UMD exports. Do not edit the minified asset or move tokenizer internals into the viewer; upgrades require reviewing the source pin and backport together.

## Report a bug

Run `/bug [description]` to prepare a private report for the Pi developers. You can include the session transcript, omit it, or ask the current model to summarize the problem. Review any transcript or generated summary because it can contain sensitive conversation data.

The report includes environment and provider configuration without credential values, plus recorded error diagnostics. Upload it through `radius.pi.dev` or export the same report as a zip to inspect and share yourself. Uploads do not require a login; Radius authentication attributes the report to your account so the developers can follow up. If an upload fails, Pi offers to export the zip.
