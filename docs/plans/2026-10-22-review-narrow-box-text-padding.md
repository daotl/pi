# Review: clamp narrow component margins and align Box mouse routing

Date: 2026-10-22
Migration parent: `2cda87bd2`.
Source: authored merge `e3f076aa28c4d7c1373a3e68a35cbfd07a199bff`, exact Box/TruncatedText hunks in authored-merge-resolutions.diff, retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. Preserve current Box childLines convention; do not import the provenance-only flattenLines/WeakRef optimization or physical-row renderer changes.

## Problem and RED

Configured Box/TruncatedText margins exceed a one-column viewport; content moves beyond the visible cell and truncated output exceeds width. Box mouse routing always subtracts configured padding even when rendering disables or clamps it. Four new regressions fail before source changes: Box renders two spaces before x at width 1; TruncatedText emits 9 columns for width 1; padding-off click inserts at column 1 rather than 3; one-column padded click is discarded (**4 failed**).

## Adaptation

Use the final clamped effective horizontal margin for Box render and mouse coordinate mapping, and for TruncatedText width/margin output. Keep childLines carrying left padding in current Box, cache policy keys and background/separator handling. No change to Editor's own margin calculation, physical occupancy, wrapping policy, fullscreen or overlays. Editor direct mouse-padding repair is separately pending.

## Verification

Narrow regression plus existing pad-lines/truncated-text/mouse-components owners: **48 passed**. Mouse tests route through Box into a real Editor with zero internal padding, then type a character to verify actual insertion position. They intentionally isolate Box rather than claiming coverage of Editor's independent margin bug.

Temporary actual TuiMainScreen smoke renders a Box/Text into a 1-column VirtualTerminal: observed viewport `["x", "", "", ""]`. This is emulator surface evidence, not a physical terminal/device claim; existing emulator LF patch remains unchanged and is outside this ASCII single-line path. Public README describes clamping and matching mouse coordinates. No allocation/flattening optimization is selected.

`npm run check` passed (1722 files; one new test formatted). Post-format four owner files: **48 passed**. Temporary terminal smoke script is removed after execution; normal commit hooks remain enabled.
