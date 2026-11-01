# @earendil-works/pi-env

Remote execution environments for [Pi Durable](../durable): an agent's tools run on another machine, usually over SSH,
while the Durable worker, its storage and credentials stay local.

- `pi-env` (`daemon/`): a small Rust program that runs on the remote machine. It speaks a framed protocol on stdin and
  stdout ([docs/protocol.md](docs/protocol.md)) and performs file operations and commands there.
- `RemoteExecutionEnv`: a Durable `ExecutionEnv` that talks to the daemon through a `Connection`. Its results match
  `NodeExecutionEnv` running on the remote machine; only error messages may differ
  ([docs/semantics.md](docs/semantics.md)).

```ts
import { acceptHostKey, connectSsh, RemoteExecutionEnv, scanHostKey, sshConnection } from "@earendil-works/pi-env";

const target = { host: "gpu-box", knownHostsFile: "/data/ssh/known_hosts", hostKeyAlias: "pi-env-gpu" };
// Once: show the host's key fingerprint to the owner, who compares it out of band and accepts it.
const { lines, fingerprints } = await scanHostKey(target);
await acceptHostKey(target, lines);

// Detects the remote system, deploys the daemon if missing (named by its SHA-256 and verified before every start),
// and returns a connection that starts it over ssh.
const { connection } = await connectSsh(target);
const env = new RemoteExecutionEnv({ connection, id: "pi-env:gpu", cwd: "/home/me/project" });

// Or lazily: nothing happens until the first operation, which detects, deploys and connects. A failure (no network,
// untrusted host key) is that operation's error, and the next operation tries again.
const lazy = sshConnection(target);
const lazyEnv = new RemoteExecutionEnv({ connection: lazy.connection, id: "pi-env:gpu", cwd: "/home/me/project" });
```

The package ships the daemon for every supported remote system in `bin/`. `ssh` runs with `BatchMode`, strict host-key
checking against the application's own known-hosts file under a fixed alias, no forwarding of any kind, no shared
connections or configured commands, and without forwarding the local locale. Inherited `KnownHostsCommand` and DNS
host-key trust are disabled; SSH configuration still supplies routing and jump hosts. On Windows, detection and
deployment go through PowerShell, and the daemon starts through the server's default shell (cmd.exe or PowerShell),
with its executable path quoted even when it contains no spaces.

Cancelling a request while detection, deployment or the daemon handshake is pending settles that request with
`aborted` without dispatching it. Other callers still share the same startup. Once dispatched, cancellation sends
`cancel` and waits for the daemon's result, including process cleanup.

`env.listFiles(path, options, context)` lists the tree below a directory in the daemon, as `fd --hidden --exclude .git`
does without following symbolic links: files, directories and links as relative `/` paths, skipping what git ignores
inside work trees, bounded by `maxEntries`, `maxBytes` and `timeoutMs` with a `truncated` flag, and stopped by aborting
the context. It is Durable's optional `ExecutionEnv.listFiles`. A daemon released before it reports `not_supported`
(`hello.features` lacks `listFiles`), and callers fall back to their own walk. For local sessions,
`LocalExecutionEnv` is `NodeExecutionEnv` plus `listFiles` through a daemon on the same machine:

```ts
const local = new Connection({ command: [localDaemon()] }); // owned by the caller; close() it at shutdown
const env = new LocalExecutionEnv({ cwd: "/home/me/project", connection: local });
const listing = await env.listFiles(".", { exclude: ["node_modules"] }, context);
// { ok: true, value: { entries: [{ path: "src", kind: "directory" }, { path: "src/a.ts", kind: "file" }], truncated } }
```

`nodePlatform(await connection.info())` gives the remote system in Node's names (`win32`, `darwin`, `x64`, `arm64`),
as `process.platform` and `process.arch` spell them.

`openTerminal(connection, options)` runs a program, by default the user's login shell, in a pseudo-terminal of the
daemon: raw output, input, resizing and its exit code, for interactive terminals. `localDaemon()` is the daemon for this
machine, for terminals without SSH (`new Connection({ command: [localDaemon()] })`). Terminals are not supported on
Windows yet.

Supported remote systems: Linux, macOS, Android (Termux) and Windows, on x86-64 and arm64. Windows execution requires Windows 10 / Server 2016 or newer with compatible nested-job policy. String commands run through Git Bash as `NodeExecutionEnv` runs them there; argv commands run directly.

Each Windows command is created inside its own noninheritable kill-on-close Job. Normal completion, cancellation and connection shutdown terminate remaining descendants and wait for the Job's active-process count to reach zero. Unsupported process-attribute or ambient-job configurations fail with `spawn_error`; there is no taskkill-only fallback. Process creation through an external service/broker is outside Job inheritance; this is not a sandbox for malicious same-user code.

On Unix, FIFO read opens use bounded daemon-owned helper queues, separate from ordinary file work. Cancellation interrupts the owning helper; queued requests can be cancelled without waiting for a worker. The standalone daemon reserves `SIGUSR2` for this purpose and refuses to replace a nondefault inherited handler. Actual blocking open preserves the writer rendezvous, including an empty writer; successful descriptors are transferred without reopening. Write-mode FIFO operations retain their existing blocking semantics.

## Development

`npm run build:daemon` builds the daemon with Cargo; the tests talk to `daemon/target/debug/pi-env` over a pipe, or to
the binary named by `PI_ENV_DAEMON` (CI tests the release builds this way). They run Durable's env conformance suite
against `RemoteExecutionEnv` and compare random operation sequences and Durable's tools against `NodeExecutionEnv` on
the same machine. `test/ssh-external.test.ts` runs the suite over a real SSH server when `PI_ENV_SSH_HOST` is set.

Local artifact production (`npm run pack:packages`) requires the release daemon assets under `packages/env/bin/` before packing this package. The artifact packer rejects missing or empty binaries instead of certifying an import-only package that cannot start an environment. Prepare the artifacts produced by `.github/workflows/env-daemons.yml` for Linux, Android, and macOS (`x64` and `arm64`, `pi-env`) and Windows (`x64` and `arm64`, `pi-env.exe`). A host debug daemon supplied through `PI_ENV_DAEMON` is a test override, not a substitute for this release matrix.

`npm run check:package-install` checks isolated installation, exports, SDK loading, and CLI identity only. It explicitly skips release-daemon completeness and reports that limit; it does not certify a deployable `pi-env` release. Production artifact commands retain the complete-asset check by default.

Local release tests honor `PI_ENV_DAEMON`. Without that override, release scripts build the host daemon with the repository's Rust toolchain into a temporary external Cargo target, pass its path to `test.sh`, and remove that temporary target afterward. They do not overwrite an existing checkout target directory.

Terminal close and connection shutdown terminate the daemon-owned terminal session's job-control processes, including HUP-ignoring background jobs. Closing the connection first ends daemon stdin so this cleanup can run; a bounded fallback terminates an unresponsive transport. POSIX session enumeration does not provide an atomic guarantee against descendants concurrently forking or deliberately leaving their session.
