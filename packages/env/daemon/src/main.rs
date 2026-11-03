//! pi-env: a small daemon that gives a Pi Durable host an execution environment on this machine over stdin/stdout
//! (docs/protocol.md). Started as `pi-env serve --token <hex>`, usually through `ssh`.

mod decode;
mod errors;
mod exec;
mod frame;
mod fs;
mod list;
mod output;
mod pty;
mod scan;
#[cfg(unix)]
mod special;
mod sys;
mod watch;
mod window;

use errors::Failure;
use exec::Control;
use frame::{CANCEL, ERROR, Frame, PING, REQUEST, RESULT};
use output::Output;
use serde_json::{Value, json};
use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs::{File, ReadDir};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const PROTOCOL: u64 = 1;
/// Operations added after protocol 1's first release; clients check `hello.features` before using them.
const FEATURES: &[&str] = &["listFiles"];
/// The npm package version this daemon ships with (build.rs).
const VERSION: &str = env!("PI_ENV_VERSION");
const PING_INTERVAL: Duration = Duration::from_secs(5);
const SILENCE_LIMIT_MS: u64 = 30_000;
const SCAN_CHUNK: usize = 64 * 1024;
/// Threads for file operations; commands run on their own threads.
const WORKERS: usize = 16;
/// Open handles per connection, beyond which opening fails with `EMFILE`.
const MAX_HANDLES: usize = 4096;
/// Replies with larger payloads queue behind command output instead of going first.
const CONTROL_PAYLOAD: usize = 64 * 1024;

#[cfg(all(test, unix))]
thread_local! {
    // Kept thread-local so a pathname replacement fixture cannot affect another request or test.
    static AFTER_WRITE_METADATA: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = Default::default();
}

struct FileHandle {
    file: File,
    path: String,
    #[cfg(unix)]
    stream: bool,
    /// A failed chunk write poisons a write handle, so later chunks cannot leave a gap.
    failed: AtomicBool,
    /// Chunk writes run one at a time in arrival order, though the client sends several at once.
    serial: Mutex<Serial>,
}

#[derive(Default)]
struct Serial {
    jobs: VecDeque<Job>,
    running: bool,
}

struct DirHandle {
    entries: ReadDir,
    path: String,
    /// An entry consumed from ReadDir that belongs to the next encoded page.
    pending: Option<Value>,
}

/// Count encoded JSON bytes without allocating a second copy of every directory entry.
#[derive(Default)]
struct JsonSize(usize);

impl Write for JsonSize {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl DirHandle {
    fn read_page(&mut self, max: usize, frame_limit: usize) -> Result<Value, Failure> {
        let mut entries = Vec::new();
        let mut done = false;
        // Include the frame header and the longer (`false`) spelling of the page envelope.
        let mut size = 9 + b"{\"entries\":[],\"done\":false}".len();
        while entries.len() < max {
            let entry = match self.pending.take() {
                Some(entry) => entry,
                None => match self.entries.next() {
                    None => {
                        done = true;
                        break;
                    }
                    Some(Err(error)) => return Err(Failure::io(&error, "readdir", &self.path)),
                    Some(Ok(entry)) => fs::dir_entry(&self.path, &entry.file_name()),
                },
            };
            let mut encoded = JsonSize::default();
            serde_json::to_writer(&mut encoded, &entry)
                .map_err(|error| Failure::new("EIO", error.to_string()))?;
            let next_size = size + encoded.0 + usize::from(!entries.is_empty());
            if next_size > frame_limit {
                self.pending = Some(entry);
                if entries.is_empty() {
                    return Err(Failure::new(
                        "E2BIG",
                        "directory entry exceeds the frame limit",
                    ));
                }
                break;
            }
            size = next_size;
            entries.push(entry);
        }
        let mut page = serde_json::Map::new();
        page.insert("entries".into(), Value::Array(entries));
        page.insert("done".into(), Value::Bool(done));
        Ok(Value::Object(page))
    }
}

enum Handle {
    File(Arc<FileHandle>),
    Dir(Arc<Mutex<DirHandle>>),
}

type Job = Box<dyn FnOnce() + Send>;

struct Server {
    output: Arc<Output>,
    tmpdir: String,
    handles: Mutex<HashMap<u64, Handle>>,
    next_handle: AtomicU64,
    controls: Mutex<HashMap<u32, Arc<Control>>>,
    groups: exec::Groups,
    terminals: pty::Terminals,
    #[cfg(unix)]
    special: Mutex<Option<special::Sender>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn field<'a>(json: &'a Value, key: &str) -> Result<&'a str, Failure> {
    json[key]
        .as_str()
        .ok_or_else(|| Failure::new("EINVAL", format!("missing field {key}")))
}

