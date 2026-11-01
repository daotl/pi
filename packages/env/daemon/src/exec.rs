//! `exec`: Durable's `NodeExecutionEnv.exec` semantics (docs/semantics.md), output streamed as `output` events.

use crate::decode::StreamDecoder;
use crate::errors::Failure;
use crate::frame::{EVENT, Frame};
use crate::output::Output;
use crate::sys;
use crate::window::{Pending, Window, duration_ms};
use serde_json::{Map, Value, json};
#[cfg(unix)]
use std::collections::HashSet;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::process::ExitStatus;
#[cfg(unix)]
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const EXIT_STDIO_GRACE: Duration = Duration::from_millis(100);
/// How often a delivery waiting for the link to drain looks again.
const UNSENT_POLL: Duration = Duration::from_millis(20);

/// Raw pipe bytes waiting for decoding/spilling, independently of the downstream output window.
const RAW_LIMIT: usize = 1024 * 1024;

#[derive(Default)]
pub struct RawOutput {
    bytes: AtomicUsize,
}

/// The queued message owns its reservation until it is consumed or the receiver is dropped.
pub struct RawPermit {
    output: Arc<RawOutput>,
    bytes: usize,
}

impl Drop for RawPermit {
    fn drop(&mut self) {
        self.output.bytes.fetch_sub(self.bytes, Ordering::SeqCst);
    }
}

impl RawOutput {
    pub fn send(
        self: &Arc<Self>,
        stream: usize,
        bytes: &[u8],
        sender: &Sender<Message>,
        stop: &AtomicBool,
        paused: &AtomicUsize,
    ) -> bool {
        paused.fetch_add(1, Ordering::SeqCst);
        loop {
            if stop.load(Ordering::SeqCst) {
                paused.fetch_sub(1, Ordering::SeqCst);
                return false;
            }
            let queued = self.bytes.load(Ordering::SeqCst);
            if queued + bytes.len() <= RAW_LIMIT {
                if self.bytes.compare_exchange(queued, queued + bytes.len(), Ordering::SeqCst, Ordering::SeqCst).is_ok() {
                    break;
                }
            } else {
                thread::sleep(UNSENT_POLL);
            }
        }
        paused.fetch_sub(1, Ordering::SeqCst);
        let permit = RawPermit { output: self.clone(), bytes: bytes.len() };
        sender.send(Message::Data(stream, bytes.to_vec(), permit)).is_ok()
    }
}
/// Creation and registration share the shutdown lock, including commands still preparing to spawn.
#[cfg(unix)]
#[derive(Default)]
pub struct ProcessGroups {
    pub stopping: bool,
    pub pids: HashSet<u32>,
}

#[cfg(unix)]
pub type Groups = Arc<Mutex<ProcessGroups>>;
#[cfg(windows)]
pub type Groups = sys::ProcessGroups;

pub enum Message {
    Data(usize, Vec<u8>, RawPermit),
    Eof(usize),
    Exit(ExitStatus),
    WaitFailed(String),
    /// Abort: the command settles as `aborted`.
    Cancel,
    /// Kill without aborting, as `cleanup()` does: the command settles with the killed process's status.
    Kill,
}

/// Cancellation of one request, registered before the request runs so a cancel that arrives first is not lost.
#[derive(Default)]
pub struct Control {
    pub aborted: AtomicBool,
    pub killed: AtomicBool,
    sender: Mutex<Option<Sender<Message>>>,
}

impl Control {
    pub fn cancel(&self, kill: bool) {
        let sender = self.sender.lock().unwrap();
        if kill {
            self.killed.store(true, Ordering::SeqCst);
        } else {
            self.aborted.store(true, Ordering::SeqCst);
        }
        if let Some(sender) = sender.as_ref() {
            let _ = sender.send(if kill { Message::Kill } else { Message::Cancel });
        }
    }

    pub fn attach(&self, sender: Sender<Message>) {
        *self.sender.lock().unwrap() = Some(sender);
    }
}

