# Review: deterministic calendar and pre-abort dispatch oracles

## Bounded source and changes

V04 candidate #12 `0a9acad131b79844ce5afd677368090ef95684f7`, exact deterministic calendar test behavior; V02 candidate #41 `6f9400463750fda6160b9b3b73d20ade24e7b7bb`, exact already-aborted tokenizer zero-fetch assertion. These are existing behavior-proof repairs, not new production behavior.

Only the three date-less parser cases use a fixed local midday Date with seconds. Each registers onTestFinished cleanup returning void before its assertions; only Date is faked. Duration, absolute future-century/leap validation and sibling timer tests keep their existing clocks. This avoids sampling separately near midnight and misclassifying the test's next-minute input. No production parser change or new calendar semantics.

The existing pre-aborted tokenizer row now uses a typed vi.fn fetch spy and not.toHaveBeenCalled. Its previous throwing callback alone could be swallowed by countTokens' aborted-signal catch, so return undefined did not prove zero dispatch. The explicit invocation observation detects a removed abort guard. Existing cancellation-during-authorization and retry controls remain unchanged; no new forwarding/mock-copy test.

## Actual verification

No product RED claimed: production guard/parser already exist. Final localized calendar owner **32 passed / 1 file, 2.27s** from coding-agent; tokenizer owner **26 passed / 1 file, 0.41s** from ai. Full check **1770 files / No fixes applied, 11.99s**. Cleanup callbacks now use explicit void blocks and were formatted before final tests. Both test owners and relevant real implementations were read. No network or physical UI exercise.

Code review: skipped (ce-code-review unavailable). Both native source/proof follow-ups report no actionable findings in the final localized Date/typed-spy patch; neither executed tests or independently verified timings. Reviews are supplemental, not CE/cross-model receipts. No mutation-testing run, original midnight failure reproduction, exhaustive timezone/DST guarantees, HTTP request or physical-terminal claim.

Owned: two existing test owners and this review. Normal explicit-path commit precedes fixed root aggregate; review-only amendment records exact tested SHA. No changelog on crystal; no production code changed.

## Fixed committed-tree aggregate

Normal implementation commit `164e91cd3` includes all three owned paths; hook **1770 files / No fixes applied, 13.30s**. Isolated root `./test.sh` on that fixed test/review tree: **8766 passed / 0 failed / 915 skipped, 99.29s**, `artifact://5302`. No next-unit source/test/guide changes occurred during aggregate. Subsequent review-only amendment records the receipt; tested SHA remains `164e91cd3`, not the amended SHA. Recovery-only protection snapshot: **749 / 0 mismatches**; original manifest unavailable.

