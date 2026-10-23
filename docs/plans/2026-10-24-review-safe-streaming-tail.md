# Review: safe visible-tail resume for tall streaming paragraphs

## Source chain and defect

P14 final chain: #13 `aecd44347d2ada4e38b44f0fd8006bd881ae0872`, #23 `243015b85e9159c785bdfa09053bb9eac12aab74`, #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45`. Frozen final `planLineTailRewrite` adds complete-grapheme physical-row resume, styling preservation and exact OSC 133 A/B/C allowance; it does not import the backup's unrelated cursor/overlay architecture. Existing LF normalization, physical occupancy, hardware caret and stop changes remain untouched.

Current main-screen renderer fully redrew whenever a changed logical line started above the viewport. A tall streaming paragraph can have unchanged offscreen rows and only a changed visible tail; full redraw emitted scrollback clear and replayed history. This resets the user's terminal scroll position during streaming.

## Change and safety invariants

The local planner compares identical UTF-16 prefix and both physical-row boundary sequences using existing terminalLineRows. Physical boundaries must start a complete unchanged grapheme in both old and new lines; whitespace candidates reject combining/variation/joiner extensions and ambiguous pending-wrap positions. It scans the identical prefix, preserving SGR and OSC 8 state, skipping only exact OSC 133 A/B/C markers with BEL or ST terminators. Any other effectful escape keeps full-redraw fallback. Image lines never use tail resume.

The renderer resumes only at a safe point within the previous visible viewport. It moves by physical rows, preserves cells before the resume column, clears only the remaining visible tail rows and emits restored styles plus the new suffix. Changes that cannot be proven safe still redraw. No editor/fullscreen/global wrapping, overlay painter or independent cursor architecture cutover is included.

## Runtime evidence and fixture correction

Initial targeted current-source run: **5 failed / 1 passed, 0.83s**. Four B/C-framed tall text families and the exact-marker allowance failed at unexpected scrollback clearing. Styled combining/variation/pending-wrap clean-render controls already passed via full redraw, not additional reproduced defects.

First product run was **50 / 51**: the ASCII fixture began with a whitespace at exact row fill, where the final frozen planner deliberately refuses resume because the changed tail can alter pending-wrap behavior. That zero-clear expectation was overbroad. The ASCII fixture now adds a non-pending prefix; separate pending-wrap/control-tail cases retain clean-render correctness oracles without demanding zero clears. Production was not relaxed. The initial ASCII failure is not credited as an independently valid final zero-clear case; Han/Kana/combining and exact-marker RED are valid. Initial-render clear counters are reset before update assertions. Per-file global padding/wrapping preferences are restored in finally.

Pre-review TUI owners: **51 passed / 3 files, 19.71s**, actual TuiMainScreen writes into unmodified xterm VirtualTerminal. B/C-framed ASCII/Han/odd-width Kana/combining streams preserve full scroll-buffer equality against a fresh render at every increment and do not clear/replay history or prompt markers. BEL/ST A/B/C allowed, D/A;extra/title/cursor-effect escapes retain full redraw. Styled OSC8/SGR, combining removal, variation-selector widening and pending-wrap controls match clean-render text buffers. Existing Kitty, caret, embedded-LF, layout shifts, shrink and bounded-output tests passed unchanged. Pre-review check **1766 / No fixes applied, 12.05s**. An earlier formatting/lint run fixed one source file but failed restricted test variable naming; LSP renamed that variable before successful verification. Final repaired-tree proof is recorded below.

A drafted coding-agent AssistantMessageComponent integration test was removed without execution to keep this unit in the TUI package; the original file is byte-identical and has no diff. It supplies no evidence. The B/C fixture is exact rendered framing, not a claim of full coding-agent interactive Enter or physical terminal execution. Text-buffer proof is not exhaustive cell-attribute/OSC8 click behavior; no all-terminal, overlay, fullscreen or malformed-escape completeness guarantee is made. No ad-hoc scripts were created.

## Independent review and delivery

Code review: skipped (ce-code-review unavailable). Bounded native source/proof reviews are supplemental, not portable CE or cross-model coverage; results recorded upon delivery.

Owned main-screen source, existing scrollback test, TUI README and this review only. No user file, package dependency, generated model, changelog, branch/worktree/push changes. Normal explicit-path commit precedes committed source/test/guide root aggregate; review-only amendment then records exact tested SHA separately from final SHA. Full 44-candidate migration remains open.

### Native review findings and repairs

SafeTailProofReview found no defects in the original bounded proof, with text-buffer/style/UI limits retained. SafeTailSourceReview found two unsafe preserved-prefix cases inherited from the frozen planner: ANSI styling between a whitespace resume point and a combining mark bypassed the raw extension check; bare CR in a tail could have overwritten prefix cells which partial clearing preserved. Minimal actual run **2 failed / 0 passed, 0.32s**: CR produced **XBCDE** instead of clean-render **Xord **. ANSI-separated combining matched xterm's text buffer but failed the explicit conservative-redraw oracle (0 versus 1); this is not evidence of observed combining character corruption.

The first review repair skipped intervening ANSI sequences before testing old/new leading grapheme extensions and rejected bare CR in either logical line; CRLF retained normalization. That intermediate tree passed **53 / 3 files, 19.84s**, check **1766 / No fixes applied, 12.23s**. It was superseded by the complete-line escape validation and final 54-case proof below. Proof-review addendum found no actionable issues in those two fixtures/guards and correctly distinguished the oracles; it executed nothing.

A subsequent bounded source reread found a changed CSI parameter split inside the common prefix could bypass the prefix-only effect check. Actual minimal RED **1 failed, 0.25s** showed **worAX** versus fresh **wordX**. Final planner validates both complete old/new lines first, allowing only numeric SGR, OSC8 and exact OSC133 A/B/C escapes; unrecognized/effectful escapes and C0 controls other than tab/LF/CRLF reject resume. This also handles bare CR before candidate construction. Final post-format owners passed **54 / 3 files, 20.80s**; no-fix check **1766 / No fixes applied, 12.98s**. The preceding check fixed one source file (**12.66s**), followed by this post-format proof. Source final rereview confirmed all three safety fixes and no further bounded findings; no checks/execution by the reviewer. No exhaustive malformed-escape/cell-attribute/overlay/fullscreen guarantee is made.

SafeTailProofReview's final bounded addendum found no actionable issues in all three safety fixtures/guards and confirmed the observed-corruption versus conservative-fallback distinction. It executed nothing and its timing snapshot predates the completed post-format 54-pass result above. Recovery-only protection check matched **749 / zero mismatches** before these owned source/test repairs; no protected paths were touched.

## Fixed committed-source/test/guide aggregate

Normal explicit-path implementation commit `2714d3d83` includes exactly main-screen source, scrollback test, TUI README and this review; hook passed **1766 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed source/test/guide tree passed **8640 passed / 0 failed / 936 skipped**, exit 0, **110.17s**, full output `artifact://4592`. No next-unit source/test/guide changes occurred during execution. The following review-only amendment preserves product blobs and records this aggregate against `2714d3d83`, not the future final SHA. P14 closes after canonical receipt synchronization; P15/P16 and full migration remain open.
