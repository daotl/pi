# Effective resource inventory review

## Scope and final chain

Parent `972920c0f`; frozen upstream `839dc79197595a4285d711e37d02fb623e5b6b7b`, backup `cb3bee033ba853041609b874303dc625d5d30479`. S4/parent UI final behavior from authored `0a9acad131b79844ce5afd677368090ef95684f7`, `26cb5df97f1fbe6266113f2a6be681605fca81cc`, subsequent source identity/refresh repairs through `65007d6c75cb16d08fbe47934e923bc53abaea1b`; final backup AgentSession 2408-2440, interactive resource identity/listing/completion/update paths and RPC get_commands. No whole-file replacement or import of old rendering architecture.

## Problem and implementation

Core rendered and dispatched saved skill metadata, while interactive completions/listings and RPC advertised freshly discovered disk metadata. Restored prompt info also claimed current file paths for opaque saved sections.

Expose copied effective skill metadata and effective context source path/label records. Track prompt source identity during rebuild and restore it on failed explicit updates. Opaque saved sections use honest unavailable-source labels; raw context files retain their saved paths. Interactive completions/listings/prompt info and RPC command inventory consume these APIs. Refresh installed completion providers and resource views after explicit updates and selected-path/transcript changes; an inventory identity avoids redundant refreshes. Loader diagnostics remain loader diagnostics.

## Runtime evidence

- Actual same DefaultResourceLoader, changed owned SKILL.md, file-backed reopen: corrected completion fixture reproduced disk description instead of saved description (**1 failed**, bg_899). Initial bg_898 used the wrong slash-prefixed completion item value and is fixture failure, not product proof.
- Installed completion provider now advertises saved metadata, then actual /update skills refreshes it to disk metadata. Navigating between saved and updated branches refreshes the installed provider too.
- Initial consumer cutover exposed obsolete test fixture contracts (bg_900, 24 failures); updated fixtures to the new public APIs, with no production fallback shim. Ownership/consumer matrix **81 passed / 5 files**, bg_901; installed refresh and navigation owners **64 passed / 5 files**, bg_903.
- RPC JSONL regression uses real disk skill path/description changes, saved-session reopen, full reload and explicit skill refresh. Added test crossed existing listener cleanup threshold: MaxListeners warnings in bg_902; cleanup now removes only listeners owned by each test run, without raising limits/suppressing warnings. Final **91 passed / 6 files**, bg_905, 9.70s, no warnings.
- Public metadata mutation tests protect nested sourceInfo and arrays. Source tests distinguish live files, saved raw context, opaque labels, explicit clear, and failed loader-update rollback. Existing private skill test access removed.
- Independent consumer review found the session-start listing fixture lacked the new contract; fixed its type and factory, not production. Final adjacent matrix **116 passed / 10 files**, bg_907, 11.95s, including RPC, inventory, status, update transactions, restore/skills, session-start, tree, compaction and selected-path owners.
- Actual 110x32 tmux TUI smoke: restored listing displayed Saved system prompt (source unavailable); /skill:al showed SAVED EFFECTIVE SKILL; exact /update skills then showed CURRENT DISK SKILL. First Ctrl-U input was garbled and accidentally prompted; not claimed as update proof. Cleared draft, sent exact command separately, observed update status and refreshed completion. Closed normally; script removed.
- Final npm run check **1751 files, No fixes applied**, bg_908, 11.90s; all dependency/type/browser-smoke gates passed. Earlier check formatting and listener type error chronology retained, not reported as clean runs.
- Protected daemon target: **749 paths, zero SHA256 mismatches**.

## Independent review and limits

EffectiveSourceAudit: bounded correct; source tracking, saved/current labels, defensive ownership and rollback match frozen final behavior. EffectiveConsumerAudit: sole session-start fixture finding resolved, final bounded correct. Both read-only, no runs.

No claim of exhaustive untrusted branch source-inventory coverage or broader transcript/footer/destructive-race/scheduler migration. Whole 44-commit task remains open. Fixed committed-tree isolated aggregate follows normal unit commit.

## Fixed committed-tree aggregate

Source/test commit **c230adf03**, root isolated test.sh: **8390 passed / 0 failed / 936 skipped**, exit 0, **101.25s**, bg_910, artifact://3382. Normal commit hook passed **1751 files, No fixes applied**, bg_909, 14.81s. No source/test edits occurred during the aggregate. Protected manifest reconfirmed 749 paths, zero mismatches. The following amendment is review-only.
