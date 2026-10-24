# Review: activate local update and startup tests offline

## Frozen source and scope

V02, candidate #23 `243015b85e9159c785bdfa09053bb9eac12aab74`, exact behavior `R11#5 local git/package/version/stdout tests run by default`. Twenty-one local scenarios were skipped because collection read PI_OFFLINE before beforeEach could enable their mocked/local code paths. Product offline checks are correct and unchanged.

Remove only collection gates in four existing owners: nine git update cases with local remotes or command interception, four mocked version responses, two trusted startup stdout cases with a local fake npm executable, and six package update/self-update cases with fake executables and mocked fetch. Preserve each allowNetwork fixture, original behavioral assertions and explicit disabled-automatic/direct-version controls. Version fixture clears PI_SKIP_VERSION_CHECK with vi.stubEnv and restores stubs after each case. No provider network opt-in, production flags or runner changes.

## Actual execution

Before edits, default-offline focused run collected **21 skipped** and **27 passed / 2 failed, 4 files, 6.06s**. The failures were existing config selectors discovering real HOME skills, not activation behavior. This is a skip-coverage baseline, not product RED. Focused runs therefore used a newly created empty HOME/XDG directory; no code/test was changed to suppress those ambient discoveries.

Post-format focused: **50 passed / 0 skipped, 4 files, 14.93s** with that empty HOME. Existing assertions prove git update/rewritten history/ref behavior, trusted fake package execution and stdout routing, and version metadata/self-update success/failure; no new wiring-only tests. Full check **1770 files / No fixes applied, 26.25s**; prior check formatted two owned files. Temporary empty HOME was inspected and removed. Full authoritative root runner still must verify committed tree with its standard credentials/network isolation.

Source review read all four owners and local I/O setup before editing. Local git reset/clean operations belong to temp fixture repositories, not the working tree. Fake npm/pnpm paths are temp-owned; actual external version requests use fetch mocks. No real package registry or model provider request is intended or enabled by this patch; allowNetwork clears the existing product offline flag only inside these fixtures.

## Review and delivery

Code review: skipped (ce-code-review unavailable). Both bounded native source/proof reviews report no actionable findings after inspecting all four owners and relevant local/mock I/O paths; neither executed tests or independently verified timings. These are supplemental, not CE/cross-model receipts. No remote registry, cloud provider, every production offline path or all-platform subprocess claim.

Owned: four existing test owners and this review (five paths). Normal explicit-path commit precedes fixed-tree root aggregate; review-only amendment records exact tested SHA and execution counts. The aggregate's skipped total should decrease by exactly 21 if all newly active cases execute; unrelated outcomes remain reported honestly.

## Fixed committed-tree aggregate

Normal implementation commit `57fa2a6e6` includes all five owned paths; hook **1770 files / No fixes applied, 28.72s**. Authoritative isolated root `./test.sh` on that fixed test/review tree: **8766 passed / 0 failed / 915 skipped, 193.84s**, `artifact://5267`. Relative to the preceding aggregate **8745 / 0 / 936**, exactly 21 previously skipped cases now pass and the skipped total decreases by 21. No next-unit source/test/guide changes occurred during aggregate. The following review-only amendment records this receipt; tested SHA remains `57fa2a6e6`, not the amended SHA. Recovery-only protected snapshot remains **749 / 0 mismatches**; original manifest unavailable.

