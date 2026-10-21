# Review: reject heartbeat presets outside interactive mode

Date: 2026-10-21
Migration base: `902d8c75a`
Source repair: `513e503a4ecf728e39a12333f94c66e7749ca4ed`

## Problem

`--heartbeat` is consumed only by `InteractiveMode`, but the CLI accepts it for print, JSON, RPC, and redirected/non-terminal invocations. Those invocations silently ignore the requested scheduler or fail later for unrelated provider authentication. This falsely suggests a recurring action was configured.

The current-base real CLI regression produced **4 failed / 2 passed**: print reached a missing-credential error, and JSON/RPC/redirected invocations exited successfully without installing a scheduler. Plain help and model-list metadata controls passed.

## Final repair

After resolving the application mode, reject nonempty heartbeat presets when the mode is not interactive, before session/provider/resource setup. Preserve plain metadata commands and existing version/export behavior. Mark the argument documentation and help as interactive-only. Do not add a headless scheduler or change heartbeat timing, persistence, or trust handling in this unit.

## Verification

- Real CLI subprocess regression and existing argument suite: **93 passed** across two files.
- Subprocesses use an invocation-owned HOME/agent directory, allowlisted environment, offline mode, no cloud catalogs, and no credentials. The tests execute the actual source CLI through the existing source resolver; no provider request is required.
- The six subprocess outcomes cover four unsupported modes plus help/model-list controls. This is executable CLI smoke evidence, not a mock of mode dispatch.
- `npm run check`: passed with 1702 files; Biome formatted the new test file. The same owning two-file suite was rerun afterward and again passed **93 tests**. Normal commit hooks provide the final no-fixes check.
