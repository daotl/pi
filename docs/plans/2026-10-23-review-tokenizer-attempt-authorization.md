# Tokenizer attempt authorization prerequisite review

## Scope and sources

Parent `7de742755`; fixed upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`, backup `cb3bee033ba853041609b874303dc625d5d30479`. Final authored chain: `0a9acad131b79844ce5afd677368090ef95684f7` definitive-unavailability callback, `b2489d93bca284d3322ece68c1fa7e086ee02e38` per-attempt permission, `a820049ee4ff71fb8f35dd62c386181dce6e9222` awaited permission and cancellation recheck.

This is the AI callback prerequisite only. AgentSession fragment authorization, full transform/converter attribution, native dispatch checks, count ownership, bounded speculative concurrency and removal of the shared faux tokenizer interception remain pending. No partial guard is added around the current unsafe fragment conversion. Existing countChatTokens and its chat-template/multimodal counting contract are unchanged.

## Change and invariants

countTokensWithRetry accepts optional onUnavailable and canRequest arguments. Permission is awaited outside the transient retry catch before every attempt, including after backoff. Cancellation is checked both before and after permission. Denial returns undefined without uploading text/credentials or poisoning endpoint capability; rejected authorization propagates. Only a non-empty unavailable result without cancellation invokes onUnavailable. Exhausted transient retries, empty input, denial and cancellation do not invoke it. Existing retry limits and HTTP/body classification remain unchanged.

## Evidence

- New owning regressions initially **5 failed / 20 passed**, bg_957: private text/key dispatched before permission; revoked permission ignored on retry; pending-authorization cancellation still dispatched; authorization rejection ignored; unavailable callback absent.
- Narrow implementation **57 passed / 2 files**, bg_958, 0.82s. Added asynchronous allow/exact-count control. Final tokenizer/header/body/unavailable owners **76 passed / 4 files**, bg_962, 1.79s.
- Actual local HTTP server smoke observed zero requests for denial and exactly one authorized request before a 503 revoked permission; no retry upload and no unavailable notification. All four assertions true, bg_960, 0.48s. Temporary script removed; no external service or real credentials.
- LSP references inspected before public signature extension: eight references, existing three-argument callers remain intentionally unchanged until the complete AgentSession integration.
- Protected daemon target manifest: **749 paths, zero SHA256 mismatches**.

## Limits and verification receipt

Matches the final callback ordering and classification from the frozen backup. Authorization callbacks own their asynchronous work; cancellation prevents dispatch after resolution but does not forcibly settle an arbitrary never-resolving callback. No consumer privacy guarantee is claimed before S9 integration. Whole 44-commit migration remains open. Full check and fixed committed-tree aggregate follow their actual completed results.

Check attempts bg_959, bg_963 and bg_964 stalled before Biome produced a result and were cancelled. They were tooling stalls, not passing verification. Process inspection showed the wrapper blocked at `/usr/bin/env node .../biome`; no product source or test threshold changed for this environment behavior. Recovery and successful checks are recorded below.

The bounded foreground retry and owned-file check also timed out; installed native Biome 2.3.5 --version itself timed out, confirming startup rather than repository lint complexity. Downloaded a temporary same-version @biomejs/cli-darwin-arm64 package from npm without changing dependencies/locks. Archive SHA512 exactly matched published integrity `fLdTur8cJU33HxHUUsii3GLx/TR0BsfQx8FkeqIiW33cGMtUD56fAtrh+2Fx1uhiCsVZlFh6iLKUU3pniZREQw==`; SHA1 also matched npm metadata. No xattr/codesign or installed binary modifications. At that point temporary binary readiness and full check were still required, not assumed.

## Historical blocker: native checker startup

The verified fresh arm64 Biome 2.3.5 binary also timed out at --version (bg_972). An independent Bun subprocess probe outside the repository produced no output and was terminated after 15 seconds (exit 143). This confirms the failure is not caused by the new tokenizer files or the shell wrapper. An alternate x64 archive was downloaded and its npm SHA512/SHA1 verified, but was not extracted or executed; its archive and directory were subsequently removed. Recovery attempts stopped after the verified arm64 startup failure. No Rosetta, signature, xattr, installed dependency or lockfile changes.

While startup was blocked, the tokenizer authorization unit remained uncommitted: 76/76 focused tests and the local HTTP smoke did not substitute for full npm run check. No aggregate or completion was claimed at that point.

## Bounded native-startup diagnosis

Further read-only diagnosis localized the launch block. Both binaries are Mach-O arm64. A three-second sample of fresh Biome PID 51379 recorded all 267 samples at `_dyld_start`, with no application frames or binary-image description. The matching kernel log reported `AppleSystemPolicy: Security policy would not allow process: 51379, /private/tmp/pi-migration-biome-2.3.5/package/biome`; a second sampled launch, PID 51743, produced the same policy message. Both owned probes were terminated and reaped.

Both `/usr/bin/otool -L` and the direct CommandLineTools otool timed out without output. A read-only Mach-O load-command parser found `/usr/lib/dyld`, CoreFoundation, CoreServices, libiconv and libSystem only; no Homebrew dependency. This is static linkage evidence, not a successful otool result.

`launchctl print system/com.apple.security.syspolicy` showed the service running as PID 511. Concurrent service logs repeatedly reported `failed to call driver: 0x3` and `Failed to terminate process: -1`. Sampling PID 511 was denied for insufficient privileges. The execution-policy block is observed; the service's internal cause and whether restarting it repairs launch remain unverified. No security service was restarted, no policy was disabled, and no repository dependencies were changed. Required full check remains blocked pending authorized system-level diagnosis/recovery.

A non-interactive privileged read-only sample (`sudo -n /usr/bin/sample 511 3 10 -file /tmp/pi-syspolicyd-admin-sample.txt`) failed with `sudo: a password is required`. Administrator evidence is not available to this session; no privileged recovery command was attempted.

## Recovery and current verification

The user supplied an administrator sample of syspolicyd PID 520, launched at 09:41. Its three-second capture at 09:49 showed the main thread waiting in the Mach-message run loop and an idle worker; it does not demonstrate a service deadlock. The PID differs from the earlier 511. The recovery mechanism was not supplied and is not inferred.

Installed native Biome then returned `Version: 2.3.5` in 0.05s. Full `rtk proxy npm run check` passed in 9.57s, checking 1757 files and formatting one file. The post-format four-file tokenizer matrix passed **76 tests / 4 files** in 1.04s (wall 1.32s). A second complete check passed in 8.85s: **1757 files, No fixes applied**, with dependency, TypeScript, lockfile and browser-smoke checks successful. Current system ripgrep also starts normally (`15.1.0`, PCRE2 10.45); no temporary replacement is needed for the next aggregate.

After runtime recovery, the old temporary migration artifact directory and original protected-file hash manifest were no longer present, and the eval kernel had been lost. The historical 749-path equality receipt above is from the prior verification, not a fresh comparison to an available original manifest. Protected files remain excluded from staging; a new current-state snapshot cannot retroactively replace that original evidence. Fixed committed-source/test aggregate results will be appended after the normal commit.

The restored current protected inventory contains exactly **749 untracked target files**. A fresh SHA256 manifest was saved outside the repository for subsequent-unit comparisons, explicitly labeled as a recovery-time snapshot rather than the missing original manifest. Final local patch review found no changes to countChatTokens, endpoint classification, existing caller behavior, or unrelated files; tests cover observable upload denial, retry revocation, cancellation and unavailability classification rather than callback wiring alone.

## Fixed committed-tree aggregate

The explicit-path implementation commit included exactly the AI source, owning test, README and this review. Its normal pre-commit full check passed with **1757 files / No fixes applied**. Root `rtk proxy ./test.sh` ran on the pre-amend source/test tree at `d10f73760` and completed **8463 passed / 0 failed / 936 skipped**, exit 0, **71.14s**, full output `artifact://3525`. Only this review was amended afterward to record that receipt; source/test blobs were unchanged. The authoritative runner isolated credentials, HOME and temporary state and used its default cloud-disable policy. No worker cap, additional test exclusion/skip change, timeout change or assertion weakening was used. This receipt completes the callback prerequisite only; the consumer and other remaining migration units are still pending.
