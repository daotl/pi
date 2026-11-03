//! Unix opens stay interruptible; only nonblocking stream I/O runs on the reactor itself.

use crate::{Control, Failure, FileHandle, Server, finish_response, sys};
use serde_json::json;
use std::collections::{HashSet, VecDeque};
use std::ffi::CString;
use std::fs::File;
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

pub struct Request {
    pub id: u32,
    pub control: Arc<Control>,
    pub operation: Operation,
}

pub enum Operation {
    Open {
        path: String,
        slow: bool,
    },
    Read {
        handle: Arc<FileHandle>,
        offset: Option<u64>,
        length: usize,
    },
    WriteOpen {
        path: String,
        append: bool,
        content: Vec<u8>,
        keep: bool,
    },
    Write {
        handle: Arc<FileHandle>,
        content: Vec<u8>,
        written: usize,
        keep: bool,
        initial: bool,
    },
}

pub fn is_stream(file: &File) -> bool {
    file.metadata()
        .is_ok_and(|metadata| !metadata.is_file() && !metadata.is_dir())
}

extern "C" fn interrupt_open(_signal: libc::c_int) {}

/// This standalone daemon reserves SIGUSR2 solely to interrupt its bounded open helpers. Install before any
/// worker threads, never replace a handler inherited from an embedding environment, and never use SA_RESTART.
/// The no-op handler is async-signal-safe. Command children reset their signal dispositions before exec.
pub fn install_interrupt() -> io::Result<()> {
    // SAFETY: sigaction fills initialized storage; called once at daemon startup before spawning threads.
    unsafe {
        let mut previous: libc::sigaction = std::mem::zeroed();
        if libc::sigaction(libc::SIGUSR2, std::ptr::null(), &mut previous) != 0 {
            return Err(io::Error::last_os_error());
        }
        if previous.sa_sigaction != libc::SIG_DFL
            && previous.sa_sigaction != interrupt_open as *const () as usize
        {
            return Err(io::Error::other(
                "pi-env requires exclusive ownership of SIGUSR2 for FIFO cancellation",
            ));
        }
        let mut action: libc::sigaction = std::mem::zeroed();
        action.sa_sigaction = interrupt_open as *const () as usize;
        libc::sigemptyset(&mut action.sa_mask);
        if libc::sigaction(libc::SIGUSR2, &action, std::ptr::null_mut()) != 0 {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

struct Active {
    thread: libc::pthread_t,
    control: Arc<Control>,
    defer: Arc<AtomicBool>,
}

type Registration = Arc<Mutex<Option<Active>>>;

/// Clear under the same lock the reactor holds while signalling: a completed or reused pthread cannot be targeted
/// using a stale registration, including unwinding exits.
struct Registered(Registration);

impl Drop for Registered {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = None;
    }
}

struct OpenJob {
    request: Request,
    defer: Arc<AtomicBool>,
}

struct Opened {
    request: Request,
    /// None transfers a still-unopened quick job to the slow queue. A successful descriptor is never reopened.
    result: io::Result<Option<File>>,
}

enum Event {
    Request(Request),
    Opened { opened: Opened, slow: bool },
    Written {
        request: Request,
        result: Result<(), Failure>,
    },
}

pub struct Sender(SyncSender<Event>);

impl Sender {
    pub fn try_send(&self, request: Request) -> Result<(), ()> {
        self.0.try_send(Event::Request(request)).map_err(|_| ())
    }
}

fn open_mode(
    path: &str,
    flags: libc::c_int,
    control: &Control,
    defer: &AtomicBool,
) -> io::Result<Option<File>> {
    let path = CString::new(std::path::Path::new(path).as_os_str().as_bytes())
        .map_err(|_| io::Error::from_raw_os_error(libc::EINVAL))?;
    let mut interrupted = false;
    loop {
        if control.aborted.load(Ordering::SeqCst) {
            return Err(sys::synthetic("aborted"));
        }
        // A reactor pass can mark deferral before this helper executes its first syscall. Always attempt that
        // initial open; otherwise ordinary files could be queued behind stalled FIFOs without ever being tried.
        if interrupted && defer.load(Ordering::SeqCst) {
            return Ok(None);
        }
        // SAFETY: NUL-terminated path; unlike std OpenOptions, do not retry EINTR internally.
        let fd = unsafe {
            libc::open(
                path.as_ptr(),
                flags | libc::O_CLOEXEC,
                0o666 as libc::c_uint,
            )
        };
        if fd >= 0 {
            // SAFETY: open returned a new descriptor now exclusively owned by this File. Retain it even if the
            // reactor concurrently deferred this job: its successful open already owns the writer rendezvous.
            return Ok(Some(unsafe { File::from_raw_fd(fd) }));
        }
        let error = io::Error::last_os_error();
        if error.kind() != io::ErrorKind::Interrupted {
            return Err(error);
        }
        interrupted = true;
    }
}

struct Openers {
    sender: SyncSender<OpenJob>,
    registrations: Vec<Registration>,
    active: usize,
}

impl Openers {
    fn start(completed: SyncSender<Event>, slow: bool) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<OpenJob>(crate::WORKERS);
        let receiver = Arc::new(Mutex::new(receiver));
        let mut registrations = Vec::new();
        for _ in 0..crate::WORKERS {
            let slot: Registration = Arc::new(Mutex::new(None));
            registrations.push(slot.clone());
            let receiver = receiver.clone();
            let completed = completed.clone();
            std::thread::spawn(move || {
                // SAFETY: modify only this helper's signal mask, leaving other daemon threads untouched.
                let mask_error = unsafe {
                    let mut signals: libc::sigset_t = std::mem::zeroed();
                    libc::sigemptyset(&mut signals);
                    libc::sigaddset(&mut signals, libc::SIGUSR2);
                    libc::pthread_sigmask(libc::SIG_UNBLOCK, &signals, std::ptr::null_mut())
                };
                loop {
                    let job = match receiver.lock().unwrap().recv() {
                        Ok(job) => job,
                        Err(_) => return,
                    };
                    let (path, flags) = match &job.request.operation {
                        Operation::Open { path, .. } => (path, libc::O_RDONLY),
                        Operation::WriteOpen { path, append, .. } => (
                            path,
                            libc::O_WRONLY
                                | libc::O_CREAT
                                | if *append {
                                    libc::O_APPEND
                                } else {
                                    libc::O_TRUNC
                                },
                        ),
                        _ => unreachable!(),
                    };
                    // SAFETY: pthread_self identifies this live, exclusively owned helper thread.
                    *slot.lock().unwrap() = Some(Active {
                        thread: unsafe { libc::pthread_self() },
                        control: job.request.control.clone(),
                        defer: job.defer.clone(),
                    });
                    let registered = Registered(slot.clone());
                    let result = if mask_error == 0 {
                        open_mode(path, flags, &job.request.control, &job.defer)
                    } else {
                        Err(io::Error::from_raw_os_error(mask_error))
                    };
                    drop(registered);
                    if completed
                        .send(Event::Opened {
                            opened: Opened {
                                request: job.request,
                                result,
                            },
                            slow,
                        })
                        .is_err()
                    {
                        return;
                    }
                }
            });
        }
        Self {
            sender,
            registrations,
            active: 0,
        }
    }

    fn submit(&mut self, request: Request) {
        self.active += 1;
        let _ = self.sender.send(OpenJob {
            request,
            defer: Arc::new(AtomicBool::new(false)),
        });
    }

    fn interrupt(&self, defer: bool) {
        for slot in &self.registrations {
            let active = slot.lock().unwrap();
            if let Some(active) = active.as_ref() {
                if defer {
                    active.defer.store(true, Ordering::SeqCst);
                }
                if active.defer.load(Ordering::SeqCst)
                    || active.control.aborted.load(Ordering::SeqCst)
                {
                    // SAFETY: the held registration lock excludes helper completion and pthread reuse.
                    unsafe {
                        libc::pthread_kill(active.thread, libc::SIGUSR2);
                    }
                }
            }
        }
    }
}

/// Retain opened ordinary descriptors while a fixed pool writes their initial payloads. Admission never waits
/// on a worker; the reactor's shared MAX_HANDLES budget includes queued, running, and completed writes.
struct RegularWriters {
    sender: SyncSender<Request>,
    active: usize,
}

impl RegularWriters {
    fn start(completed: SyncSender<Event>) -> Self {
        let (sender, receiver) = mpsc::sync_channel::<Request>(crate::MAX_HANDLES);
        let receiver = Arc::new(Mutex::new(receiver));
        for _ in 0..crate::WORKERS {
            let receiver = receiver.clone();
            let completed = completed.clone();
            std::thread::spawn(move || loop {
                let request = match receiver.lock().unwrap().recv() {
                    Ok(request) => request,
                    Err(_) => return,
                };
                let result = request.write_regular();
                if completed.send(Event::Written { request, result }).is_err() {
                    return;
                }
            });
        }
        Self { sender, active: 0 }
    }

    fn submit(&mut self, server: &Server, request: Request) {
        if request.control.aborted.load(Ordering::SeqCst) {
            request.finish(server, Err(Failure::new("aborted", "aborted")));
            return;
        }
        match self.sender.try_send(request) {
            Ok(()) => self.active += 1,
            Err(error) => {
                let (request, failure) = match error {
                    mpsc::TrySendError::Full(request) => (
                        request,
                        Failure::new("EMFILE", "too many pending ordinary writes"),
                    ),
                    mpsc::TrySendError::Disconnected(request) => (
                        request,
                        Failure::new("EIO", "ordinary writer pool is unavailable"),
                    ),
                };
                request.finish(server, Err(failure));
            }
        }
    }
}

impl Request {
    fn write_regular(&self) -> Result<(), Failure> {
        let Operation::Write {
            handle,
            content,
            written,
            ..
        } = &self.operation
        else {
            unreachable!();
        };
        debug_assert!(!handle.stream);
        if self.control.aborted.load(Ordering::SeqCst) {
            return Err(Failure::new("aborted", "aborted"));
        }
        if handle.failed.load(Ordering::SeqCst) {
            return Err(Failure::new("EBADF", "an earlier write failed"));
        }
        #[cfg(test)]
        if *written < content.len() {
            tests::before_ordinary_write(handle);
        }
        crate::fs::write_chunk(
            &handle.file,
            &handle.path,
            &content[*written..],
            Some(&self.control),
        )
    }

    fn finish(
        self,
        server: &Server,
        mut result: Result<(serde_json::Value, Vec<u8>), Failure>,
    ) {
        if let Operation::Write {
            handle,
            keep,
            initial,
            ..
        } = self.operation
        {
            if result.is_err() {
                handle.failed.store(true, Ordering::SeqCst);
            } else if keep && initial {
                result = server
                    .insert(crate::Handle::File(handle))
                    .map(|id| (json!({ "handle": id }), Vec::new()));
            }
        }
        finish_response(server, self.id, false, result);
    }

    fn attempt_write(&mut self) -> Option<Result<(serde_json::Value, Vec<u8>), Failure>> {
        let Operation::Write {
            handle,
            content,
            written,
            ..
        } = &mut self.operation
        else {
            return None;
        };
        let result = (|| {
            if self.control.aborted.load(Ordering::SeqCst) {
                return Err(Failure::new("aborted", "aborted"));
            }
            if handle.failed.load(Ordering::SeqCst) {
                return Err(Failure::new("EBADF", "an earlier write failed"));
            }
            while *written < content.len() {
                if self.control.aborted.load(Ordering::SeqCst) {
                    return Err(Failure::new("aborted", "aborted"));
                }
                match (&handle.file).write(&content[*written..]) {
                    Ok(0) => {
                        return Err(Failure::io(
                            &io::Error::from(io::ErrorKind::WriteZero),
                            "write",
                            &handle.path,
                        ));
                    }
                    Ok(count) => *written += count,
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                        ) =>
                    {
                        return Ok(None);
                    }
                    Err(error) => return Err(Failure::io(&error, "write", &handle.path)),
                }
            }
            Ok(Some((json!({}), Vec::new())))
        })();
        match result {
            Ok(None) => None,
            Ok(Some(value)) => Some(Ok(value)),
            Err(error) => Some(Err(error)),
        }
    }
    fn attempt_read(
        &mut self,
        buffer: &mut Vec<u8>,
    ) -> Option<Result<(serde_json::Value, Vec<u8>), Failure>> {
        if self.control.aborted.load(Ordering::SeqCst) {
            return Some(Err(Failure::new("aborted", "aborted")));
        }
        let Operation::Read {
            handle,
            offset,
            length,
        } = &mut self.operation
        else {
            return None;
        };
        if *length == 0 {
            return Some(Ok((json!({}), Vec::new())));
        }
        buffer.resize(*length, 0);
        // Read directly: readiness notifications do not portably report device/FIFO EOF. Real blocking open
        // completed the writer rendezvous, so zero now means EOF and EAGAIN means a connected idle writer.
        let result = match offset {
            Some(offset) => sys::read_at(&handle.file, buffer, *offset),
            None => (&handle.file).read(buffer),
        };
        match result {
            Ok(read) => {
                buffer.truncate(read);
                Some(Ok((json!({}), std::mem::take(buffer))))
            }
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                ) =>
            {
                None
            }
            Err(error) => Some(Err(Failure::io(&error, "read", &handle.path))),
        }
    }
}

