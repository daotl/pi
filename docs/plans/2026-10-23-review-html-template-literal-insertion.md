# Review: literal resource insertion in HTML exports

## Problem and source chain

Parent `f29301853`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #10 `e13924536243de16b20af0b0eb8d117056f22ec8` contains the completed callback-replacement repair. This unit migrates only that final behavior, not the candidate's unrelated context-estimator or continuation changes.

`generateHtml` inserts CSS, application JavaScript and vendored scripts using string replacements. Vendored `highlight.min.js:917` contains the original two-character `$&` in its R grammar, not the literal HTML entity `$&amp;`. A string replacement expands it to the matched `{{HIGHLIGHT_JS}}` placeholder; the same payload's Swift grammar contains `$$`, which becomes one dollar sign. These are shipped resource bytes, not hypothetical user-provided payloads.

## Final adaptation

All nine template/CSS substitutions return their existing insertion values from replacement callbacks. Resource loading, theme selection, base64 session serialization, usage totals, public APIs and output paths remain unchanged. No new helper, escaping convention, dependency, vendor change or compatibility shim.

The existing export whitespace test file gains two actual file-backed export cases, one for each public entrypoint (`exportSessionToHtml` and `exportFromFile`). They compare the exported highlight script with the actual shipped vendor bytes. The removed VM assertion was redundant and never reached in RED; browser execution supplies separate rendering evidence. Existing unrelated CSS/XSS tests are outside this unit, not silently rewritten.

## Verification chronology

- Before source edits, the two new export cases failed and three existing cases passed: **2 failed / 3 passed**, **1.17s**, full output `artifact://4032`. Both public entrypoints changed R grammar `$&` to `{{HIGHLIGHT_JS}}` and Swift grammar `$$` to `$`.
- After callbacks, export whitespace, charge-identity export and theme-export owners: **12 passed / 3 files**, **3.07s**.
- First full `npm run check`: **1765 files, Fixed 1**, all stages passed, **14.28s**. It formatted only the owned test imports/layout; this is not a no-fixes result.
- Post-format same three owning files: **12 passed**, **3.14s**.
- Final full check: **1765 files, No fixes applied**, all stages passed, **17.45s**.
- Actual Node source-resolver smoke invoked the real file-backed exporter: `{"actualSourceExport":true,"highlightBytesPreserved":true}`, **0.36s**. The generated file was opened in managed headless Chromium. Actual DOM showed R `$` as `hljs-operator`, Swift `$0` as `hljs-variable`, and exact code text `left $ right` / `let value = $0`; page errors were empty. A screenshot was captured, but no pixel-perfect or all-language visual claim. The first selector assumed language-specific classes removed by the page; inspecting actual markup corrected the selector, not production.
- Both browser tabs were closed. The owned smoke executable and output directory were removed. No external network, provider credentials or paid APIs were used.

## Scope and review limits

Pre-work status returned only protected `?? packages/env/`; neither owned source/test path was dirty. Subsequent path-scoped status showed only this session's new test edit before production changes. All 749 protected files matched the recovery-time SHA256 snapshot; the original pre-migration manifest is unavailable and is not reconstructed by this check.

No branch/worktree/push/PR, lockfile/generated changes or changelog on `crystal`. This repair does not implement P03/P12/P13, scheduler, TUI or the remaining merge-family audit. U02 remains explicitly incomplete and is not a dependency of this independent repair. A root aggregate is run only after the normal path-limited implementation commit; its actual fixed source/test SHA and result will be appended, never inferred from focused tests.

LiteralExportSourceReview and LiteralExportProofReview completed independent bounded source-only review with no actionable findings. Source review checked all nine callback substitutions, placeholder order, public entrypoints, encoding and accounting; proof review checked both actual exported-output cases and false-pass boundaries. Neither reran tests/checks/browser. Code review: skipped (ce-code-review unavailable). The host exposes skill-content reads but no skill invocation/command primitive; a failed attempt to execute a `skill://` helper URI is not a skill invocation. The two native reviews are supplemental evidence, not a portable CE receipt or authorized relabeling of the portable workflow. No cross-model or exhaustive coverage is claimed; no unresolved reviewer jobs or actionable findings remain.

## Fixed committed-source/test aggregate

Normal path-limited implementation commit `ec1ff2948` contains exactly the exporter, its test and this review. Normal hook and immediate precommit check passed **1765 files / No fixes applied**. Root `rtk proxy ./test.sh` on this committed source/test tree passed **8589 / 0 failed / 936 skipped**, exit 0, **108.17s**, full output `artifact://4062`. No next-unit source/test changes occurred during execution. The following path-limited amendment changes only this review receipt; the tested source/test blobs remain unchanged. Recovery-time protection manifest matched all **749 files / zero mismatches** before the run. This closes P04, not the complete 44-candidate migration.
