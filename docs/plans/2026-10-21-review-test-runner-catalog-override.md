# Review: preserve explicit catalog metadata override in isolated tests

Date: 2026-10-21
Migration base: `603bdd822`
Source: `243015b85` isolated runner explicit PI_DISABLE_CLOUD_PROVIDERS override. Aggregation/reporters are already migrated separately.

## Problem and RED

Runner documentation promises PI_DISABLE_CLOUD_PROVIDERS=0 opt-in but env -i always assigns 1. New integration row fails **1 / 7 passed**, observing child value1 instead of0.

## Adaptation

Default missing/empty override to1 while preserving explicit value. Keep env -i, isolated HOME/cache/tmp, credentials and PI_E2E_TESTS exclusion unchanged. Replace misleading old comment that claimed ambient behavior flags survived isolation. No provider test activation/config change in this unit.

## Verification

Eight actual test.sh integration cases pass. Explicit metadata override reaches child npm fixture, while supplied API tokens, cloud credential sources, NODE_OPTIONS and E2E opt-in remain absent; default remains disabled. Real Node reporter fixtures and failure precedence continue to pass. Does not claim all package configs honor metadata activation yet.

`npm run check` passed (1714 files; No fixes applied).
