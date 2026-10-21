# Review: retain symlink target identity during atomic rewrite

Date: 2026-10-21
Related migration: atomic rewrite `b401d5f3c`; independent StoragePublicationAudit found this integration regression.

## Problem and RED

The old truncating open followed a session symlink. Renaming a sibling temp over the session path instead replaces the link, splitting subsequent history from the original target. Focused real-filesystem regression failed: the session alias became a regular file (**1 failed / 16 skipped**).

## Adaptation

Resolve an existing destination with realpathSync before selecting its sibling temp and performing atomic rename. Keep the public sessionFile alias path unchanged; later appends still follow that alias to the updated target. Existing non-file destination handling, mode preservation and owned best-effort cleanup remain. Concurrent symlink retargeting, dangling links and hard-link alias preservation are not covered by this repair.

## Verification

The real-filesystem regression requires the alias remain a symlink, the original target expose the deletion, and a subsequent alias append be visible through target reopen. No mocked rename is used in this regression.

Owning rewrite/file-operation/soft-delete suites passed **62 tests**. Combined post-format storage and summary audit-correction run: **160 passed / 2 skipped** across eight files. `npm run check` passed (1712 files; final run No fixes applied).
