# Review: reject normalized invalid schedule dates

Date: 2026-10-21
Migration base: `827f59f46`
Source: `aecd4434` schedule clock/calendar bounds (interactive diff:5-30).

## Problem and RED

Date silently normalizes impossible dates and out-of-range clock fields into different valid deadlines. Six parser rows failed: February 30, month 13, day 0, hour 24, minute 60 and second 60 (**6 failed / 21 skipped**).

## Adaptation

Reject clock fields outside 23:59:59, construct explicit local dates, and compare year/month/day back to requested values before accepting. Keep current local time, date-less next-day behavior and duration syntax. No DST policy or heartbeat parser change.

## Verification

Schedule and heartbeat suites initially passed **96 tests** after the production change. Additional command-path control invokes handleScheduleCommand with an impossible date and requires no accepted schedule, ID advance, timer or delivery. Existing valid absolute-date, duration and date-less cases remain positive controls. No physical TUI display claim.

Additional Gregorian boundary accepts 2400-02-29 and rejects 2300-02-29. Final post-format owning suites: **98 passed**. `npm run check` passed (1713 files; final regression formatting applied).
