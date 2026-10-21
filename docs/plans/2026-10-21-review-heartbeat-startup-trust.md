# Review: require project trust for automatic heartbeat loading

Date: 2026-10-21
Migration base: `c22adb1ec`
Source: `778e0120` root heartbeat trust discovery, trust prompt disclosure and automatic startup load guard. Existing stale-load/atomic-save/lifecycle repairs remain intact.

## Problem and RED

A root HEARTBEAT.md automatically schedules repository instructions even after project trust is declined; a heartbeat-only project also bypasses the trust decision because resource detection ignores the file. Current tests: **3 failed / 3 passed**. Automatic untrusted load and untrusted CLI combination both included repository instructions; root detection returned false. Trusted scheduling positive control already passed.

## Adaptation

Include only cwd-root HEARTBEAT.md in protected resource detection, disclose automatic scheduling in trust prompt/security guide, and gate automatic file loading on the resolved SettingsManager trust decision. Keep explicit /heartbeat load and CLI --heartbeat user actions unchanged. No trust store format, extension precedence, permissions or timer-policy change.

## Verification

Trust manager/selector, actual InteractiveMode startup run path, heartbeat lifecycle and heartbeat persistence/scheduling suites: **83 passed**. Startup fixture stubs initialization/input boundaries, uses VirtualTerminal and real file loader/scheduler; trusted heartbeat reaches actual faux AgentSession prompt and response, untrusted automatic mode schedules none, CLI still schedules bare continuation, explicit load still loads instructions. This is runtime behavior proof, not full visual TUI proof. No live provider/network request.

Additional real resolveProjectTrusted test verifies heartbeat-only projects ask, session-only allow/deny works, and stored denial bypasses further prompts: five suites **84 passed**. A temporary exact disclosure assertion in that real selector flow passed (**1 passed / 3 skipped**) and was removed afterward; no permanent test pins wording. Disclosure is exercised smoke evidence, distinct from retained decision-policy regression.

Final `npm run check` passed (1713 files; trust test formatting applied). Final post-format five owning suites: **84 passed**.
