# Review: preserve ordered assistant edit sections

Date: 2026-10-21
Migration base: `6e7c73be4`
Source chain: `778e0120` text after tool sections; `aecd4434` section boundaries/multiple reasoning/formatter text flush; `243015b85` JSON-aware tool close selection. Adapt only exact parser/formatter blocks, keeping current pi_swipe/block-close/attribute decoding/safety guard and signed-body protections.

## Problem and observed RED

Current parser only consumes leading reasoning then one text region plus tools, while formatter moves buffered text past thinking. Valid text/tool/text, tool/reasoning/text, text/reasoning/text, consecutive signed reasoning and multiple-tool-plus-text messages are refused by the lossless guard. Five content cases times edit/swipe fail (**10 failed**) before production edits.

## Adaptation

Find section boundaries using existing furthest-close/adjacent-section rules, parse text/reasoning/tool sections in their original order, retain each signed reasoning block separately, and flush text before thinking or tools. Tool closing search accepts a closing only when its JSON parses, preserving literal closing tags inside arguments; malformed JSON retains existing fallback. User/plain legacy paths and deliberate discussion of format tags stay unchanged.

## Verification

Five order/safety/actual AgentSession edit/swipe/lexical suites: **116 passed**. New controls format/parse/apply each order for edit and pi_swipe and assert exact content arrays; embedded tool closing-tag argument survives. Existing literal nested tag, nonobject argument, ambiguous refusal and native Responses replay cases pass. No trailing whitespace policy, mixed-edit transaction, physical UI or live provider claim.

`npm run check` passed (1716 files; two changed files formatted). Post-format owning suites: **116 passed**.
