# Semantics

The reference is Durable's `NodeExecutionEnv` (`packages/durable/src/env/node.ts`) on the remote machine. Durable's
env conformance suite and `test/differential.test.ts` check each rule below.

## Split of work

| Concern | Where |
|---|---|
| Path resolution: `~` (remote home), `file://`, relative to `cwd`; on Windows drive-relative paths against the remote's working directories | client, the remote system's `path` rules |
| Abort checkpoints of each method | client, as `NodeExecutionEnv` |
| Error code mapping (`ENOENT` → `not_found`, ...) | client, as `NodeExecutionEnv`'s `toFileError` |
| `readFile`'s read sizes, size limit and decoding (`StringDecoder`, byte-order mark kept) over the daemon's `open(path, "r")` | client |
| `writeFile` in 512 KiB writes with an abort check before each; `appendFile` without checks | client, over one open file |
| Line reader | client, positional reads and Durable's `StreamDecoder` |
| Watching: snapshots, native events, polling | daemon, a port of Durable's `NodeFileWatcher` |
| Timeout validation, result precedence (callback error, timeout, abort, spill failure, exit code) | client |
| System calls, processes, spill files, line scans | daemon |
| Command output decoding: per stream, WHATWG UTF-8, only a leading byte-order mark dropped | daemon (`encoding_rs`) |

## Rules the standard libraries do not follow

- Recursive `mkdir`: an existing directory is fine, an existing file fails with `EEXIST`, a file in the way of a parent
  fails with `ENOTDIR`. Writes create missing parents this way.
- `rm`: a missing path fails unless `force`; a directory without `recursive` fails with `ERR_FS_EISDIR`
  (`FileError` code `unknown`).
- `mkdtemp`: `mkdtemp(3)` of `<tmpdir>/<prefix>XXXXXX`; the prefix is joined with POSIX `path.join`, so `../x` works.
- `tmpdir`: `TMPDIR`, `TMP`, `TEMP`, then `/tmp` (Termux: `$PREFIX/tmp`), trailing slash removed.
- `listDir`: names in byte order, like libuv's `scandir`; fails if any entry cannot be lstat'ed. `openDirReader` keeps
  directory order, skips entries removed meanwhile, and fills each page after skipping. Names that are not UTF-8 are
  decoded with replacement characters and lstat'ed under that name, so they fail with `ENOENT` as in Node.
- `openBinaryReader`: nonblocking open; directories fail with `is_directory`, other non-regular files with `invalid`;
  `noFollow` refuses a final symbolic link (`O_NOFOLLOW`).
- `readBinaryFile`, `readTextFile` and `openTextLineReader` open any file like `open(path, "r")`: `/dev/null` reads
  empty, a FIFO blocks until it has a writer, and a directory fails when read (a line reader at `readLine`). A regular
  file is read up to its size at open; other files to their end. `readBinaryFile` and `readTextFile` check for
  cancellation after each reply, including a single-chunk binary read and unknown-size EOF, and close the file
  before returning an abort.
- Every Unix writer open uses a separate bounded, interruptible helper pool, even when metadata identifies a regular
  or missing destination: pathname replacement with a FIFO cannot trap an ordinary worker. Parent creation and
  write/append flags are preserved. Connected special-file writes are nonblocking and cancellable. Waiting writers
  do not occupy ordinary file workers or reader-open helpers. Saturated reader/writer rendezvous pools reject new
  opens with `EMFILE`; successful descriptors preserve rendezvous and append behavior without reopening. Chunks stay
  ordered per handle.
- The remote line reader scans decoded fragments once and joins only when returning a line, including a final
  unterminated line. UTF-8 decoding and cancellation checkpoints remain streaming.
- `listFiles` has no `NodeExecutionEnv` counterpart: the daemon implements it for remote and local environments
  alike (`LocalExecutionEnv` runs a daemon on the same machine), so both list with the same code. Unlike `fd`,
  symbolic links are not followed; unlike `git ls-files`, a tracked file that matches an ignore rule is left out.
  Abort and timeout checkpoints include directory enumeration and ignored or excluded entries, not just emitted
  paths. A timeout returns `truncated: true`; an abort fails with `aborted`. Completed listings remain depth first
  with siblings in name order.
- `readBinaryFile` returns a `Buffer`, reader reads a plain `Uint8Array`, as Node does.
- Windows: error codes are libuv's translations; `rm` of a symbolic link or junction to a directory removes the link;
  creating a file where a directory exists fails with `EISDIR`; modification times before 1970 are negative.
- Remote metadata waits used for path resolution, temporary paths and `listFiles` feature detection are abortable,
  including an explicit command `cwd`. An already-aborted file operation does not start a connection; aborting one
  startup waiter does not cancel the shared connection startup needed by other callers.

## Commands

- A string runs through the shell: a configured `shellPath` that does not exist (following links) fails with
  `shell_unavailable`; otherwise `/bin/bash`, `which bash`, then `sh`, with `-c`. An argv array runs its program
  directly; on Windows it is searched like libuv does (working directory, then `PATH`, adding `.com` and `.exe`), and
  batch files are refused.
- The working directory must exist (`spawn_error`).
- Environment: with `inheritEnv` (default), the daemon's environment, then `shellEnv`, then `env`; without it, only
  `env`.
- Each command gets a new session (process group), default signal dispositions and an empty signal mask. Timeout,
  abort and `cleanup()` kill the group with `SIGKILL`.
- After the process exits, output is still collected until both pipes end, or 100 ms pass without output; the timeout
  still applies meanwhile. The pipes are closed when the command settles, even if a descendant keeps them open.
- An abort settles as `aborted`, including an abort raised by the final output callback after the daemon exited. A callback error takes precedence, and a daemon timeout remains `timeout`. Abort and timeout failures preserve any spill path. `cleanup()` kills dispatched commands without aborting, so they settle with exit code 137. Commands still resolving their working directory or waiting for connection startup are cancelled with `aborted` and never dispatched; cleanup does not wait for or close the shared connection, so other environments remain usable.
- A process killed by a signal reports `128 + signal`.
- On Windows, terminating a running command's Job uses status 137. Normal leader exit retains its original status
  while remaining descendants are terminated and joined.
- Spill: once the output crosses `spill.afterBytes` or `spill.afterLines` (counted over raw chunks in arrival order, as
  Node counts), the complete raw output goes to `pi-output-<uuid>.log` in a fresh `tmp-` directory.

## Watching

- The daemon runs Durable's `NodeFileWatcher` next to the files: native events (inotify, FSEvents) only trigger a
  debounced rescan, and changes are the difference between snapshots plus the event paths. Reads are not events.
- Windows and network or FUSE file systems poll, as `NodeExecutionEnv` does; running out of native watches switches to
  polling and reports `overflow`.
- When the connection is lost, the client opens the watcher again once a new daemon starts and reports `overflow`.
