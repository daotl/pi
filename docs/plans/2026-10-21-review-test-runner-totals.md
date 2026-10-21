# Review: report Node and colored Vitest totals without losing exit status

Date: 2026-10-21
Migration base: `8b55c61be`
Source: `243015b85` final runner/TUI reporter/count regression chain (commit diff:4833-4834,5671-5908).

## Problem and RED

Root runner only recognizes uncolored Vitest summaries. Root Node tests and TUI dot-only results disappear, ANSI Vitest summaries become zero, and aggregate failures can exit before npm's original status is restored. Actual runner fixture RED: **6 failed / 1 passed**, including a printed TOTAL of zero despite real Node outcomes and a colored Vitest summary. Credential/E2E isolation positive control passed.

## Adaptation

Add TUI spec reporter alongside dot so final Node counters exist. Strip ANSI SGR before aggregate parsing; sum only Vitest Tests and Node final counters, not suite/file/individual outcomes. Map cancelled to failed and TODO to skipped. Capture aggregate status under set +e, then prefer original npm nonzero status. Preserve environment isolation, default catalog flag and E2E disabling; explicit catalog override is a separate candidate.

## Verification

Seven runner integration tests pass. Each invokes actual test.sh with invocation-owned npm fixture, executes real Node tests using the current root/TUI reporter flags, adds an ANSI Vitest sample and asserts exact totals/status. Failure, cancellation, TODO and npm-status precedence are covered; credentials and E2E opt-in stay absent from child environment. No full repository suite claim.

`npm run check` passed (1714 files; No fixes applied). Package manifest change is script-only; dependency metadata/locks unchanged.

Actual `npm test --workspace packages/tui` passed: **1056 passed / 0 failed / 1 skipped**, 1057 tests across 162 suites. The modified real workspace command emitted both dot/spec output and final Node counters. Full output artifact1943; this is the complete TUI suite, not the full monorepo suite.
