# Review: reject skipped top-level markup in edit documents

Date: 2026-10-21
Related migration: recognized scanner203737d0f and ordered parser44d2d7d64; independent EditParserFinalAudit found this integration regression.

## Problem and RED

findBlockClose recognizes a next-block prefix in pi_editor, but recognized-tag scanning skips that unknown markup. Top-level parsing then accepts a later valid pi_edit without verifying adjacency. Exact input of valid edit / pi_editor markup / valid edit returns both edits rather than rejecting the document. Initial run failed from a missing fixture import (not defect proof); corrected regression fails on two unexpected parsed edits (**1 failed /11 skipped**).

## Adaptation

Require openTag.start===pos at each top-level iteration after whitespace. Keep permissive recognized scanning within message bodies and existing block-close/literal-tag discussion semantics. Do not tighten next-close detection in a way that absorbs the invalid intervening block into the first message body.

## Verification

Five safety/order/actual AgentSession edit/swipe/lexical suites: **119 passed**. New regression asserts whole-document parse rejection, apply returns no mutation and full history remains unchanged. Apply/history checks are post-fix controls because the RED stops at parser equality. Existing nested tags/body prose, valid adjacent multi-block documents, attributes and provider replay controls pass. No physical TUI or live provider request claim.

`npm run check` passed (1719 files; two changed files formatted). Post-format owning suites: **119 passed**. Independent source-only follow-up confirmed the exact finding corrected and literal body scanning unchanged; no independent test execution claim.

Fixed-tree authoritative `./test.sh` at7c48959fd passed **8005 passed / 0 failed / 999 skipped** (artifact2092), including packed SDK/CLI smoke. All749 protected user build artifacts still match their saved SHA256 manifest. This is current integration proof, not completion of the remaining44-commit migration behavior inventory.
