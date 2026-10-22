# Review: raw tool-call tokens across provider, proxy and frame transport

Date: 2026-10-22
Parent: `c58088ee0`.
Source chain: `26cb5df97f1fbe6266113f2a6be681605fca81cc` introduces optional per-call raw increments and proxy forwarding; `65007d6c75cb16d08fbe47934e923bc53abaea1b` completes raw-preserving frame snapshots, independent catch-up and authoritative end metadata. Final source is backup `cb3bee033ba853041609b874303dc625d5d30479`. No old agent exports/package restoration; current experimental harness is preserved and adapted at its actual tracked-frame consumer.

## Problem and RED

Completions accumulated `__raw` into a mutable tool block, but emitted only JSON argument deltas. A proxy or durable frame transport that strips partial snapshots therefore lost raw tokens before tool completion. Frame start/end clones also discarded raw. An interrupted tool call consequently could not retain its exact raw prefill. Separately, proxy options dropped `returnPrefill`, so the backend never received explicit continuation intent.

Observed before edits: proxy regression failed with request `returnPrefill` undefined; frame replay failed with raw absent; actual tracked harness reducer retained only start raw and lost the tail. Public references were checked with LSP: AssistantMessageEvent85, ProxyAssistantMessageEvent5, PiMessagesEvent6 and applyFrame7 references. Graph project/generation/coverage unavailable due to reported WeakMap initialization failure; exact source/LSP fallback.

The first queued-frame fixture kept its live raw accumulator static after a new delta; corrected to advance the live block before encoding the new uncovered suffix. This models shared queued-start coverage rather than pretending partials are immutable event-time snapshots. The initial native pi-messages clean-EOF fixture also encountered its pre-existing policy of producing an empty local error, outside this unit. It was replaced with a backend explicit-error case; that correctly retained the partial but failed because its raw field was missing. The clean-EOF policy is unchanged.

Independent transport review found an integration defect in both proxy and native pi-messages: `Object.assign` at tool end retained newly accumulated raw when the authoritative final call omitted it. Two new absent-raw rows failed with stale `<stale>`; empty and replacement controls passed. Both consumers now delete accumulated raw before assigning the final tool call. Their final result therefore follows the same absent/empty/override authority as the frame reducer and tracked consumer.

## Contract and adaptation

- `AssistantMessageEvent.toolcall_delta` adds optional `rawDelta`, independent of JSON `delta`. Native Completions emits nonempty per-call `__raw`; absent/empty chunks do not invent raw metadata. Raw-only chunks remain meaningful progress.
- Proxy serializable request options include `returnPrefill`. Proxy delta events carry optional raw increments, append them per content index and preserve them on existing EOF/error paths. Actual Agent continuation is exercised against a backend that only echoes when it receives that flag.
- Frame start clones include raw. Encoder records independent raw covered/delta character offsets per call, trimming only the already-snapshotted raw prefix while JSON snapshot catch-up proceeds independently. Raw-only increments can produce frames even when JSON emits no checkpoint.
- Checkpoint/delta frames carry only uncovered raw increments; end carries authoritative optional raw, including empty or absent values. Replay appends increments and replaces/removes raw on authoritative end. Existing strict frame validation and other metadata remain unchanged. Long stream regression bounds persisted size linearly, not repeated full raw snapshots per token.
- Current pico3 tracked `applyFrame` consumer receives the same raw checkpoint/delta/end semantics. Its existing JSON materialization policy remains unchanged. The harness is not deleted or replaced with backup code.
- Native pi-messages is another serialized-event receiver. Its public optional raw field is accumulated in the live tool block and forwarded by the existing event spread. Backend explicit errors retain that block. No broad local EOF/error semantic change or synthetic raw is added.
- Older senders may omit optional raw increments. The receiver cannot reconstruct raw metadata never transmitted; no shim guesses it.

## Verification

Provider tests use a local synthetic model instead of catalog defaults, keeping five real-adapter scenarios runnable under the isolated runner: success, unfinished EOF, interleaved raw-only transport error, absent raw and empty raw. Events pass through raw-stripped progress into the actual frame encoder/reducer without relying on authoritative tool ends. Codec coverage includes queued snapshots, partially covered chunks, blocked JSON catch-up, raw-plus-checkpoint, interleaved calls, end override/removal/empty, snapshot mutation isolation and linear wire-size bounds. Proxy tests include EOF/error interleaving and actual Agent-to-backend prefill echo. Native pi-messages explicit error is exercised through a local HTTP server.

Initial integrated AI owners: **44 passed / four files**; agent/proxy/tracked harness owners: **34 passed / three files**. Actual Agent proxy echo plus tracked consumer: **8 passed / two files** before final raw absence/empty controls. `npm run check` passed including browser smoke: **1745 files, Fixed 4**, then **1745 files, Fixed 1** after the actual Agent fixture. These formatting results are not no-fix check claims. Workers implemented their bounded source/test slices but ran no checks, tests, builds or formatters; runtime evidence is parent execution.

Pre-audit broad Agent/harness/loop owners: **171 passed / seven files**; AI owners remained **44 passed / four files**. RawCodecAudit returned correct/no actionable findings for independent coverage, snapshot isolation, final authority and linear storage. RawTransportAudit found the stale-final-raw issue above, then confirmed its correction with no remaining actionable findings. Both were source-only reviews and ran no checks/tests.

Final broad owners after audit repair: **174 passed / seven Agent files**, **47 passed / four AI files**. Audited check passed **1745 files, Fixed 3**; final check passed **1745 files, No fixes applied**, including browser smoke. Post-format proxy/tracked owners passed **13 / two files**, AI owners **47 / four files**. Protected user artifacts: **749 SHA256 / zero mismatches**. No worker or static reviewer execution is substituted for these parent results.

Final narrow cleanup types proxy JSON scratch as a ToolCall intersection instead of the touched branches' existing `as any`, and clones checkpoint/end inputs in tracked-consumer parity tests. After these changes: **174 passed / seven Agent files**, full check **1745 files, No fixes applied**, including browser smoke. AI paths were unchanged from their final **47 / four files** execution.

Committed fixed source/test tree `cb0efc3c8` root `rtk proxy ./test.sh`: **8293 passed / 0 failed / 945 skipped**, exit 0, **188.92 seconds**, full output `artifact://2975`. Normal commit hooks passed **1745 files, No fixes applied**. No next-unit source/test edits occurred during this run; the immediate amendment changes only this review evidence. Protected user artifacts: **749 SHA256 / zero mismatches**.

Native Node and workspace source resolver smoke used actual Completions adapter → local HTTP proxy stripping partials → streamProxy → frame encode/JSON persistence/reduce. Upstream sent a raw-only tail then ended without finish_reason. Result and restored progress both retained raw `<prefix><tail>` and arguments `{path:"/tmp"}`; proxy forwarded returnPrefill true. Output: `{"nativeAdapter":true,"localHTTPProxy":true,"returnPrefill":true,"interruptedRaw":"<prefix><tail>","replayedRaw":"<prefix><tail>","arguments":{"path":"/tmp"}}`. No paid service or credentials; local server closed and temporary smoke removed.

## Limits

No ordinary append/pending receipt, saved prompt/loadout, tokenizer permission, branch budgets or unrelated UI work. Existing local pi-messages EOF partial-discard behavior is explicitly not changed. Additive optional fields remain readable for existing frames; old data does not acquire missing raw values. No claims about every external sender's protocol implementation. Changelog intentionally unchanged on crystal. Parent aggregate8267/0/945 on source369861320 is not this unit's evidence; its own committed-tree aggregate is recorded after execution.
