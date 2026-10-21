# Review: refuse lossy edit formats without partial selection

Date: 2026-10-21
Migration base: `df452532c`
Source chain: `aecd4434` recognized format-tag scanner; `d8ffbdfa` round-trip refusal/whole-selection/copy fallback; `6f1cfc1f` signed text/raw/namespace fidelity; `243015b85` exception-safe probe. Adapt scanner and comparison to upstream pi_swipe; keep current id0/swipe semantics.

## Problem and RED

Formatter emits XML that can reinterpret literal format tags, drop whitespace or provider replay fields. Current edit UI would publish safe subsets if a formatter starts returning null; multi-copy would omit refused matches. Initial safety file **11 failed**: refusal/selection/copy assertions plus an overly broad literal-less-than positive fixture. Positive fixture narrowed to representable literal angle text; existing lexical unbalanced-less-than controls then exposed scanner dependence (two failures), and recognized scanner preserves them.

## Adaptation

Compare parsed content/replay keys before returning edit/swipe XML; normalize adjacent unsigned text only, retain signed text/reasoning/tool metadata and whitespace. Catch parser rejection from ordinary prose and refuse safely. Recognize only this format's tags (including pi_swipe), leaving ordinary '<' literal. Refuse entire selected edit/swipe set before changing editor draft; multi-copy falls back to inner plain content. No ordered parser rewrite, content escaping, mixed mutation transaction or crypto authentication.

The pre-existing literal user swipe fixture lacked a parent anchor and previously slipped through malformed tag parsing. Added a system parent; user content expectation remains unchanged. No production swipe root semantics change.

## Verification

Safety, actual AgentSession edit/swipe and lexical suites: **106 passed**. Command-method controls assert unsent draft unchanged for mixed safe/unsafe substring and swipe selections; copy keeps refused match content. Positive signed reasoning/literal text round trip and existing Responses replay stay intact. This is real method/state proof with prototype UI seam, not a full physical TUI visual test. Current full integration before this unit was7968passed0failed999skipped; no claim this new unit has passed full suite yet.

`npm run check` passed (1715 files; two changed files formatted). Post-format owning suites: **106 passed**.
