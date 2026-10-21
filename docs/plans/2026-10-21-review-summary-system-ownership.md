# Review: emit summary system state once

Date: 2026-10-21
Related migration: canonical preparation `0813beef1`; CompactionBoundaryAudit identified a newly introduced builder integration defect. Final backup compaction.ts:503-523 already uses a complete transcript rather than separate outer system authority; current adaptation retains the existing Agent.convertToLlm contract.

## Problem and RED

Preparation now includes the selected checkpoint/system deltas, but buildAgentSummarizationContext independently computes full current system state and generateSummaryWithUsage prepends it. The actual AgentSession summary-stream capture produced two system messages for CHECKPOINT-ONCE (**1 failed / 29 skipped**). This is stream-boundary request evidence, not an actual external provider HTTP capture.

## Adaptation

Canonical prepared messages own existing system state. Supply a saved/fallback baseline only when the source has no initial system message, then run context transform/conversion once over that transcript. Do not restore removed baseline authority after transforms. Attach existing executable tool fallback only after conversion, when no tool baseline was provided; adding executable functions before extension emitContext causes DataCloneError (observed six failures during implementation and corrected).

Remove the separate unconditional outer system message. Standalone generation also respects supplied canonical system state instead of adding default authority. No public signature, retry redesign, request authorization, convertForRequest migration or native output clamp.

## Verification

Actual AgentSession compaction, summary reasoning, compaction preparation, context-edit and nested-call suites: **97 passed / 2 skipped** before the additional standalone control. Request regression checks exact system-message list plus effective tool declarations. Existing no-system fallback and transport/options controls pass. No paid provider call.

Combined post-format audit-correction run (five summary suites plus three storage suites): **160 passed / 2 skipped**, including the standalone control. `npm run check` passed (1712 files; final run No fixes applied) after removing the obsolete Tool type import.
