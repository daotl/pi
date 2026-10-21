# Review: preserve committed JSONL when a rewrite fails

Date: 2026-10-21
Migration base: `e229e7697`
Final local source: `6f1cfc1f5511b7ce600843d31eb72661587f9a80`, retained by later staged-transaction repairs

## Problem and current proof

_rewriteFile opens the selected session file with w before serializing entries. A write/close failure can truncate or partially publish the only committed conversation. There is no atomic replacement boundary for deletion/edit operations.

Current-source real-file regression: **5 failed / 1 passed**. Write failure left only the first JSONL record; close failure changed committed bytes despite throwing. Fsync/rename/exclusive-temp cases failed because those boundaries did not exist in the old implementation; they establish post-repair fault/ownership controls, not additional independently triggered old-path failures. The positive complete-rewrite/mode case passed.

## Final repair

Create a unique sibling temp with exclusive wx, preserve existing permissions, serialize the complete current file entries, fsync, close and rename over the destination. Publish no partial destination bytes. Cleanup closes/unlinks only invocation-owned resources; a failed exclusive open owns nothing and cannot delete another writer's temporary file.

Adapt only the existing file rewrite boundary. No new session schema, selection/leaf marker, swipe/soft-delete algorithm or upstream architecture replacement. Directory fsync/power-loss durability is not claimed.

Descriptor close and owned-temp unlink during error cleanup are best-effort. If either cleanup operation itself fails, an owned resource/temp may remain; the tests do not establish cleanup success under those secondary failures. Existing permission preservation is a positive control, not a failing-before defect.

## Important remaining dependent work

This disk-atomic unit does not yet stage live state. Existing callers can still mutate in-memory entries before failed rewrite. The regression intentionally checks committed bytes and reopened context only. The next selected transaction-publication repair must address live-state rollback, including current supersededBy/deletedAt/deletedToolCalls fields; this document does not claim that work complete.

## Verification

Atomic rewrite, existing soft-delete/file operations and swipe suites: **69 passed** across four files. Faults exercise the actual public softDeleteUnits path, and reopen validates the last committed conversation and deletion visibility. Foreign-temp collision, mode preservation and successful complete rewrite controls pass. No provider/network request is used.

`npm run check` passed with 1711 files and formatted two changed files. Post-format owning suites again passed **69 tests**; normal hooks provide the final no-fixes gate.
