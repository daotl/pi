# Review: restage explicitly staged ignored review documents

Date: 2026-10-21
Baseline: `839dc79197595a4285d711e37d02fb623e5b6b7b`

## Problem and observed failure

The user requires each migrated fix and its independent `docs/plans` review document in the same commit. That directory is ignored. Explicit `git add -f -- <review-path>` stages the document, but `.husky/pre-commit` then runs normal checks and executes `git add "$file"` for each previously staged path. Git rejects the ignored review path and the hook aborts the commit.

The attempted swipe-import-suppression commit reproduced this: all checks passed, Biome reported `No fixes applied`, and the hook then failed with `The following paths are ignored ... docs/plans`. No commit was created.

The old local repair `6f1cfc1f5511b7ce600843d31eb72661587f9a80` handled this class of failure with a special case for the old review ledger. That exact-filename exception is unsuitable for the user's new per-fix documents.

## Final repair

Restage the same already-captured staged-file list with `git add -f -- "$file"`. The forced operation is limited to each explicit path the user/commit already staged; it does not discover or add other ignored files. Preserve all normal checks and hooks, and do not add a directory-wide exception to `.gitignore`.

## Verification

The failed real commit above is pre-change evidence. The repaired hook is exercised by committing this hook change and this review document together through the normal commit path. Subsequent per-fix commits use the same path-limited flow.

Code review: skipped (mechanical diff), because the single command preserves existing staged-path selection and only allows re-staging ignored paths already explicitly selected.
