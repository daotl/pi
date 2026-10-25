# SDK

`@earendil-works/pi-coding-agent` embeds Pi in a Node.js or Bun process. It provides direct TypeScript access to the agent, sessions, tools, models, and resources used by the command-line application.

Use the SDK for in-process TypeScript integration. For a language-independent or isolated subprocess, see [CLI Integration](cli-integration.md).

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();

try {
  await session.prompt("What files are in the current directory?");
  console.log(session.getLastAssistantText());
} finally {
  session.dispose();
}
```

This uses the working directory, discovered resources, stored settings, and configured credentials. `prompt()` resolves when the run finishes.

The [complete minimal example](../examples/sdk/01-minimal.ts) also streams text events. All [SDK examples](../examples/sdk/) are typechecked with the repository.

<a id="session-management"></a>

## Session lifecycle

`createAgentSession()` creates an `AgentSession`. The session owns one conversation, its model and tools, queued messages, compaction state, and extension runtime.

Read current state through `session.messages`, `session.model`, `session.thinkingLevel`, `session.systemPrompt`, and `session.getActiveToolNames()`.

`session.getSessionProjection()` returns finalized live contributions as `entries: { sourceEntry, messages }[]`, their flattened `messages`, and the selected model/thinking state. Reuse this view when a UI needs durable provenance alongside context replacements and omissions. A captured continuation prefix retains its source entry but contributes no live messages until restored or replaced. State-only custom/usage entries may also have empty messages; render their own display metadata separately rather than discarding them. This view does not include the assistant response currently streaming.

`session.systemPrompt` is read-only and returns the current effective system prompt, including changes that have not yet been sent to the model. Tool changes are declared to the model before the next request.

Explicit `setCustomSystemPrompt()` and granular `reloadSystemPromptFromFiles()`/`reloadSkillsFromFiles()`/`reloadAllFromFiles()` updates reject while an agent run, compaction or tree summary owns the session. If saving the updated snapshot fails, the previous effective prompt construction and skill metadata remain active for subsequent requests. Loader caches may already reflect changed files; another explicit update retries publication from those current resources.

On trusted resume, saved static prompt sections remain effective across getters, `before_agent_start` handlers and provider requests; the current working directory and executable tool/skill-reader guidance follow the runtime. New snapshots retain copied raw context files. Older rendered project-context bodies remain opaque rather than being parsed into invented file paths. Per-run option edits and explicit empty sections override the saved rendering without rewriting the base snapshot.

On untrusted resume, saved skill paths provide ordering hints only: current non-project loader resources determine skill identity and metadata. Historical system instruction sections are replaced before request-context hooks and direct summaries; allowed current hooks can still augment the sanitized policy. An explicit user `customPrompt` override remains effective. AGENTS context loads regardless of project trust: structured saved context remains effective until a full resource reload, while an opaque legacy prompt without sections uses current loader context. A full reload refreshes context files while retaining saved preamble, addendum and skill metadata until their explicit granular update.

Tree and swipe navigation restore prompt construction, skill metadata, context files and executable tool loadout from the selected path. Regeneration and mixed message edits reconcile that state without an intermediate snapshot append; policy-only system entries do not split assistant swipe versions. Physical tail removal also restores the remaining path's policy. In-memory explicit updates retain snapshots for later branch restoration without adding an invisible startup anchor to an otherwise empty session.

Use `session.getEffectiveSkills()` for the skill inventory used by prompt rendering and `/skill:name` dispatch, rather than newly discovered loader metadata. Returned skill records and source metadata are copies. `session.getEffectiveContextSources()` returns copied `{ path }` or `{ label }` records; restored opaque sections use an unavailable-source label instead of claiming a changed file supplied their current contents. Interactive resource listings, completions and RPC `get_commands` follow the effective inventory; explicit resource updates and selected-path changes refresh the interactive views.

<a id="sessionmanager-api"></a>

### Session storage

Sessions are persistent by default. `SessionManager` owns the persisted or in-memory entry tree and tracks its active leaf. Branching changes that leaf without deleting abandoned branches. When Pi reconstructs model context, the manager selects the active branch and applies compaction.

`SessionManager` is authoritative for finalized model context. Restore external history by constructing the session with a manager containing those entries. Assigning `session.agent.state.messages` does not replace persisted context.

Use an in-memory manager when the host does not want session files:

```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
});
```

See the checked [sessions example](../examples/sdk/11-sessions.ts) for creating, opening, continuing, listing, and forking sessions. [Session File Format](session-format.md) defines the persisted JSONL contract, and [Message Types](message-types.md) defines transcript values. For exact methods and signatures, use the exported TypeScript declarations or [`session-manager.ts`](../src/core/session-manager.ts).

`cwd` selects the workspace used for project resource discovery, context files, session grouping, and built-in tool paths. Pass it explicitly when the target differs from `process.cwd()`.

`session.dispose()` aborts active work, invalidates extension contexts, disconnects from the agent, and removes event listeners. Call it when the session is no longer needed.

`AgentSessionRuntime` adds `newSession()`, `switchSession()`, `fork()`, and `importFromJsonl()`. Each operation replaces the active `AgentSession` and recreates services for the target working directory.

Runtime replacement and ordinary `runtime.dispose()` first settle active work and persist retained deferred output and completed usage receipts to the outgoing session. A storage error rejects before shutdown/invalidation so the existing session can retry; shutdown handlers see persisted totals. Signal hosts use `runtime.dispose({ fromSignal: true })` to dispatch cleanup before abort can write terminal progress. If a later abort or persistence drain rejects after cleanup, disposal awaits the existing `session_start` reactivation lifecycle before returning the original error. Resources are ready before an interactive host releases its shutdown latch. If reactivation fails, partially acquired resources are cleaned, an `AggregateError` retains the original cause, and readonly `runtime.shutdownPending` stays true; hosts must not resume prompts or scheduled work in that state. A second storage-only drain after shutdown handlers preserves additional pending records before invalidation. Same-file resume/import reloads the target after outgoing publication. Hosts managing raw sessions can `await session.abort()` then call `session.flushPendingPersistence()` before `session.dispose()`; the flush is synchronous, propagates storage errors, and does not notify outgoing subscribers. Raw `session.dispose()` remains best-effort cleanup, not a durability barrier.

If extension reactivation fails and `runtime.shutdownPending` remains true, interactive mode accepts only `/quit` or empty-editor Ctrl+D to retry disposal. Ordinary prompts, continuation, bash, extension commands/shortcuts and captured submissions remain blocked against closed resources. The restricted built-in recovery editor prevents another concurrent disposal retry. This also applies after signal-triggered cleanup; ordinary editor/queue/heartbeat behavior resumes only after successful resource reactivation.

When the initial replacement receipt drain fails before any shutdown/invalidation, runtime replacement rejects with exported `SessionReplacementPendingUsageError`; its `cause` is the original storage failure. Interactive `/new`, resume/import and extension replacement flows report that recoverable error without exiting or discarding the outgoing Session. Recover storage and retry the operation. Errors after teardown or during replacement construction keep their existing fatal handling; the recoverable class is not a general replacement-error wrapper.

After a runtime replacement, subscriptions belong to the old `AgentSession` and must be rebound. See the [session runtime example](../examples/sdk/13-session-runtime.ts).

## Prompting

`prompt()` handles extension commands and expands file-based prompt templates before ordinary user messages enter the agent. For an accepted agent run, it resolves after the run finishes, including automatic retries.

A prompt sent while the session is already streaming must specify whether it should steer the current run or follow it. Calling `prompt()` without that choice rejects rather than guessing.

Preflight hooks, authentication, compaction and image normalization can yield to another run. On resuming, `prompt()` queues or rejects against current run ownership before publishing its prompt/tool loadout. A rejected prompt does not settle another run. An active run's automatic compaction keeps ordinary steering/follow-up behavior; independent manual compaction or branch summarization rejects new prompts until completion.

A steering message enters after the current assistant turn and its tool calls. A follow-up enters after the current run finishes its pending work. `steer()` and `followUp()` expose those behaviors directly and return `"queued"` if the input was queued (including after an extension transformed it), or `"handled"` if an extension consumed it.

Canonical context edits remain authoritative on the next request. Ordinary projected assistant copies are not appended again as implicit prefills; an explicit direct-Agent prefill is retained even if earlier history contains the same text. Later tool-result requests use the finalized projection without reattaching the original partial.

`session.continue(prefill?)` accepts an optional assistant prefix. Automatic capture leaves its original session entry and ordered suffix selected on disk while omitting that contribution only from live/request context. A verified terminal echo atomically replaces the original contribution after message hooks run; a complete echoed abort can also be stored. A truncated abort or failed continuation restores the original prefix and replayable recovery entries before another request dispatches.

Trusted continuation preserves dynamic sections from the selected canonical history. An untrusted session preserves only custom sections accepted from allowed current-lifecycle prompt hooks on its selected path; historical raw sections remain excluded. A fresh prompt or path/runtime replacement clears that lifecycle authority. Continued responses do not inherit old tool-call deletion tombstones, and swipe selection chooses a terminal descendant even when preserved suffix timestamps predate the newly billed response.

A supplied prefix with any role other than `assistant` is rejected at the session entry boundary, before changing run state or publishing prompt/tool policy. This runtime check also applies to JavaScript callers; the TypeScript parameter type is not the validation boundary.

If restoration cannot be written, the run rejects and releases ownership, but retains the recovery state in memory. The next accepted prompt or continuation retries restoration first. An accepted tree navigation supersedes recovery on the abandoned branch. `message_end` listeners still run before persistence; a completed response rejected by a listener or storage failure retains its charge as a content-free error receipt rather than a published answer.

If both original terminal publication and its fallback content-free receipt append fail, the active Session retains that physical response receipt in memory. Required receipt drains cover prompts, continuations, compaction and runtime replacement/disposal. Storage recovery publishes it once before subsequent dispatch; an already committed response is not queued again. These pending receipts do not survive process exit. A prompt reports the internal `started` disposition only after it owns the run and all required pending receipts are durable; storage failure before that boundary rejects RPC acceptance and preserves queued interactive input.

Accepted custom messages with `deliverAs: "nextTurn"` remain Session-owned if required receipt admission rejects before Agent dispatch. Recovery retries deliver that batch in original order alongside the user message, before before-agent-start hook messages. Consumption happens after successful receipt admission and before the started callback; custom messages newly queued by that callback belong to the following prompt. An already dispatched batch is not queued again after a later run failure.

Candidate prompt sections and tool-loadout changes publish only after that same successful run-owned receipt admission. A receipt-rejected prompt does not replace accepted discovery authority, advance its selected leaf, or install its candidate tools/hidden declarations; later continuation retains the previously accepted policy.

`abort()` stops the active operation and waits for the session to become idle. `waitForIdle()` waits without aborting it.

Hosts replacing or disposing a Session directly can call `flushPendingPersistence()` after aborting/settling it to publish retained deferred bash/custom output and usage receipts without outgoing subscriber notifications. Runtime replacement and interactive shutdown use this drain before invalidation. Records are consumed after successful storage, even if later projection refresh fails, so retry does not append them twice. `flushPendingUsage()` remains the narrower usage-only operation.

`incomingMessagePrefix` is read from the supplied `SettingsManager` on each SDK context conversion. Historical and new string/array user text receive the current prefix without changing stored history, text metadata or images. The SDK uses the shared `prefixUserMessages` helper in its converter so direct summaries and token counts follow the same setting. Do not also set the Agent prefix to the same value; that would apply it twice. Cache warming replays the already converted original request, not a newly prefixed one.

## Subscribing to events

Subscribe before prompting when the host needs streamed output:

```typescript
const unsubscribe = session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

