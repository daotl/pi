# Review: test pre-prompt compaction through the public prompt path

Date: 2026-10-22
Migration parent: `82a0f8e18`.
Source: `f2970f807e4121823162581ebb8d7495f52f3785` repair named by frozen S12 analysis; final backup `cb3bee033ba853041609b874303dc625d5d30479` test provides the selected behavior. No production implementation is imported by this coverage-only unit.

## Coverage gap and adaptation

The current regression invokes private `_checkCompaction` and checks its boolean. It does not prove the public `session.prompt()` caller delivers the newly submitted prompt, avoids continuing an old partial, or produces the final answer. Replace that invocation with the actual public prompt. Capture the faux provider's summary and answer requests, then assert the old history is summarized before the new prompt, the new prompt reaches the second request and transcript, the final answer is retained, and `agent.continue()` is not called. Preserve the compaction outcome assertions. Use a 10,000-token window and matching prior usage so the fixture triggers pre-prompt overflow without requiring a newly compacted prompt to fit a 100-token physical window.

## Verification

Public regression plus existing queued-compaction suite: **5 passed** on current production. This is stronger coverage of already working behavior, not a new defect RED. The actual faux-backed request path ran; no real provider or HTTP request is claimed. The existing shared harness still intercepts faux tokenizer requests, a known pending S9/S12 consumer issue; this test does not prove faux transport privacy or absence of HTTP attempts. No extra production fallback or timeout change.

`npm run check` passed (1719 files, no fixes applied); post-check owning suites **5 passed**. No shared harness implementation changed.
