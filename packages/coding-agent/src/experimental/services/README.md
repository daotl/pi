# Experimental client/server service slices

Services are native Chord contracts declared with `local`, `remote`, and `method`. Hosts load facets with `defineFacet` and serve their contracts; consumers acquire references through `Host.get()` or `Ctx.get()`. Server and Session routes carry native frames over protocol version 9. Without a selected Session, Session contracts are unavailable; attachment hydration acquires `SessionPlugins` before marking the source attached.

Run the source-only server and client from the repository root:

```bash
PI_EXPERIMENTAL=1 ./pi-test.sh server
PI_EXPERIMENTAL=1 ./pi-test.sh client
```

`PI_SERVER_DIR` overrides the server profile and socket directory, which defaults to `~/.pi/server`. `PI_SERVER_ID` selects the logical server ID when `--server-id` is omitted. The server, client, and experimental package subpaths are excluded from npm packages and standalone binaries.

| Scope | Service | Current slice | Continuation point |
|---|---|---|---|
| server | `SessionDirectory` | replicated state implemented | add authenticated per-client projection when identity lands |
| server | `SessionManagement` | create, remove, attach, detach implemented | add authenticated workspace authorization |
| server | `PresentationPlugins` | prepares the selected Session branch's matching TUI artifacts and reloads that branch | add authenticated plugin policy |
| session | `SessionPlugins` | reloads the configured Session facet generation | add coordinated multi-worker reload reporting |
| session | `Models` | state, default-persisting selection, thinking, refresh implemented | move provider/auth composition behind plugin facets |
| session | `AgentController` | presentation-safe `AgentLane` facade for prompting, queueing, abort, resume, compaction, and navigation | add new lane operations only when a presentation requires them |
| session | `Transcript` | replicated lane state with source-event metadata | add projections only when another presentation needs them |
| presentation | `SlashCommands` | process-local contribution registry with model, thinking, compact, reload, and example hello commands | add more presentation hookpoints only as concrete plugin slices require them |
| presentation | `PresentationUI` | process-local selection and status capabilities | add narrowly scoped UI capabilities only when commands require them |

`ServerServiceSource.connection` and `SessionServiceSource.attachment` are implemented local control states. Session directory, creation, and address DTOs are owned by these coding-agent service contracts rather than `pi-protocol`; the transport treats their payloads as opaque service data.

With `PI_EXPERIMENTAL=1`, an interactive `pi client` creates and attaches a Session before opening the service-only chat TUI. `pi client -c` and `pi client -r` attach the newest existing Session instead, preserving its durable model and thinking configuration. Model selection is available on demand through `/model`; it is never a startup screen. The presentation always uses the stable coding agent's alternate-screen renderer and shared transcript/dock viewport. It loads configured theme resources and uses the stable terminal light/dark detection and appearance-change notifications. Its replicated state feeds the stable editor, message, tool, status, theme, and tool-renderer components. The presentation drives the worker-owned main lane through `AgentController` and renders the `Transcript` service's complete replicated value while controller calls are pending. The provider remains the sole Harness reducer and mutates Transcript's tracked snapshot before publishing each event. Chord flushes compact operations once per publication, while each client/state pairing encodes them with an independent path dictionary. Chord reconstructs presentation replicas and owns hydration, sequencing, and gap detection.

A foreground server uses repeatable `-e` options to establish its default Session and TUI facets. A local client can select packages for its Session branch without changing other workers or server defaults. The application bundles conventional `src/session.ts` and `src/tui.ts` entries with esbuild into separately owned ESM artifacts and integrity-checked `pi-plugin-facets.json` manifests. Chord's `nodeLoader` loads these facets. `/reload` builds candidates, applies `Host.reload()`, and disposes retired plugin generations. Built-in facet factories receive `AgentLane`, `ModelRuntime`, and `SettingsManager` directly; these implementation dependencies are not remote services.

Native references preserve their contract across compatible reloads. Local presentation contracts such as `SlashCommands` and `PresentationUI` stay inside the presentation host. Server and Session contracts are routed to their owning hosts; principals and attachment identities are validated at those boundaries. Session attachment release awaits matching plugin resource cleanup, including cleanup already started by link loss, before acknowledging demand removal. Native endpoint closure propagates as a scoped terminal frame through the worker manager so pending calls fail promptly rather than waiting for heartbeat expiry.

`Transcript` contract version 3 publishes an authoritative snapshot, an independent `sequence` high-water cursor, and at most 256 replay records within 1 MiB of UTF-8 JSON. Assistant progress records carry identity-bearing `AssistantMessageFrame` deltas rather than cumulative prefixes. `TranscriptReplay` hydrates at the current cursor and reconstructs the existing cumulative event callbacks; an evicted or oversized record causes an explicit replay-window error. Reconnect before submitting again after that error. Mid-response hydration includes the exact unfinished tool-argument decoder checkpoint and response frame cursor captured by the lane, not JSON guessed from parsed arguments. Update all experimental peers together.

The example package `examples/plugins/pi-example-plugin/` contributes `/hello` through its TUI facet. Facets use native `serve` and `self.get` declarations, and command invocations receive native `Ctx`. `ExperimentalClientTui` owns terminal rendering, state subscriptions, navigation, and action dispatch; transport links remain internal infrastructure. A reusable Client shares one presentation host across its service sources. When the final source is released while disconnected, that host retires and removes its connection subscription; connected zero-reference hosts remain reusable until disconnect.