try {
  await session.prompt("Explain this repository");
} finally {
  unsubscribe();
}
```

Session events report message updates, tool execution, queues, compaction, retries, and run lifecycle changes.

Successful nonempty `deleteLastMessages()`, `deleteMessage()` and `applyMessageEdits()` emit `transcript_changed` after durable commit and their existing live-state refresh. Edit invalidation includes additions, replacements, new swipe versions and in-place swipe edits. No-op inputs and failed commits emit no invalidation. Subscribers can rebuild from `session.getSessionProjection()` for finalized content with durable provenance; this notification contract does not extend to other deletion, restoration or navigation APIs.

`message_end` contains the authoritative completed message. `agent_end` marks the end of one low-level agent run, but automatic recovery or queued work can still follow.

Use `agent_settled` when the host needs to know that Pi will not continue automatically.

Prompts submitted from an `agent_settled` handler are deferred until those handlers finish and return immediately, so awaiting the original call does not await the deferred run. The internal `PromptOptions.onDeferredError` observer receives later deferred-execution failures; the original failure still propagates through the enclosing settlement path. Accepted dispatch reporting remains separate and does not report rejections.

The internal `PromptOptions.onDeferred` hook receives a separate execution-completion promise synchronously when submission is deferred. It leaves the original `prompt()` call's immediate-return behavior unchanged. A settlement handler must not await that completion promise itself; internal delivery owners can observe it outside the handler to retain exclusion until execution finishes. Exceptions from the notification hook do not reject work that is already queued.

If an earlier deferred action fails, later actions are not executed; their completion handoffs reject with that same error and their internal error observers are notified, so delivery owners can release or restore pending input.

## Configuring a session

Without overrides, the factory creates a `ModelRuntime`, file-backed `SettingsManager`, persistent `SessionManager`, `DefaultResourceLoader`, and the configured default tools.

Each boundary can be supplied explicitly:

- `modelRuntime`, `model`, `thinkingLevel`, and `scopedModels` control model access and selection.
- `settingsManager` supplies merged settings or an in-memory configuration.
- `sessionManager` supplies persistent or in-memory conversation history.
- `resourceLoader` supplies extensions, skills, prompt templates, themes, and context files.
- `tools`, `noTools`, `excludeTools`, and `customTools` control the active tool set.

Use `DefaultResourceLoader` when you want standard discovery with selected overrides. Supply a custom `ResourceLoader` when the host owns resource storage and discovery completely.

A custom `ResourceLoader` must implement synchronous `reloadSystemPrompt(): void` and `reloadSkills(): void` alongside its asynchronous `reload()` method. Each granular reload must update its corresponding getters without reloading unrelated resource categories. Empty implementations are appropriate only when those resources are immutable, as in the full-control example; a mutable loader must refresh its cached prompt or skill data.

<a id="inlineextension"></a>

Inline extension factories can be supplied through `DefaultResourceLoader`. Give one an `InlineExtension` name only when it needs a stable name in diagnostics and startup output. A named inline extension with `replaceable: true` is left out when another extension registers a tool, command, or flag with a name it registers during loading, instead of both loading with a conflict. The CLI's built-in codemode, tool search, and MCP extensions are replaceable. A named entry with `builtin: true` is not an inline extension: it supplies the code of the `builtin:<name>` extension, which loads like a configured extension file. It loads by default, is listed in `pi config`, and is disabled by `-builtin:<name>` in the `extensions` setting or by `noExtensions`; `additionalExtensionPaths: ["builtin:<name>"]` loads it explicitly. It loads after project trust is resolved, so it cannot handle `project_trust`. The CLI's built-in extensions use it.

<a id="codemode-mcp"></a>

The CLI loads `codemode`, `tool_search`, and MCP as built-in extensions. SDK sessions do not; add `createCodemodeExtension()`, `createToolSearchExtension()`, and `createMcpExtension()` to the `extensionFactories` of `DefaultResourceLoader`. `codemode` and `tool_search` are registered inactive: enable them through the `defaultTools` setting (`["+codemode", "+tool_search"]` keeps the other default tools), or let the MCP extension activate them: `codemode` for servers with `codemode` exposure, `tool_search` for servers with `deferred` exposure. The MCP extension connects its servers on `session_start`, so call `session.bindExtensions()`. See [Codemode and MCP](../examples/sdk/14-codemode-mcp.ts).

See the focused examples for [models](../examples/sdk/02-custom-model.ts), [tools](../examples/sdk/05-tools.ts), [extensions](../examples/sdk/06-extensions.ts), and [full control](../examples/sdk/12-full-control.ts).

## Examples

| Example | Purpose |
|---|---|
| [Minimal](../examples/sdk/01-minimal.ts) | Create, prompt, observe, and dispose a session |
| [Custom model](../examples/sdk/02-custom-model.ts) | Select a model and thinking level |
| [System prompt](../examples/sdk/03-custom-prompt.ts) | Replace or append to the system prompt |
| [Skills](../examples/sdk/04-skills.ts) | Discover, filter, and add skills |
| [Tools](../examples/sdk/05-tools.ts) | Select built-in tools and their working directory |
| [Extensions](../examples/sdk/06-extensions.ts) | Load file-based and inline extensions |
| [Context files](../examples/sdk/07-context-files.ts) | Add or replace project instructions |
| [Prompt templates](../examples/sdk/08-prompt-templates.ts) | Add file-style prompt templates |
| [Credentials](../examples/sdk/09-api-keys-and-oauth.ts) | Configure credential and model storage |
| [Settings](../examples/sdk/10-settings.ts) | Supply file-backed or in-memory settings |
| [Sessions](../examples/sdk/11-sessions.ts) | Control session persistence and restoration |
| [Full control](../examples/sdk/12-full-control.ts) | Replace default discovery and state services |
| [Session runtime](../examples/sdk/13-session-runtime.ts) | Replace the active session safely |
| [Codemode and MCP](../examples/sdk/14-codemode-mcp.ts) | Add the `codemode`, `tool_search`, and MCP extensions |

<a id="exports"></a>

## Resources

- [Choose a Model](models.md) covers model selection and compatible endpoints; [Provider Authentication](providers.md) covers credentials and cloud-provider setup.
- [Configuration](configuration.md) explains normal discovery and settings; [Settings](settings.md) lists every setting.
- [Sessions and Context](sessions.md) explains session behavior; [Session Format](session-format.md) defines persisted entries; [Message Types](message-types.md) defines shared transcript values.
- [Extensions](extensions.md), [Skills](skills.md), and [Prompt Templates](prompt-templates.md) document resources supplied through a `ResourceLoader`.
- [CLI Integration](cli-integration.md) covers print, JSON, and RPC alternatives to an in-process SDK integration.
