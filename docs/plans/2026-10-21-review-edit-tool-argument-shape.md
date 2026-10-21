# Review: reject nonobject edited tool arguments before publication

Date: 2026-10-21
Migration base: `0ad977905`
Source: `243015b85` parseToolCallArguments object validation (commit diff:1550-1561,1590); adapted to both current forward/trailing parsers and current pi_swipe support.

## Problem and RED

JSON.parse is cast to JsonObject without checking runtime shape. Arrays/null/scalars can become tool arguments and publish alongside earlier valid edits. Five current mixed-edit cases failed because no exception was thrown (**5 failed / 54 skipped**). First trailing-parser path failed before forward-parser assertions; forward/swipe cases are post-fix controls.

## Adaptation

Shared helper parses unknown, rejects non-null non-array nonobjects, and returns undefined on malformed JSON. Both current parser paths use ?? {} to retain their existing malformed-JSON fallback. Do not import the backup ordered parser/close-search architecture in this narrow unit; those remain independent parser candidates. Existing id0 version creation and timestamp-based swipe edits stay intact.

## Verification

Initial three owning suites passed **81 tests**. Added swipe shape controls then passed the five-case focused matrix with one worker (**5 passed / 54 skipped**), checking unchanged full history/live messages after each rejected mixed edit and swipe. A previous three-suite run returned an inconsistent shell-backend timeout with only RUN output; it is not passing evidence and was reported. Existing valid-object tool edit is a positive control; no provider execution or cryptographic validation claimed.

Final matrix also exercises malformed `{bad` in both parser paths, preserving empty-object fallback; nonobject cases reject with Error and preserve all history/messages, without pinning error wording. Final three owning suites with one worker: **83 passed** before and after formatting. `npm run check` passed (1713 files; final test formatting applied).
