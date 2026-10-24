# Review: first authentication selects and persists provider default

## Scope and existing behavior

U01 bounded candidate #25 `5d43bb4f2bd071ff9ba76f4446f98fe2161bff45` acceptance. Current Azure Responses and GitHub Copilot defaults are gpt-5.4 and the post-authentication consumer selects them when the previous model is unknown. Existing catalog tests checked default IDs; dynamic Radius login tests replaced Session.setModel with a spy and did not prove these provider defaults reach Session/settings state.

Add two cases to the existing credential-refresh regression owner. Use actual built-in catalog model data with dynamic ID lookup, an offline registered credential/provider seam and actual modelRuntime availability. An explicit getAvailableSnapshot assertion establishes the exact snapshot read by completeProviderAuthentication before invoking that real consumer. Session.setModel is not replaced: assertions verify selected model, both default getters, model_change entry and status. Previous selection is an actual unknown-shaped model in Agent state, not a mocked getter. Only background catalog refresh and UI presentation methods are stubbed; no provider stream is allowed.

## Actual proof

No product RED claimed: production behavior already exists. Final post-format authentication/catalog owners **62 passed / 2 files, 3.37s**: suite/regressions/7027-credential-refresh-hang.test.ts and model-resolver.test.ts. Full check **1770 files / No fixes applied, 13.97s**. Earlier check formatted the fixture and rejected using a dynamic default string with the literal-ID getter; final test uses the authoritative catalog list and find without casts.

This proves post-auth consumer → actual Session mutation → settings getters/session entry. It does not execute credential entry/OAuth/browser login, initialize a whole InteractiveMode, or reopen disk-backed settings. Both provider IDs and physical catalog defaults are current; Azure uses azure-openai-responses rather than the obsolete key.

Code review: skipped (ce-code-review unavailable). Both bounded native source/proof reviews report no actionable findings; neither executed tests or independently verified timings. These are supplemental, not CE/cross-model receipts. No paid provider/network, physical terminal, production Copilot OAuth authentication, background remote catalog or all first-login provider claim.

Owned: existing 7027 credential-refresh test and this review. Normal explicit-path commit precedes fixed root aggregate; review-only amendment records actual tested SHA. U03 collision proof remains independently closed; U02 bounded provenance is unchanged.

## Fixed committed-tree aggregate

Normal test commit `60c7d5b36` includes both owned paths; hook **1770 files / No fixes applied, 15.39s**. Isolated root `./test.sh` on that fixed test/review tree: **8769 passed / 0 failed / 915 skipped, 112.77s**, `artifact://5427`. No next-unit source/test/guide changes occurred during aggregate. Following review-only amendment records this receipt; tested SHA remains `60c7d5b36`, not the amended SHA. Recovery-only protection snapshot: **749 / 0 mismatches**; original manifest unavailable. This remains post-auth consumer/Session/settings-state proof, not credential UI/OAuth or disk-reopen proof.

