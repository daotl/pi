# Per-attempt summary policy review

## Scope and final sources

Parent `ea7191197`; fixed upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`, backup `cb3bee033ba853041609b874303dc625d5d30479`. Final authored chain includes `65007d6c75cb16d08fbe47934e923bc53abaea1b` per-attempt rebuilt policy and later live payload corrections. Reference backup compaction 582-628, 707-790 and branch builder. This is the retry-context/live payload subset of S8, not full file attribution, native budget/headroom, fresh usage or S9 tokenizer authorization.

## Problem and implementation

Compaction and branch summaries transformed/converted history once, then retried the same context/options. A later policy replacement or changed incoming prefix did not affect retry history; transport mutation could contaminate subsequent attempts. Payload callbacks captured before asynchronous context work could also be stale.

The shared summary choke point now accepts a context builder, creates fresh shallow options per attempt, and invokes the builder before dispatch. Static standalone contexts receive per-attempt deep copies. Both summary paths freeze the selected source boundary, clone it per attempt, rerun current transform/converter/prefix, append the generated instruction afterward, and read onPayload after awaited policy work. Routing ID and no-cache-write policy remain stable across retries.

Current architecture requires a complete input checkpoint when raw selected history lacks one. Default prompt and serialized tool declarations are therefore supplied before policy, not restored afterward. Explicit checkpoints stay authoritative. Transform/converter removal of the original or synthetic baseline/tools remains effective. This deliberately adapts the backup fallback timing to retain current tool declaration behavior without post-policy resurrection.

## Reproduction and checks

- Actual scripted summary streams, first transport mutation and policy/prefix/payload replacement: compact/branch **2 failed**, bg_930; second request reused first policy. Initial implementation **31 passed / 5 files**, bg_931.
- External singleton converter-output mutation fixture failed bg_932 but asserted ownership beyond the selected-source contract. Replaced it with a converter returning references into attempt input, not a production clone added to satisfy the singleton fixture; **4 passed**, bg_933. External converter-owned singletons and nested option objects remain outside isolation guarantees.
- Policy edge fixture initially lacked a real baseline for a system-only mutation (bg_938); corrected Agent initial state. Actual baseline/tool-removal controls then passed, bg_940 **43 / 6 files**.
- Removing post-conversion tool restoration exposed two existing current compaction contracts (bg_942). Supplying serialized declarations before policy fixed checkpoint history; supplying a synthetic default before policy fixed missing-baseline history. Synthetic and existing baseline removal controls cover both transform and converter. **81 passed / 7 files**, bg_944.
- Current permanent tests check actual dispatched history, policy, tools, prefix placement, source immutability and returned summaries. Existing tool comparisons now use serialized declarations rather than executable implementation objects.
- Native OpenAI adapter smoke captured HTTP bodies for both compact and branch: first stream terminated, payload callback replaced, retry wire body contained REDACTED MARKER and not PRIVATE MARKER; canonical history unchanged. Both actualNativeAdapter/retryUsesLivePayload/canonicalUnchanged true, bg_939, 0.66s. No real network/credentials; script removed.
- Final broad matrix **139 passed / 10 files**, bg_946, 11.32s, including summary owners, untrusted summaries, cache fidelity, actual compaction, publication receipts, queued compaction and bug reports.
- Checks retained actual chronology: initial check formatted four files and reported two style infos (fixed); later no-fix bg_941 passed before final synthetic adaptation; bg_945 **1757 files, Fixed 1**, 22.35s. Final no-fix receipt follows.

## Independent review and limits

SummaryRetryPolicyAudit repeatedly inspected the final boundaries and returned bounded correct, including synthetic checkpoint exposure before policy and no restoration after conversion. No tests/runs by reviewer. Builder/converter/transport thrown errors retain existing propagation; returned abort/error responses retain existing retry handling. No new guarantee for external singleton converter output, nested option mutation, auth refresh or budget/attribution.

Graph generation/coverage unavailable due to WeakMap initialization failure; exact source and LSP references used. Whole 44-commit migration remains open. Fixed committed-tree aggregate follows normal commit.

Final full check **1757 files, No fixes applied**, bg_947, 22.30s; all dependency/type/browser-smoke gates passed. Protected daemon manifest **749 paths, zero SHA256 mismatches**. Source/test tree is fixed for the normal unit commit and isolated aggregate.

## First fixed-tree aggregate: environment failure

Root isolated test.sh on **2126ff401** returned **8450 passed / 4 failed / 936 skipped**, exit 1, **151.12s**, bg_949, artifact://3468. All four failures were grep tool tests: Homebrew ripgrep 15.1.0 could not load its pcre2 dylib because macOS rejected the library code signature. No summary-policy assertion failed. This is a failed aggregate, not green evidence.

No product/test changes or skipped cases. For environment recovery, downloaded official standalone Darwin arm64 ripgrep 15.2.0 into an owned temp directory. Exact published Darwin SHA256 and local archive both match `3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4`. otool shows only system libiconv/libSystem dependencies, not Homebrew pcre2. Original Homebrew installation untouched; rerun evidence follows actual executable readiness.

Verified standalone rg 15.2.0 starts successfully with bundled PCRE2 10.45. With its directory first on PATH, the unchanged source/test tree completed **8453 passed / 1 failed / 936 skipped**, exit 1, bg_953, **147.76s**, artifact://3477. All four dylib failures were resolved. The sole remaining failure was the untouched delta documentation timing test: large/small ratio 45.8744 exceeded 40. Isolated owning file then passed **60 tests**, bg_954, 0.69s, without edits or threshold changes. A fresh aggregate under the recovered tool environment follows; no source changes or test exclusions.

## Final fixed-tree aggregate

Unchanged source/test commit **2126ff401**, root isolated test.sh with verified standalone rg first on PATH: **8454 passed / 0 failed / 936 skipped**, exit 0, **154.50s**, bg_955, artifact://3480. No worker cap, skipped test, timeout or assertion change. Prior dylib and timing failures remain above. Normal commit hook was **1757 files, No fixes applied** (bg_948). The following amendment changes only this review; source/test tree is exactly the one exercised by the green aggregate.
