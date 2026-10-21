# Review: preserve user edit trailing whitespace

Date: 2026-10-21
Migration base: `44d2d7d64`
Source: `447d3579` trailing special-block lookbehind separates tagEnd from text end (commit diff:186-199).

## Problem and RED

parseTrailingSpecialBlocks trims end even when there is no trailing special block, so ordinary user text loses its newline/spaces. Lossless formatting consequently refuses otherwise editable text. Two current trailing newline/tab cases fail (**2 failed / 10 skipped**) with formatting refusal.

## Adaptation

Use a temporary tagEnd to ignore whitespace only while finding a special closing tag. Keep original end for plain text. Existing trailing-block separation and user image/assistant tool formats remain unchanged; no global trim/escape or whitespace-only assistant policy change.

## Verification

Order/safety/actual AgentSession edit/swipe/lexical suites: **118 passed**. Both edit/swipe parser outputs retain exact trailing bytes; actual id0 edit stores the unchanged user content. New fixture uses a real system parent so user swipe formatting has a legitimate group anchor. Full integration will run after this bounded commit, not claimed here.

`npm run check` passed (1716 files; regression formatted). Post-format owning suites: **118 passed**.