fn complete_open(server: &Server, opened: Opened) -> Option<Request> {
    let Opened {
        mut request,
        result,
    } = opened;
    if matches!(&result, Ok(None)) && !request.control.aborted.load(Ordering::SeqCst) {
        return Some(request);
    }
    let file = (|| {
        if request.control.aborted.load(Ordering::SeqCst) {
            return Err(Failure::new("aborted", "aborted"));
        }
        let path = match &request.operation {
            Operation::Open { path, .. } | Operation::WriteOpen { path, .. } => path,
            _ => unreachable!(),
        };
        let file = result
            .map_err(|error| Failure::io(&error, "open", path))?
            .expect("nondeferred open owns a descriptor");
        // SAFETY: the helper transferred exclusive ownership of this live descriptor.
        unsafe {
            let flags = libc::fcntl(file.as_raw_fd(), libc::F_GETFL);
            if flags < 0
                || libc::fcntl(file.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) < 0
            {
                return Err(Failure::io(&io::Error::last_os_error(), "open", path));
            }
        }
        Ok(file)
    })();
    let result = match file {
        Err(error) => Err(error),
        Ok(file) => match request.operation {
            Operation::Open { path, .. } => {
                server.open_read(file, &path).map(|json| (json, Vec::new()))
            }
            Operation::WriteOpen {
                path,
                content,
                keep,
                ..
            } => {
                let handle = Arc::new(FileHandle {
                    stream: is_stream(&file),
                    file,
                    path,
                    failed: AtomicBool::new(false),
                    serial: Mutex::default(),
                });
                request.operation = Operation::Write {
                    handle,
                    content,
                    written: 0,
                    keep,
                    initial: true,
                };
                return Some(request);
            }
            _ => unreachable!(),
        },
    };
    finish_response(server, request.id, false, result);
    None
}

