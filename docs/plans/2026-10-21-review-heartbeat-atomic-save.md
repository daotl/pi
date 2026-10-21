# Review: save an accepted heartbeat snapshot without corrupting the previous file

Date: 2026-10-21
Migration base: `643fe9994`
Final local source: `6f9400463750fda6160b9b3b73d20ade24e7b7bb`, using the already migrated `2093b87` load generation

## Problem and current proof

Save serializes mutable heartbeats after awaiting mkdir and writes directly over HEARTBEAT.md. Concurrent cancellation/edit can change an accepted save's bytes/count; partial write failure destroys previously saved instructions. There is no separate close/rename boundary to preserve the old file.

Current-source owning suite: **4 failed / 64 passed**. The accepted snapshot became a newline after concurrent removal, a partial write replaced the old file with `partial`, and close/rename fault scenarios overwrote the previous file. The baseline partial-write probe used its then-current fs.promises.writeFile seam; the permanent regression removes that obsolete seam and injects the actual new FileHandle write failure.

## Final repair

Capture serialized bytes, count, destination and lifecycle owner before yielding. Write an exclusively created unique sibling temp, preserve existing target permissions, close before atomic rename, and clean up only the temp successfully opened by this invocation. Failed exclusive open does not own a path and cannot remove another writer's data. Suppress stale success/error status after clear/replacement; an accepted save still completes with its captured data.

Keep the existing heartbeat file format, load behavior and scheduling semantics. No fsync/crash-durability guarantee is added; this is write/close/rename failure atomicity.

## Verification

- Initial repaired heartbeat and real lifecycle suites: **72 passed**.
- Permanent partial-write test uses the actual FileHandle seam; close/rename failures preserve previous bytes and remove owned temporary files. Existing normal save/load roundtrips remain.
- Permission-preserving successful overwrite is checked on non-Windows platforms. Existing unrelated sibling file is preserved on partial failure.
- Final owning suites after removing the obsolete baseline seam and adding the permission control: **73 passed**. `npm run check` passed with 1708 files and formatted two changed files; post-format suites again passed **73 tests**. Normal hooks provide final no-fixes verification.
