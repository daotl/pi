# Review: omit failed assistant replay except explicit trailing prefill

Date: 2026-10-21
Migration base: `17fefa46f`
Source chain: `aecd4434` skipped assistant/result ownership; `447d3579` final explicit-prefill-only trailing exception. Uses last conversational index and system patch handling already landed in f46a61095.

## Problem and observed RED

Errored/aborted partial assistants replay as ordinary history, including incomplete reasoning/tool calls providers cannot accept. Their tool results survive orphaned if only the assistant is removed. The previously parked exact transform scenarios observed **4 failed / 5 passed** on f46a61095; only independent OAuth caller awaits changed before integration, so RED is reused rather than rerun. It directly shows failed partial/result leakage and ordinary trailing failed text retention.

## Adaptation

Skip failed assistants unless they are the final conversational assistant in explicit prefill mode. Suppress their dependent tool results until the next assistant starts; clear suppression there so reused call IDs in later valid responses survive. Retain system messages and stored history; no mutation, Agent terminal echo, durable continuation, raw token or receipt changes.

## Verification

Transform prefill, Completions prefill serialization/reasoning-details, Azure reasoning and Copilot-to-Anthropic transform suites initially **40 passed**. Additional actual converter control proves ordinary aborted partial is absent from serialized assistant items and explicit prefill remains trailing. No live provider HTTP or end-to-end Agent continuation claim.

`npm run check` passed (1714 files; three changed files formatted). Final five AI suites: **41 passed**; existing AgentSession continuation, retry/continue lifecycle and prompt suites: **36 passed**. These consumer regressions do not establish the still-pending durable/echo repair groups.

Follow-up after 263ad30dd strengthens ordinary converter output to the exact retained user item, not only absence of assistant. Prefill serialization + transform suites: **18 passed**. Original transform regressions already assert retained patch/later assistant/result sequences; this closes the narrower converter negative-control gap.
