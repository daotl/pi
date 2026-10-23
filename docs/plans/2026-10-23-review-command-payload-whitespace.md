# Review: preserve whitespace-sensitive command payload grammar

## Problem and final source chain

Parent `e85a1bba5`; fixed baseline `839dc79197595a4285d711e37d02fb623e5b6b7b`; backup `cb3bee033ba853041609b874303dc625d5d30479`. Own candidate #13 `aecd44347d2ada4e38b44f0fd8006bd881ae0872`, exact frozen patch1707-1727 and acceptance2144-2193 owns these two narrow grammar repairs. U03 same-name resource precedence is separately source-reconciled; no resource-loader redesign here.

`handleSystemPromptCommand` only recognized literal `set `, ignoring newline/tab prompt payloads despite submission preserving them. `handleCopyCommand` distinguished next-line literals from same-line quoted selectors, but numeric recognition ignored that distinction and treated `/copy\n42` as editable index42.

## Adaptation and controls

Match one whitespace character after set with `^set\s` and slice exactly the matched command prefix; retain internal prompt whitespace and existing bare-set information behavior. Add sameLine to numeric copy recognition; same-line0 remains an editable index, while next-line digits remain literal. No overall command-prefix grammar expansion, numeric range change, custom prompt authority change or clipboard implementation change.

Existing prompt-update suite calls the actual default submit callback for newline/tab/space, checks custom policy and the actual faux-provider request's system text, then verifies bare set leaves existing policy unchanged. Existing copy suite invokes the actual copy handler at the injected clipboard boundary for next-line42, space-before-newline0 and same-line0. Its new matrix uses no renderer/terminal instance; UI is an unused adapter on this branch.

## Verification chronology

- First attempt: **5 failed / 35 passed / 3.88s** included three theme-not-initialized fixture errors; these are not product RED. Theme initialization corrected the fixture.
- Valid current-source RED: **4 failed / 36 passed / 3.48s**. Two numeric next-line cases copied an indexed answer or copied nothing; newline/tab set did not establish custom policy. Existing same-line index, space-set and bare-set behavior controls passed where reached.
- After the two production branch changes: **40 passed / 2 files / 3.43s**.
- First check: **1765 / Fixed 2 / 19.32s**, all stages completed but emitted one useTemplate info. The owned string concatenation was changed to a template literal; infos are not ignored as a clean gate.
- An earlier formatted run/check passed40 and1765NoFixes. The new copy matrix was subsequently simplified to explicit same-line0 and an unused UI adapter, so those earlier results are not its final verification.
- Final owning run **40 passed / 2 files / 3.34s**; complete check **1765 / No fixes applied / 16.20s**. Permanent runtime cases exercise actual submit, policy persistence/request conversion and actual copy-handler selection with a clipboard test adapter; no separate smoke executable ran. A drafted SDK smoke was deleted unrun and supplies no evidence. No full-process Enter or real system clipboard proof.

## Review and delivery boundaries

Code review: skipped (ce-code-review unavailable). Host exposes skill reads but no skill invocation primitive. Independent bounded native source/proof reviews supplement verification, not portable CE/cross-model coverage; results follow actual delivery.

Owned source/two tests/sessions guide and this independent review only. No provider network, credentials, command error-boundary redesign, dependency/lock/generated/changelog changes. Normal explicit-path implementation commit precedes fixed-tree root aggregate; only review receipt amended afterward, preserving tested blobs and exact tested/final SHA. Full 44-candidate migration remains open.

CommandGrammarSourceReview and CommandGrammarProofReview completed independent bounded read-only review with **no actionable findings**. They confirmed exact frozen branch predicates, suffix preservation, real submit/Session/faux-request acceptance and minimal copy adapter controls. Neither executed verification. New prompt fixtures are in-memory (not disk-durability proof), no renderer is started by either new matrix, and full-process Enter/visual/system clipboard behavior remains unverified.

## Fixed committed-source/test aggregate

Normal explicit-path implementation commit `bfae0a760` includes exactly source/two tests/sessions guide/this review; hook passed **1765 / No fixes applied**. Root `rtk proxy ./test.sh` on that committed source/test tree passed **8610 / 0 failed / 936 skipped**, exit 0, **103.46s**, full output `artifact://4382`. No next-unit source/test changes occurred during execution. Following review-only amendment preserves product blobs and records aggregate against `bfae0a760`, not the future amended SHA. This closes the two U03 grammar adaptations, not the unknown family's remaining same-name evidence limitation or the full migration.