fn number(json: &Value, key: &str) -> Result<u64, Failure> {
    json[key]
        .as_u64()
        .ok_or_else(|| Failure::new("EINVAL", format!("missing or invalid field {key}")))
}

fn flag(json: &Value, key: &str) -> bool {
    json[key].as_bool().unwrap_or(false)
}

impl Server {
    fn file(&self, json: &Value) -> Result<Arc<FileHandle>, Failure> {
        match self.handles.lock().unwrap().get(&number(json, "handle")?) {
            Some(Handle::File(file)) => Ok(file.clone()),
            Some(Handle::Dir(_)) => Err(Failure::new("EBADF", "not a file handle")),
            None => Err(Failure::new("EBADF", "unknown handle")),
        }
    }

    fn insert(&self, handle: Handle) -> Result<u64, Failure> {
        let mut handles = self.handles.lock().unwrap();
        if handles.len() >= MAX_HANDLES {
            return Err(Failure::new("EMFILE", "EMFILE: too many open files"));
        }
        let id = self.next_handle.fetch_add(1, Ordering::Relaxed);
        handles.insert(id, handle);
        Ok(id)
    }

    fn insert_file(&self, file: File, path: &str) -> Result<u64, Failure> {
        #[cfg(unix)]
        let stream = special::is_stream(&file);
        self.insert(Handle::File(Arc::new(FileHandle {
            file,
            path: path.to_string(),
            #[cfg(unix)]
            stream,
            failed: AtomicBool::new(false),
            serial: Mutex::new(Serial::default()),
        })))
    }

    fn open_read(&self, file: File, path: &str) -> Result<Value, Failure> {
        let mut result = match file.metadata() {
            Ok(metadata) => json!({ "stat": fs::info(path, &metadata) }),
            Err(error) => json!({ "statError": Failure::io(&error, "fstat", path).to_json() }),
        };
        result["handle"] = json!(self.insert_file(file, path)?);
        Ok(result)
    }

