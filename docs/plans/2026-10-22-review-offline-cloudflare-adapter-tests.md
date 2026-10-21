# Review: run mocked Cloudflare adapter regressions offline

Date: 2026-10-22
Migration parent: `0da5bb3e3`.
Source: authored test activation/fixture repair in `243015b85e9159c785bdfa09053bb9eac12aab74`, retained in final backup `cb3bee033ba853041609b874303dc625d5d30479`. Only test activation/environment ownership is selected; do not import the backup's unrelated token-clamp expectations.

## Current gap

With an allowlisted credential-free environment and `PI_DISABLE_CLOUD_PROVIDERS=1`, `openai-completions-empty-tools.test.ts` runs **7 passed / 4 skipped**. The four skipped cases already replace the OpenAI client with a scripted in-process fake; they verify gateway field compatibility, resolved URL/auth, inline upstream Authorization precedence and session affinity. Their gate disables offline regression coverage, not real network traffic. This is characterization of skipped coverage, not an assertion RED.

## Adaptation and verification

Each affected case locally enables the bundled catalog and stubs synthetic Cloudflare credentials. `afterEach` restores environment, replacing direct process.env mutation. Remove only the skip gates; keep existing payload/header assertions and current clamp expectations. Existing unavoidable string-ID casts become `never` rather than `any`; no API redesign or production change.

The same file now runs **11 passed / 0 skipped** under the default disabled catalog. All provider payloads go through the existing fake OpenAI client; no actual provider request is claimed. Remaining catalog-gated test files remain separate pending work.

`npm run check` passed (1719 files; one test file formatted). Post-format adapter plus provider/adaptive metadata suites: **42 passed**. Normal commit hooks remain enabled.
