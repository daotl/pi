# Review: declare the AI package's direct Smithy type dependency

Date: 2026-10-21
Upstream baseline: `839dc79197595a4285d711e37d02fb623e5b6b7b`
Reference: `my-merge` at `cb3bee033ba853041609b874303dc625d5d30479`

## Problem

`packages/ai/src/api/bedrock-converse-stream.ts:26` imports `BuildMiddleware`, `DeserializeMiddleware`, `DocumentType`, `HttpResponse`, and `MetadataBearer` directly from `@smithy/types`. The AI package did not declare that dependency. The current checkout resolves version `4.18.0` only through the installed transitive dependency tree; this does not declare the package's own build/type dependency.

The current-baseline probe observed the direct import, a missing manifest declaration, and a resolvable transitive `4.18.0`; it exited with status 1. No provider request was made. This is a packaging declaration defect, not evidence of a Bedrock runtime failure or a vulnerability.

## Source and final repair

- `548504c8cab9c1fddc0781e7c3ec077a203b88cd` adds the missing exact dependency.
- `6e484348ab86298b669c2c5cfceea56d12d369b9` synchronizes root lock metadata; its unrelated Aube build allowlist is not migrated.
- `720b569f1ac0405a547376316d890c1de9c1c0ed` contains related consumer-lock metadata and an unrelated equivalent template-literal edit; the lint-only source edit is not migrated.

Declare `@smithy/types` at the already-installed exact version `4.18.0`. Refresh the current root lock and regenerate the coding-agent installation lock through their existing commands. Do not copy old lockfile contents or change provider implementations.

## Scope and compatibility

The change adds one dependency declaration in each of the AI manifest, root workspace lock entry, generated AI consumer-lock entry, and existing coding-agent shrinkwrap. Root lock comparison found only `packages/ai` changed; no registry package version or lifecycle-script package was added or upgraded. The generated install manifest remains unchanged. Upstream's experimental Agent harness, current provider IDs, and swipe/restore/shred behavior are untouched.

## Verification

- Baseline declaration probe: direct import present, declaration missing, transitive `4.18.0` present; expected exit 1.
- `npm install --package-lock-only --ignore-scripts`: completed successfully; emitted the existing `autoevals` npm/pnpm engine warning. No lifecycle scripts executed.
- `node scripts/generate-coding-agent-install-lock.mjs`: completed; generated closure contains 154 packages, including 26 platform-specific packages.
- Final dependency probe: manifest, root lock, installed package, and generated consumer lock all resolve to `4.18.0`; exit 0. An earlier consumer-lock probe incorrectly expected a `name` field that npm's lock entries omit; that probe was corrected without changing the implementation.
- `npm run check:pinned-deps`, `npm run check:runtime-deps`, and install-lock generation with `--check`: all passed.
- Initial `npm run check`: blocked at the existing unused `Message` type import in `packages/coding-agent/src/core/swipe-list.ts:9`; Biome checked 1701 files and reported `No fixes applied`. The import is preserved; the user's separately selected line-scoped suppression is documented and committed as a distinct prerequisite.
- A focused existing swipe-list suite could not collect because the reset checkout lacks ignored `packages/ai/src/providers/data/azure-openai-responses.json`. No tests ran; this is an environment prerequisite, not a failing behavior assertion or a dependency-fix regression.
- Canonical dependency changes remain the four dependency metadata files plus this review document; pre-existing `packages/env/daemon/target` artifacts are excluded.
- The existing shrinkwrap check required regeneration too: `node scripts/generate-coding-agent-shrinkwrap.mjs` completed with 153 packages, including 26 platform-specific packages; only the AI dependency declaration changed.
- The installed Anthropic SDK was `0.129.0` while this baseline pins `0.124.0`. `npm install --ignore-scripts` restored the current dependency versions without running lifecycle scripts.
- `npm run hydrate:model-data` restored missing ignored catalog files, but live catalogs no longer match several frozen-source test model names and one provider API union. Version-matched published `@earendil-works/pi-ai@0.99.2` catalog data was then restored only to ignored data paths; its provider set and the relevant model/API identities match current source. This is compatible published data, not proof of an exact Git source snapshot; no generated TypeScript or provider code was changed.
- Final `npm run check`: passed with 1701 files, `No fixes applied`, pinned/runtime/import/entry-graph/shrinkwrap/install-lock checks, TypeScript, and browser smoke; exit 0 in 16.90 seconds. This verifies the current code with the disclosed compatible published model data, not with an attested exact-commit catalog snapshot.
- Code review: skipped (mechanical diff), because this unit only declares an already-installed exact dependency and regenerates its metadata; no executable provider code changed.