    fn dispatch(
        &self,
        id: u32,
        json: &Value,
        payload: Vec<u8>,
        control: &Control,
    ) -> Result<(Value, Vec<u8>), Failure> {
        if json.is_null() {
            return Err(Failure::new("EINVAL", "invalid JSON"));
        }
        let op = json["op"].as_str().unwrap_or_default();
        let plain = |value: Result<Value, Failure>| value.map(|value| (value, Vec::new()));
        match op {
            "hello" => plain(Ok(json!({
                "protocol": PROTOCOL,
                "version": VERSION,
                "os": env::consts::OS,
                "arch": env::consts::ARCH,
                "home": sys::home(),
                "separator": sys::PATH_SEPARATOR,
                "tmpdir": self.tmpdir,
                "cwd": sys::cwd(),
                "driveCwds": sys::drive_cwds(),
                "pid": std::process::id(),
                "features": FEATURES,
            }))),
            "lstat" => plain(fs::lstat(field(json, "path")?)),
            "realpath" => plain(fs::realpath(field(json, "path")?)),
            "write" => {
                let path = field(json, "path")?;
                let parents = json["parents"].as_bool().unwrap_or(true);
                let file = fs::write(path, flag(json, "append"), parents, &payload, control)?;
                if !flag(json, "keep") {
                    return plain(Ok(json!({})));
                }
                plain(Ok(json!({ "handle": self.insert_file(file, path)? })))
            }
            "writeChunk" => {
                let handle = self.file(json)?;
                if handle.failed.load(Ordering::SeqCst) {
                    return Err(Failure::new("EBADF", "an earlier write failed"));
                }
                fs::write_chunk(&handle.file, &handle.path, &payload, Some(control)).inspect_err(|_| {
                    handle.failed.store(true, Ordering::SeqCst);
                })?;
                plain(Ok(json!({})))
            }
            "truncate" => plain(fs::truncate(field(json, "path")?, number(json, "size")?)),
            "fsync" => plain(fs::fsync(field(json, "path")?)),
            "rename" => plain(fs::rename(field(json, "path")?, field(json, "to")?)),
            "mkdir" => plain(fs::mkdir(field(json, "path")?, flag(json, "recursive"))),
            "rm" => plain(fs::rm(
                field(json, "path")?,
                flag(json, "recursive"),
                flag(json, "force"),
            )),
            "mkdtemp" => plain(fs::mkdtemp(field(json, "path")?)),
            "open" => {
                let path = field(json, "path")?;
                if json["mode"].as_str() == Some("read") {
                    // Unix read opens are dispatched through the cancellable stream reactor when necessary.
                    let file = sys::open(path, sys::OpenMode::Read)
                        .map_err(|error| Failure::io(&error, "open", path))?;
                    return plain(self.open_read(file, path));
                }
                let (file, info) = fs::open_reader(path, flag(json, "noFollow"))?;
                plain(Ok(
                    json!({ "handle": self.insert_file(file, path)?, "info": info }),
                ))
            }
            "pread" => {
                let handle = self.file(json)?;
                let length = (number(json, "length")? as usize).min(frame::MAX_PAYLOAD);
                let bytes = match json["offset"].as_u64() {
                    Some(offset) => fs::pread(&handle.file, &handle.path, offset, length)?,
                    None => fs::read(&handle.file, &handle.path, length)?,
                };
                Ok((json!({}), bytes))
            }
            "fstat" => {
                let handle = self.file(json)?;
                let metadata = handle
                    .file
                    .metadata()
                    .map_err(|error| Failure::io(&error, "fstat", &handle.path))?;
                plain(Ok(fs::info(&handle.path, &metadata)))
            }
            "scanLines" => {
                let handle = self.file(json)?;
                plain(scan_lines(&handle.file, &handle.path, json, control))
            }
            "opendir" => {
                let path = field(json, "path")?;
                let entries =
                    sys::read_dir(path).map_err(|error| Failure::io(&error, "opendir", path))?;
                let handle = self.insert(Handle::Dir(Arc::new(Mutex::new(DirHandle {
                    entries,
                    path: path.to_string(),
                    pending: None,
                }))))?;
                plain(Ok(json!({ "handle": handle })))
            }
            "readdir" => plain(self.read_dir(json)),
            "listFiles" => list::run(json, &|| control.aborted.load(Ordering::SeqCst)),
            "close" => {
                self.handles
                    .lock()
                    .unwrap()
                    .remove(&number(json, "handle")?);
                plain(Ok(json!({})))
            }
            "exec" => plain(exec::run(
                id,
                exec::ExecRequest::from_json(json)?,
                &self.tmpdir,
                &self.output,
                control,
                &self.groups,
            )),
            "watch" => plain(watch::run(id, json, &self.output, control)),
            "pty" => plain(pty::run(
                id,
                pty::PtyRequest::from_json(json)?,
                &self.output,
                control,
                &self.groups,
                &self.terminals,
            )),
            _ => Err(Failure::new("EINVAL", format!("unknown operation {op}"))),
        }
    }

    fn read_dir(&self, json: &Value) -> Result<Value, Failure> {
        let max = number(json, "max")?.max(1) as usize;
        // Lock only this directory, so other requests are not held up by a slow listing.
        let dir = match self.handles.lock().unwrap().get(&number(json, "handle")?) {
            Some(Handle::Dir(dir)) => dir.clone(),
            _ => return Err(Failure::new("EBADF", "not a directory handle")),
        };
        let mut dir = dir.lock().unwrap();
        dir.read_page(max, frame::MAX_FRAME)
    }
}

fn scan_lines(file: &File, path: &str, json: &Value, control: &Control) -> Result<Value, Failure> {
    let start_line = number(json, "startLine")?;
    let end_line = json["endLine"].as_u64();
    if end_line.is_some_and(|end| end <= start_line) {
        return Err(Failure::new("EINVAL", "Invalid line range"));
    }
    let mut scanner = scan::LineScanner::new(start_line, end_line);
    let mut buffer = vec![0u8; SCAN_CHUNK];
    let mut position = 0u64;
    loop {
        if control.aborted.load(Ordering::SeqCst) {
            return Err(Failure::new("aborted", "aborted"));
        }
        let read = sys::read_at(file, &mut buffer, position)
            .map_err(|error| Failure::io(&error, "read", path))?;
        if read == 0 {
            return Ok(scanner.finish());
        }
        scanner.push(&buffer[..read]);
        position += read as u64;
    }
}

fn kill_all(groups: &exec::Groups) -> io::Result<()> {
    #[cfg(unix)]
    {
        let mut groups = groups
            .lock()
            .map_err(|_| io::Error::other("process ownership lock poisoned"))?;
        groups.stopping = true;
        for pid in &groups.pids {
            exec::kill_group(*pid);
        }
        Ok(())
    }
    #[cfg(windows)]
    sys::shutdown_jobs(groups)
}

