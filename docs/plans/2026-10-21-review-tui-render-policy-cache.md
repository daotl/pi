# Review: refresh component caches when padding or wrapping changes

Date: 2026-10-21
Migration base: `89dc71890`
Final local source: `6f1cfc1f5511b7ce600843d31eb72661587f9a80`

## Problem

Text and Markdown cache rendered lines by text and width only, although output also depends on mutable padding/wrapping settings. Existing component instances therefore keep stale layout when a setting changes at the same terminal width. Box separately caches its decoration lines without the padding policy; unchanged child output can leave its top/bottom padding stale.

Current-source regression: **6 failed / 18 passed**. Text/Markdown kept unpadded or unwrapped output after toggles; Box inherited stale child wrapping, and its independent unchanged-child case retained empty decoration rows instead of full-width spaces. Existing layout controls passed.

## Final repair

Include effective padding/wrapping policy in Text/Markdown rendered-output cache keys and writes, including empty output. Include padding policy in Box's own cache key. Preserve parsed Markdown token caching, current left-padded Box child storage, themes, images, widths and global policy semantics.

No narrow-margin, mouse, editor viewport, renderer, physical-row or overlay changes belong to this unit. The isolated worker's broader margin proposal is not copied wholesale.

## Verification

- Owning `node --test test/pad-lines.test.ts`: **24 passed** after repair.
- Same component instances toggle settings in both directions without explicit invalidation. Assertions observe rendered rows/cells, including an unchanged-background child to isolate Box's own cache.
- These component-render exercises do not claim terminal-emulator/physical-screen verification; this unit changes cache selection only.
- `npm run check`: passed with 1706 files and formatted three changed files; the owning suite was rerun afterward and again passed **24 tests**. Normal hooks provide the final no-fixes gate.
