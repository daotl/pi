# Review: choose catalog-backed Azure and Copilot defaults

Date: 2026-10-21
Migration base: `4568ff3b7`
Source chain: `5d43bb4f` invalid wildcard defaults → gpt-5.4; `edb4e9d9` explicitly activate bundled metadata and assert known provider before all-provider invariant. Adapt Azure key to current azure-openai-responses, not backup azure.

## Problem and observed RED

Both defaults are llama-server/*, not actual catalog model IDs. findInitialModel therefore falls back to the first available model. Activating the previously vacuous invariant fails on Azure; two real-catalog startup cases also fail, selecting GPT-4 and Claude Fable instead of the intended available GPT-5.4 (**2 failed / 51 skipped**).

## Adaptation

Change only those two table entries. Enable cloud catalog metadata locally inside the existing invariant and require OpenAI presence before iteration; existing unstubEnvs restores the test environment. Preserve other model defaults, startup precedence, credentials and network policy. Current ignored published-compatible catalog assets contain the exact gpt-5.4 candidate for both providers; no generated/catalog asset is changed or claimed to match the exact upstream source snapshot.

## Verification

Full model-resolver test file: **53 passed**, including nonvacuous all-provider membership and actual findInitialModel with an alternative catalog model placed first. Tests assert returned model identity, not copied table constants. No provider network call. First-login UI reads the same table but its selection/persistence path was not exercised here and remains an explicit S13 verification dependency.

`npm run check` passed (1714 files; test formatted). Post-format owning file: **53 passed**.