/// Stdin that records when bytes last arrived, so a large frame arriving slowly counts as a live client.
struct Seen<R> {
    inner: R,
    last_seen: Arc<AtomicU64>,
}

impl<R: Read> Read for Seen<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buffer)?;
        if read > 0 {
            self.last_seen.store(now_ms(), Ordering::Relaxed);
        }
        Ok(read)
    }
}

fn start_workers() -> Sender<Job> {
    let (jobs, queue) = mpsc::channel::<Job>();
    let queue = Arc::new(Mutex::new(queue));
    for _ in 0..WORKERS {
        let queue: Arc<Mutex<Receiver<Job>>> = queue.clone();
        thread::spawn(move || {
            loop {
                let job = queue.lock().unwrap().recv();
                match job {
                    Ok(job) => job(),
                    Err(_) => return,
                }
            }
        });
    }
    jobs
}

fn respond(server: &Server, id: u32, request: Frame, control: Arc<Control>) {
    #[cfg(unix)]
    let mut request = request;
    #[cfg(unix)]
    {
        let prepared = (|| -> Result<Option<special::Operation>, Failure> {
            match request.json["op"].as_str() {
                Some("write") => {
                    let path = field(&request.json, "path")?;
                    #[cfg(test)]
                    let _ = std::fs::metadata(path);
                    #[cfg(test)]
                    AFTER_WRITE_METADATA.with(|hook| {
                        if let Some(hook) = hook.borrow_mut().take() {
                            hook();
                        }
                    });
                    // A regular or missing pathname may become a FIFO before open. Prepare on this worker,
                    // then transfer every Unix writer open to a cancellable helper.
                    fs::prepare_write(
                        path,
                        flag(&request.json, "append"),
                        request.json["parents"].as_bool().unwrap_or(true),
                        &control,
                    )?;
                    return Ok(Some(special::Operation::WriteOpen {
                        path: path.to_string(),
                        append: flag(&request.json, "append"),
                        content: std::mem::take(&mut request.payload),
                        keep: flag(&request.json, "keep"),
                    }));
                }
                Some("writeChunk") => {
                    let handle = server.file(&request.json)?;
                    if handle.stream {
                        return Ok(Some(special::Operation::Write {
                            handle,
                            content: std::mem::take(&mut request.payload),
                            written: 0,
                            keep: false,
                            initial: false,
                        }));
                    }
                }
                Some("open") if request.json["mode"].as_str() == Some("read") => {
                    if control.aborted.load(Ordering::SeqCst) {
                        return Err(Failure::new("aborted", "aborted"));
                    }
                    let path = field(&request.json, "path")?;
                    let slow = std::fs::metadata(path)
                        .is_ok_and(|metadata| !metadata.is_file() && !metadata.is_dir());
                    // Metadata chooses a bounded queue only. A real open retains the writer rendezvous.
                    return Ok(Some(special::Operation::Open {
                        path: path.to_string(),
                        slow,
                    }));
                }
                Some("pread") => {
                    let handle = server.file(&request.json)?;
                    if handle.stream {
                        return Ok(Some(special::Operation::Read {
                            handle,
                            offset: request.json["offset"].as_u64(),
                            length: (number(&request.json, "length")? as usize)
                                .min(frame::MAX_PAYLOAD),
                        }));
                    }
                }
                _ => {}
            }
            Ok(None)
        })();
        match prepared {
            Ok(Some(operation)) => {
                let pending = special::Request {
                    id,
                    control,
                    operation,
                };
                let queued = match server.special.lock().unwrap().as_ref() {
                    Some(sender) => sender
                        .try_send(pending)
                        .map_err(|_| Failure::new("EMFILE", "too many pending stream requests")),
                    None => Err(Failure::new("EIO", "stream reactor is unavailable")),
                };
                if let Err(failure) = queued {
                    finish_response(server, id, false, Err(failure));
                }
                return;
            }
            Err(failure) => {
                finish_response(server, id, false, Err(failure));
                return;
            }
            Ok(None) => {}
        }
    }
    let is_exec = matches!(request.json["op"].as_str(), Some("exec" | "pty"));
    let result = server.dispatch(id, &request.json, request.payload, &control);
    finish_response(server, id, is_exec, result);
}

