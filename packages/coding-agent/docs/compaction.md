# Compaction Reference

This reference describes automatic compaction, branch summarization, persisted entries, and extension hooks. For the user workflow, see [Sessions and Context](sessions.md#manage-conversation-context).

**Source files** ([pi](https://github.com/earendil-works/pi)):
- [`packages/coding-agent/src/core/compaction/compaction.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) - Auto-compaction logic
- [`packages/coding-agent/src/core/compaction/branch-summarization.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) - Branch summarization
- [`packages/coding-agent/src/core/compaction/utils.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/utils.ts) - Shared utilities (file tracking, serialization)
- [`packages/coding-agent/src/core/session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts) - Entry types (`CompactionEntry`, `BranchSummaryEntry`)
- [`packages/coding-agent/src/core/extensions/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts) - Extension event types

For TypeScript definitions in your project, inspect `node_modules/@earendil-works/pi-coding-agent/dist/`.

## Overview

Pi has two summarization mechanisms:

| Mechanism | Trigger | Purpose |
|-----------|---------|---------|
| Compaction | Context exceeds threshold, or `/compact` | Summarize old messages to free up context |
| Branch summarization | `/tree` navigation | Preserve context when switching branches |

Both use closely related structured formats and track attributable file operations. Summarization requests disable prompt-cache writes because these one-off prompts are unlikely to be reused.

Each retry starts from a fresh copy of the fixed selected source history and reapplies the current context transform, converter and incoming-message prefix. Generated summary instructions are appended afterward and are not prefixed. The payload callback is read again after asynchronous policy work; a retry does not reuse a prior attempt's transformed messages. If policy removes an existing system baseline or tool declarations, summarization does not restore that private state afterward.

Historical assistant usage is cleared only on request-local summary copies, including standalone calls. Native adapter output limits therefore use the current converted request, not usage from a larger history or another model; stored billing and converter-owned messages remain unchanged.

Compaction preserves fitting structured history. If converted tool results exceed the physical input window or leave only the verified native adapter's one-token emergency floor, it serializes already-converted, replay-eligible history with bounded tool-result text. It preserves the policy-visible system/tool state and selected kept boundary, then checks the complete bounded request again. A request that still cannot fit fails before dispatch. Arbitrary custom streams retain their physical-window budget rather than inheriting native safety allowances.

## Compaction

### When It Triggers

Auto-compaction triggers when:

```
contextTokens > contextWindow - reserveTokens
```

By default, `reserveTokens` is 16384 tokens (configurable in `~/.pi/agent/settings.json` or `<project-dir>/.pi/settings.json`). This leaves room for the LLM's response.

During a multi-turn agent run, Pi checks the canonical projected context after tools finish and their results are appended, before starting the next assistant response. If the threshold is crossed, Pi compacts during `prepareNextTurn`, then performs the existing catch-up steering poll before `turn_start`. It skips this between-turn check when the completed tool batch terminates the run and no queued message requires another response. Pi also checks before a new user prompt and performs final-attempt overflow recovery after the low-level run ends.

A provider context-overflow error or an early final `stopReason: "length"` can select one compact-and-retry recovery attempt. Length responses with tool calls retain their synthetic failed tool results and follow the ordinary tool/queue scheduler rather than forcing the run to end.

You can also trigger manually with `/compact [instructions]`, where optional instructions focus the summary.

### How It Works

1. **Find cut point**: Walk backwards through the finalized session projection, accumulating token estimates (using the model's own tokenizer when available) until `keepRecentTokens` (default 20k, configurable in `~/.pi/agent/settings.json` or `<project-dir>/.pi/settings.json`) is reached
2. **Extract messages**: Collect projected messages from the previous kept boundary (or session start) up to the cut point
3. **Generate summary**: Call LLM to summarize the cut messages with the structured format. Prior summaries are included in the request prefix (as their own messages) for provider cache fidelity, but are context, not re-folded into the new summary.
4. **Append entry**: Save a new `CompactionEntry` with summary and `firstKeptEntryId`
5. **Rebuilds context**: Session rebuilds the context for the next request, using all summaries (oldest first) + messages from the latest `firstKeptEntryId` onwards

```
Before compaction:

  entry:  0     1     2     3      4     5     6      7      8     9
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┘
                └────────┬───────┘ └──────────────┬──────────────┘
               messagesToSummarize            kept messages
                                   ↑
                          firstKeptEntryId (entry 4)

After compaction (new entry appended):

  entry:  0     1     2     3      4     5     6      7      8     9     10
        ┌─────┬─────┬─────┬──────┬─────┬─────┬──────┬──────┬─────┬─────┬─────┐
        │ hdr │ usr │ ass │ tool │ usr │ ass │ tool │ tool │ ass │ tool│ cmp │
        └─────┴─────┴─────┴──────┴─────┴─────┴──────┴──────┴─────┴─────┴─────┘
               └──────────┬──────┘ └──────────────────────┬───────────────────┘
                 not sent to LLM                    sent to LLM
                                                         ↑
                                              starts from firstKeptEntryId

What the LLM sees:

  ┌────────┬─────────┬─────┬─────┬──────┬──────┬─────┬──────┐
  │ system │ summary │ usr │ ass │ tool │ tool │ ass │ tool │
  └────────┴─────────┴─────┴─────┴──────┴──────┴─────┴──────┘
       ↑         ↑      └─────────────────┬────────────────┘
    prompt   from cmp          messages from firstKeptEntryId
```

On repeated compactions, each new compaction summarizes only the messages being cut. Every prior summary is kept as its own message in the context prefix (oldest first), so no summary is ever re-summarized into a summary-of-summaries. The LLM sees `system prompt + [summary 1, summary 2, ...] + [kept messages]`. Because the summaries block grows with each compaction, its size is bounded by `summaryBlockMaxTokens` (default 16384); when the block exceeds the limit, the oldest summaries are dropped from the context view (never the most recent). A limit of `0` keeps only the most recent summary, matching the pre-feature single-summary behavior. Dropped summaries remain in the JSONL file; only the context view is filtered.

The transcript uses `compaction.summaryPlacement` consistently on initial load, after normal or extension-boundary compaction, on rebuild and when reopening a session. `context` shows selected summaries before the retained messages; `chronological` shows those same selected entries in active-branch order. Both modes use persisted summary timestamps and billing usage, exclude summaries outside the block limit, and leave the model's summaries-first context order unchanged.

When the structured history fits, the summarization request keeps the normal chat prefix (system prompt plus the summaries block and messages being cut, minus the preserved tail); only the summarization instruction is appended. Oversized converted tool history uses the bounded fallback described above instead of claiming prefix identity.

### Token counting

Remote counting is optional and requires a known native direct transport. Custom stream or payload callbacks, provider request/header policies, and faux providers use local estimates instead of bypassing those policies with a separate upload. Cut-point fragments are uploaded only when the current complete-history transform and converter prove the standard per-message mapping; that proof and live transport permission are checked again before every retry. Policy denial is not cached as endpoint unavailability.

Summary text is counted with `POST /tokenize` only when a prospective complete request proves that the summary survives policy unchanged. The final count retains the separate `POST /chat/completions/input_tokens` path, including chat-template, multimodal and effective tool declarations. Counting callbacks receive isolated history copies; policy-removed system messages or tools are not restored after conversion. Unsupported or denied counts retain the existing local-estimate fallback.

For native OpenAI-compatible chat counting, Pi reuses the inference adapter's message/tool serializer and resolved chat-template options after context policy conversion. Image blocks become wire `image_url` parts, tool results become `role:tool`, and effective declarations become request-level `tools`; raw executable tools are not reinserted when policy removes their declarations. The lazy `buildChatTokenRequest()` helper from `@earendil-works/pi-ai/api/openai-completions.lazy` accepts a normalized transcript and simple stream options. Pass its request to `countChatTokens(model, { request, ...auth })`; generation-only controls are omitted, while template options remain. Messages-only counting callers must already supply wire messages.

The footer uses a successful post-compaction count only for the checkpoint, selected leaf, context-edit state and model that were counted. New custom/bash context, context edits, a newer checkpoint or a model change invalidates it, including changes while counting is pending. Local estimates remain available to compaction but are not presented as a fresh exact footer count; unavailable or invalidated counts show `?` until a new count or applicable provider usage arrives. Live summary-budget changes invalidate the footer cache without another entry, and completed asynchronous counts refresh it without rescanning unchanged streaming frames.

Assistant usage copied by edit, deletion or restoration remains historical billing data, not a fresh measurement of the changed context. Projected estimates reject a copied entry when its `usageSourceId` differs from its current entry ID and use local content estimates instead. An independently generated alternative or a new provider response can supply fresh usage again; historical session charges are unchanged.

A fresh canonical continuation can replace a retained assistant before its cloned checkpoint. Its optional `usageContextEntryId` records the latest checkpoint/edit included in that request. Both projected estimates and SDK/footer usage accept the new measurement only when that reference matches the current latest invalidation boundary and the entry is not replayed usage. New boundaries invalidate it normally, including after file reopen.

Cut-point preparation starts at most four independent counts per batch and consumes them newest-first, regardless of completion order. A known cutoff cancels unused speculative requests without waiting for them or cancelling compaction, and no batch crosses the combined message-retention boundary. The first unknown endpoint probe is shared; after support is confirmed, batch requests can run concurrently. A definitive unavailable response stops further probes only for that compaction; later compactions probe again, and transient exhaustion or policy denial does not cache unavailability.

On repeated compactions, the summarized span starts at the previous compaction's kept boundary (`firstKeptEntryId`), not at the compaction entry itself, falling back to the entry after the previous compaction if that kept entry cannot be found in the path. A retain-none compaction records its own ID as `firstKeptEntryId`; repeated compaction starts after that entry. This preserves messages that survived the earlier compaction by including them in the next summarization pass as well. Pi also recalculates `tokensBefore` from the rebuilt, context-edited session projection before writing the new `CompactionEntry`, so the token count reflects the actual pre-compaction context being replaced. Omitted raw entries remain stored but do not affect cut selection, summaries, checkpoints, or token estimates.

### Overflow and Length Recovery Ordering

Recovery preserves the existing lifecycle and queue order. The completed attempt remains visible to `turn_end` and `agent_end`; post-run recovery then repairs persisted model context before a fresh retry:

```text
persist final assistant response
→ extension/public turn_end
→ extension/public agent_end
→ append context_edit omissions for the selected attempt
→ for overflow/length: run session_before_compact and append compaction on success
→ start the retry as a fresh run
```

If recovery compaction fails or is cancelled, Pi keeps the omission edits, appends no compaction, and schedules no internal retry. Existing queued work remains governed by ordinary steering and follow-up rules. `agent_before_settle` sees the repaired projection after recovery processing. Raw transcript history, exports, billing totals, and history-search extensions can still inspect the omitted attempt.

Cancelling a queued compaction during asynchronous summary authentication or stream setup does not restart the interrupted task, even when the provider wrapper reports a plain setup error. Genuine setup failures retain normal resume behavior; separately accepted steering and follow-up input keeps its ordinary delivery order.

A manual compact queued during a retryable response runs at the completed boundary before automatic retry events or backoff. Successful or failed compaction does not create an extra retry grant: disabled and exhausted policies remain exhausted. Cancelling the compaction suppresses the interrupted run's retry.

A queued compact takes precedence over a boundary continuation decision. After compaction, only a naturally runnable tool batch or an explicit continuation with committed runnable boundary input resumes. Tool results alone do not restart an all-terminating batch; an explicit end or completed tool-less answer without runnable boundary input stays ended. Cancellation suppresses this interrupted continuation; an ordinary compaction failure can still resume runnable work.

If compaction is cancelled while finding its cut point, preparation stops before `session_before_compact` handlers run. A started automatic compaction emits its aborted completion event whether preparation produced a usable candidate or not.

Cancellation before checkpoint publication, including during final summary tokenization, leaves the previous model context unchanged. If the built-in summary request already completed, Pi records that physical provider/model's charge once as a context-invisible usage entry. Cancelling before the summary completes creates no completed charge. Once the checkpoint is committed, cancellation during the final chat-template/multimodal context count does not roll it back or bill the summary again.

If writing the checkpoint fails, Pi likewise retains the completed built-in summary charge. If its usage entry cannot be written either, the charge stays pending in the active session and must be persisted before the next accepted prompt, continuation or compaction dispatches. Pending receipts are consumed after successful storage, before notifications, so a notification error cannot duplicate a charge. Unwritten pending receipts do not survive process exit. Extension-supplied summaries do not invent a physical provider/model attribution.

Session runtime replacement and shutdown drain pending summary and unpublished terminal-response charges, together with retained deferred bash/custom output, before invalidating the outgoing session; a failed initial drain rejects replacement and leaves that session available for retry. Charges share the same Session-owned publication queue and consume only after durable storage. Recovered usage notifications during a run occur only after that run or compaction owns the session, so a subscriber cannot start a competing continuation inside publication. Prompt acceptance is reported only after the mandatory run-owned receipt drain succeeds.

A compact accepted after the final turn boundary, including from `agent_before_settle`, runs before `agent_settled` for both prompts and standalone continuations. It does not start another model request solely because it was queued late.

### Split user-message spans

A user-message span starts with a user message and includes all turns until the next user message. Normally, compaction cuts at user-message boundaries.

When one user-message span exceeds `keepRecentTokens`, the cut point lands within that span at an assistant message. This is a split user-message span:

```
Split user-message span (one span exceeds budget):

  entry:  0     1     2      3     4      5      6     7      8
        ┌─────┬─────┬─────┬──────┬─────┬──────┬──────┬─────┬──────┐
        │ hdr │ usr │ ass │ tool │ ass │ tool │ tool │ ass │ tool │
        └─────┴─────┴─────┴──────┴─────┴──────┴──────┴─────┴──────┘
                ↑                                     ↑
         turnStartIndex = 1                  firstKeptEntryId = 7
                │                                     │
                └──── turnPrefixMessages (1-6) ───────┘
                                                      └── kept (7-8)

  isSplitTurn = true
  messagesToSummarize = []  (no earlier user-message spans)
  turnPrefixMessages = [usr, ass, tool, ass, tool, tool]
```

For split user-message spans, Pi generates two summaries and merges them:
1. **History summary**: Previous context (if any)
2. **User-message-span prefix summary**: The early part of the split user-message span

### Cut Point Rules

Valid cut points are:
- User messages
- Assistant messages
- BashExecution messages
- Custom messages (custom_message, branch_summary)

Never cut at tool results (they must stay with their tool call).

Preparation advances the kept boundary into a context-invisible suffix only when that suffix contains an omitted assistant attempt and no unomitted context-producing entries. Recovery `context_edit` omissions satisfy this rule; intrinsically context-invisible metadata may coexist with them. Metadata alone and newly appended custom messages do not move the cut. A replacement edit affecting the candidate input or summarized prefix also blocks advancement because the omitted assistant answered the pre-edit input; replacements of suffix entries that are ultimately omitted remain safe. This allows an over-budget recovered input to be summarized while retaining the edits that keep the abandoned attempt omitted, without making bookkeeping change whether new model input is preserved verbatim.

### CompactionEntry Structure

Defined in [`session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts):

```typescript
interface CompactionEntry<T = unknown> {
  type: "compaction";
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  usage?: Usage;       // LLM usage that generated the summary
  fromHook?: boolean;  // true if provided by extension (legacy field name)
  details?: T;         // implementation-specific data
}

// Default compaction uses this for details (from compaction.ts):
interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

Extensions can store any JSON-serializable data in `details`. The default compaction tracks file operations, but custom extension implementations can use their own structure. Generated and extension-provided summaries store their LLM `usage` when available so session totals include summarization work.

See [`prepareCompaction()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) and [`compact()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) for the implementation. For direct programmatic summarization, `generateSummary()` returns the summary text and `generateSummaryWithUsage()` returns `{ text, usage, fileOps }`. File operations come from attributable converted request history; custom transports or final payload/header policies conservatively omit reconstructed tags when attribution cannot be proved.

`findCutPoint()` is asynchronous; await its `Promise<CutPointResult>`. A custom token counter returns `Promise<number>` and may receive an abort signal for speculative work. The source-level `prepareCompaction()` helper is also asynchronous but is not exported from the root SDK package.

Direct compaction, branch-summary and bug-report summary headers use `ProviderHeaders` (`string | null` values). A `null` value suppresses a provider default header, including generated `Authorization`. Authentication preserves that marker until the final case-insensitive header merge; compaction also preserves it through optional token counting.

### SDK migration: checkpoint messages

`generateSummary()` and `generateSummaryWithUsage()` no longer accept the ignored positional `previousSummary` argument. Pass earlier checkpoints as ordered `compactionSummary` messages in `currentMessages` instead. `thinkingLevel` now immediately follows `customInstructions`; remove the obsolete argument from positional calls so later stream, retry and policy options do not shift accidentally. Earlier checkpoints remain context, not a target to fold into the new summary. `CompactionPreparation.previousSummary` remains extension metadata and is not removed.

```typescript
import { generateSummary } from "@earendil-works/pi-coding-agent";

const summary = await generateSummary(
  [{ role: "compactionSummary", summary: previousCheckpoint, tokensBefore: 12000, timestamp: Date.now() }, ...newMessages],
  model,
  reserveTokens,
  apiKey,
);
```


## Branch Summarization

### When It Triggers

When you use `/tree` to navigate to a different branch, Pi offers to summarize the work you're leaving. This injects context from the left branch into the new branch.

### How It Works

1. **Find common ancestor**: Deepest node shared by old and new positions
2. **Collect entries**: Walk from old leaf back to common ancestor
3. **Prepare with budget**: Include messages up to token budget (newest first)
4. **Generate summary**: Call LLM with structured format
5. **Append entry**: Save `BranchSummaryEntry` at navigation point

Branch summaries select canonical old-branch contributions, including context replacements and omissions, without restoring discarded checkpoint history or copying shared conversation into the abandoned range. Tool calls and matching results form complete groups; system patches remain transparent to matching, but user/custom/assistant boundaries stop association even when call IDs are reused.

Selection includes restored system/tool state, generated instructions and output room. Verified native streams use the adapter's fresh-input estimator and safety allowance to remove older complete groups before arbitrary policy hooks run. Every converted retry request is checked again; expansion that removes useful output room fails before navigation or checkpoint publication. Final payload/header attribution is a separate capability and does not disable the native adapter budget. Custom streams keep their physical-window selection and configured output cap.

Native output clamping has its own factory/registry dispatch-identity capability across Anthropic, OpenAI Completions/Responses/Codex, Azure Responses, Google/Vertex, Mistral and Bedrock simple adapters. This does not grant file-history attribution or tokenizer upload permission. Replacing either factory/provider dispatch function or installing a custom registry/extension wrapper revokes automatic native-budget treatment; restoring the original recognized dispatch restores it.

For programmatic callers, `prepareBranchEntries(entries, tokenBudget, contextProjection?)` accepts chronological slices; pass the full canonical old-branch projection when summarizing a selected range. Its result is `{ messages, fileOps, totalTokens, budgetExceeded }`. `budgetExceeded` replaces `firstEntryId`; preceding authority is recovered from the projection rather than a raw entry boundary. Update consumers to inspect `budgetExceeded` for selection truncation. Input entries and their persisted parent IDs are not mutated.

For standalone `generateBranchSummary({ agent, ... })` calls, the Agent's current system/tool state supplies a baseline only when the selected projection has no preceding system baseline, no explicit `contextProjection`, and no compaction checkpoint. A supplied projection or checkpoint remains authoritative. This fallback does not copy shared conversation into the abandoned range.

```
Tree before navigation:

         ┌─ B ─ C ─ D (old leaf, being abandoned)
    A ───┤
         └─ E ─ F (target)

Common ancestor: A
Entries to summarize: B, C, D

After navigation with summary:

         ┌─ B ─ C ─ D
    A ───┤
         └─ E ─ F ─ [summary of B,C,D] (new leaf)
```

### Request-Derived File Tracking

Default compaction and branch summarization derive appended file-operation tags from successful-attempt policy-transformed and converted assistant tool calls. Error/aborted calls excluded by provider replay do not reappear through checkpoint metadata. Raw preparation details and internal nested-call records never restore a path removed from model-visible history.

Earlier summaries remain ordinary policy-visible context and may retain their own file tags; their raw `details` are not independently reinserted after filtering. Each new file list describes attributable tool operations in that request, not an unconditionally accumulated archive. Extensions retain control of their own details format.

### BranchSummaryEntry Structure

Defined in [`session-manager.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts):

```typescript
interface BranchSummaryEntry<T = unknown> {
  type: "branch_summary";
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  fromId: string;      // Entry we navigated from
  usage?: Usage;       // LLM usage that generated the summary
  fromHook?: boolean;  // true if provided by extension (legacy field name)
  details?: T;         // implementation-specific data
}

// Default branch summarization uses this for details (from branch-summarization.ts):
interface BranchSummaryDetails {
  readFiles: string[];
  modifiedFiles: string[];
}
```

Same as compaction, extensions can store custom data in `details`.

See [`collectEntriesForBranchSummary()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts), [`prepareBranchEntries()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts), and [`generateBranchSummary()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/branch-summarization.ts) for the implementation.

## Summary Format

Both formats include Goal, Constraints & Preferences, Progress, Key Decisions, and Next Steps. Compaction summaries also include Critical Context. Branch summaries stop after Next Steps. Pi appends file lists to either format when relevant.

Compaction summaries use this format:

```markdown
## Goal
[What the user is trying to accomplish]

## Constraints & Preferences
- [Requirements mentioned by user]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data needed to continue]

<read-files>
path/to/file1.ts
path/to/file2.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

### Message Serialization

Before summarization, messages are serialized to text via [`serializeConversation()`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/utils.ts):

```
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

This prevents the model from treating it as a conversation to continue.

Tool results are truncated to 2000 characters during serialization. Content beyond that limit is replaced with a marker indicating how many characters were truncated. This keeps summarization requests within reasonable token budgets, since tool results (especially from `read` and `bash`) are typically the largest contributors to context size.

## Custom Summarization via Extensions

Extensions can intercept and customize both compaction and branch summarization. See [`extensions/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts) for event type definitions.

### session_before_compact

Fired before auto-compaction or `/compact`. Can cancel or provide custom summary. See `SessionBeforeCompactEvent` and `CompactionPreparation` in the types file.

```typescript
pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, branchEntries, customInstructions, reason, willRetry, signal } = event;

  // preparation.messagesToSummarize - messages to summarize
  // preparation.turnPrefixMessages - user-message-span prefix (if isSplitTurn)
  // preparation.previousSummary - previous compaction summary
  // preparation.fileOps - extracted file operations
  // preparation.tokensBefore - context tokens before compaction
  // preparation.firstKeptEntryId - where kept messages start
  // preparation.settings - effective settings after applying model overrides

  // branchEntries - all entries on current branch (for custom state)
  // reason - "manual" (/compact), "threshold", or "overflow"
  // willRetry - whether the aborted turn is retried after compaction (overflow recovery)
  // signal - AbortSignal (pass to LLM calls)

  // Cancel:
  return { cancel: true };

  // Custom summary:
  return {
    compaction: {
      summary: "Your summary...",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      // usage: summaryResponse.usage, // Optional; included in session totals
      details: { /* custom data */ },
    }
  };
});
```

#### Converting Messages to Text

To generate a summary with your own model, convert messages to text using `serializeConversation`:

```typescript
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation } = event;
  
  // Convert AgentMessage[] to Message[], then serialize to text
  const conversationText = serializeConversation(
    convertToLlm(preparation.messagesToSummarize)
  );
  // Returns:
  // [User]: message text
  // [Assistant thinking]: thinking content
  // [Assistant]: response text
  // [Assistant tool calls]: read(path="..."); bash(command="...")
  // [Tool result]: output text

  // Now send to your model for summarization
  const { summary, usage } = await myModel.summarize(conversationText);
  
  return {
    compaction: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      usage,
    }
  };
});
```

See [custom-compaction.ts](../examples/extensions/custom-compaction.ts) for a complete example using a different model.

### session_compact_failed

Fired when manual or automatic compaction fails or is aborted. This is useful for telemetry extensions that need to pair `session_before_compact` attempts with terminal outcomes.

```typescript
pi.on("session_compact_failed", async (event, ctx) => {
  const { reason, errorMessage, aborted, willRetry, fromExtension } = event;
  // reason - "manual" (/compact), "threshold", or "overflow"
  // errorMessage - present for non-abort failures
  // aborted - true for canceled/aborted compactions
  // willRetry - whether the aborted turn would have retried after compaction
  // fromExtension - whether extension-provided compaction content was being used
});
```

### session_before_tree

Fired before `/tree` navigation. Always fires regardless of whether user chose to summarize. Can cancel navigation or provide custom summary.

```typescript
pi.on("session_before_tree", async (event, ctx) => {
  const { preparation, signal } = event;

  // preparation.targetId - where we're navigating to
  // preparation.oldLeafId - current position (being abandoned)
  // preparation.commonAncestorId - shared ancestor
  // preparation.entriesToSummarize - entries that would be summarized
  // preparation.userWantsSummary - whether user chose to summarize

  // Cancel navigation entirely:
  return { cancel: true };

  // Provide custom summary (only used if userWantsSummary is true):
  if (preparation.userWantsSummary) {
    return {
      summary: {
        summary: "Your summary...",
        // usage: summaryResponse.usage, // Optional; included in session totals
        details: { /* custom data */ },
      }
    };
  }
});
```

See `SessionBeforeTreeEvent` and `TreePreparation` in the types file.

## Settings

Configure compaction in `~/.pi/agent/settings.json` or `<project-dir>/.pi/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000,
    "summaryBlockMaxTokens": 16384
  }
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enabled` | `true` | Enable auto-compaction |
| `reserveTokens` | `16384` | Tokens to reserve for LLM response |
| `keepRecentTokens` | `20000` | Recent tokens to keep (not summarized) |
| `summaryBlockMaxTokens` | `16384` | Max tokens for the summaries block in the prefix; oldest summaries are dropped beyond this (the most recent is always kept). `0` keeps only the most recent summary |

Disable auto-compaction with `"enabled": false`. You can still compact manually with `/compact`.

### Per-model overrides

Use `compaction.modelOverrides` to tune token budgets for different models:

```json
{
  "compaction": {
    "reserveTokens": 16384,
    "keepRecentTokens": 20000,
    "modelOverrides": {
      "some-provider/big-model": {
        "reserveTokens": 400000
      }
    }
  }
}
```

For a model with a 1M context window, this override triggers compaction above 600K tokens and keeps the ordinary 20000 recent tokens. Other models retain the ordinary 16384-token reserve. `reserveTokens` also influences summarization output limits, capped by the model's maximum output tokens; it is not solely a trigger threshold.

Keys are exact, case-sensitive `provider/modelId` values, including any slashes within the model ID. Each `reserveTokens` and `keepRecentTokens` value falls back independently from the model override to the ordinary setting to the built-in default. Values must be non-negative safe integers. Invalid values in the matching model override produce an error when read; only omitted fields fall back to the ordinary setting. Model override entries must be objects. Invalid ordinary token settings produce an error when read, even if the active model has a valid override. Only omitted ordinary values use built-in defaults. `enabled` remains global, not model-specific.

These resolved values are used for manual compaction, all automatic threshold checks, overflow recovery, and extension-visible `preparation.settings`. Model switches affect subsequent checks and compactions without changing ordinary settings. Compaction already in progress uses the model and settings captured for that operation. Branch summarization settings are unaffected.

Overrides work in both global and project settings. The files merge recursively before lookup, so a global model-specific value beats a project-wide fallback; a project must override that model entry to change it. See [Settings](settings.md#per-model-compaction-overrides) for details.
