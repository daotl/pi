//! Unix stream reads must not retain ordinary file workers while waiting for a writer or bytes.

use crate::{Control, Failure, FileHandle, Server, finish_response, sys};
use serde_json::json;
use std::collections::VecDeque;
use std::ffi::CString;
use std::fs::File;
use std::io::{self, Read};
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
}

pub fn is_stream(file: &File) -> bool {
    file.metadata()
        .is_ok_and(|metadata| !metadata.is_file() && !metadata.is_dir())
}

extern "C" fn interrupt_open(_signal: libc::c_int) {}

/// This standalone daemon reserves SIGUSR2 solely to interrupt its bounded read-open helpers. Install before any
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
}

pub struct Sender(SyncSender<Event>);

impl Sender {
    pub fn try_send(&self, request: Request) -> Result<(), ()> {
        self.0.try_send(Event::Request(request)).map_err(|_| ())
    }
}

fn blocking_open(path: &str, control: &Control, defer: &AtomicBool) -> io::Result<Option<File>> {
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
        let fd = unsafe { libc::open(path.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC) };
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
                    let Operation::Open { path, .. } = &job.request.operation else {
                        unreachable!()
                    };
                    // SAFETY: pthread_self identifies this live, exclusively owned helper thread.
                    *slot.lock().unwrap() = Some(Active {
                        thread: unsafe { libc::pthread_self() },
                        control: job.request.control.clone(),
                        defer: job.defer.clone(),
                    });
                    let registered = Registered(slot.clone());
                    let result = if mask_error == 0 {
                        blocking_open(path, &job.request.control, &job.defer)
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

impl Request {
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
    if matches!(&opened.result, Ok(None)) && !opened.request.control.aborted.load(Ordering::SeqCst)
    {
        return Some(opened.request);
    }
    let result = (|| {
        if opened.request.control.aborted.load(Ordering::SeqCst) {
            return Err(Failure::new("aborted", "aborted"));
        }
        let Operation::Open { path, .. } = &opened.request.operation else {
            unreachable!()
        };
        let file = opened
            .result
            .map_err(|error| Failure::io(&error, "open", path))?
            .expect("nondeferred open owns a descriptor");
        // SAFETY: the completed helper transferred exclusive ownership of this live descriptor.
        unsafe {
            let flags = libc::fcntl(file.as_raw_fd(), libc::F_GETFL);
            if flags < 0
                || libc::fcntl(file.as_raw_fd(), libc::F_SETFL, flags | libc::O_NONBLOCK) < 0
            {
                return Err(Failure::io(&io::Error::last_os_error(), "open", path));
            }
        }
        server.open_read(file, path).map(|json| (json, Vec::new()))
    })();
    finish_response(server, opened.request.id, false, result);
    None
}

/// Metadata selects only a queue, never how to open. Quick opens that unexpectedly block are interrupted and
/// deferred after one reactor pass, freeing their pool even if a regular pathname became a FIFO. A successful
/// descriptor always transfers unchanged. Slow and quick helpers, queues, and cancellation scans remain bounded.
pub fn start(server: Weak<Server>) -> Sender {
    // Both arrivals and helper completions wake this bounded receiver. In particular, an ordinary open must
    // not wait for a cancellation poll merely because no further request arrives.
    let (events, receiver) = mpsc::sync_channel::<Event>(crate::MAX_HANDLES);
    let sender = Sender(events.clone());
    std::thread::spawn(move || {
        let mut quick = Openers::start(events.clone(), false);
        let mut slow = Openers::start(events, true);
        let mut pending = Vec::<Request>::new();
        let mut quick_queue = VecDeque::<Request>::new();
        let mut slow_queue = VecDeque::<Request>::new();
        let mut scratch = Vec::new();
        loop {
            let next = if pending.is_empty()
                && quick_queue.is_empty()
                && slow_queue.is_empty()
                && quick.active == 0
                && slow.active == 0
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
                        let pool = if is_slow { &mut slow } else { &mut quick };
                        pool.active -= 1;
                        if let Some(request) = complete_open(&server, opened) {
                            slow_queue.push_back(request);
                        }
                    }
                }
            }
            for request in arrivals {
                if pending.len() + quick_queue.len() + slow_queue.len() + quick.active + slow.active
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
                    Operation::Read { .. } => pending.push(request),
                }
            }
            for (queue, pool) in [(&mut quick_queue, &mut quick), (&mut slow_queue, &mut slow)] {
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
                    } else {
                        queue.push_back(request);
                    }
                }
            }
            let mut index = 0;
            while index < pending.len() {
                if let Some(result) = pending[index].attempt_read(&mut scratch) {
                    let request = pending.swap_remove(index);
                    finish_response(&server, request.id, false, result);
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
        let mut file = blocking_open(&path.to_string_lossy(), &control, &defer)
            .unwrap()
            .expect(
                "initial deferral cannot send an unattempted regular open behind stalled FIFOs",
            );
        let mut content = String::new();
        file.read_to_string(&mut content).unwrap();
        assert_eq!(content, "ordinary");
        control.cancel(false);
        let cancelled = blocking_open(&path.to_string_lossy(), &control, &defer).unwrap_err();
        assert_eq!(sys::error_name(&cancelled), "aborted");
        drop(file);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn misclassified_fifo_keeps_the_original_empty_writer_rendezvous() {
        use std::os::unix::fs::OpenOptionsExt;
        let root = sys::mkdtemp(&format!("{}/pi-env-open-race-", sys::tmpdir())).unwrap();
        let path = std::path::Path::new(&root).join("fifo");
        let raw = CString::new(path.as_os_str().as_bytes()).unwrap();
        // SAFETY: NUL-terminated path in a private test directory.
        assert_eq!(unsafe { libc::mkfifo(raw.as_ptr(), 0o600) }, 0);
        let (events, receiver) = mpsc::sync_channel(crate::MAX_HANDLES);
        let mut quick = Openers::start(events, false);
        // Force the exact metadata/open race state without probabilistic renames: a FIFO enters the quick pool
        // with the same hint a just-replaced regular path would carry.
        quick.submit(Request {
            id: 1,
            control: Arc::new(Control::default()),
            operation: Operation::Open {
                path: path.to_string_lossy().into_owned(),
                slow: false,
            },
        });
        // An empty writer's successful open/close proves the reader rendezvoused. Keep retrying ENXIO only while
        // the helper has not entered its real blocking open; no wall-clock sleep or writer payload hides the race.
        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        loop {
            match std::fs::OpenOptions::new()
                .write(true)
                .custom_flags(libc::O_NONBLOCK)
                .open(&path)
            {
                Ok(writer) => {
                    drop(writer);
                    break;
                }
                Err(error)
                    if error.raw_os_error() == Some(libc::ENXIO)
                        && std::time::Instant::now() < deadline =>
                {
                    std::thread::yield_now();
                }
                Err(error) => panic!("writer did not rendezvous: {error}"),
            }
        }
        let Event::Opened { opened, slow } = receiver.recv_timeout(Duration::from_secs(3)).unwrap()
        else {
            panic!("expected the completed FIFO open");
        };
        assert!(!slow);
        let mut file = opened
            .result
            .unwrap()
            .expect("successful rendezvous must transfer its original descriptor");
        let mut byte = [0];
        assert_eq!(file.read(&mut byte).unwrap(), 0);
        drop(file);
        drop(quick);
        std::fs::remove_dir_all(root).unwrap();
    }
}
