# Review: exception-safe fullscreen-local wrapping

## Source and defect

P15 fullscreen subunit from final candidate #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45`. Editor-owned wrapping already landed independently in `9fca17409`; regular physical overlays remain pending P16. Frozen final scope wraps both public fullscreen document rendering and the complete frame, including layout measurement, overlay rendering and the second search-driven layout pass.

Fullscreen disables native autowrap and clips painted lines to viewport width. Built-in Text/Markdown previously followed the regular transcript wrapping preference (off by default), so one long logical line was measured as one row and clipped to its first ten columns; scrolling could not reach the remaining content.

## Change

Add synchronous `withWrappedLines` in utils with a saved previous render override restored in finally. Effective wrapping combines user padding/wrap preferences with this temporary override; preference getters/setters remain unchanged. TuiAltScreen.render wraps direct/final-document rendering. doRender wraps a private renderScreen containing the entire existing frame pipeline, not just component paint after measurement. Nested document/frame scopes preserve their outer override. No async scope, persistent global preference mutation, editor change, regular overlay implementation or new package-root re-export is added.

## Actual consumer proof

Targeted current-source RED **8 failed / 0 passed, 0.40s**: Text/Markdown implicit and explicit fullscreen layouts showed only the first clipped row instead of the final two wrapped rows; their overlays clipped too. Exception fixtures failed at the required wrapped result inside the throwing render, not at an observed post-exception preference leak.

Existing fullscreen owner now exercises Text/Markdown × implicit/explicit layout, exact follow-end viewport, scroll-to-top/by-two, shared component regular-mode cache isolation, unchanged preference getters, and complete final main-screen scroll-buffer text after stop. Overlay cases assert all wrapped rows and unchanged direct rendering outside fullscreen. Document and full-frame failures preserve the original thrown Error, render wrapped content before throwing, and restore subsequent unwrapped Text rendering. All new fixtures restore user preferences and stop with preserveScreen on failure.

Before the nested helper test was added, post-format focused owners passed **110 / 3 files, 5.20s** (`tui-alt-screen`, `layout`, `pad-lines`), using the actual renderer into unmodified xterm. That tree's check passed **1766 / No fixes applied, 15.61s**. Earlier formatting check fixed one owned test file (**33.77s**). These are intermediate results; final 111-case verification is recorded below. Existing mouse/search/selection/scrollbar/Kitty and preference-cache controls passed. No physical terminal, full coding-agent interactive Enter, arbitrary async renderer, regular-overlay or complete cell-style proof is claimed. No ad-hoc scripts created.

## Independent review and delivery

Code review: skipped (ce-code-review unavailable). Bounded native source/proof reviews supplement this, not portable CE or cross-model receipts; actual results recorded after delivery.

Owned utils/alt-screen source, existing fullscreen and pad-lines tests, TUI README and this review only. Normal explicit-path commit precedes committed source/test/guide aggregate; review-only amendment records tested and final SHA separately with unchanged product blobs. No dependency/model/changelog/branch/worktree/push changes. This completes P15 only after its receipt and editor subunit are reconciled; P16 and full migration remain open.

Nested helper coverage was added in the existing pad-lines owner: inner render throws the exact Error, outer effective wrapping stays true before/after the caught error with actual Text output still wrapped, and outer exit restores unwrapped output and false effective policy. Final owners **111 / 3 files, 5.22s**; full check **1766 / No fixes applied, 19.65s**. The nested test's first format check fixed one owned test file (**23.86s**), followed by post-format runs; earlier 110-case evidence is not the final proof tree.

FullscreenWrapSourceReview and FullscreenWrapProofReview completed bounded read-only review with **no actionable findings**, including nested restoration, complete frame measurement/search/overlay coverage, final document and policy-aware cache isolation. Proof-review follow-up confirmed both explicit effective-policy assertions. Neither executed checks. Fullscreen exception fixtures compare Error properties, not identity; the nested helper asserts identity, and source directly propagates it. No independent runtime, async renderer, physical terminal or P16 regular-overlay proof is claimed.

## Fixed committed-source/test/guide aggregate

Normal explicit-path implementation commit `cc3b6707b` includes exactly six owned paths; hook passed **1766 / No fixes applied**. Root `rtk proxy ./test.sh` on that fixed source/test/guide tree passed **8653 passed / 0 failed / 936 skipped**, exit 0, **125.08s**, full output `artifact://4658`. No next-unit source/test/guide edits occurred during execution. The following review-only amendment preserves product blobs and records aggregate against `cc3b6707b`, not the future final SHA. With the editor receipt this closes P15; P16 and full migration remain open.
