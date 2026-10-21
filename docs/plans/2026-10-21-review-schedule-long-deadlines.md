# Review: preserve long scheduled deadlines

Date: 2026-10-21
Migration base: `520fcb453`
Source: `778e0120` bounded timeout registration and due-time recheck (interactive diff:14-49). Later scheduler queue/preflight/cadence changes remain separately scoped.

## Problem and RED

Node timers clamp delays beyond signed 32-bit milliseconds to approximately 1ms. Current 30/60-day schedules fire immediately. Owning schedule suite RED: **1 failed / 20 passed**; fake-clock advancement by 1ms delivered long, cancelled and short entries rather than only short.

## Adaptation

Store the schedule before arming its timer. Clamp each wait to 2147483647ms and recheck the absolute deadline before dequeuing/delivery; re-arm remaining chunks when still early. Cancellation removes the entry/current timer, so later chunks cannot resurrect it. No date parser, calendar, preflight, queue or heartbeat cadence change.

## Verification

Schedule, heartbeat and startup trust suites: **93 passed**. Existing real scheduling methods run with fake time; 60-day delivery occurs exactly at its deadline, 30-day entry is cancelled between chunks, 1ms schedule delivers normally, queue ends empty. This is timer/runtime logic proof, not physical TUI rendering or real elapsed-month proof.

`npm run check` passed (1713 files; regression formatting applied). Post-format owning suites passed **93 tests** again.
