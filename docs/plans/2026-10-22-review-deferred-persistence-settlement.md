# Review: retain unflushed deferred output and release run ownership

Date: 2026-10-22
Migration parent: `024392670`.
Source: final recovery repair `a820049ee4ff71fb8f35dd62c386181dce6e9222`, retained in backup `cb3bee033ba853041609b874303dc625d5d30479`. Select deferred queue consumption and innermost settlement finally only; do not import durable prefill restore/usage/checkpoint transaction architecture.

## Problem and RED

Prompt/continue cleanup can throw while appending deferred output before `_emitAgentSettled`, leaving run ownership and idle waiters stuck. Bash flush retries previously successful records after a later append fails; custom flush clears its whole pending array before persistence and loses remaining records. Standalone continue omits final custom flush entirely.

New file-backed public-session matrix injects an error at the real fs.appendFileSync call for the second of three deferred records after agent_end. Four rows cover prompt/continue × bash/custom. Before source changes: **4 failed**. Prompt/bash, prompt/custom and continue/bash remain non-idle after error; continue/custom never reports the storage error because it never flushes there. No private pending arrays or persistence methods are substituted.

## Adaptation

Move settlement to an innermost finally in both owning run paths. Keep existing cleanup fields, clearing those fields before fallible flush. Add the missing continue custom flush. Consume one deferred record only after its append succeeds, retaining the failed record and later records for retry. Existing append persist-before-publication remains the storage boundary; no new generic transaction wrapper, append rollback or process-crash guarantee.

Existing harness gets two optional test inputs, cwd and SessionManager, with caller-owned cwd cleanup; default behavior remains unchanged. Its own temporary directory and provider cleanup remain harness-owned. LSP references checked HarnessOptions consumers before extension. Experimental production harness exports are untouched.

## Verification

New four-case matrix plus existing bash-persistence/actionable-boundary suites: **48 passed**. Tests verify the exact injected Error propagates, session becomes idle, a held idle waiter resolves, completed assistant text survives, a later public prompt succeeds, and actual JSONL reopen contains all three deferred records in order exactly once. The initial RED stops before record-recovery assertions, so those are post-fix controls.

Only invocation-owned directories are removed; response stream and outcome are settled in finally. Synthetic commands are recorded, not executed, in the new failure matrix. Existing bash suite executes its ordinary local smoke. No provider API, general disk partial-write atomicity, or completed-but-unpublished usage receipt claim.

`npm run check` passed (1720 files; one new test file formatted). Post-format five-file deferred/bash/boundary/queued-compact/continue-prefill run: **77 passed**. Normal hooks remain enabled.
