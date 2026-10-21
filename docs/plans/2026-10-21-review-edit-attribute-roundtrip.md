# Review: decode formatted edit/swipe attributes exactly once

Date: 2026-10-21
Migration base: `551975eab`
Final local source: `778e0120721a2978abedd9ce60f945427f5c9ee2`

## Problem and current proof

The formatter escapes XML attribute ampersands/quotes/angle brackets, but parseTag stores escaped bytes without decoding. Editing a signed reasoning message therefore corrupts its transport signature. Current-base edit/swipe regression observed two relevant failures: pi_edit stored escaped signature text, and pi_swipe subsequently caused actual Responses message conversion to throw JSON parsing error.

The same run included an unrelated blocks-between-text expectation that conflicts with current intentional tag-discussion behavior; it was excluded instead of changing that product contract. Literal less-than body cases and 18 existing swipe cases already passed. No scanner rewrite is migrated without a demonstrated current failure.

## Final repair

Decode only the four formatter-produced attribute entities in one replacement pass. Do not decode body text or repeatedly decode literal `&quot;` data; `&amp;quot;` becomes literal `&quot;` once, not a quote. Shared parseTag supplies both pi_edit and current pi_swipe paths.

Preserve current id0 version creation, timestamp-selected in-place swipe editing, metadata reconstruction, block-close/scanner semantics and persistence transactions. Broader signed-edit/order/refusal repairs remain separate candidates.

## Verification

- Edit attribute provider-replay regression, existing message-edit and swipe suites: **76 passed** across three files.
- New regressions format/apply through real faux-harness sessions, inspect stored content, then exercise actual Responses conversion with a structured reasoning item. Literal angle/body-entity controls remain unchanged.
- No provider/network request or credentials are used.
- The first post-format run exposed an inherited swipe control's millisecond timestamp collision (75 passed / 1 failed at currentIndex). Its two version creations now use explicitly separated Date-only fake times, leaving product behavior/expectations unchanged; the same three suites then passed **76 tests**. This fixture correction is not claimed as a new product repair.
- `npm run check` passed with 1709 files and formatted the new regression; final normal hooks rerun the full gate after the deterministic fixture update.
