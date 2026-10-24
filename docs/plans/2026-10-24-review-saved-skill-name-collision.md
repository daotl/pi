# Review: saved skill identity wins a discovered name collision

## Scope and existing contract

U03 bounded acceptance from candidate #13 `aecd44347d2ada4e38b44f0fd8006bd881ae0872` effective skill precedence, later prompt-authority/resource-inventory chain retained. Current AgentSession resources_discover extension handling preserves effective names when adding newly discovered paths. Earlier tests covered same-path metadata changes and untrusted discovery, not a saved alpha versus different-path discovered alpha.

Add one consumer scenario to the existing effective-resource-inventory owner. A separate real seed loader supplies saved alpha metadata; the runtime loader starts with no skills, then real resources_discover admits a different alpha path and new beta. Explicit assertions require the runtime loader to contain discovered alpha/beta while Session effective inventory contains saved alpha/beta. Actual faux-provider requests verify saved alpha's file body/path and beta's body, reject colliding alpha body, and retain correct effective prompt descriptions. No production change, new precedence rule, source-text assertion or mocked dispatch echo.

## Actual proof

No product RED claimed: source protection already exists. Final post-format inventory/restore owners **10 passed / 2 files, 2.94s**. Full check **1770 files / No fixes applied, 13.73s**; earlier check formatted the owned test. Fixture owns real temp skill files, loaders, session and faux registration; cleanup disposes harness and removes its temp root. No paid APIs/network. This is binding/getter/prompt/actual request proof, not new collision-specific interactive autocomplete or process-reopen proof.

Code review: skipped (ce-code-review unavailable). Both native reviews found the first fixture masked Session precedence with loader-level deduplication. Separate seed/runtime inventories and explicit loader-versus-effective assertions resolve that finding; both read-only follow-ups report no remaining actionable findings. Neither executed tests. These are supplemental, not CE/cross-model receipts. U03 command grammar remains separately closed; U01 authentication and U02 bounded provenance are untouched.

Owned: existing effective-resource-inventory test and this review. Normal explicit-path commit precedes fixed-tree root aggregate; review-only amendment records exact tested SHA. This closes only the previously named different-path name-collision proof, not all resource discovery combinations.

## Fixed committed-tree aggregate

Normal test commit `cd85792fb` includes both owned paths; hook **1770 files / No fixes applied, 13.81s**. Isolated root `./test.sh` on that fixed test/review tree: **8767 passed / 0 failed / 915 skipped, 102.56s**, `artifact://5405`. No next-unit source/test/guide changes occurred during aggregate. Following review-only amendment records the receipt; tested SHA remains `cd85792fb`, not the amended SHA. Recovery-only protection snapshot: **749 / 0 mismatches**; original manifest unavailable.

