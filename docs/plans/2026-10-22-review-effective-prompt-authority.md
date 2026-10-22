# Effective prompt rendering and resource authority review

## Scope and final sources

Parent `f4ab58508`; frozen upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`, backup `cb3bee033ba853041609b874303dc625d5d30479`. Only 44 authored candidates supply migration behavior; 178 original upstream commits remain provenance-only.

Final chain: authored merge effective overlay; `e1f9cdc22ecbc3b690625b44ea3aa934592eef79` effective rendering, `ff0f22eb780decb94a196a2700cc6ba44446116e` raw/opaque context, `deede133ff5bc52ba82ea52f01ea27acd712a430` explicit section removal, `93d7e6dc2a8036b344083338df0df7cc3179f526` canonical current-resource authority/discovery, `6f1cfc1f5511b7ce600843d31eb72661587f9a80` sanitize-before-hooks, and final backup continuation/full-reload corrections through `65007d6c75cb16d08fbe47934e923bc53abaea1b`. Not whole-file replay.

This unit joins renderer and trust authority because shipping only the trusted overlay would widen historical project-policy exposure. Selected-branch resource restoration, UI inventories/completions and remaining S4/S6/S7/S8/S9 behaviors remain pending. Current swipe/soft deletion, harness exports, hidden tool declarations and chat-template counting are preserved.

## Implementation

Saved sections overlay a generated baseline. Tools, rules, skill-reader guidance and runtime cwd refresh; unchanged static sections retain saved values/order. Explicit empty sections delete saved sections. Replacing a restored preamble keeps it first. Getter, chained hooks and provider patches share the effective renderer; exact forced prompts retain precedence.

Snapshots copy raw context records. Older rendered context stays opaque; no parsing into invented file paths. Full reload updates context without replacing saved preamble/addendum/skills. Canonical durable history, not a live-only replacement, determines request section deltas. Removed the obsolete live prompt setter and override field.

Untrusted resumes use current non-project loader Skill objects; canonical saved paths are ordering hints only. Sanitization precedes extension transforms and direct summaries. Safe snapshots finalize after discovery binding or an accepted request and compare complete persisted shape to avoid redundant records. Failed explicit updates restore new renderer/trust fields too.

Authority distinction follows the fixed backup: explicit user customPrompt remains authoritative; AGENTS context loads regardless of project trust, so structured saved context survives until full reload. Opaque legacy text without sections uses current loader context. Tests distinguish both. This is not a new rule that trust revocation discards all historical AGENTS files.

Standalone continuation persists accepted policy before prefill capture. Capture resolves the actual assistant source and retains the complete suffix; replacement/restoration preserve that suffix. Moving the patch after capture would not follow the final source contract. Branch summaries now establish their baseline before transforms and do not re-inject stale agent.state.systemPrompt afterward. Provider-facing TranscriptContext is normalized once, including standalone callers.

## Runtime evidence

- Same real loader and owned changed SYSTEM/APPEND/AGENTS files: initial hook/provider parity **3 failed**, bg_816; implementation **39 passed / 6 files**, bg_817.
- Preamble clear order: bg_818 **1 failed / 9 passed**, corrected preamble-first overlay. Full reload stale context bg_822 and key-order bg_823 were corrected without moving existing section keys.
- First continuation fixture used a completed assistant and correctly hit the existing stop gate (bg_820); corrected pending-user fixture reproduced OLD instead of NEW policy (bg_821). Persist-before-capture fixed it.
- Actual SDK relocation/trust-revoked reopen **2 failed**, bg_831. Removed live-only initialization that masked durable deltas and added trust baseline/sanitization; both passed in bg_833 (**34 / 2 files**, 2.95s).
- Automatic prefill aborted/completed policy recovery plus existing durable failure/publication, continuation and rollback suites: **58 passed / 5 files**, bg_834, 4.78s.
- Direct summary fixture first had an unconfigured faux runtime (bg_835); switched to actual custom stream. Explicit user override was then incorrectly labeled hostile (bg_836); corrected fixture distinguishes user override. Branch-only stale policy reinjection reproduced in bg_838; fixed baseline-before-transform pipeline.
- Summary/branch/skills/restore **32 passed / 4 files**, bg_839; standalone explicit policy plus authority/metadata/builders **75 passed / 7 files**, bg_840, 4.82s.
- Current broad matrix **216 passed / 16 files**, bg_844, 22.68s: renderer, skills, summaries, rollback, extensions, durable prefill, preflight, mixed edits and swipe. This is not proof of pending selected-branch resource reconciliation.
- Native Node SDK smoke observed getter/provider equality for trusted saved static policy and untrusted current policy. Both results safePolicy=true, bg_846, 0.68s; temporary script removed.
- Final foreground npm run check: **1749 files, No fixes applied**, all dependency/type/browser-smoke gates passed, 25.46s. bg_845/847 shell-backend timeouts are not passing evidence. Earlier checks reported real formatting and dead-import/type diagnostics, subsequently fixed.
- Protected daemon target manifest: **749 paths, zero SHA256 mismatches**.

## Review and limits

SavedRendererAudit found canonical/live drift and widened untrusted request exposure; actual SDK REDs above drove fixes. Its bounded continuation rereview confirmed persist-before-capture with exact suffix/storage source evidence, no tests run. Final integrated reviews and fixed-tree aggregate follow their actual completion. Graph generation/coverage remains unavailable due to WeakMap initialization failure; exact source fallback only. Whole migration remains open.

## Integrated review repairs

Both integrated reviewers found a leading partial system delta could suppress the complete branch baseline. Summary review also found an extra tools-only head displaced transformed policy on native providers. Corrected fixtures reproduced **3 failed / 6 passed**, bg_850 (bg_849 first exposed missing explicit fixture streams). Restored preceding policy using retained source-entry provenance and optional old-branch contextProjection; navigation supplies that projection before mutating selection. Standalone explicit policy stays single. Tools attach to the transformed baseline, not a separate normalized head.

An executable-tool fallback caused actual DataCloneError in SDK extension context cloning, bg_851 (**1 failed / 18 passed**). Converted fallback tools with toToolDeclaration. Added cloned branch entries with unrelated live policy to ensure the explicit old-branch projection wins. Result **40 passed / 4 files**, bg_852, 5.53s. Foreground check then passed **1749 files, Fixed 3 files**, 29.37s; formatting is not reported as no-fix.

IntegratedPromptAuthorityAudit confirmed saved overlays, rollback, structured/legacy AGENTS handling, canonical skills/discovery and continuation match the frozen intended behavior, with the branch baseline finding above. IntegratedSummaryPolicyAudit rereview cleared the baseline, duplicate systemPrompt, extra tool head and executable clone findings. Both source-only; selected-branch restoration and UI remain explicitly outside these verdicts.

Final post-review focused matrix: **221 passed / 16 files**, bg_853, 57.19s. Final full npm run check: **1749 files, No fixes applied**, every gate including browser smoke passed, 11.83s. bg_854 was another shell-backend deadline mismatch and is not passing evidence. Protected manifest rechecked: **749 paths, zero mismatches**. No selected-branch/UI completion claim; fixed committed-tree aggregate will be recorded after this unit's normal commit.

Explicit contextProjection mismatch guard: regression first dispatched despite missing retained entry (**1 failed / 10 passed**, bg_856). Generation now returns a structured error before dispatch when the supplied projection lacks the retained source ID. Branch/summary/restore/skills **41 passed / 4 files**, bg_857, 3.80s. This does not implement selected-branch resource reconciliation; this remains an S4 predecessor unit, not S4 completion.

After the mismatch guard, npm run check passed **1749 files, Fixed 2 files**, bg_858, 11.50s; all gates including browser smoke passed. Source/test tree is now fixed for the normal unit commit and following isolated aggregate.

Normal commit **7cfa737e9** ran the full required check in its hook: **1749 files, No fixes applied**, all gates passed (bg_859, 11.69s). Post-format branch/summary/restore/skills confirmation **41 passed / 4 files**, bg_860, 3.71s. Fixed-tree root aggregate is running on this source/test commit; only this review will change before the next unit.

## Fixed-tree aggregate

Root isolated test.sh on source/test commit **7cfa737e9**: **8381 passed / 0 failed / 936 skipped**, exit 0, **86.30s**, bg_861, artifact://3274. No source/test edits occurred during the run. Additional foreground check confirmed **1749 files, No fixes applied**, 14.92s. The following amendment changes only this review; source/test tree remains the one exercised above.
