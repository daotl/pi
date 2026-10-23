# Review: glyph-aware physical rows and hardware caret

## Problem and final chain

Parent `55924df99`; fixed upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Candidate `0a9acad131b79844ce5afd677368090ef95684f7` repairs R7 #18 physical layout/caret drift. Later `243015b85e9159c785bdfa09053bb9eac12aab74` and `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45` retain final row-boundary/cursor and independently rendered constituent rules. LF normalization and truthful unpatched emulator are already committed; their code is not repeated here.

Current main-screen lineRows used total visible width divided by columns. At odd widths, a two-cell glyph cannot occupy the final one-cell remainder and wraps early; sum-width arithmetic therefore undercounts rows. Hardware caret separately used logical-prefix width, losing physical wraps/newlines and counting hidden control payload LF. Renderer bookkeeping could rewrite Header onto CJK content or place the IME cursor in the wrong column/row.

## Final implementation

- Reuse the final shared glyph advancement walker for physical rows/cursor. Existing graphemeWidth retains width-only return semantics for all prior callers; optional position advancement handles wide glyphs, emoji/partial flags, separately rendered Indic/spacing constituents and zero-width clusters. ASCII/ANSI fast path remains allocation-light.
- `terminalLineRows` skips recognized control sequences, treats normalized LF/CRLF and standalone CR as terminal movement, materializes pending wrap only when a visible glyph requires it, and can locate the complete ANSI cursor marker using the same placement decisions. Final frozen helper source was compared exactly before formatting; no older partial algorithm is replayed.
- Main-screen row layout uses shared occupancy and derives clear rows from its existing layout instead of measuring again. Its own cursor extractor carries wrappedRow; hardware positioning consumes that physical offset rather than dividing a logical width.
- Preserve incremental identical-prefix layout reuse, image reservation behavior, render-state shape, width APIs and logical text. No safe-tail helper, terminalLinePhysicalRows slicing, overlay separation/reservation, editor/fullscreen wrapping or new renderer state belongs to this unit.

## Behavioral proof

Final consumer cases were added before production: **4 failed / 5 passed**, wall **0.66s**. CJK caret before an early-wrapping glyph was `{x:77,y:3}` rather than `{x:0,y:3}`; embedded-LF/control-payload case was `{x:5,y:0}` rather than `{x:2,y:2}`; odd-width header repaint retained old Header and overwrote a CJK row; pending-wrap content gave stale cursor bookkeeping. Indic, existing ASCII and plain LF controls already passed and are not product RED evidence.

After repair, five owning width/row/scrollback files passed **43**, wall **15.98s**. New assertions check exact emulator viewport and hardware cursor through initial render and updates, including CJK before/after last glyph, Indic constituent wrapping, hidden payload LF, exact-width zero-width controls and CR/LF movement. They do not exercise tall streaming-tail resume or overlays.

Full TUI package run `rtk proxy npm test --workspace packages/tui`: **1071 passed / 0 failed / 1 existing skipped**, wall **18.83s**, `artifact://3924`. No existing assertions, skips, timeouts or emulator compensation changed. Initial full check formatted one owned file; final no-fix/post-format evidence is appended after results.

Actual-source TuiMainScreen/unpatched VirtualTerminal smoke observed `{actualRenderer:true, columns:79, rows:6, cjkPhysicalRows:3, cursor:{x:0,y:3}, footerPreserved:true}`, exit 0, **0.19s**. Both initial and changed Header preserve the three CJK rows/Footer and physical caret. stop/flush cleanup ran in finally; temporary executable removed. This is emulator output, not physical device/all-terminal-mode proof.

## Scope and limits

LSP references inspected private graphemeWidth consumers (10, width-only calls) and public TuiMainScreen consumers (183 including startup, interactive capture/restore and tests). The shared helper remains an internal module export, not a new package-root API. Current renderer callers supply terminal columns and complete cursor-marker starts, not arbitrary offsets inside escape payloads. No new invalid-width or malformed-control contract is asserted. Graph initialization remains unavailable with WeakMap error; exact source and references are the evidence, not exhaustive dynamic/external coverage.

Bounded source/proof reviewers inspect algorithm, integration and tests read-only without tests/build/check/formatting. Outcomes and final committed-tree aggregate follow actual results. No dependency/lock/generated/changelog change, branch/worktree/push or unrelated renderer rewrite. Protected 749 daemon target files remain excluded and checked against recovery-time manifest. Overall terminal chain and 44-candidate migration remain active.

Independent proof review found no introduced occupancy/caret defect, but identified a remaining physical-height consumer in existing stop cleanup. Actual stop followed by shell output failed **1 / 8 passed**, wall **0.60s**: Footer was overwritten by the shell prompt because cleanup moved by logical row count. The final backup's one-line `previousLayout?.totalRows ?? previousLines.length` target fixes this same occupancy boundary. A test now checks all transcript rows, existing blank separator and later shell output; its first post-fix expectation omitted the established blank separator and stop's trailing space, corrected with trimEnd and an explicit blank row rather than changing product exit policy. Final wrapped file passed **9**, wall **0.61s**. This is exercised exit-buffer proof, not the earlier source-only inference.

Pre-exit-extension final focused set passed **71 / 6 files**, wall **17.03s**; no-fixes check passed **1765**, wall **14.27s**. After the one-line exit repair, full TUI/check and independent confirmations are collected again. No new occupancy state or safe-tail/overlay code is introduced.

Both independent source/proof reviews returned no remaining concrete finding after checking the exit-height fix. Source review confirmed final helper equivalence and unchanged width-only returns; proof review confirmed exact viewport/caret and shell-buffer oracles, with no graphical-image or physical-device guarantee. Post-exit full TUI passed **1071 / 0 / 1 existing skipped**, wall **18.54s**, `artifact://3939`; post-format six-file owning run passed **71**, wall **16.85s**, and full check **1765 / No fixes applied**, wall **13.36s**.

The exit regression's finally block initially called stop again after its asserted stop. TuiBase.stop is not idempotent, so a local stopped flag now prevents duplicate cleanup while retaining failure-path cleanup. The final owning wrapped file passed **9**, wall **0.62s**; product source and assertions are unchanged by that lifecycle-only correction. Final full check follows before normal commit.

Final full check after single-stop correction: **1765 / No fixes applied**, all stages passed, wall **13.76s**. Proof reviewer confirmed failure-path cleanup and unchanged seven-row shell oracle read-only. Protected recovery manifest again matched all 749 files. Final normal commit owns only utils, main-screen renderer, wrapped-line regression, README and this review.

## Fixed committed-source/test aggregate

Normal explicit five-path commit `722b897e3` includes the final glyph/caret/exit-height source, single-stop regression cleanup, guide and this review. Full hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed committed source/test tree: **8587 passed / 0 failed / 936 skipped**, exit 0, **115.64s**, full output `artifact://3951`. No new skips/exclusions, timeouts, assertion relaxation or emulator compensation. Only this review receipt is amended afterward; tested source/test blobs remain unchanged. Safe tails, scoped wrapping/overlays and the full 44-candidate migration remain incomplete.