fn finish_response(
    server: &Server,
    id: u32,
    is_exec: bool,
    result: Result<(Value, Vec<u8>), Failure>,
) {
    let reply = match result {
        Ok((json, payload)) => Frame::with_payload(RESULT, id, json, payload),
        Err(failure) => Frame::new(ERROR, id, failure.to_json()),
    };
    server.controls.lock().unwrap().remove(&id);
    // A command's result follows its output; large payloads do not hold up pings and small replies.
    if is_exec || reply.payload.len() > CONTROL_PAYLOAD {
        server.output.bulk(reply, None);
    } else {
        server.output.control(reply);
    }
}

/// Queue `job` behind the handle's earlier chunk writes; one pool job drains the queue.
fn run_in_order(jobs: &Sender<Job>, handle: Arc<FileHandle>, job: Job) {
    let mut serial = handle.serial.lock().unwrap();
    serial.jobs.push_back(job);
    if serial.running {
        return;
    }
    serial.running = true;
    drop(serial);
    let _ = jobs.send(Box::new(move || {
        loop {
            let next = {
                let mut serial = handle.serial.lock().unwrap();
                let next = serial.jobs.pop_front();
                if next.is_none() {
                    serial.running = false;
                }
                next
            };
            match next {
                Some(job) => job(),
                None => return,
            }
        }
    }));
}

