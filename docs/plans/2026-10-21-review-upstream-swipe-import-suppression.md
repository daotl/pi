# Review: preserve the upstream swipe imports while unblocking verification

Date: 2026-10-21
Upstream baseline: `839dc79197595a4285d711e37d02fb623e5b6b7b`

## Problem

The baseline imports the unused `Message` type in `packages/coding-agent/src/core/swipe-list.ts:9`. The required `npm run check` stops on Biome's `lint/correctness/noUnusedImports` warning because the repository enables `--error-on-warnings`. This blocks normal commit hooks before dependency, TypeScript, and browser checks execute.

This warning is inherited from the reset upstream baseline, not a migrated `my-merge` behavioral defect. The first observed check scanned 1701 files, reported `No fixes applied`, and exited 1.

## Explicit user decision

The user selected adding an ignore comment rather than deleting the unused upstream import. Add one line-scoped `biome-ignore lint/correctness/noUnusedImports` immediately before that import, documenting why the upstream list is retained during selective repair migration. Do not disable the rule globally, change exports, or modify runtime swipe behavior.

## Verification

The baseline failure above is the observed pre-change evidence. This is a targeted static-check suppression with no executable behavior change; the existing swipe-list test suite could not collect because the checkout lacks ignored Azure catalog data. No passing runtime-test claim is made.

After the unrelated reset dependency/catalog prerequisites were restored (documented in the Smithy dependency review), `npm run check` passed with 1701 files and `No fixes applied`, including TypeScript and browser smoke, exit 0 in 16.90 seconds. The line-scoped warning is suppressed; no runtime behavior was changed. Code review: skipped (mechanical diff), because this unit only adds the explicitly requested static-check comment.
