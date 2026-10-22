# Review: execute local image/classifier runtime regressions offline

Date: 2026-10-22
Parent: `7747ec68f`.
Source behavior chain: `aecd44347d2ada4e38b44f0fd8006bd881ae0872` separates bundled catalog metadata activation from provider network access; final fixture activation follows the already landed `test-network-env.ts::enableBuiltinProviders` convention. These newer upstream operation suites are adapted to that final authored behavior rather than copied from an old suite. No production runtime or provider implementation changes.

## Problem and reproduction

`model-runtime-images.test.ts` and `model-runtime-classifiers.test.ts` skipped their entire suites whenever the isolated root runner disabled cloud-provider metadata. Their operations are local: in-memory stores with `allowModelNetwork:false`, registered synthetic image/classifier implementations, explicit local fetch mock for the Typesafe response, and bundled model metadata. No real API key or remote request is required.

Before edit under `PI_DISABLE_CLOUD_PROVIDERS=1 PI_OFFLINE=1`: **eight skipped / two files**, zero test execution. After removing the file-wide skip and calling the existing case-local metadata helper in `beforeEach`: **eight passed / two files** under the same environment. The root isolated runner still controls credentials and keeps network/cloud E2E disabled; no `allowNetwork` call or ambient credential opt-in.

## Change and verification

- Both suites use unconditional describe plus `beforeEach(enableBuiltinProviders)`.
- Existing Vitest unstubEnvs restores per-case flags. Metadata is resolved when each runtime is created, not at collection. No global environment mutation convention or second helper.
- All existing consumer assertions remain: operation-specific catalogs, native/extension replacement, shared auth/header precedence, unconfigured/aborted generation and rejection of image models at chat entry points.
- Full `npm run check` passed **1746 files, No fixes applied**, including browser smoke.

Native Node actual ModelRuntime smoke with in-memory credentials/store, existing bundled Typesafe classifier and local fetch response produced approval probability0.8; registered native image implementation dispatched once and returned image bytes `aGk=`. Output: `{"offline":true,"classifier":{"probability":0.8},"imageDispatches":1,"imageBytes":"aGk=","network":"local mock only"}`. Initial smoke import incorrectly assumed AuthStorage was a public root export; corrected to its actual internal module before the successful run. No product export added. Temporary smoke removed. Protected artifacts **749 SHA256 / zero mismatches**.

Committed fixed tree `836250c11` root `rtk proxy ./test.sh`: **8320 passed / 0 failed / 937 skipped**, exit 0, **93.01 seconds**, full output `artifact://3037`. The eight formerly skipped cases now execute in the isolated aggregate. Normal commit hooks passed **1746 files, No fixes applied**. No next-unit source/test edits occurred; the immediate amendment changes only this review evidence. Protected artifacts **749 SHA256 / zero mismatches**.

## Limits

No provider HTTP/E2E activation, image/classifier product change, model-registry gate removal, model-catalog protocol change, S9 tokenizer policy or broader test rewrite. Changelog intentionally unchanged on crystal. Parent aggregate8312/0/945 on source60a55fd72 is not this unit's aggregate; fixed committed-tree evidence is added after execution.
