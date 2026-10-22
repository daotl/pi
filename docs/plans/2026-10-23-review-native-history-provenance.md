# Native history provenance prerequisite review

## Scope and final sources

Parent `71f230fd5`; fixed upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`, backup `cb3bee033ba853041609b874303dc625d5d30479`. Final authored chain: `7cfc4563ad539607c1f02ef56bd76b38d5fcacf5` native transport evidence, `8b99d3ee3d54e82a494ef15d400ff571e864e363` separate history/direct capability, `06023b8cbaacae6ba27c4d8ed68c359dd7104e63` final faux direct denial. Earlier faux-direct behavior is superseded, not migrated.

This unit supplies the live transport capability boundary for S8/S9. It does not yet authorize AgentSession tokenizer uploads, remove the shared tokenizer fixture interception, or implement per-attempt summary policy/attribution. Existing countChatTokens, tool schemas and multimodal/chat-template counting remain unchanged.

## Implementation and boundaries

Repository-owned Anthropic, Responses and Completions lazy APIs carry exact-object/original-stream-pair history evidence. Direct tokenizer transport evidence is separate and belongs only to factory-created Completions APIs. Wrapping, replacing or copying stream implementations does not inherit recognition. Restoring original identities restores recognition.

createProvider exposes its live underlying API through factory streamSimple identity. Per-model API maps remain live. Composed provider policy follows the same dispatch branches as streamWith: custom extension streams deny recognition, inherited matching base APIs recurse, and compatibility fallback queries the current registry. ModelRuntime queries the live selected provider and denies unresolved virtual models.

Compatibility registration records original wrapped function pairs only for repository-created builtin registrations or explicit faux registration. Faux is history-known but direct-denied even under an openai-completions label. External registration and mutation revoke recognition. Non-clobbering builtin registration neither replaces nor blesses an existing override. The builtin dispatch identity map records only instances actually installed by that operation; otherwise an external override could be mistaken for the builtin and bypassed.

Capability is not upload authorization: consuming request policies, transforms, auth and cancellation must still permit the operation. The exported internal history marker can opt a transport into history attribution but cannot grant direct transport evidence. This is not a sandbox against deliberately malicious in-process code.

## Verification

- Runtime boundary regression initially **4 failed**, bg_913: method absent. This is missing-capability RED, not a reproduced HTTP privacy leak.
- Runtime native/compat controls **17 passed / 3 files**, bg_914, 2.35s. Covers native history/direct distinction, wrapper replacement/restoration, custom extension denial, OpenAI-labelled faux denial, live external registry replacement and reset.
- AI factory/registry/model/provider/faux owners **130 passed / 5 files**, bg_915, 2.99s. Final post-format matrix **134 passed / 6 files**, bg_919, 4.39s; exact pair mutation, copies, live model-map selection, external non-clobbering, faux and reset boundaries.
- Runtime adjacent operations **38 passed / 7 files**, bg_920, 4.94s: auth, Cloudflare compatibility, images/classifiers, dynamic provider and remote catalog controls.
- Actual Node runtime smoke observed native direct permission, replacement denial and actual custom dispatch, and faux history-only status. All assertions true, bg_918, 1.33s. No real HTTP or credentials used; script removed.
- First full check **1755 files, Fixed 3**, bg_916, 25.43s. Final **1755 files, No fixes applied**, bg_921, 22.46s; all dependency/type/browser-smoke gates passed.
- Protected daemon target: **749 paths, zero SHA256 mismatches**.

## Review and limits

NativeIdentityAudit: bounded correct, including final faux denial and external override dispatch ownership; source/test review only, no runs. Composer review follows its actual completed result. Graph project/generation/coverage unavailable (WeakMap initialization error); exact source fallback and LSP references used. Whole 44-commit migration remains open. Fixed committed-tree isolated aggregate follows normal unit commit.

## Review repair: both provider entry points

ComposedHistoryAudit found provider-level evidence tracked only streamSimple while non-simple runtime dispatch could use a replaced stream. Added actual mutation controls: **3 failed / 1 passed**, bg_922. Factory and composed provenance now record and validate the complete provider stream/streamSimple pair, in addition to the underlying API pair. Added a composed-provider mutation/restoration control. Runtime adjacent matrix **39 passed / 7 files**, bg_923, 13.62s. Reviewer reread the repair and returned bounded correct with no further findings, source-only. This deliberately tightens the frozen helper to match both current runtime entry points.

Post-repair AI matrix **134 passed / 6 files**, bg_925, 4.46s. Full check after pair fix **1755 files, Fixed 3 files**, bg_924, 37.48s. Internal capability details remain in this engineering review rather than becoming a supported SDK API paragraph; the public faux guide states only the transport distinction. Final no-fix check and fixed-tree aggregate follow.

Final check **1755 files, No fixes applied**, bg_926, 35.23s, all gates including browser smoke passed. No AgentSession tokenizer upload authorization change is claimed by this prerequisite commit.

## Fixed committed-tree aggregate

Source/test commit **a878d7569**, root isolated test.sh: **8432 passed / 0 failed / 936 skipped**, exit 0, **244.53s**, bg_928, artifact://3428. Normal commit hook passed **1755 files, No fixes applied**, bg_927, 41.24s. No source/test edits occurred during the aggregate; protected manifest 749 paths, zero mismatches. The following amendment is review-only.
