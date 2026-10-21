# Review: enforce conversation retention boundaries

Date: 2026-10-21
Migration base: `674b36ed6`
Source chain: `447d3579` zero token budget; `3891c85a` zero message budget; `8b99d3ee` message-bound token counting and shortest-window precedence. Historical speculative batching in `6f1cfc1f` is intentionally excluded: current TokenCounter accepts one argument and provides no cancellation contract.

## Problem and evidence

Zero budgets are treated as disabled. Empty user/assistant messages do not count toward message retention, while prompt deltas do. Token counting continues into history already excluded by the message budget, potentially sending unnecessary remote requests or failing on irrelevant history.

Current compaction suite: **5 failed / 31 passed / 2 skipped**. Raw cutoff regressions directly showed both zero-budget failures, the empty-message boundary error and an out-of-window counter exception. Preparation directly showed a system delta incorrectly triggering compaction. Some combined assertions after the first raw failure were not reached in RED; projected parity is a post-fix control, not separate observed baseline evidence.

## Adaptation

Both raw and projected cutoff implementations retain the newest valid atomic group for zero budgets. Count non-system conversation contributions even when empty; exclude compaction checkpoints and prompt-only messages. Bound sequential token calls at the known message boundary, preserving a stricter token boundary and existing tool-call/result grouping and recovery-omission handling.

No counter batching, new cancellation API, summary composition or privacy policy change.

## Verification

Compaction plus context-edit suites: **54 passed / 2 skipped**. Actual prepareCompaction output verifies retained IDs, summary history and split-turn prefix; injected counter rejects excluded history and observes only bounded conversation input. Zero-token/message tests verify assistant call and trailing tool result remain together. No actual tokenizer HTTP or provider call is claimed.

The exact second file is `test/session-context-edit.test.ts`, including existing cases “does not advance past a boundary replacement of the candidate input”, “does not let metadata move the cut past unsent boundary input”, “does not treat an omitted custom message as a recovery attempt”, “advances past input for an omitted assistant recovery suffix with metadata”, and “prepares compaction from edited model content”. All ran in both 54-pass owning runs; these are existing boundary controls, not new RED regressions.

`npm run check` passed (1712 files; two changed files formatted). Post-format owning suites passed **54 tests / 2 skipped** again.