fn serve_frames(server: &Arc<Server>, input: &mut impl Read) -> io::Result<()> {
    let jobs = start_workers();
    while let Some(request) = frame::read_frame(input)? {
        match request.kind {
            REQUEST
                if matches!(
                    request.json["op"].as_str(),
                    Some("ptyWrite" | "ptyResize" | "ptyForeground")
                ) =>
            {
                // Answered here, in arrival order: through the worker pool, two writes could swap.
                let reply = match request.json["op"].as_str() {
                    Some("ptyWrite") => {
                        pty::write(&server.terminals, &request.json, request.payload)
                    }
                    Some("ptyResize") => pty::resize(&server.terminals, &request.json),
                    _ => pty::foreground(&server.terminals, &request.json),
                };
                server.output.control(match reply {
                    Ok(json) => Frame::new(RESULT, request.id, json),
                    Err(failure) => Frame::new(ERROR, request.id, failure.to_json()),
                });
            }
            REQUEST => {
                let id = request.id;
                // Registered before the request runs, so a cancel right behind it is not lost.
                let control = Arc::new(Control::default());
                server.controls.lock().unwrap().insert(id, control.clone());
                // Commands and watchers last; they get their own threads (watchers recurse through trees).
                if matches!(request.json["op"].as_str(), Some("exec" | "watch" | "pty")) {
                    let worker = server.clone();
                    let spawned = thread::Builder::new()
                        .stack_size(16 * 1024 * 1024)
                        .spawn(move || respond(&worker, id, request, control));
                    if let Err(error) = spawned {
                        server.controls.lock().unwrap().remove(&id);
                        let failure = Failure::new("spawn_error", error.to_string());
                        server
                            .output
                            .bulk(Frame::new(ERROR, id, failure.to_json()), None);
                    }
                } else {
                    let worker = server.clone();
                    let serial = match request.json["op"].as_str() {
                        Some("writeChunk") => server.file(&request.json).ok(),
                        _ => None,
                    };
                    let job: Job = Box::new(move || respond(&worker, id, request, control));
                    match serial {
                        Some(handle) => run_in_order(&jobs, handle, job),
                        None => {
                            let _ = jobs.send(job);
                        }
                    }
                }
            }
            CANCEL => {
                let control = server.controls.lock().unwrap().get(&request.id).cloned();
                if let Some(control) = control {
                    control.cancel(request.json["mode"].as_str() == Some("kill"));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

fn serve(token: &str) -> io::Result<()> {
    #[cfg(unix)]
    special::install_interrupt()?;
    {
        let mut stdout = io::stdout().lock();
        writeln!(stdout, "PI-ENV {token}")?;
        stdout.flush()?;
    }
    let output = Arc::new(Output::default());
    let writer = {
        let output = output.clone();
        thread::spawn(move || {
            output.run(&mut BufWriter::with_capacity(1 << 20, io::stdout().lock()))
        })
    };
    let server = Arc::new(Server {
        output: output.clone(),
        tmpdir: sys::tmpdir(),
        handles: Mutex::new(HashMap::new()),
        next_handle: AtomicU64::new(1),
        controls: Mutex::new(HashMap::new()),
        groups: Arc::new(Mutex::new(Default::default())),
        terminals: Arc::new(Mutex::new(HashMap::new())),
        #[cfg(unix)]
        special: Mutex::new(None),
    });
    #[cfg(unix)]
    {
        *server.special.lock().unwrap() = Some(special::start(Arc::downgrade(&server)));
    }
    let last_seen = Arc::new(AtomicU64::new(now_ms()));
    {
        let output = output.clone();
        let last_seen = last_seen.clone();
        let groups = server.groups.clone();
        let terminals = server.terminals.clone();
        thread::spawn(move || {
            loop {
                thread::sleep(PING_INTERVAL);
                output.control(Frame::new(PING, 0, json!({})));
                // A client that went silent (a phone that lost its network) leaves nothing running.
                if now_ms().saturating_sub(last_seen.load(Ordering::Relaxed)) > SILENCE_LIMIT_MS {
                    if let Err(error) = kill_all(&groups) {
                        pty::kill_all(&terminals);
                        eprintln!("pi-env: failed to clean process trees: {error}");
                        std::process::exit(1);
                    }
                    pty::kill_all(&terminals);
                    std::process::exit(0);
                }
            }
        });
    }
    let mut input = BufReader::with_capacity(
        1 << 20,
        Seen {
            inner: io::stdin().lock(),
            last_seen,
        },
    );
    let result = serve_frames(&server, &mut input);
    // However input ended, the client is gone: stop everything it started.
    let cleanup = kill_all(&server.groups);
    pty::kill_all(&server.terminals);
    output.close();
    let _ = writer.join();
    result.and(cleanup)
}

fn main() {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("serve") => {
            let token = args
                .iter()
                .position(|arg| arg == "--token")
                .and_then(|index| args.get(index + 1));
            let Some(token) = token else {
                eprintln!("usage: pi-env serve --token <hex>");
                std::process::exit(2);
            };
            if let Err(error) = serve(token) {
                eprintln!("pi-env: {error}");
                std::process::exit(1);
            }
            // Request threads may still be blocked in a filesystem write; the client is gone.
            std::process::exit(0);
        }
        Some("--version") => println!("pi-env {VERSION}"),
        _ => {
            eprintln!("usage: pi-env serve --token <hex>");
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn replaced_write_destinations_cancel_without_readers_or_file_worker_starvation() {
        const CHILD: &str = "PI_ENV_REPLACED_WRITER_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "tests::replaced_write_destinations_cancel_without_readers_or_file_worker_starvation", "--nocapture"])
                .env(CHILD, "1").spawn().unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            loop {
                if let Some(status) = child.try_wait().unwrap() {
                    assert!(status.success(), "isolated writer replacement regression failed: {status}");
                    return;
                }
                if std::time::Instant::now() >= deadline {
                    child.kill().unwrap();
                    child.wait().unwrap();
                    panic!("isolated writer replacement regression timed out");
                }
                thread::sleep(Duration::from_millis(5));
            }
        }
        special::install_interrupt().unwrap();
        for (existing, append) in [(true, false), (false, false), (true, true), (false, true)] {
            let root = sys::mkdtemp(&format!("{}/pi-env-writer-replace-", sys::tmpdir())).unwrap();
            let output = Arc::new(Output::default());
            let server = Arc::new(Server {
                output: output.clone(), tmpdir: root.clone(), handles: Mutex::default(),
                next_handle: AtomicU64::new(1), controls: Mutex::default(),
                groups: Arc::default(), terminals: Arc::default(), special: Mutex::new(None),
            });
            *server.special.lock().unwrap() = Some(special::start(Arc::downgrade(&server)));
            let (mut replies, mut wire) = std::os::unix::net::UnixStream::pair().unwrap();
            replies.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let writer_output = output.clone();
            let writer = thread::spawn(move || writer_output.run(&mut wire));
            let jobs = start_workers();
            let (reached, ready) = mpsc::channel();
            let controls: Vec<_> = (0..WORKERS).map(|_| Arc::new(Control::default())).collect();
            for (index, control) in controls.iter().enumerate() {
                let path = std::path::Path::new(&root).join(format!("destination-{index}"));
                if existing { std::fs::write(&path, b"original").unwrap(); }
                let worker = server.clone();
                let control = control.clone();
                let reached = reached.clone();
                jobs.send(Box::new(move || {
                    let replaced_path = path.clone();
                    let before_open = reached.clone();
                    AFTER_WRITE_METADATA.with(|hook| *hook.borrow_mut() = Some(Box::new(move || {
                        if existing { std::fs::remove_file(&replaced_path).unwrap(); }
                        use std::os::unix::ffi::OsStrExt;
                        let raw = std::ffi::CString::new(replaced_path.as_os_str().as_bytes()).unwrap();
                        // SAFETY: the fixture exclusively owns this private pathname.
                        assert_eq!(unsafe { libc::mkfifo(raw.as_ptr(), 0o600) }, 0);
                        fs::BEFORE_WRITE_OPEN.with(|hook| *hook.borrow_mut() = Some(Box::new(move || {
                            // The fallback already passed its final abort check. Cancel only after this seam;
                            // otherwise an early abort could hide an uninterruptible ordinary-worker open.
                            before_open.send(index).unwrap();
                        })));
                    })));
                    respond(&worker, index as u32, Frame::with_payload(REQUEST, index as u32, json!({
                        "op": "write", "path": path, "append": append,
                    }), b"replacement".to_vec()), control);
                    fs::BEFORE_WRITE_OPEN.with(|hook| { hook.borrow_mut().take(); });
                    // A safely routed request relinquishes its ordinary worker before rendezvous completes.
                    reached.send(index).unwrap();
                })).unwrap();
            }
            for _ in 0..WORKERS { ready.recv_timeout(Duration::from_secs(3)).unwrap(); }
            for control in &controls { control.cancel(false); }
            let (available, ordinary) = mpsc::channel();
            let ordinary_server = server.clone();
            let ordinary_path = std::path::Path::new(&root).join("ordinary");
            std::fs::write(&ordinary_path, b"available").unwrap();
            jobs.send(Box::new(move || {
                available.send(ordinary_server.dispatch(100, &json!({ "op": "lstat", "path": ordinary_path }), vec![], &Control::default())).unwrap();
            })).unwrap();
            assert!(ordinary.recv_timeout(Duration::from_secs(3))
                .expect("replacement FIFOs must not strand ordinary file workers").is_ok());
            for _ in 0..WORKERS {
                let cancelled = frame::read_frame(&mut replies)
                    .expect("a replaced writer must cancel without introducing a FIFO reader").unwrap();
                assert_eq!(cancelled.kind, ERROR);
                assert_eq!(cancelled.json["code"], "aborted");
            }
            drop(jobs);
            output.close();
            writer.join().unwrap();
            drop(server);
            std::fs::remove_dir_all(root).unwrap();
        }
    }



    #[test]
    fn queued_cancelled_chunks_leave_the_file_at_the_last_completed_write() {
        let root = sys::mkdtemp(&format!("{}{}pi-env-write-cancel-", sys::tmpdir(), sys::PATH_SEPARATOR)).unwrap();
        let path = std::path::Path::new(&root).join("file").to_string_lossy().into_owned();
        let server = Arc::new(Server {
            output: Arc::default(), tmpdir: root.clone(), handles: Mutex::default(),
            next_handle: AtomicU64::new(1), controls: Mutex::default(), groups: Arc::default(), terminals: Arc::default(),
            #[cfg(unix)]
            special: Mutex::new(None),
        });
        let (opened, _) = server.dispatch(1, &json!({ "op": "write", "path": path, "keep": true }), b"first".to_vec(), &Control::default()).unwrap();
        let handle_json = json!({ "op": "writeChunk", "handle": opened["handle"] });
        let handle = server.file(&handle_json).unwrap();
        let (jobs, queue) = mpsc::channel::<Job>();
        let worker = thread::spawn(move || { queue.recv().unwrap()(); });
        let (entered, ready) = mpsc::channel();
        let (release, held) = mpsc::channel();
        run_in_order(&jobs, handle.clone(), Box::new(move || {
            entered.send(()).unwrap();
            held.recv().unwrap();
        }));
        ready.recv_timeout(Duration::from_secs(3)).unwrap();
        let control = Arc::new(Control::default());
        let (completed, result) = mpsc::channel();
        let queued_server = server.clone();
        let queued_control = control.clone();
        run_in_order(&jobs, handle.clone(), Box::new(move || {
            completed.send(queued_server.dispatch(2, &handle_json, b"cancelled".to_vec(), &queued_control)).unwrap();
        }));
        control.cancel(false);
        release.send(()).unwrap();
        assert_eq!(result.recv_timeout(Duration::from_secs(3)).unwrap().unwrap_err().code, "aborted");
        worker.join().unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"first");
        // Already cancelled initial requests must not truncate an existing file or create missing parents.
        let cancelled = json!({ "op": "write", "path": path });
        assert_eq!(server.dispatch(3, &cancelled, b"replacement".to_vec(), &control).unwrap_err().code, "aborted");
        assert_eq!(std::fs::read(&path).unwrap(), b"first");
        let missing = std::path::Path::new(&root).join("missing/file");
        assert_eq!(server.dispatch(4, &json!({ "op": "write", "path": missing }), vec![], &control).unwrap_err().code, "aborted");
        assert!(!missing.parent().unwrap().exists());
        drop(handle);
        drop(server);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn shutdown_refuses_exec_and_terminal_requests_that_have_not_spawned() {
        let root = sys::mkdtemp(&format!("{}/pi-env-shutdown-", sys::tmpdir())).unwrap();
        let groups: exec::Groups = Arc::default();
        let terminals: pty::Terminals = Arc::default();
        let output = Arc::new(Output::default());
        kill_all(&groups).unwrap();
        let command = "printf leaked > after-shutdown";
        let exec = exec::run(
            1,
            exec::ExecRequest::from_json(&json!({ "command": command, "cwd": root })).unwrap(),
            &root,
            &output,
            &Control::default(),
            &groups,
        );
        let terminal = pty::run(
            2,
            pty::PtyRequest::from_json(&json!({
                "argv": ["/bin/sh", "-c", command], "cwd": root, "cols": 80, "rows": 24,
            })).unwrap(),
            &output,
            &Control::default(),
            &groups,
            &terminals,
        );
        let leaked = std::path::Path::new(&root).join("after-shutdown").exists();
        std::fs::remove_dir_all(root).unwrap();
        assert!(!leaked, "a request spawned a child after shutdown");
        assert_eq!(exec.unwrap_err().code, "spawn_error");
        assert_eq!(terminal.unwrap_err().code, "spawn_error");
    }
    #[test]
    fn directory_pages_fit_encoded_frames_without_losing_the_carried_entry() {
        let path = sys::mkdtemp(&format!(
            "{}{}pi-env-readdir-",
            sys::tmpdir(),
            sys::PATH_SEPARATOR
        ))
        .unwrap();
        let names = ["first", "second", "third"];
        for name in names {
            std::fs::write(std::path::Path::new(&path).join(name), "").unwrap();
        }
        let expected: Vec<Value> = sys::read_dir(&path)
            .unwrap()
            .map(|entry| fs::dir_entry(&path, &entry.unwrap().file_name()))
            .collect();
        // The byte limit fits any one entry but cannot fit two, with no giant directory fixture.
        let limit = expected
            .iter()
            .map(|entry| {
                9 + serde_json::to_vec(&json!({ "entries": [entry], "done": false }))
                    .unwrap()
                    .len()
            })
            .max()
            .unwrap();
        let mut dir = DirHandle {
            entries: sys::read_dir(&path).unwrap(),
            path: path.clone(),
            pending: None,
        };
        let mut actual = Vec::new();
        let mut done = false;
        for _ in 0..=names.len() {
            let page = dir.read_page(usize::MAX, limit).unwrap();
            assert!(9 + serde_json::to_vec(&page).unwrap().len() <= limit);
            actual.extend(page["entries"].as_array().unwrap().iter().cloned());
            done = page["done"].as_bool().unwrap();
            if done {
                break;
            }
        }
        assert!(done);
        let mut actual_names: Vec<_> = actual
            .iter()
            .map(|entry| entry["name"].as_str().unwrap())
            .collect();
        actual_names.sort();
        assert_eq!(actual_names, names);
        drop(dir);
        std::fs::remove_dir_all(path).unwrap();
    }

    #[test]
    fn a_single_oversized_directory_entry_returns_a_request_error() {
        let path = sys::mkdtemp(&format!(
            "{}{}pi-env-readdir-",
            sys::tmpdir(),
            sys::PATH_SEPARATOR
        ))
        .unwrap();
        let entry = json!({ "name": "quotes\" and newline\n and unicode é", "error": { "code": "ENOENT" } });
        let limit = 9 + serde_json::to_vec(&json!({ "entries": [&entry], "done": false }))
            .unwrap()
            .len();
        let mut dir = DirHandle {
            entries: sys::read_dir(&path).unwrap(),
            path: path.clone(),
            pending: Some(entry.clone()),
        };
        assert_eq!(dir.read_page(1, limit - 1).unwrap_err().code, "E2BIG");
        let page = dir.read_page(1, limit).unwrap();
        assert_eq!(page, json!({ "entries": [entry], "done": false }));
        assert_eq!(
            dir.read_page(1, limit).unwrap(),
            json!({ "entries": [], "done": true })
        );
        drop(dir);
        std::fs::remove_dir_all(path).unwrap();
    }
}
