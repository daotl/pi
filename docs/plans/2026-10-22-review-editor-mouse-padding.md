# Review: use rendered editor padding for mouse hit testing

Date: 2026-10-22
Migration parent: `d8c85b511`.
Source: `447d3579a3123052de1e4b4f54a46942836ceb48` editor mouse-padding repair, retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. Box/TruncatedText margins are already a separate landed unit.

## Problem and RED

Editor.render ignores configured horizontal padding when padLines is off, but both text and autocomplete mouse branches subtract it. A direct Editor with paddingX 2, padding disabled and click at x=3 inserts X at column 1 instead of 3. New paired padding-off/on insertion cases produce **1 failed / 5 passed** before source changes; padding-on is the existing-behavior control.

## Adaptation and verification

Compute effective padding once at handleMouse entry using the same padLines flag and narrow-width clamp as render; use it for text and autocomplete coordinates. No wrapping, paste, history, keyboard, grapheme layout or global policy change. Existing configurable keybinding logic remains untouched.

Narrow-padding/editor/mouse-components owner files: **211 passed**. Actual TuiAltScreen → VirtualTerminal SGR mouse press/release → keyboard smoke observes text `abcXdef` and viewport containing that text with unchanged borders. This is emulator input/render evidence, not a physical terminal claim. The text insertion regression directly exercises the coordinate bug; existing editor/autocomplete tests run, but no new autocomplete click scenario is claimed.

Temporary terminal smoke is removed after execution. No imported physical-row, tail-streaming, fullscreen or overlay architecture.

`npm run check` passed (1722 files; one test file formatted). Post-format owner files: **211 passed**. Normal commit hooks remain enabled.
