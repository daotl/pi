# Review: preserve native custom Responses item IDs

Date: 2026-10-21
Migration base: `b3b673880`
Source: `e3f076aa` authored merge resolution, authored-merge-resolutions.diff:1983-1997.

## Problem and RED

Native custom tool response item IDs start ctc_, but replay coerces every non-fc_ ID into fc_..., changing provider item identity. Existing stream-to-converter namespace regression updated to native identity failed **1 / 4 passed**, producing fc_ctc_test instead of ctc_test.

## Adaptation

Accept native fc_ and ctc_ prefixes; retain foreign provider/API rebuilding into hashed fc_ IDs, existing sanitization and length bounds. No transport/provider catalog or tool execution changes. Updated the other constrained grammar replay contract that explicitly expected the old wrong fc_ctc_ ID; it failed once during integration and now asserts preserved native identity.

## Verification

Responses namespace stream/replay, foreign call IDs, message IDs and constrained-sampling suites: **13 passed**. Actual processResponsesStream output feeds converter and retains namespace/input/call association. No live OpenAI HTTP request is claimed.

`npm run check` passed (1713 files; No fixes applied).
