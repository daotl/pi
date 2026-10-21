# Review: honor explicit removal of generated prompt sections

Date: 2026-10-22
Migration parent: `fbe31b82d`.
Source chain: `ff0f22eb780decb94a196a2700cc6ba44446116e` adds generated-section deletion; `deede133ff5bc52ba82ea52f01ea27acd712a430` establishes empty override precedence for the later restored overlay. Final backup `cb3bee033ba853041609b874303dc625d5d30479` retains the generator behavior. This unit selects the generator contract only; restored overlay/trust rendering remains pending S4.

## Problem and RED

A before_agent_start handler can set a generated section to an empty string, but the generator ignores empty customSections values, so the old generated instructions remain in the actual provider request. A public faux-backed AgentSession regression sends an initial prompt, then explicitly empties docs and rules before a second prompt. Before the fix it fails because the second request still contains docs (**1 failed / 8 filtered**).

## Adaptation

When an explicitly supplied section value is empty, delete the corresponding generated section. Omitting a key still generates its usual value. Preserve section-name validation, forced-prompt behavior, tool declarations, preamble and other sections. LSP references identified the generator, state wrapper, AgentSession patch/snapshot consumers and existing test callers before editing. No new API/type or imported backup architecture.

## Verification

Four owning prompt/update/tool-contribution/restore files: **40 passed**, including a post-format rerun. The new regression captures actual provider contexts, checks initial sections present and subsequent docs/rules absent, retains preamble/tools/cwd/tool declarations, and confirms the stored transcript carries null section deltas. The original RED stops at docs absence; rules, unchanged-section and transcript checks are post-fix controls.

`npm run check` passed (1719 files; one test file formatted); types, dependency/lock checks and browser smoke passed. Extension documentation now states empty versus omitted section semantics. No physical TUI or live-provider claim. Existing incidental prompt-wording tests are unchanged by this bounded behavior unit.
