# Review: retry token-rate throttling without retaining abort listeners

Date: 2026-10-21
Migration base: `d03098376` on upstream-based `crystal`
Reference: `my-merge` at `cb3bee033ba853041609b874303dc625d5d30479`

## Problems

1. The retry classifier rejects every error containing `token limit` before considering transient status/rate signals. A provider response such as `429 rate limit reached: token limit per minute exceeded` therefore returns an error without attempting recovery.
2. Each completed retry backoff registers an abort listener that is removed only if the signal eventually aborts. Successful or exhausted retries retain closures and accumulate listeners on a long-lived signal.

Current-source regression proof: `test/retry.test.ts` produced **4 failed / 34 passed**. Both token-per-minute/second scenarios returned the original empty error instead of the later successful response. Both listener scenarios observed `[0, 1, 2, 3]` retained listeners across attempts rather than `[0, 0, 0, 0]`. The permanent quota/billing/context/output controls passed.

## Final repair chain

- `3891c85a2d698b87546873ddc42f3d400406db13`: remove the retry-sleep listener when its timer resolves.
- `06023b8cbaacae6ba27c4d8ed68c359dd7104e63`: exclude explicit `token limit per minute` / `per second` wording from the broad permanent token-limit matcher, allowing existing transient signals to decide.

Apply these final semantic hunks to the current classifier. Preserve its current provider patterns, account/quota/billing precedence, retry budgets, backoff caps and abort result shape. Do not import additional original-upstream retry patterns or change unlimited-retry product policy.

## Verification

- Owning suite after repair: **38 passed**, including the unchanged abort-during-backoff behavior and permanent-limit controls.
- Actual-source Node smoke: three token-rate errors followed by success; **4 calls**, result `recovered`, **0 remaining abort listeners**. No provider API or network request was used.
- `npm run check`: passed; 1701 files, `No fixes applied`, TypeScript and browser smoke included; exit 0.

## Limits

The classifier recognizes the specific explicit per-minute/per-second wording above. This is not a claim that all possible provider token-rate messages are recognized.
