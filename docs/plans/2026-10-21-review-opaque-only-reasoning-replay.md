# Review: retain opaque-only native reasoning replay

Date: 2026-10-21
Migration base: `08f6ab547`
Source: `e3f076aa` authored merge resolution, authored-merge-resolutions.diff:1968-1982.

## Problem and RED

The converter populates native reasoning_details, then drops the assistant if visible text/thinking/tool calls are empty. An encrypted-only response loses its replay item. SDK payload-capture regression fails **1 / 7 passed**: reasoning_details is absent from the second request.

## Adaptation

Treat preservedReasoningDetails as meaningful assistant payload in the existing empty-message guard. Keep prior exact-origin checks, ordinary empty assistant filtering, prefill rules and tool metadata unchanged.

## Verification

Completions reasoning-details, transform prefill and Azure reasoning replay suites: **19 passed**. Actual stream parsing followed by second SDK request capture retains the encrypted detail without mutating stored assistant; no live provider request.

`npm run check` passed (1713 files; production guard formatted). Post-format owning suites: **19 passed**.