pub struct ExecRequest {
    pub command: Option<String>,
    pub argv: Option<Vec<String>>,
    pub cwd: String,
    pub env: Map<String, Value>,
    pub inherit_env: bool,
    pub shell_path: Option<String>,
    pub timeout: Option<Duration>,
    pub spill: Option<(u64, u64)>,
    pub window: Option<Window>,
}

impl ExecRequest {
    pub fn from_json(json: &Value) -> Result<ExecRequest, Failure> {
        let strings = |value: &Value| -> Option<Vec<String>> {
            value
                .as_array()?
                .iter()
                .map(|item| item.as_str().map(str::to_string))
                .collect()
        };
        Ok(ExecRequest {
            command: json["command"].as_str().map(str::to_string),
            argv: strings(&json["argv"]),
            cwd: json["cwd"]
                .as_str()
                .ok_or_else(|| Failure::new("EINVAL", "exec needs cwd"))?
                .to_string(),
            env: json["env"].as_object().cloned().unwrap_or_default(),
            inherit_env: json["inheritEnv"].as_bool().unwrap_or(true),
            shell_path: json["shellPath"].as_str().map(str::to_string),
            timeout: json.get("timeoutMs")
                .map(|value| duration_ms(value, "timeoutMs"))
                .transpose()?,
            spill: json["spill"].as_object().and_then(|spill| {
                Some((
                    spill.get("afterBytes")?.as_u64()?,
                    spill.get("afterLines")?.as_u64()?,
                ))
            }),
            window: Window::from_json(&json["window"])?,
        })
    }
}

#[cfg(unix)]
pub fn kill_group(pid: u32) {
    sys::kill_tree(pid);
}

fn random_uuid() -> String {
    let mut bytes = sys::random_bytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

/// Spill of the complete raw output, started once it crosses either threshold, like Node's.
struct Spill {
    after_bytes: u64,
    after_lines: u64,
    seen_bytes: u64,
    seen_newlines: u64,
    prefix: Vec<Vec<u8>>,
    file: Option<File>,
    path: Option<String>,
    failed: Option<String>,
}

impl Spill {
    fn push(&mut self, chunk: &[u8], tmpdir: &str) {
        if self.failed.is_some() || chunk.is_empty() {
            return;
        }
        if self.file.is_none() {
            self.seen_bytes += chunk.len() as u64;
            self.seen_newlines += chunk.iter().filter(|byte| **byte == b'\n').count() as u64;
            let lines = self.seen_newlines + u64::from(chunk.last() != Some(&b'\n'));
            if self.seen_bytes <= self.after_bytes && lines <= self.after_lines {
                self.prefix.push(chunk.to_vec());
                return;
            }
            if let Err(error) = self.start(tmpdir) {
                self.failed = Some(error);
                return;
            }
        }
        if let Some(file) = &mut self.file
            && let Err(error) = file.write_all(chunk)
        {
            self.failed = Some(error.to_string());
        }
    }

    /// `createTempFile({ prefix: "pi-output-", suffix: ".log" })`: a fresh `tmp-` directory holding the file.
    fn start(&mut self, tmpdir: &str) -> Result<(), String> {
        let prefix = Path::new(tmpdir)
            .join("tmp-")
            .to_string_lossy()
            .into_owned();
        let directory = sys::mkdtemp(&prefix).map_err(|error| error.to_string())?;
        let path = Path::new(&directory)
            .join(format!("pi-output-{}.log", random_uuid()))
            .to_string_lossy()
            .into_owned();
        let mut file = OpenOptions::new()
            .append(true)
            .create(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        for chunk in self.prefix.drain(..) {
            file.write_all(&chunk).map_err(|error| error.to_string())?;
        }
        self.file = Some(file);
        self.path = Some(path);
        Ok(())
    }
}

#[cfg(unix)]
fn spawn(
    request: &ExecRequest,
    program: &str,
    args: &[String],
    piped_stdin: bool,
    groups: &Groups,
) -> std::io::Result<Child> {
    let mut command = Command::new(program);
    command
        .current_dir(&request.cwd)
        .stdin(if piped_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    sys::configure(&mut command, args, &request.env, request.inherit_env);
    let mut groups = groups
        .lock()
        .map_err(|_| std::io::Error::other("process ownership lock poisoned"))?;
    if groups.stopping {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "the connection has ended",
        ));
    }
    let child = command.spawn()?;
    groups.pids.insert(child.id());
    Ok(child)
}

/// Read one pipe on its own thread. Without an output window, reading waits while too much output is unsent.
fn spawn_reader(
    stream: usize,
    pipe: impl sys::Pipe + Send + 'static,
    sender: Sender<Message>,
    stop: Arc<AtomicBool>,
    output: Option<Arc<Output>>,
    raw: Arc<RawOutput>,
    paused: Arc<AtomicUsize>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        sys::read_pipe(pipe, &stop, |bytes| {
            let delivered = raw.send(stream, bytes, &sender, &stop, &paused);
            if let Some(output) = &output {
                output.wait_for_room(&stop, &paused);
            }
            delivered
        });
        let _ = sender.send(Message::Eof(stream));
    })
}

