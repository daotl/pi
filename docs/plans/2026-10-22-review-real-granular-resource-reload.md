# Review: prove granular resource reload with one real loader

Date: 2026-10-22
Migration parent: `c4daf82be`.
Source: test-fidelity repair `444bce20a39f93d6b860efc6919548995d7509ab` identified in frozen S12 analysis, final backup `cb3bee033ba853041609b874303dc625d5d30479` skills-restore.test.ts lines 240–359. No loader production implementation is imported.

## Coverage gap and adaptation

Older restore fixtures mutate holder objects or replace the loader while reload is a no-op, so they cannot prove disk rereads through the same loader. Add a dedicated test using one DefaultResourceLoader, real owned SYSTEM.md/APPEND_SYSTEM.md/SKILL.md files, a file-backed SessionManager and existing faux request harness. Edit the preamble, delete addendum and one skill, change another skill description and add a new skill. Public prompt-only reload must preserve the old skill set; public skill reload must then reflect changed/deleted/added files without replacing the loader.

## Verification

The actual consumer test passes on current production (**1 passed**), so this is coverage-only evidence, not a defect RED. It captures real provider-context instructions after each public reload and verifies actual JSONL reopen retains the final prompt and skill metadata. All paths are invocation-owned; noContextFiles/noExtensions/noThemes/noPromptTemplates and explicit skill paths isolate discovery. No inventory API, trust restoration claim, new production behavior or paid provider request.

The existing harness cwd/manager seams are reused without modification. No product source or fixture holder replacement is added.

`npm run check` passed (1721 files; one new test formatted). Initial broader invocation from repository root with Vitest `--root` failed three existing resource-loader cases that resolve theme fixtures using process.cwd; this was an invocation error, not a source defect, and no assertion/path was weakened. Running the four actual owner files from coding-agent package cwd passed **61 tests**. Normal hooks remain enabled.