/// Metadata selects only a queue, never how to open. Quick opens that unexpectedly block are interrupted and
/// deferred after one reactor pass, freeing their pool even if a regular pathname became a FIFO. A successful
/// descriptor always transfers unchanged. Saturated slow reader and writer pools reject excess opens with EMFILE;
/// quick opens may wait for their pool, but never occupy ordinary file workers while waiting for rendezvous.
/// Opened ordinary writers transfer to a bounded worker pool; their payloads never run on this reactor.
pub fn start(server: Weak<Server>) -> Sender {
    // Both arrivals and helper completions wake this bounded receiver. In particular, an ordinary open must
    // not wait for a cancellation poll merely because no further request arrives.
    let (events, receiver) = mpsc::sync_channel::<Event>(crate::MAX_HANDLES);
    let sender = Sender(events.clone());
    std::thread::spawn(move || {
        let mut quick = Openers::start(events.clone(), false);
        let mut slow = Openers::start(events.clone(), true);
        // Writer rendezvous never occupies a read-open helper: a later reader must be able to release it.
        let mut writers = Openers::start(events.clone(), true);
        let mut regular = RegularWriters::start(events);
        let mut pending = Vec::<Request>::new();
        let mut quick_queue = VecDeque::<Request>::new();
        let mut slow_queue = VecDeque::<Request>::new();
        let mut write_queue = VecDeque::<Request>::new();
        let mut scratch = Vec::new();
        loop {
            let next = if pending.is_empty()
                && quick_queue.is_empty()
                && slow_queue.is_empty()
                && write_queue.is_empty()
                && quick.active == 0
                && slow.active == 0
                && writers.active == 0
            {
                receiver
                    .recv()
                    .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
            } else {
                // Outstanding stream reads and open cancellation still need periodic scans. Otherwise an idle
                // reactor blocks without a timer, and a helper completion wakes it directly.
                receiver.recv_timeout(Duration::from_millis(10))
            };
            let event = match next {
                Ok(event) => Some(event),
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
                Err(mpsc::RecvTimeoutError::Timeout) => None,
            };
            let Some(server) = server.upgrade() else {
                return;
            };
            let mut arrivals = Vec::new();
            // Interrupted quick requests leave no descriptor behind. If open succeeded concurrently, do not retry
            // it: preserve that exact descriptor, including an empty writer's completed rendezvous.
            quick.interrupt(true);
            slow.interrupt(false);
            writers.interrupt(false);
            for event in event
                .into_iter()
                .chain(receiver.try_iter().take(crate::MAX_HANDLES))
            {
                match event {
                    Event::Request(request) => arrivals.push(request),
                    Event::Opened {
                        opened,
                        slow: is_slow,
                    } => {
                        let writing =
                            matches!(opened.request.operation, Operation::WriteOpen { .. });
                        let pool = if writing {
                            &mut writers
                        } else if is_slow {
                            &mut slow
                        } else {
                            &mut quick
                        };
                        pool.active -= 1;
                        if let Some(request) = complete_open(&server, opened) {
                            match &request.operation {
                                Operation::Write { handle, .. } if !handle.stream => {
                                    regular.submit(&server, request);
                                }
                                Operation::Write { .. } => pending.push(request),
                                Operation::WriteOpen { .. } => write_queue.push_back(request),
                                _ => slow_queue.push_back(request),
                            }
                        }
                    }
                    Event::Written { request, result } => {
                        regular.active -= 1;
                        request.finish(&server, result.map(|()| (json!({}), Vec::new())));
                    }
                }
            }
            for request in arrivals {
                if pending.len()
                    + quick_queue.len()
                    + slow_queue.len()
                    + write_queue.len()
                    + quick.active
                    + slow.active
                    + writers.active
                    + regular.active
                    >= crate::MAX_HANDLES
                {
                    finish_response(
                        &server,
                        request.id,
                        false,
                        Err(Failure::new("EMFILE", "too many pending stream requests")),
                    );
                    continue;
                }
                match &request.operation {
                    Operation::Open { slow: true, .. } => slow_queue.push_back(request),
                    Operation::Open { slow: false, .. } => quick_queue.push_back(request),
                    Operation::WriteOpen { .. } => write_queue.push_back(request),
                    Operation::Write { handle, .. } if !handle.stream => {
                        regular.submit(&server, request);
                    }
                    Operation::Read { .. } | Operation::Write { .. } => pending.push(request),
                }
            }
            for (queue, pool, quick_pool) in [
                (&mut quick_queue, &mut quick, true),
                (&mut slow_queue, &mut slow, false),
                (&mut write_queue, &mut writers, false),
            ] {
                let count = queue.len();
                for _ in 0..count {
                    let request = queue.pop_front().unwrap();
                    if request.control.aborted.load(Ordering::SeqCst) {
                        finish_response(
                            &server,
                            request.id,
                            false,
                            Err(Failure::new("aborted", "aborted")),
                        );
                    } else if pool.active < crate::WORKERS {
                        pool.submit(request);
                    } else if quick_pool {
                        queue.push_back(request);
                    } else {
                        finish_response(
                            &server,
                            request.id,
                            false,
                            Err(Failure::new("EMFILE", "too many pending FIFO opens")),
                        );
                    }
                }
            }
            let mut index = 0;
            let mut writing = HashSet::new();
            while index < pending.len() {
                if let Operation::Write { handle, .. } = &pending[index].operation
                    && !writing.insert(Arc::as_ptr(handle))
                {
                    index += 1;
                    continue;
                }
                let result = if matches!(pending[index].operation, Operation::Write { .. }) {
                    pending[index].attempt_write()
                } else {
                    pending[index].attempt_read(&mut scratch)
                };
                if let Some(result) = result {
                    let request = pending.remove(index);
                    request.finish(&server, result);
                } else {
                    index += 1;
                }
            }
        }
    });
    sender
}

