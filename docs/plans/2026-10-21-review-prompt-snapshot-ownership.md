# Review: isolate saved prompt metadata

Date: 2026-10-21
Migration base: `b5599b1c3`
Source chain: `ff0f22eb` copies snapshot collections/sections; `243015b85` completes nested skill sourceInfo copies at append, saved read and extension normalization boundaries.

## Problem and proof

appendSystemPrompt stores caller-owned skills and sections; getSavedSystemPrompt returns the same objects. Mutating a construction input or saved read therefore silently changes historical prompt metadata without a new snapshot. Normalization copies skills shallowly, allowing mutable extension options to change the original sourceInfo.

Three independent current-source regressions failed: input mutation changes stored skill path/sections; saved-read section mutation changes history; normalization mutation changes original skill metadata. After the fix all three pass.

## Scope

Copy each skill and its scalar-field sourceInfo on append/read/normalization. Copy section records on append/read. No public type or schema change, new contextFiles field, trust policy, renderer behavior, append transaction, selection algorithm or reload change. Low-level getEntries/getBranch still expose current entry objects; this is not a general immutable SessionManager API.

Only a new focused test file is added. Canonical skills-restore and system-prompt-restore files have no diff against b5599b1c3; their existing reload tests remain intact. The worker packet's unrelated test deletions are not integrated.

## Verification

Focused ownership tests plus existing skills/system prompt restore suites: **13 passed** across three files. These exercise real SessionManager snapshot and prompt normalization operations; existing suites exercise AgentSession resume/reload. No provider call or disk failure durability is claimed.

`npm run check` passed (1712 files; two files formatted). Post-format owning suites passed **13 tests** again.
