# Review: bounded editor-owned wrapping and indivisible graphemes

## Source and defect

P15 editor subunit from candidate #23 `243015b85e9159c785bdfa09053bb9eac12aab74`, preserved by final #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45`. Fullscreen renderer-local scope is a separate pending P15 subunit; physical overlay painting remains P16. No whole-file backup replacement.

Editor display and visual navigation previously followed transcript-global wrapping. A long unwrapped draft could start above the viewport and Home/typing would target invisible cells. Minimum-five content rows also exceeded short terminals. wordWrapLine recursively attempted to split an indivisible wide glyph at the same one-column width, overflowing the stack.

## Change

Editor layout and visual-line navigation always use their own word-wrap geometry. Viewport/page step use the same existing 30%-height preference bounded by terminalRows-2, with one content row minimum. The two-row border minimum cannot fit a terminal shorter than three rows; no impossible full-fit claim is made.

Only recognized merged paste-marker segments recurse into their constituent graphemes; indivisible real glyphs remain intact. When the final glyph exceeds layout width it uses the reserved cursor column and an empty trailing visual row owns its end cursor. Mixed A+wide+B chunks/UTF-16 offsets have explicit assertions. Stored semantic text, paste registry, undo/submission and atomic marker editing are unchanged. No global transcript wrap policy changes.

## Evidence

Current-source targeted RED: **3 failed / 2 controls passed, 0.36s**. Real glyph recursion produced RangeError; four-row terminal returned seven editor rows; actual Home input in a tall draft left START outside the hardware-cursor viewport. Existing wrap-on and two-column resize were passing controls, not additional defects. The obsolete test requiring transcript-wrap-off to keep one unbounded editor layout line was removed rather than repinned.

Final post-format owners **234 passed / 3 files, 1.68s** (`editor`, `wrapped-line-render`, `tui-render`). Includes actual TuiMainScreen+unmodified xterm resize/input: Home exposes START, Down maps to column79, resize+typing remains visible with exact stored text, two-column wide glyph stays visible and typing yields exact cursor/text. Four-row render/PageUp exact position, indivisible glyph chunks/offsets and existing paste/undo/autocomplete/navigation cases pass. Full final check **1766 / No fixes applied, 17.42s**. Earlier check passed while formatting one owned test file (**14.40s**); focused final proof followed it.

The transient mis-indentation of the final-chunk addition was corrected before final checks. Placement matches the frozen final source; it is conditional on the final chunk exceeding width, not every mixed-text input. No keybinding changes, physical terminal, full coding-agent interactive Enter, autocomplete-height full-fit, fullscreen scope or physical-overlay proof is claimed. No ad-hoc scripts created.

## Independent review and delivery

Code review: skipped (ce-code-review unavailable). Bounded native source/proof reviews supplement this, not portable CE or cross-model receipts; results recorded upon delivery.

Owned editor source, existing editor test, TUI README and this review only. Normal explicit-path implementation commit precedes fixed committed source/test/guide aggregate; review-only amendment records exact tested SHA separately from final SHA. No dependency/catalog/changelog/branch/worktree/push changes. P15 remains open until fullscreen subunit completes; full migration remains open.

EditorWrapSourceReview and EditorWrapProofReview completed bounded read-only review with **no actionable findings**. They confirmed indivisible/marker split handling, conditional empty-end row, shared display/navigation geometry, matching viewport/page bounds and meaningful actual input/text/cursor oracles. Neither executed checks. Their original review noted immediate post-resize cursor visibility was not independently asserted; that assertion and a direct render(30) wrap-off semantic-text contract were subsequently added. Strengthened final owners passed **235 / 3 files, 1.56s**; check **1766 / No fixes applied, 15.11s**. Production source/guide unchanged. Recovery-only protection hashes matched **749 / zero mismatches**. Fullscreen/overlay/full-application and impossible sub-three-row full-fit remain explicitly unproved.

## Fixed committed-source/test/guide aggregate

Strengthened committed tree `aa97c983f` includes exactly editor source, editor test, TUI README and this review; normal amend hook passed **1766 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed source/test/guide tree passed **8644 passed / 0 failed / 936 skipped**, exit 0, **140.01s**, full output `artifact://4627`. No fullscreen/next-unit source/test/guide edits occurred during execution. The following review-only amendment preserves product blobs and records aggregate against `aa97c983f`, not the future final SHA. This closes only the editor P15 subunit; fullscreen wrap scope remains pending.