#[cfg(test)]
mod tests {
    use super::*;

    struct OrdinaryWriteGate {
        path: String,
        entered: mpsc::Sender<()>,
        release: mpsc::Receiver<()>,
    }

    static ORDINARY_WRITE_GATE: Mutex<Option<OrdinaryWriteGate>> = Mutex::new(None);

    pub(super) fn before_ordinary_write(handle: &FileHandle) {
        let gate = {
            let mut gate = ORDINARY_WRITE_GATE.lock().unwrap();
            if !handle.stream && gate.as_ref().is_some_and(|gate| gate.path == handle.path) {
                gate.take()
            } else {
                None
            }
        };
        if let Some(gate) = gate {
            assert!(handle.file.metadata().unwrap().is_file());
            gate.entered.send(()).unwrap();
            // Dropping the test's sender also releases the descriptor boundary during panic unwinding.
            let _ = gate.release.recv();
        }
    }

    #[test]
    fn blocked_ordinary_initial_write_does_not_block_stream_progress_or_cancellation() {
        const CHILD: &str = "PI_ENV_ORDINARY_WRITE_REACTOR_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "special::tests::blocked_ordinary_initial_write_does_not_block_stream_progress_or_cancellation", "--nocapture"])
                .env(CHILD, "1").spawn().unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(20);
            loop {
                if let Some(status) = child.try_wait().unwrap() {
                    assert!(status.success(), "isolated ordinary writer regression failed: {status}");
                    return;
                }
                if std::time::Instant::now() >= deadline {
                    child.kill().unwrap();
                    child.wait().unwrap();
                    panic!("isolated ordinary writer regression timed out");
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        install_interrupt().unwrap();
        let root = sys::mkdtemp(&format!("{}/pi-env-ordinary-writer-reactor-", sys::tmpdir())).unwrap();
        let path = std::path::Path::new(&root).join("ordinary").to_string_lossy().into_owned();
        let output = Arc::new(crate::Output::default());
        let server = Arc::new(Server {
            output: output.clone(), tmpdir: root.clone(), handles: Mutex::default(),
            next_handle: std::sync::atomic::AtomicU64::new(1), controls: Mutex::default(),
            groups: Arc::default(), terminals: Arc::default(), special: Mutex::new(None),
        });
        let sender = start(Arc::downgrade(&server));
        *server.special.lock().unwrap() = Some(Sender(sender.0.clone()));
        let (mut replies, mut wire) = std::os::unix::net::UnixStream::pair().unwrap();
        replies.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let writer_output = output.clone();
        let writer = std::thread::spawn(move || writer_output.run(&mut wire));
        let stream = || {
            let (reader, peer) = std::os::unix::net::UnixStream::pair().unwrap();
            reader.set_nonblocking(true).unwrap();
            let fd: std::os::fd::OwnedFd = reader.into();
            let file = File::from(fd);
            assert!(is_stream(&file));
            (Arc::new(FileHandle {
                file, path: "ordinary-write-regression-stream".into(), stream: true,
                failed: AtomicBool::new(false), serial: Mutex::default(),
            }), peer)
        };
        let (idle, idle_peer) = stream();
        let cancelled = Arc::new(Control::default());
        server.controls.lock().unwrap().insert(2, cancelled.clone());
        assert!(sender.try_send(Request {
            id: 2, control: cancelled.clone(),
            operation: Operation::Read { handle: idle, offset: None, length: 1 },
        }).is_ok());
        let (readable, mut peer) = stream();
        peer.write_all(b"bp").unwrap();
        assert!(sender.try_send(Request {
            id: 3, control: Arc::default(),
            operation: Operation::Read { handle: readable.clone(), offset: None, length: 1 },
        }).is_ok());
        // A real stream completion proves the earlier idle read has reached this reactor before the gate.
        let barrier = crate::frame::read_frame(&mut replies).unwrap().unwrap();
        assert_eq!((barrier.id, barrier.kind, barrier.payload.as_slice()), (3, crate::frame::RESULT, b"b".as_slice()));
        let (entered, ready) = mpsc::channel();
        let (release, held) = mpsc::channel();
        *ORDINARY_WRITE_GATE.lock().unwrap() = Some(OrdinaryWriteGate {
            path: path.clone(), entered, release: held,
        });
        let ordinary_control = Arc::new(Control::default());
        server.controls.lock().unwrap().insert(1, ordinary_control.clone());
        crate::respond(&server, 1, crate::frame::Frame::with_payload(crate::frame::REQUEST, 1,
            json!({ "op": "write", "path": path, "keep": true }), b"ordinary payload".to_vec()), ordinary_control);
        ready.recv_timeout(Duration::from_secs(3)).expect("ordinary descriptor never reached its actual payload-write boundary");
        cancelled.cancel(false);
        assert!(sender.try_send(Request {
            id: 4, control: Arc::default(),
            operation: Operation::Read { handle: readable, offset: None, length: 1 },
        }).is_ok());
        // The gate stays closed until BOTH an existing read's cancellation and a new stream read settle.
        // The timeout only guards deadlock; the entered/release handshake establishes the blocked syscall.
        let mut frames = Vec::new();
        let progress = (|| -> io::Result<()> {
            for _ in 0..2 {
                frames.push(crate::frame::read_frame(&mut replies)?
                    .ok_or_else(|| io::Error::other("reactor output closed while ordinary write was held"))?);
            }
            Ok(())
        })();
        let ordinary_still_pending = server.controls.lock().unwrap().contains_key(&1);
        let cancellation_settled = !server.controls.lock().unwrap().contains_key(&2);
        release.send(()).unwrap();
        let mut all = frames.len();
        let mut ordinary_reply = None;
        while all < 3 {
            let reply = crate::frame::read_frame(&mut replies).unwrap().unwrap();
            if reply.id == 1 { ordinary_reply = Some(reply); }
            all += 1;
        }
        let bytes = std::fs::read(&path).unwrap();
        server.handles.lock().unwrap().clear();
        output.close();
        writer.join().unwrap();
        drop(idle_peer);
        drop(peer);
        drop(sender);
        drop(server);
        std::fs::remove_dir_all(root).unwrap();
        progress.expect("blocked ordinary payload write prevented reactor cancellation and another stream read from progressing");
        assert!(ordinary_still_pending, "ordinary write must remain held until the gate is released");
        assert!(cancellation_settled, "cancelled stream control must settle before releasing the ordinary write");
        let cancelled = frames.iter().find(|reply| reply.id == 2).expect("missing stream cancellation");
        assert_eq!(cancelled.kind, crate::frame::ERROR);
        assert_eq!(cancelled.json["code"], "aborted");
        let read = frames.iter().find(|reply| reply.id == 4).expect("missing independent stream read");
        assert_eq!(read.kind, crate::frame::RESULT);
        assert_eq!(read.payload, b"p");
        let ordinary = ordinary_reply.expect("ordinary write must settle after its gate is released");
        assert_eq!(ordinary.kind, crate::frame::RESULT);
        assert!(ordinary.json["handle"].as_u64().is_some(), "keep must retain the successfully opened ordinary descriptor");
        assert_eq!(bytes, b"ordinary payload");
    }

    #[test]
    fn serial_ordinary_opens_notify_the_arrival_receiver_without_another_request() {
        let root = sys::mkdtemp(&format!("{}/pi-env-open-notify-", sys::tmpdir())).unwrap();
        let path = std::path::Path::new(&root).join("regular");
        std::fs::write(&path, b"ordinary").unwrap();
        let (events, receiver) = mpsc::sync_channel(crate::MAX_HANDLES);
        let sender = Sender(events.clone());
        let mut quick = Openers::start(events, false);
        for id in 1..=4 {
            assert!(
                sender
                    .try_send(Request {
                        id,
                        control: Arc::new(Control::default()),
                        operation: Operation::Open {
                            path: path.to_string_lossy().into_owned(),
                            slow: false,
                        },
                    })
                    .is_ok()
            );
            let Event::Request(request) = receiver.recv_timeout(Duration::from_secs(3)).unwrap()
            else {
                panic!("expected the next ordinary open request");
            };
            assert_eq!(request.id, id);
            quick.submit(request);
            // This is the same wait used for arrivals, with no further request to wake it. The timeout is only
            // a deadlock guard, not a latency threshold: completion itself must provide the next event.
            let Event::Opened { opened, slow } =
                receiver.recv_timeout(Duration::from_secs(3)).unwrap()
            else {
                panic!("expected the ordinary helper to notify completion");
            };
            assert!(!slow);
            assert_eq!(opened.request.id, id);
            let mut file = opened
                .result
                .unwrap()
                .expect("ordinary open owns its descriptor");
            let mut content = String::new();
            file.read_to_string(&mut content).unwrap();
            assert_eq!(content, "ordinary");
            quick.active -= 1;
            assert!(matches!(
                receiver.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
        }
        drop(quick);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_and_cancelled_opens_notify_the_same_receiver_with_original_errors() {
        let root = sys::mkdtemp(&format!("{}/pi-env-open-errors-", sys::tmpdir())).unwrap();
        let path = std::path::Path::new(&root).join("missing");
        let (events, receiver) = mpsc::sync_channel(crate::MAX_HANDLES);
        let mut slow = Openers::start(events, true);
        for (id, aborted) in [(1, false), (2, true)] {
            let control = Arc::new(Control::default());
            if aborted {
                control.cancel(false);
            }
            slow.submit(Request {
                id,
                control,
                operation: Operation::Open {
                    path: path.to_string_lossy().into_owned(),
                    slow: true,
                },
            });
            let Event::Opened {
                opened,
                slow: is_slow,
            } = receiver.recv_timeout(Duration::from_secs(3)).unwrap()
            else {
                panic!("expected an error completion without another request");
            };
            assert!(is_slow);
            assert_eq!(opened.request.id, id);
            let error = opened.result.unwrap_err();
            assert_eq!(
                sys::error_name(&error),
                if aborted { "aborted" } else { "ENOENT" }
            );
            slow.active -= 1;
            assert!(matches!(
                receiver.try_recv(),
                Err(mpsc::TryRecvError::Empty)
            ));
        }
        drop(slow);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn initial_deferral_still_attempts_regular_open_but_never_ignores_cancellation() {
        let root = sys::mkdtemp(&format!("{}/pi-env-open-defer-", sys::tmpdir())).unwrap();
        let path = std::path::Path::new(&root).join("regular");
        std::fs::write(&path, b"ordinary").unwrap();
        let control = Control::default();
        let defer = AtomicBool::new(true);
        let mut file = open_mode(&path.to_string_lossy(), libc::O_RDONLY, &control, &defer)
            .unwrap()
            .expect(
                "initial deferral cannot send an unattempted regular open behind stalled FIFOs",
            );
        let mut content = String::new();
        file.read_to_string(&mut content).unwrap();
        assert_eq!(content, "ordinary");
        control.cancel(false);
        let cancelled = open_mode(&path.to_string_lossy(), libc::O_RDONLY, &control, &defer).unwrap_err();
        assert_eq!(sys::error_name(&cancelled), "aborted");
        drop(file);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn misclassified_fifo_keeps_the_original_empty_writer_rendezvous() {
        const CHILD: &str = "PI_ENV_FIFO_INTERRUPT_CHILD";
        if std::env::var_os(CHILD).is_none() {
            // SIGUSR2 belongs to the standalone daemon, never the test runner's global signal state.
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "special::tests::misclassified_fifo_keeps_the_original_empty_writer_rendezvous", "--nocapture"])
                .env(CHILD, "1")
                .spawn()
                .unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(15);
            loop {
                if let Some(status) = child.try_wait().unwrap() {
                    assert!(status.success(), "isolated FIFO interruption regression failed: {status}");
                    return;
                }
                if std::time::Instant::now() >= deadline {
                    child.kill().unwrap();
                    child.wait().unwrap();
                    panic!("isolated FIFO interruption regression timed out");
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        install_interrupt().unwrap();
        let root = sys::mkdtemp(&format!("{}/pi-env-open-race-", sys::tmpdir())).unwrap();
        let path = std::path::Path::new(&root).join("fifo");
        let raw = CString::new(path.as_os_str().as_bytes()).unwrap();
        // SAFETY: NUL-terminated path in a private test directory.
        assert_eq!(unsafe { libc::mkfifo(raw.as_ptr(), 0o600) }, 0);
        let regular = std::path::Path::new(&root).join("regular");
        std::fs::write(&regular, b"ordinary").unwrap();
        let (events, receiver) = mpsc::sync_channel(crate::MAX_HANDLES);
        let mut quick = Openers::start(events.clone(), false);
        let mut slow = Openers::start(events, true);
        let controls: Vec<_> = (0..crate::WORKERS).map(|_| Arc::new(Control::default())).collect();
        for (id, control) in controls.iter().enumerate() {
            quick.submit(Request {
                id: id as u32,
                control: control.clone(),
                operation: Operation::Open { path: path.to_string_lossy().into_owned(), slow: false },
            });
        }
        wait_registered(&quick, crate::WORKERS);
        // Every quick worker is occupied by a misclassified FIFO. Actual SIGUSR2 interruption must transfer
        // each unopened request to the slow pool, freeing capacity without any writer rendezvous.
        for _ in 0..crate::WORKERS {
            let Event::Opened { opened, slow: is_slow } = interrupted_completion(&quick, &receiver, true) else {
                panic!("expected a deferred open");
            };
            assert!(!is_slow);
            assert!(opened.result.unwrap().is_none());
            quick.active -= 1;
            slow.submit(opened.request);
        }
        wait_registered(&slow, crate::WORKERS);
        quick.submit(Request {
            id: 100,
            control: Arc::new(Control::default()),
            operation: Operation::Open { path: regular.to_string_lossy().into_owned(), slow: false },
        });
        let Event::Opened { opened, slow: is_slow } = receiver.recv_timeout(Duration::from_secs(3)).unwrap() else {
            panic!("ordinary open did not complete while slow FIFOs were blocked");
        };
        assert!(!is_slow);
        assert_eq!(opened.request.id, 100);
        let mut content = String::new();
        opened.result.unwrap().unwrap().read_to_string(&mut content).unwrap();
        assert_eq!(content, "ordinary");
        quick.active -= 1;
        for control in &controls { control.cancel(false); }
        for _ in 0..crate::WORKERS {
            let Event::Opened { opened, slow: is_slow } = interrupted_completion(&slow, &receiver, false) else {
                panic!("expected cancellation of a deferred FIFO");
            };
            assert!(is_slow);
            assert_eq!(sys::error_name(&opened.result.unwrap_err()), "aborted");
            slow.active -= 1;
        }

        // Interrupt around a writer rendezvous. A nonblocking writer can succeed even when the reader syscall
        // returns EINTR, so retain that one writer until quick completion or quick-to-slow transfer completes.
        // Then close it and require EOF from the transferred reader without ever opening another writer.
        use std::os::unix::fs::OpenOptionsExt;
        for id in 200..216 {
            quick.submit(Request {
                id,
                control: Arc::new(Control::default()),
                operation: Operation::Open { path: path.to_string_lossy().into_owned(), slow: false },
            });
            wait_registered(&quick, 1);
            let writer_path = path.clone();
            let (release_writer, held_writer) = mpsc::channel();
            let writer = std::thread::spawn(move || {
                let deadline = std::time::Instant::now() + Duration::from_secs(3);
                loop {
                    match std::fs::OpenOptions::new().write(true).custom_flags(libc::O_NONBLOCK).open(&writer_path) {
                        Ok(writer) => {
                            held_writer.recv_timeout(Duration::from_secs(5)).unwrap();
                            drop(writer);
                            return;
                        }
                        Err(error) if error.raw_os_error() == Some(libc::ENXIO) && std::time::Instant::now() < deadline => std::thread::yield_now(),
                        Err(error) => panic!("writer did not rendezvous: {error}"),
                    }
                }
            });
            let Event::Opened { mut opened, slow: is_slow } = interrupted_completion(&quick, &receiver, true) else {
                panic!("expected the interrupted FIFO completion");
            };
            assert!(!is_slow);
            quick.active -= 1;
            if matches!(&opened.result, Ok(None)) {
                slow.submit(opened.request);
                let Event::Opened { opened: transferred, slow: is_slow } = receiver.recv_timeout(Duration::from_secs(3)).unwrap() else {
                    panic!("expected the transferred FIFO completion");
                };
                assert!(is_slow);
                slow.active -= 1;
                opened = transferred;
            }
            release_writer.send(()).unwrap();
            writer.join().unwrap();
            assert_eq!(opened.request.id, id);
            let mut file = opened.result.unwrap().expect("successful rendezvous must transfer its original descriptor");
            // Nonblocking read turns a lost rendezvous into a deterministic failure, not a hung test.
            unsafe {
                let flags = libc::fcntl(file.as_raw_fd(), libc::F_GETFL);
                assert!(flags >= 0);
                assert_eq!(libc::fcntl(file.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK), 0);
            }
            assert_eq!(file.read(&mut [0]).unwrap(), 0);
        }
        drop(quick);
        drop(slow);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn saturated_distinct_fifo_pools_reject_a_fresh_pair_without_waiting_for_rendezvous() {
        const CHILD: &str = "PI_ENV_FIFO_SATURATION_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "special::tests::saturated_distinct_fifo_pools_reject_a_fresh_pair_without_waiting_for_rendezvous", "--nocapture"])
                .env(CHILD, "1")
                .spawn()
                .unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(15);
            loop {
                if let Some(status) = child.try_wait().unwrap() {
                    assert!(status.success(), "isolated FIFO saturation regression failed: {status}");
                    return;
                }
                if std::time::Instant::now() >= deadline {
                    child.kill().unwrap();
                    child.wait().unwrap();
                    panic!("isolated FIFO saturation regression timed out");
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        install_interrupt().unwrap();
        for writing in [false, true] {
            let root = sys::mkdtemp(&format!("{}/pi-env-fifo-saturation-", sys::tmpdir())).unwrap();
            let output = Arc::new(crate::Output::default());
            let server = Arc::new(Server {
                output: output.clone(), tmpdir: root.clone(), handles: Mutex::default(),
                next_handle: std::sync::atomic::AtomicU64::new(1), controls: Mutex::default(),
                groups: Arc::default(), terminals: Arc::default(), special: Mutex::new(None),
            });
            let sender = start(Arc::downgrade(&server));
            let (mut replies, mut wire) = std::os::unix::net::UnixStream::pair().unwrap();
            replies.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let writer_output = output.clone();
            let writer = std::thread::spawn(move || writer_output.run(&mut wire));
            let fifo = |name: &str| {
                let path = std::path::Path::new(&root).join(name);
                let raw = CString::new(path.as_os_str().as_bytes()).unwrap();
                // SAFETY: NUL-terminated path in this test's private directory.
                assert_eq!(unsafe { libc::mkfifo(raw.as_ptr(), 0o600) }, 0);
                path.to_string_lossy().into_owned()
            };
            let operation = |path, writing| if writing {
                Operation::WriteOpen { path, append: false, content: b"input".to_vec(), keep: false }
            } else {
                Operation::Open { path, slow: true }
            };
            let controls: Vec<_> = (0..crate::WORKERS + 2).map(|_| Arc::new(Control::default())).collect();
            for (id, control) in controls.iter().take(crate::WORKERS).enumerate() {
                assert!(sender.try_send(Request {
                    id: id as u32, control: control.clone(), operation: operation(fifo(&format!("unmatched-{id}")), writing),
                }).is_ok());
            }
            let regular = std::path::Path::new(&root).join("ordinary");
            std::fs::write(&regular, b"available").unwrap();
            assert!(sender.try_send(Request {
                id: 100, control: Arc::default(),
                operation: Operation::Open { path: regular.to_string_lossy().into_owned(), slow: false },
            }).is_ok());
            // The completion wakes the actual reactor after all earlier FIFO arrivals consumed pool slots.
            let barrier = crate::frame::read_frame(&mut replies).unwrap().unwrap();
            assert_eq!(barrier.id, 100);
            assert_eq!(barrier.kind, crate::frame::RESULT);
            let fresh = fifo("fresh");
            for (id, same_side) in [(200, true), (201, false)] {
                assert!(sender.try_send(Request {
                    id, control: controls[crate::WORKERS + usize::from(!same_side)].clone(),
                    operation: operation(fresh.clone(), if same_side { writing } else { !writing }),
                }).is_ok());
            }
            let refused = crate::frame::read_frame(&mut replies)
                .expect("saturated rendezvous admission must settle without releasing unmatched FIFOs")
                .unwrap();
            assert_eq!(refused.id, 200);
            assert_eq!(refused.kind, crate::frame::ERROR);
            assert_eq!(refused.json["code"], "EMFILE");
            for control in &controls { control.cancel(false); }
            for _ in 0..crate::WORKERS + 1 {
                let cancelled = crate::frame::read_frame(&mut replies).unwrap().unwrap();
                assert_eq!(cancelled.kind, crate::frame::ERROR);
                assert_eq!(cancelled.json["code"], "aborted");
            }
            server.handles.lock().unwrap().clear();
            output.close();
            writer.join().unwrap();
            drop(sender);
            drop(server);
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    fn wait_registered(pool: &Openers, count: usize) {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while pool.registrations.iter().filter(|slot| slot.lock().unwrap().is_some()).count() != count {
            assert!(std::time::Instant::now() < deadline, "FIFO helpers did not register");
            std::thread::yield_now();
        }
    }

    fn interrupted_completion(pool: &Openers, receiver: &mpsc::Receiver<Event>, defer: bool) -> Event {
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            // Repeat to cover registration becoming visible just before the helper enters libc::open.
            pool.interrupt(defer);
            match receiver.recv_timeout(Duration::from_millis(5)) {
                Ok(event) => return event,
                Err(mpsc::RecvTimeoutError::Timeout) if std::time::Instant::now() < deadline => {}
                Err(error) => panic!("interrupted helper did not complete: {error}"),
            }
        }
    }
}
