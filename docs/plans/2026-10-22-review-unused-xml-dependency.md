# Review: remove the unused XML parser dependency

Date: 2026-10-22
Migration parent: `ee16528bb`.
Source chain: authored merge `e3f076aa28c4d7c1373a3e68a35cbfd07a199bff`, final dependency cleanup and isolated-consumer validation in `26cb5df97f1fbe6266113f2a6be681605fca81cc`; final backup `cb3bee033ba853041609b874303dc625d5d30479` omits the declaration. Only this dependency cleanup is selected, not that commit's unrelated runtime changes.

## Current evidence and adaptation

Before editing, coding-agent declares `fast-xml-parser` 5.7.3. Root lock metadata identifies coding-agent as its only dependency owner. Exact source/script searches for the package name, XMLParser, XMLBuilder and XMLValidator found no consumer; the only other matches were dependency metadata and an immutable released changelog entry. Graph documentation lookup fails with the previously reported WeakMap error; no graph coverage or dynamic external-consumer completeness claim.

Remove the single direct declaration, then run the repository's root lock refresh and both existing shrinkwrap/install-lock generators. All three lockfiles remove the same seven exclusive packages: `fast-xml-parser`, `fast-xml-builder`, `@nodable/entities`, `path-expression-matcher`, `strnum`, `anynum`, and `xml-naming`. Parsed before/after comparisons show no added packages, version changes or unrelated metadata changes. Install-lock package.json is unchanged. No product feature or parser implementation is removed; no vulnerability claim is made.

## Verification

This is unused-dependency metadata cleanup, not a behavior fix; no fabricated RED and no permanent dependency-name assertion test. Existing parser consumer suites remain unchanged.

- `npm install --package-lock-only --ignore-scripts`, then both existing generators succeeded. npm emitted the existing autoevals package-manager engine warning (Node 24.15.0/npm 11.12.1 versus its pnpm-only metadata); no lifecycle scripts ran.
- `npm run build:offline` rebuilt current source and bundled coding-agent successfully; no clean/delete operation touched user build artifacts.
- Temporary consumer smoke packed all 13 current public workspace packages, installed only coding-agent with local package overrides and `--ignore-scripts --omit=dev`, then exercised SDK import plus bundled and unbundled CLI `--version`. All passed. Recursive realpath-aware inspection of 139 installed packages verified all seven removed closure packages absent. Consumer smoke used an isolated credential-free home; installation may access the package registry, not provider APIs. Temporary consumer directory was removed by the script.
- `npm run check`: 1719 files, no fixes applied; types, dependency checks, both lock checks and browser smoke passed.
- Post-check safety/order/AgentSession edit/swipe/lexical suites: **119 passed**.

The consumer smoke proves package loading/version entrypoints, not a live provider request or physical interactive terminal behavior. Whole migration remains in progress.
