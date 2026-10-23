# Review: explicit terminal LF normalization and truthful emulator

## Problem and final source

Parent `526f78347`; fixed upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Candidate `0a9acad131b79844ce5afd677368090ef95684f7`, R7 residual #19, fixes output that relied on PTY newline translation. Current normalizer expanded tabs but emitted raw visible LF. Test VirtualTerminal monkey-patched xterm's private lineFeed handler to reset columns, hiding actual output drift.

The larger terminal chain is separately accounted: shared grapheme occupancy/cursor -> safe streaming tails -> renderer-local wrapping/physical overlays -> relative origin -> bottom overlay row reservation. This prerequisite unit does not port those later behaviors or claim bottom overlay completion. Existing margins/render-policy cache/mouse repairs remain intact.

## Implementation

`normalizeTerminalOutput` now converts visible LF to CRLF except an LF already preceded by CR, preserving existing CRLF and standalone CR. Existing visible tabs remain three spaces and Thai/Lao AM decomposition remains unchanged. The existing ANSI parser skips recognized control sequences as complete spans; tabs/newlines inside OSC/APC payloads remain byte-identical. Copy spans avoid rebuilding unaffected bytes. Plain text with no tab/LF retains the fast path.

Remove only obsolete VirtualTerminal.patchMaterializeWrap and its constructor call. The fixture uses default xterm newline semantics, not a private emulator override. TuiBase's existing output-normalization call remains the single product boundary; logical component/editor text, renderer layout and control-string policy are unchanged. README describes explicit visible-newline behavior and payload preservation.

## Behavioral proof

New owning regressions initially **2 failed / 4 passed**, wall **0.18s**. The normalizer left `abc\n123456` unchanged, and an unmodified xterm emulator rendered the second row as `   123456` instead of `123456`. This is actual surface drift, not source-text or implementation-count evidence.

After repair, controls preserve existing CRLF/standalone CR and tabs/newlines inside BEL/ST-terminated OSC/APC strings. A raw xterm instance renders exact first/second rows and cursor coordinates. Five owning files (tab width, wrapped rendering/scrollback, truncation/Thai-Lao and renderer behavior) passed **61**, wall **16.36s** before final formatting closure. Full TUI package execution `rtk proxy npm test --workspace packages/tui`: **1064 passed / 0 failed / 1 existing skipped**, wall **17.94s**, full output `artifact://3894`. No fixture writes, assertions, skips or timeouts were changed to compensate for patch removal.

Actual-source TuiMainScreen + now-unpatched VirtualTerminal smoke observed `{actualRenderer:true, unpatchedEmulator:true, viewport:["abc","changed","",""], embeddedLfStartsColumnZero:true}`, exit 0, **0.16s**. Both initial and differential embedded-LF frames were checked. Renderer stop/flush cleanup ran in finally; executable temporary script removed. This is emulator surface evidence, not physical terminal/device or all-terminal-mode proof.

Initial full check formatted two owned files. Final post-format focused/no-fixes and independent reviews are attached after actual outcomes. LSP inspected normalizeTerminalOutput references (10 including declaration, TuiBase and tests); exact current/final source used because graph initialization fails with WeakMap error. No project/generation/exhaustive graph coverage claim.

## Scope and limitations

Only normalizer, obsolete emulator patch, two behavioral regressions, README and independent review. No dependency/lock/generated/changelog change, branch/worktree/push, physical occupancy/tail/fullscreen/editor/overlay alteration or broad code replacement. Recognized control sequences retain their existing parser boundary; arbitrary malformed/unrecognized terminal sequences do not gain a new interpretation. Protected 749 daemon target files remain excluded and checked against the available recovery-time manifest, not an unavailable original manifest.

The required root aggregate runs on the normal explicit-path implementation commit, then only this review receipt is amended. Overall 44-candidate migration remains active.

Final post-format owning run: **61 passed / 5 files**, wall **16.92s**. Final full check: **1765 / No fixes applied**, all stages passed, wall **13.24s**. Source reviewer reported no material introduced defect. Fidelity reviewer found one guide overclaim: global pre-existing Thai/Lao normalization can change payload characters, so the README now promises only preservation of tab/newline bytes inside recognized controls, not every payload byte. No product code/test change was needed. Both reviews were read-only; no physical terminal or exhaustive parser guarantee is claimed. Protected recovery manifest matched 749/749.

## Fixed committed-source/test aggregate

Normal explicit five-path commit `95145f991` included the implementation, truthful fixture, behavioral regressions, guide and this review; full hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on the fixed committed source/test tree: **8580 passed / 0 failed / 936 skipped**, exit 0, **132.28s**, full output `artifact://3910`. No new skips/exclusions, timeout/assertion changes or emulator compensation. Only this review receipt is amended afterward; tested source/test blobs remain unchanged. Remaining occupancy/tail/overlay chain and overall 44-candidate migration are not complete.