fn output_frame(id: u32, stream: &str, text: String, skipped: Option<Value>) -> Frame {
    let mut json = json!({ "kind": "output", "stream": stream });
    if let Some(skipped) = skipped {
        json["skipped"] = skipped;
    }
    Frame::with_payload(EVENT, id, json, text.into_bytes())
}

/// Run one command, sending output events for request `id`, until it settles.
pub fn run(
    id: u32,
    request: ExecRequest,
    tmpdir: &str,
    output: &Arc<Output>,
    control: &Control,
    groups: &Groups,
) -> Result<Value, Failure> {
    run_with_shell(
        id,
        request,
        tmpdir,
        output,
        control,
        groups,
        sys::shell_config,
    )
}

fn run_with_shell(
    id: u32,
    mut request: ExecRequest,
    tmpdir: &str,
    output: &Arc<Output>,
    control: &Control,
    groups: &Groups,
    shell_config: impl FnOnce(Option<&str>) -> Result<sys::ShellConfig, Failure>,
) -> Result<Value, Failure> {
    // A skipped sample must carry its exclusion proof in one frame. Larger windows use
    // ordinary bounded reader chunks with the existing output-queue backpressure.
    request.window = request.window.filter(|window| window.max_bytes <= crate::frame::MAX_PAYLOAD - 4);
    let (sender, receiver) = mpsc::channel();
    control.attach(sender.clone());
    if control.aborted.load(Ordering::SeqCst) {
        return Err(Failure::new("aborted", "aborted"));
    }
    // A string runs through the shell (as its last argument, or on stdin for legacy WSL bash); argv runs directly.
    let (program, args, stdin_command) = match (request.command.take(), &request.argv) {
        (Some(command), _) => {
            let shell = shell_config(request.shell_path.as_deref())?;
            let mut args = shell.args;
            if shell.command_on_stdin {
                (shell.program, args, Some(command))
            } else {
                args.push(command);
                (shell.program, args, None)
            }
        }
        (None, Some(argv)) => match argv.split_first() {
            Some((first, rest)) => (first.clone(), rest.to_vec(), None),
            None => return Err(Failure::new("spawn_error", "Empty argv: no program to run")),
        },
        (None, None) => return Err(Failure::new("EINVAL", "exec needs command or argv")),
    };
    if !Path::new(&request.cwd).exists() {
        return Err(Failure::new(
            "spawn_error",
            format!(
                "Working directory does not exist: {}\nCannot execute bash commands.",
                request.cwd
            ),
        ));
    }
    // Validate the deadline before creating a process that an invalid request would otherwise abandon.
    let deadline = request.timeout.map(|timeout| {
        Instant::now().checked_add(timeout)
            .ok_or_else(|| Failure::new("EINVAL", "timeoutMs exceeds the clock range"))
    }).transpose()?;
    #[cfg(unix)]
    let child = spawn(&request, &program, &args, stdin_command.is_some(), groups);
    #[cfg(windows)]
    let child = sys::spawn_process(
        &program,
        &args,
        &request.cwd,
        &request.env,
        request.inherit_env,
        stdin_command.is_some(),
        groups,
    );
    let mut child = child.map_err(|error| Failure::new("spawn_error", error.to_string()))?;
    #[cfg(windows)]
    let job = child.job.clone();
    #[cfg(unix)]
    let pid = child.id();
    let stop = Arc::new(AtomicBool::new(false));
    // Without a window, output is not coalesced; reading then waits for the link.
    let gate = if request.window.is_none() {
        Some(output.clone())
    } else {
        None
    };
    let paused = Arc::new(AtomicUsize::new(0));
    let raw = Arc::new(RawOutput::default());
    let readers = [
        spawn_reader(
            0,
            child.stdout.take().unwrap(),
            sender.clone(),
            stop.clone(),
            gate.clone(),
            raw.clone(),
            paused.clone(),
        ),
        spawn_reader(
            1,
            child.stderr.take().unwrap(),
            sender.clone(),
            stop.clone(),
            gate,
            raw,
            paused.clone(),
        ),
    ];
    // Readers and cancellation/deadline tracking must be live before a script can fill stdin.
    let writer = stdin_command
        .zip(child.stdin.take())
        .map(|(command, stdin)| {
            let stop = stop.clone();
            thread::spawn(move || sys::write_stdin(stdin, command.as_bytes(), &stop))
        });
    let waiter = sender.clone();
    thread::spawn(move || {
        let _ = waiter.send(match child.wait() {
            Ok(status) => Message::Exit(status),
            Err(error) => Message::WaitFailed(error.to_string()),
        });
    });
    drop(sender);

    let mut decoders = [StreamDecoder::new(), StreamDecoder::new()];
    let mut spill = request.spill.map(|(after_bytes, after_lines)| Spill {
        after_bytes,
        after_lines,
        seen_bytes: 0,
        seen_newlines: 0,
        prefix: Vec::new(),
        file: None,
        path: None,
        failed: None,
    });
    let mut pending = request.window.map(Pending::new);
    let unsent = Arc::new(AtomicUsize::new(0));
    let names = ["stdout", "stderr"];
    let emit = |pending: &mut Option<Pending>, stream: usize, text: String| {
        if text.is_empty() {
            return;
        }
        match pending {
            Some(pending) => pending.push(names[stream], text),
            None => output.bulk(output_frame(id, names[stream], text, None), None),
        }
    };
    let deliver = |pending: &mut Pending| {
        for event in pending.take() {
            output.bulk(
                output_frame(id, event.stream, event.text, event.skipped),
                Some(unsent.clone()),
            );
        }
    };
    let mut ended = [false, false];
    let mut status: Option<Result<ExitStatus, String>> = None;
    let mut idle_until: Option<Instant> = None;
    let mut timed_out = false;
    let mut aborted = false;
    let mut killed = false;
    #[cfg(windows)]
    let mut cleanup_error = None;
    #[cfg(unix)]
    let kill = |killed: &mut bool| {
        if !*killed {
            *killed = true;
            kill_group(pid);
        }
    };
    #[cfg(windows)]
    let mut kill = |killed: &mut bool| {
        if !*killed {
            *killed = true;
            if let Err(error) = job.terminate_and_wait() {
                cleanup_error = Some(error);
            }
        }
    };
    if control.killed.load(Ordering::SeqCst) {
        kill(&mut killed);
    }
    loop {
        let now = Instant::now();
        if status.is_some() && !killed && paused.load(Ordering::SeqCst) > 0 {
            idle_until = Some(now + EXIT_STDIO_GRACE);
        }
        // Node's timer stays armed until the command settles, including the grace period after exit.
        if !timed_out && deadline.is_some_and(|deadline| now >= deadline) {
            timed_out = true;
            kill(&mut killed);
        }
        if status.is_some() && ended[0] && ended[1] {
            break;
        }
        if idle_until.is_some_and(|idle| now >= idle) {
            // A descendant may hold the pipes open after the process exited; stop waiting for it.
            break;
        }
        if let Some(pending) = &mut pending
            && !pending.is_empty()
            && pending.ready_in(now).is_zero()
            && unsent.load(Ordering::SeqCst) == 0
        {
            deliver(pending);
        }
        let mut wait = if status.is_some() && pending.is_none() {
            UNSENT_POLL
        } else {
            Duration::from_secs(3600)
        };
        if let Some(deadline) = deadline.filter(|_| !timed_out) {
            wait = wait.min(deadline.saturating_duration_since(now));
        }
        if let Some(idle) = idle_until {
            wait = wait.min(idle.saturating_duration_since(now));
        }
        if let Some(pending) = pending.as_ref().filter(|pending| !pending.is_empty()) {
            wait = wait.min(if unsent.load(Ordering::SeqCst) > 0 {
                UNSENT_POLL
            } else {
                pending.ready_in(now)
            });
        }
        match receiver.recv_timeout(wait) {
            Ok(Message::Data(stream, bytes, _permit)) => {
                emit(&mut pending, stream, decoders[stream].decode(&bytes, false));
                if let Some(spill) = &mut spill {
                    spill.push(&bytes, tmpdir);
                    if spill.failed.is_some() {
                        kill(&mut killed);
                    }
                }
                if status.is_some() {
                    idle_until = Some(Instant::now() + EXIT_STDIO_GRACE);
                }
            }
            Ok(Message::Eof(stream)) => ended[stream] = true,
            Ok(Message::Exit(exit)) => {
                status = Some(Ok(exit));
                idle_until = Some(Instant::now() + EXIT_STDIO_GRACE);
            }
            Ok(Message::WaitFailed(error)) => {
                status = Some(Err(error));
                idle_until = Some(Instant::now());
            }
            Ok(Message::Cancel) => {
                aborted = true;
                kill(&mut killed);
            }
            Ok(Message::Kill) => kill(&mut killed),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    #[cfg(unix)]
    // Preserve the saved leader status, but retain ownership until its remaining descendants are killed.
    kill_group(pid);
    #[cfg(windows)]
    {
        // A normal leader exit does not transfer ownership of its descendants to the client.
        // Keep the job registered until termination of the whole tree has completed.
        if let Err(error) = sys::finish_job(groups, &job) {
            cleanup_error = Some(error);
        }
    }
    // Like Node destroying its streams: stop reading, so the pipes close even if a descendant still holds them.
    stop.store(true, Ordering::SeqCst);
    // Repeat interruption until each worker exits: on Windows a worker can enter a synchronous I/O call between
    // observing stop and the first CancelSynchronousIo. Joining prevents pipe handles or threads outliving exec.
    for worker in readers.into_iter().chain(writer) {
        while !worker.is_finished() {
            sys::interrupt_pipe(&worker);
            thread::sleep(Duration::from_millis(1));
        }
        let _ = worker.join();
    }
    #[cfg(unix)]
    groups.lock().unwrap().pids.remove(&pid);
    emit(&mut pending, 0, decoders[0].decode(&[], true));
    emit(&mut pending, 1, decoders[1].decode(&[], true));
    if let Some(pending) = &mut pending
        && !pending.is_empty()
    {
        deliver(pending);
    }
    let spill_path = spill.as_ref().and_then(|spill| spill.path.clone());
    let with_spill = |failure: Failure| match &spill_path {
        Some(path) => failure.extra(json!({ "spillPath": path })),
        None => failure,
    };
    #[cfg(windows)]
    if let Some(error) = cleanup_error {
        return Err(with_spill(Failure::new(
            "spawn_error",
            format!("Failed to clean process tree: {error}"),
        )));
    }
    if timed_out {
        return Err(with_spill(Failure::new("timeout", "timeout")));
    }
    if aborted {
        return Err(with_spill(Failure::new("aborted", "aborted")));
    }
    if let Some(error) = spill.as_ref().and_then(|spill| spill.failed.clone()) {
        return Err(Failure::new(
            "unknown",
            format!("Failed to preserve complete shell output: {error}"),
        ));
    }
    let status = match status {
        Some(Ok(status)) => status,
        Some(Err(error)) => return Err(Failure::new("spawn_error", error)),
        None => {
            return Err(Failure::new(
                "spawn_error",
                "process did not report its exit",
            ));
        }
    };
    let mut result = json!({ "exitCode": sys::exit_code(status) });
    if let Some(path) = spill_path {
        result["spillPath"] = json!(path);
    }
    Ok(result)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn normal_leader_exit_cleans_background_children_without_changing_its_status() {
        let root = sys::mkdtemp(&format!("{}/pi-env-background-", sys::tmpdir())).unwrap();
        let request = ExecRequest::from_json(&json!({
            "command": "sleep 30 >/dev/null 2>&1 & echo $! > child; exit 23",
            "cwd": root,
        })).unwrap();
        let groups: Groups = Arc::default();
        let result = run(1, request, &root, &Arc::new(Output::default()), &Control::default(), &groups).unwrap();
        let pid: i32 = std::fs::read_to_string(Path::new(&root).join("child")).unwrap().trim().parse().unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let alive = loop {
            // An orphan can remain as a zombie until the host reaper runs; zombies cannot execute or retain pipes.
            let state = Command::new("/bin/ps").args(["-p", &pid.to_string(), "-o", "stat="]).output().unwrap();
            let state = String::from_utf8_lossy(&state.stdout);
            let alive = state.split_whitespace().any(|state| !state.starts_with('Z'));
            if !alive || Instant::now() >= deadline { break alive; }
            thread::sleep(Duration::from_millis(5));
        };
        // Also clean the fixture when run against the defective implementation.
        unsafe { libc::kill(pid, libc::SIGKILL); }
        std::fs::remove_dir_all(root).unwrap();
        assert_eq!(result["exitCode"], 23);
        assert!(groups.lock().unwrap().pids.is_empty());
        assert!(!alive, "background child survived the completed command");
    }

    #[test]
    fn full_raw_handoff_does_not_block_control_or_reader_shutdown() {
        let raw = Arc::new(RawOutput::default());
        let stop = Arc::new(AtomicBool::new(false));
        let paused = Arc::new(AtomicUsize::new(0));
        let (sender, receiver) = mpsc::channel();
        let chunk = vec![0; 64 * 1024];
        for _ in 0..RAW_LIMIT / chunk.len() {
            assert!(raw.send(0, &chunk, &sender, &stop, &paused));
        }
        let worker = {
            let raw = raw.clone();
            let stop = stop.clone();
            let paused = paused.clone();
            let sender = sender.clone();
            thread::spawn(move || raw.send(0, &chunk, &sender, &stop, &paused))
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        while paused.load(Ordering::SeqCst) == 0 {
            assert!(Instant::now() < deadline);
            thread::yield_now();
        }
        let control = Control::default();
        control.attach(sender.clone());
        control.cancel(false);
        assert!(sender.send(Message::Eof(0)).is_ok());
        use std::os::unix::process::ExitStatusExt;
        assert!(sender.send(Message::Exit(ExitStatus::from_raw(23 << 8))).is_ok());
        // Shutdown joins readers before draining/dropping the receiver; a full raw queue must not retain them.
        stop.store(true, Ordering::SeqCst);
        while !worker.is_finished() {
            assert!(Instant::now() < deadline, "raw reader remained blocked during shutdown");
            thread::yield_now();
        }
        assert!(!worker.join().unwrap());
        let mut received = 0;
        for _ in 0..RAW_LIMIT / (64 * 1024) {
            let Message::Data(_, bytes, _permit) = receiver.try_recv().unwrap() else { panic!("missing raw data"); };
            received += bytes.len();
        }
        assert_eq!(received, RAW_LIMIT);
        assert!(matches!(receiver.try_recv().unwrap(), Message::Cancel));
        assert!(matches!(receiver.try_recv().unwrap(), Message::Eof(0)));
        assert!(matches!(receiver.try_recv().unwrap(), Message::Exit(status) if status.code() == Some(23)));
        assert_eq!(raw.bytes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn oversized_output_window_stops_reading_when_the_output_link_is_full() {
        let root = sys::mkdtemp(&format!("{}/pi-env-backpressure-", sys::tmpdir())).unwrap();
        let output = Arc::new(Output::default());
        // A prior request fills the real output queue. No writer runs until this request settles.
        output.bulk(Frame::with_payload(EVENT, 0, json!({}), vec![0; 4 * 1024 * 1024 + 1]), None);
        let request = ExecRequest::from_json(&json!({
            "command": "head -c 33554432 /dev/zero; printf completed > marker",
            "cwd": root,
            "timeoutMs": 500,
            "window": {
                "maxBytes": 32000000, "maxLines": 1000000,
                "minIntervalMs": 60000, "bytesPerSecond": 1000000,
            },
        })).unwrap();
        // The real execution deadline bounds a stalled pipe; no guessed sleeps or polling are needed.
        let result = run(10, request, &sys::tmpdir(), &output, &Control::default(), &Arc::default());
        let completed = Path::new(&root).join("marker").exists();
        output.close();
        let mut bytes = Vec::new();
        output.run(&mut bytes);
        std::fs::remove_dir_all(root).unwrap();
        assert_eq!(result.unwrap_err().code, "timeout");
        assert!(!completed, "the producer ran past the full link instead of blocking");
        let mut frames = bytes.as_slice();
        let mut stdout = 0;
        while let Some(frame) = crate::frame::read_frame(&mut frames).unwrap() {
            if frame.id == 10 {
                assert!(frame.json.get("skipped").is_none());
                if frame.json["stream"] == "stdout" {
                    assert!(frame.payload.iter().all(|byte| *byte == 0));
                    stdout += frame.payload.len();
                }
            }
        }
        // Each reader may hand off its first 64 KiB chunk, then must wait for the full queue to drain.
        assert!(stdout <= 64 * 1024, "read {stdout} bytes beyond a blocked consumer");
    }

    #[test]
    fn configured_relative_shell_runs_the_validated_executable_not_a_cwd_decoy() {
        use std::os::unix::fs::PermissionsExt;

        let root = sys::mkdtemp("./pi-env-relative-shell-").unwrap();
        let trusted = Path::new(&root).join("configured-shell");
        let cwd = Path::new(&root).join("command-cwd");
        let decoy = cwd.join(&root).join("configured-shell");
        std::fs::create_dir_all(decoy.parent().unwrap()).unwrap();
        for (path, text) in [(&trusted, "TRUSTED"), (&decoy, "DECOY")] {
            std::fs::write(path, format!("#!/bin/sh\nprintf {text}\n")).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let output = Arc::new(Output::default());
        let request = ExecRequest::from_json(&json!({
            "command": "ignored", "cwd": cwd, "shellPath": trusted,
        })).unwrap();
        let result = run(9, request, &sys::tmpdir(), &output, &Control::default(), &Arc::default());
        output.close();
        let mut bytes = Vec::new();
        output.run(&mut bytes);
        std::fs::remove_dir_all(root).unwrap();
        assert_eq!(result.unwrap()["exitCode"], 0);
        let mut frames = bytes.as_slice();
        let mut stdout = Vec::new();
        while let Some(frame) = crate::frame::read_frame(&mut frames).unwrap() {
            if frame.json["stream"] == "stdout" {
                stdout.extend(frame.payload);
            }
        }
        assert_eq!(stdout, b"TRUSTED");
    }

    #[test]
    fn stdin_scripts_remain_cancellable_while_the_first_line_sleeps() {
        for abort in [false, true] {
            let control = Arc::new(Control::default());
            let groups: Groups = Arc::default();
            let output = Arc::new(Output::default());
            let mut request = ExecRequest::from_json(&json!({
                "command": format!("printf ready; sleep 3\n{}", "# pipe-filling tail\n".repeat(100_000)),
                "cwd": sys::tmpdir(),
                "timeoutMs": 80,
            })).unwrap();
            if abort {
                request.timeout = None;
            }
            let cancel = if abort {
                let control = control.clone();
                let groups = groups.clone();
                Some(thread::spawn(move || {
                    let until = Instant::now() + Duration::from_secs(1);
                    while groups.lock().unwrap().pids.is_empty() && Instant::now() < until {
                        thread::sleep(Duration::from_millis(1));
                    }
                    control.cancel(false);
                }))
            } else {
                None
            };
            let started = Instant::now();
            // Exercise the real exec lifecycle with the legacy WSL stdin transport, using Unix bash -s. The
            // first sleep is finite so a regression fails rather than leaving the test waiting indefinitely.
            let failure = run_with_shell(
                1,
                request,
                &sys::tmpdir(),
                &output,
                &control,
                &groups,
                |_| {
                    Ok(sys::ShellConfig {
                        program: "/bin/bash".into(),
                        args: vec!["-s".into()],
                        command_on_stdin: true,
                    })
                },
            )
            .unwrap_err();
            if let Some(cancel) = cancel {
                cancel.join().unwrap();
            }
            assert_eq!(failure.code, if abort { "aborted" } else { "timeout" });
            assert!(started.elapsed() < Duration::from_secs(2));
            assert!(groups.lock().unwrap().pids.is_empty());
        }
    }

    #[test]
    fn stdin_writer_closes_even_when_a_descendant_retains_the_read_end() {
        let request = ExecRequest::from_json(&json!({
            "command": format!("sleep 3 <&0 &\nexit 0\n{}", "# unread script tail\n".repeat(100_000)),
            "cwd": sys::tmpdir(),
            "timeoutMs": 2000,
        })).unwrap();
        let started = Instant::now();
        let result = run_with_shell(
            3,
            request,
            &sys::tmpdir(),
            &Arc::new(Output::default()),
            &Control::default(),
            &Arc::default(),
            |_| {
                Ok(sys::ShellConfig {
                    program: "/bin/bash".into(),
                    args: vec!["-s".into()],
                    command_on_stdin: true,
                })
            },
        )
        .unwrap();
        assert_eq!(result["exitCode"], 0);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn stdin_scripts_drain_output_before_feeding_the_remaining_script() {
        let request = ExecRequest::from_json(&json!({
            "command": format!("(sleep 3; kill -KILL $$) </dev/null >/dev/null 2>&1 & guard=$!\nhead -c 262144 /dev/zero; printf complete\nkill \"$guard\"\n{}", "# script tail\n".repeat(10_000)),
            "cwd": sys::tmpdir(),
            "timeoutMs": 2000,
        })).unwrap();
        let output = Arc::new(Output::default());
        let result = run_with_shell(
            2,
            request,
            &sys::tmpdir(),
            &output,
            &Control::default(),
            &Arc::default(),
            |_| {
                Ok(sys::ShellConfig {
                    program: "/bin/bash".into(),
                    args: vec!["-s".into()],
                    command_on_stdin: true,
                })
            },
        )
        .unwrap();
        assert_eq!(result["exitCode"], 0);
        output.close();
        let mut bytes = Vec::new();
        output.run(&mut bytes);
        let mut frames = bytes.as_slice();
        let mut stdout = Vec::new();
        while let Some(frame) = crate::frame::read_frame(&mut frames).unwrap() {
            if frame.json["stream"] == "stdout" {
                stdout.extend(frame.payload);
            }
        }
        let mut expected = vec![0; 262144];
        expected.extend_from_slice(b"complete");
        assert_eq!(stdout, expected);
    }
}
