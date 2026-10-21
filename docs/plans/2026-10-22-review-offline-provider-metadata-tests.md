# Review: execute bundled provider metadata regressions offline

Date: 2026-10-22
Migration parent: `b3d32c08f`.
Source: authored test activation in `243015b85e9159c785bdfa09053bb9eac12aab74`, retained by final backup `cb3bee033ba853041609b874303dc625d5d30479`. Preserve current upstream model expectations; do not import backup Haiku metadata or regenerate model data.

## Current gap and characterization

Under an allowlisted credential-free environment with `PI_DISABLE_CLOUD_PROVIDERS=1`, the adaptive-thinking metadata file reports **1 skipped**. The providers file reports **25 passed / 5 skipped**; its catalog enumeration also bypasses the substantive cloud-model checks. These cases examine bundled data, not provider availability. A skip is the observed coverage gap, not an assertion RED.

## Adaptation

Adaptive-thinking test locally stubs the catalog flag to `0`, asserts the known Anthropic provider exists before enumeration, and restores environment afterward. In providers.test.ts, the six catalog-dependent cases explicitly stub the flag inside their own bodies: catalog enumeration plus the five previously skipped image-limit/system-message/tool-change/pricing cases. Existing expectations remain intact; enumeration now always checks the known provider and actual models. Other auth/provider/faux/deferred cases retain their default environment. The containing suite only owns environment restoration, not activation.

An initial suite-wide activation hook was tested but not retained: it unnecessarily changed unrelated cases. The retained implementation uses case-local activation and was independently rerun under the default disabled flag. No production source, model data, credentials or E2E opt-in behavior changes.

## Verification

Both files: **31 passed / 0 skipped**, versus **25 passed / 6 skipped** before activation. The retained case-local implementation passed with a credential-free environment and again with fetch/WebSocket/HTTP/HTTPS/TCP/TLS transports replaced by throwing deny hooks. No provider request, catalog hydration or paid E2E body ran. Temporary deny-hook file is removed after verification. Existing assertions cover actual metadata rather than copied activation values. No extra permanent test asserting fixture wiring is added.

Full migration remains active; other mocked catalog-dependent files are separate pending units.

Final `npm run check` passed (1719 files, no fixes applied), followed by the network-denied **31 passed** rerun on the retained case-local implementation. The earlier check formatted providers.test.ts before that scope correction; no suite-wide activation hook remains.
