# Review: reselect the two-hour HTTP idle timeout

## Problem and source decision

D05, candidate #15 `447d3579a3123052de1e4b4f54a46942836ceb48` final HTTP timeout behavior. Current runtime default was already DEFAULT_HTTP_IDLE_TIMEOUT_MS = 7_200_000. The selector choices stopped at five minutes, so the default rendered as 7200 sec and could not be selected again after choosing a different value. settings.md incorrectly documented 300000; selector description also assumed five minutes. This is a UX/documentation correction, not a runtime-timeout defect or dependency update.

Add 2 hr choice using the existing default constant before disabled. Existing formatter, settings values and callback lookup share that table; no separate parsing convention. Correct documented default and describe pauses relative to the selected timeout. Dispatcher configuration, default value, disabled semantics and arbitrary numeric parsing remain unchanged.

## Actual proof

Existing settings-selector owner creates real SettingsSelectorComponent/SettingsList, filters via actual search input, renders the default as 2 hr, uses Enter to choose disabled then 30 sec, and cycles back through the existing choices to the same 7_200_000 value with 2 hr visible. This is component keyboard/render proof, not a forwarding-only assertion or full initialized settings persistence test.

Valid RED **1 failed / 4 controls passed, 2.79s**: actual rendered default was 7200 sec rather than 2 hr. Initial unfiltered partial config render threw on unrelated undefined setting values; fixed by using real search and excluded from product RED. Final post-format focused **10 passed / 2 files, 2.97s**: settings-selector and existing http-dispatcher local proxy/transport controls. Full check **1770 files / No fixes applied, 28.51s**; preceding check formatted one owned test. No paid API; dispatcher controls use local HTTP sockets.

LSP references found five uses of exported HTTP_IDLE_TIMEOUT_CHOICES: declaration, formatter, selector import, selector values and callback lookup. No signature change/caller migration. Graph initialization remains unavailable (WeakMap failure); no project-generation/coverage claim. No changelog on crystal.

## Reviews and delivery

Code review: skipped (ce-code-review unavailable). Both supplemental native source/proof reviews report no actionable findings; neither executed tests or independently verified timings. These are not CE/cross-model receipts. No actual two-hour wall-clock wait, external network, physical terminal or saved-settings reopen claim.

Owned: HTTP dispatcher choice table, settings selector description, existing selector test owner, settings guide and this review (five paths). Normal explicit-path commit precedes fixed committed-tree aggregate; review-only amendment records actual tested SHA separately. Remaining candidate verification/documentation reconciliation stays open.

## Fixed committed-tree aggregate

Normal implementation commit `eeb9a67a9` includes all five owned paths; hook **1770 files / No fixes applied, 39.59s**. Isolated root `./test.sh` on that fixed source/test/guide tree: **8745 passed / 0 failed / 936 skipped, 264.37s**, `artifact://5197`. No product path changed during aggregate. Subsequent review-only amendment records this receipt; tested SHA remains `eeb9a67a9`, not the amended SHA. Recovery-only protection: **749 / 0 mismatches**; original manifest unavailable. D05 is closed only for selector/docs parity, not elapsed network-timeout validation.

