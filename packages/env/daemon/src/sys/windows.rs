//! Windows, following libuv (`src/win/error.c`, `src/win/process.c`, `src/win/fs.c`) and Node's `child_process`.

use super::{OpenMode, ShellConfig, path_exists, synthetic};
use crate::errors::Failure;
use serde_json::{Map, Value};
use std::collections::hash_map::RandomState;
use std::ffi::OsStr;
use std::fs::{File, Metadata};
use std::hash::{BuildHasher, Hasher};
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::FileExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::os::windows::process::{CommandExt, ExitStatusExt};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{
    CloseHandle, DUPLICATE_SAME_ACCESS, DuplicateHandle, HANDLE, INVALID_HANDLE_VALUE,
    WAIT_OBJECT_0,
};
use windows_sys::Win32::Globalization::CompareStringOrdinal;
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, CREATE_ALWAYS, CreateFileW, FILE_APPEND_DATA,
    FILE_ATTRIBUTE_NORMAL, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    FILE_WRITE_DATA, GetFileInformationByHandle, MOVEFILE_REPLACE_EXISTING, MoveFileExW,
    OPEN_ALWAYS, OPEN_EXISTING,
};
use windows_sys::Win32::System::IO::CancelSynchronousIo;
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicAccountingInformation,
    JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
    TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess, GetExitCodeProcess, INFINITE,
    InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST,
    PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, UpdateProcThreadAttribute, WaitForSingleObject,
};

/// libuv's `uv_translate_sys_error` for the errors file and process operations produce.
pub fn os_error_name(error: &io::Error) -> &'static str {
    let Some(code) = error.raw_os_error() else {
        return "UNKNOWN";
    };
    match code {
        1 => "EISDIR",                             // ERROR_INVALID_FUNCTION
        2 | 3 | 15 | 123 | 161 | 4392 => "ENOENT", // FILE_NOT_FOUND, PATH_NOT_FOUND, INVALID_DRIVE, INVALID_NAME, BAD_PATHNAME, INVALID_REPARSE_DATA
        4 => "EMFILE",                             // ERROR_TOO_MANY_OPEN_FILES
        5 | 1314 => "EPERM",                       // ACCESS_DENIED, PRIVILEGE_NOT_HELD
        6 => "EBADF",                              // ERROR_INVALID_HANDLE
        8 | 14 => "ENOMEM",                        // NOT_ENOUGH_MEMORY, OUTOFMEMORY
        17 => "EXDEV",                             // ERROR_NOT_SAME_DEVICE
        19 => "EROFS",                             // ERROR_WRITE_PROTECT
        32 | 33 => "EBUSY",                        // SHARING_VIOLATION, LOCK_VIOLATION
        39 | 82 | 112 => "ENOSPC",                 // HANDLE_DISK_FULL, CANNOT_MAKE, DISK_FULL
        50 => "ENOTSUP",                           // ERROR_NOT_SUPPORTED
        80 | 183 => "EEXIST",                      // FILE_EXISTS, ALREADY_EXISTS
        13 | 87 | 122 | 131 | 1464 => "EINVAL", // INVALID_DATA, INVALID_PARAMETER, INSUFFICIENT_BUFFER, NEGATIVE_SEEK, SYMLINK_NOT_SUPPORTED
        126 => "ENOENT",                        // ERROR_MOD_NOT_FOUND
        145 => "ENOTEMPTY",                     // ERROR_DIR_NOT_EMPTY
        206 => "ENAMETOOLONG",                  // ERROR_FILENAME_EXCED_RANGE
        267 => "ENOENT",                        // ERROR_DIRECTORY (libuv maps it to ENOENT)
        998 => "EFAULT",                        // ERROR_NOACCESS
        740 | 1920 => "EACCES",                 // ELEVATION_REQUIRED, CANT_ACCESS_FILE
        1921 => "ELOOP",                        // ERROR_CANT_RESOLVE_FILENAME
        _ => "UNKNOWN",
    }
}

pub const PATH_SEPARATOR: &str = "\\";

pub fn read_at(file: &File, buffer: &mut [u8], offset: u64) -> io::Result<usize> {
    file.seek_read(buffer, offset)
}

/// Modification time as seconds and nanoseconds since the epoch; before 1970 the seconds are negative.
pub fn mtime(metadata: &Metadata) -> (i64, i64) {
    let Ok(time) = metadata.modified() else {
        return (0, 0);
    };
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => (after.as_secs() as i64, i64::from(after.subsec_nanos())),
        Err(before) => {
            let before = before.duration();
            let nanos = i64::from(before.subsec_nanos());
            if nanos == 0 {
                (-(before.as_secs() as i64), 0)
            } else {
                (-(before.as_secs() as i64) - 1, 1_000_000_000 - nanos)
            }
        }
    }
}

/// File index numbers need a handle per file; the creation time tells a replaced file or directory apart instead.
pub fn identity(metadata: &Metadata) -> (u64, u64) {
    use std::os::windows::fs::MetadataExt;
    (0, metadata.creation_time())
}

/// Node's `os.tmpdir()` on Windows.
pub fn tmpdir() -> String {
    let variable = |key: &str| std::env::var(key).ok().filter(|value| !value.is_empty());
    let mut path = variable("TEMP")
        .or_else(|| variable("TMP"))
        .unwrap_or_else(|| {
            format!(
                "{}\\temp",
                variable("SystemRoot")
                    .or_else(|| variable("windir"))
                    .unwrap_or_default()
            )
        });
    if path.len() > 1 && path.ends_with('\\') && !path.ends_with(":\\") {
        path.pop();
    }
    path
}

/// libuv's `uv_os_homedir`: `USERPROFILE` first.
pub fn home() -> String {
    std::env::var("USERPROFILE").unwrap_or_default()
}

/// A NUL-terminated wide path; an embedded NUL fails like the standard library's path conversion (Node rejects such
/// paths before any system call, which the client reports with the same code).
fn wide(text: &str) -> io::Result<Vec<u16>> {
    if text.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path contains a NUL byte",
        ));
    }
    Ok(OsStr::new(text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect())
}

/// libuv's `fs__mkdtemp`: `prefix` plus six characters from `[a-zA-Z0-9]`, retried while the name exists.
pub fn mkdtemp(prefix: &str) -> io::Result<String> {
    const CHARACTERS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let state = RandomState::new();
    for _ in 0..1000 {
        let mut hasher = state.build_hasher();
        hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
        let mut random = hasher.finish();
        let mut path = prefix.to_string();
        for _ in 0..6 {
            path.push(CHARACTERS[(random % CHARACTERS.len() as u64) as usize] as char);
            random /= CHARACTERS.len() as u64;
        }
        match std::fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::from_raw_os_error(80))
}

/// Windows cannot open a directory as a file and has no `O_NOFOLLOW`: check the path first, as `NodeExecutionEnv` does
/// there (not race-free).
pub fn open_reader(path: &str, no_follow: bool) -> Result<File, Failure> {
    if no_follow
        && std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(Failure::new("SYMLINK", "Refusing to follow a symbolic link").path(path));
    }
    if std::fs::metadata(path).is_ok_and(|metadata| metadata.is_dir()) {
        return Err(
            Failure::new("EISDIR", "EISDIR: illegal operation on a directory, read").path(path),
        );
    }
    File::open(path).map_err(|error| Failure::io(&error, "open", path))
}

/// libuv's `fs__open` for Node's write modes: `CreateFileW` with its access, sharing and disposition, always with
/// `FILE_FLAG_BACKUP_SEMANTICS`, so a directory opens and later calls on it fail as in Node; creating a file where a
/// directory exists reports `EISDIR`. (Rust's `File::create` opens with `OPEN_ALWAYS` and truncates afterwards.)
pub fn open(path: &str, mode: OpenMode) -> io::Result<File> {
    let (access, disposition) = match mode {
        OpenMode::Read => (FILE_GENERIC_READ, OPEN_EXISTING),
        OpenMode::Write => (FILE_GENERIC_WRITE, CREATE_ALWAYS),
        OpenMode::Append => (
            (FILE_GENERIC_WRITE & !FILE_WRITE_DATA) | FILE_APPEND_DATA,
            OPEN_ALWAYS,
        ),
        OpenMode::ReadWrite => (FILE_GENERIC_READ | FILE_GENERIC_WRITE, OPEN_EXISTING),
    };
    let name = wide(path)?;
    // SAFETY: a NUL-terminated wide path; the returned handle is owned by the File on success.
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            access,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            disposition,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        let error = io::Error::last_os_error();
        // ERROR_FILE_EXISTS while creating means the path is a directory.
        if error.raw_os_error() == Some(80) && matches!(mode, OpenMode::Write | OpenMode::Append) {
            return Err(synthetic("EISDIR"));
        }
        return Err(error);
    }
    // SAFETY: `handle` is a valid, owned file handle.
    Ok(unsafe { File::from_raw_handle(handle as _) })
}

/// libuv's `uv_fs_realpath`: the final path without the `\\?\` prefix.
pub fn realpath(path: &str) -> io::Result<String> {
    let resolved = std::fs::canonicalize(path)?.to_string_lossy().into_owned();
    Ok(if let Some(unc) = resolved.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        resolved
            .strip_prefix("\\\\?\\")
            .map(str::to_string)
            .unwrap_or(resolved)
    })
}

/// libuv's `fs__rename`: `MoveFileExW` replacing an existing destination.
pub fn rename(from: &str, to: &str) -> io::Result<()> {
    let (from, to) = (wide(from)?, wide(to)?);
    // SAFETY: both arguments are NUL-terminated wide strings that outlive the call.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_REPLACE_EXISTING) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Node's `rm` on Windows: a symbolic link or junction to a directory is removed as a directory entry (libuv's
/// `fs__unlink`), and a read-only file is retried after making it writable.
pub fn remove_file(path: &str) -> io::Result<()> {
    use std::os::windows::fs::FileTypeExt;
    if std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink_dir()) {
        return std::fs::remove_dir(path);
    }
    match std::fs::remove_file(path) {
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            let mut permissions = std::fs::metadata(path)?.permissions();
            #[allow(clippy::permissions_set_readonly_false)]
            permissions.set_readonly(false);
            std::fs::set_permissions(path, permissions)?;
            std::fs::remove_file(path)
        }
        other => other,
    }
}

/// A pipe a reader thread reads with blocking calls; `interrupt_pipe` cancels a blocked read.
pub trait Pipe: io::Read {}
impl<T: io::Read> Pipe for T {}

/// Read `pipe` until it ends, `on_data` returns false, or `stop` is set; the pipe closes when this returns.
pub fn read_pipe(mut pipe: impl Pipe, stop: &AtomicBool, mut on_data: impl FnMut(&[u8]) -> bool) {
    let mut buffer = vec![0u8; 64 * 1024];
    while !stop.load(Ordering::SeqCst) {
        match pipe.read(&mut buffer) {
            Ok(0) | Err(_) => return,
            Ok(read) => {
                if !on_data(&buffer[..read]) {
                    return;
                }
            }
        }
    }
}

/// Feed stdin on its own thread, checking stop between bounded writes.
pub fn write_stdin(mut pipe: io::PipeWriter, mut bytes: &[u8], stop: &AtomicBool) {
    use std::io::Write;
    while !bytes.is_empty() && !stop.load(Ordering::SeqCst) {
        match pipe.write(&bytes[..bytes.len().min(64 * 1024)]) {
            Ok(0) | Err(_) => return,
            Ok(written) => bytes = &bytes[written..],
        }
    }
}

/// Cancel a pipe worker blocked in ReadFile or WriteFile, so it closes its pipe.
pub fn interrupt_pipe(worker: &std::thread::JoinHandle<()>) {
    // SAFETY: the handle of a live or finished thread; cancelling no pending I/O is harmless.
    unsafe {
        CancelSynchronousIo(worker.as_raw_handle() as _);
    }
}

/// libuv's `search_path` for an argv command: a name with a directory is tried as given, otherwise the working
/// directory and then each `PATH` entry; a name without an extension also tries `.com` and `.exe`. Node refuses
/// batch files without a shell.
pub fn resolve_program(
    program: &str,
    cwd: &str,
    env: &Map<String, Value>,
    inherit_env: bool,
) -> Result<String, Failure> {
    let not_found = || Failure::new("spawn_error", format!("spawn {program} ENOENT"));
    let has_extension = Path::new(program).extension().is_some();
    let candidates = |base: &Path| -> Vec<std::path::PathBuf> {
        let mut names = Vec::new();
        if has_extension {
            names.push(base.to_path_buf());
        }
        for extension in ["com", "exe"] {
            let mut name = base.as_os_str().to_owned();
            name.push(".");
            name.push(extension);
            names.push(name.into());
        }
        names
    };
    let found = if program.contains(['\\', '/', ':']) {
        candidates(&Path::new(cwd).join(program))
            .into_iter()
            .find(|path| path.is_file())
    } else {
        // Use the same merged, case-deduplicated PATH passed to the child, including required variables.
        let path_variable = child_environment(env, inherit_env)
            .into_iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("PATH"))
            .map(|(_, value)| value)
            .unwrap_or_default();
        std::iter::once(std::path::PathBuf::from(cwd))
            .chain(
                std::env::split_paths(&path_variable)
                    .map(|directory| Path::new(cwd).join(directory)),
            )
            .flat_map(|directory| candidates(&directory.join(program)))
            .find(|path| path.is_file())
    };
    let found = found.ok_or_else(not_found)?;
    let lower = found.to_string_lossy().to_lowercase();
    if lower.ends_with(".bat") || lower.ends_with(".cmd") {
        return Err(Failure::new(
            "spawn_error",
            format!("spawn {program} EINVAL"),
        ));
    }
    Ok(found.to_string_lossy().into_owned())
}

/// Node's `isLegacyWslBashPath`: `^[a-z]:\\windows\\(system32|sysnative)\\bash\.exe$`, case-insensitive.
fn is_legacy_wsl_bash(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_lowercase();
    let mut characters = normalized.chars();
    characters
        .next()
        .is_some_and(|drive| drive.is_ascii_lowercase())
        && matches!(
            characters.as_str(),
            ":\\windows\\system32\\bash.exe" | ":\\windows\\sysnative\\bash.exe"
        )
}

fn bash_config(program: &str) -> Result<ShellConfig, Failure> {
    // shell_config validates paths against the daemon's cwd. Anchor that selected executable now,
    // before exec's cwd or PATH can reinterpret a relative configured shell as another program.
    let program = std::path::absolute(program)
        .map_err(|error| Failure::new("shell_unavailable", error.to_string()))?
        .to_string_lossy()
        .into_owned();
    let command_on_stdin = is_legacy_wsl_bash(&program);
    Ok(ShellConfig {
        program,
        args: vec![if command_on_stdin { "-s" } else { "-c" }.into()],
        command_on_stdin,
    })
}

fn where_bash() -> Option<String> {
    let output = Command::new("where")
        .arg("bash.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let first = String::from_utf8_lossy(&output.stdout)
        .trim()
        .lines()
        .next()?
        .trim()
        .to_string();
    path_exists(&first).then_some(first)
}

/// Node's shell resolution on Windows: a configured shell, Git Bash, `where bash.exe`, or `shell_unavailable`.
pub fn shell_config(shell_path: Option<&str>) -> Result<ShellConfig, Failure> {
    if let Some(configured) = shell_path {
        if path_exists(configured) {
            return bash_config(configured);
        }
        return Err(Failure::new(
            "shell_unavailable",
            format!("Custom shell path not found: {configured}"),
        ));
    }
    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(directory) = std::env::var(variable) {
            candidates.push(format!("{directory}\\Git\\bin\\bash.exe"));
        }
    }
    if let Some(found) = candidates.iter().find(|candidate| path_exists(candidate)) {
        return bash_config(found);
    }
    if let Some(found) = where_bash() {
        return bash_config(&found);
    }
    let searched: String = candidates
        .iter()
        .map(|candidate| format!("  {candidate}\n"))
        .collect();
    Err(Failure::new(
        "shell_unavailable",
        format!(
            "No bash shell found. Options:\n  1. Install Git for Windows: https://git-scm.com/download/win\n  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n  3. Configure an explicit shellPath\n\nSearched Git Bash in:\n{}",
            searched.trim_end()
        ),
    ))
}

/// libuv's `quote_cmd_arg`: how one argument is written into the command line the child splits again.
pub fn quote_argument(argument: &str) -> String {
    if argument.is_empty() {
        return "\"\"".into();
    }
    if !argument.contains([' ', '\t', '"']) {
        return argument.into();
    }
    if !argument.contains(['"', '\\']) {
        return format!("\"{argument}\"");
    }
    // Walk backwards: backslashes before a quote (or the closing quote) are doubled, and quotes are escaped.
    let mut reversed = Vec::new();
    let mut quote_hit = true;
    for character in argument.chars().rev() {
        reversed.push(character);
        if quote_hit && character == '\\' {
            reversed.push('\\');
        } else if character == '"' {
            quote_hit = true;
            reversed.push('\\');
        } else {
            quote_hit = false;
        }
    }
    let mut quoted = String::from("\"");
    quoted.extend(reversed.into_iter().rev());
    quoted.push('"');
    quoted
}

/// Variables libuv copies from the parent into every child environment that lacks them.
const REQUIRED_VARIABLES: [&str; 11] = [
    "HOMEDRIVE",
    "HOMEPATH",
    "LOGONSERVER",
    "PATH",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "USERDOMAIN",
    "USERNAME",
    "USERPROFILE",
    "WINDIR",
];

/// The child environment as Node builds it on Windows: the variables in object order, sorted by UTF-16 code units,
/// keeping the first of names that differ only in case; then libuv adds required variables the result lacks.
fn child_environment(env: &Map<String, Value>, inherit_env: bool) -> Vec<(String, String)> {
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut set =
        |key: String, value: String| match entries.iter_mut().find(|(name, _)| *name == key) {
            Some(entry) => entry.1 = value,
            None => entries.push((key, value)),
        };
    if inherit_env {
        for (key, value) in std::env::vars_os() {
            set(
                key.to_string_lossy().into_owned(),
                value.to_string_lossy().into_owned(),
            );
        }
    }
    for (key, value) in env {
        if let Some(value) = value.as_str() {
            set(key.clone(), value.to_string());
        }
    }
    entries.sort_by(|(a, _), (b, _)| a.encode_utf16().cmp(b.encode_utf16()));
    let mut seen = std::collections::HashSet::new();
    entries.retain(|(name, _)| seen.insert(name.to_uppercase()));
    for required in REQUIRED_VARIABLES {
        if !entries
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case(required))
            && let Ok(value) = std::env::var(required)
        {
            entries.push((required.to_string(), value));
        }
    }
    entries
}

/// Jobs remain registered until their entire tree has terminated, not just until the leader exits.
/// The same lock gates process creation and shutdown, including a request still preparing its pipes.
#[derive(Default)]
pub struct Jobs {
    stopping: bool,
    jobs: Vec<Arc<Job>>,
}

pub type ProcessGroups = Arc<Mutex<Jobs>>;

/// An unnamed, noninheritable job belonging to exactly one exec request.
pub struct Job {
    handle: OwnedHandle,
}

impl Job {
    fn new() -> io::Result<Self> {
        // SAFETY: null attributes create a noninheritable handle; a null name creates a private job.
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: CreateJobObjectW returned a new owned handle.
        let handle = unsafe { OwnedHandle::from_raw_handle(handle) };
        let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // No breakaway permission: descendants stay in this job, including nested-job descendants.
        information.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: a valid job and a correctly sized, initialized information structure.
        if unsafe {
            SetInformationJobObject(
                handle.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&information as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&information) as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { handle })
    }

    /// Termination is asynchronous. Join job accounting, which includes descendants and nested jobs,
    /// rather than waiting on the leader or assuming that requesting termination completed it.
    pub fn terminate_and_wait(&self) -> io::Result<()> {
        // SAFETY: this job owns its handle for the entire call, including concurrent shutdown.
        if unsafe { TerminateJobObject(self.handle.as_raw_handle(), 1) } == 0 {
            return Err(io::Error::last_os_error());
        }
        loop {
            let mut information = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
            // SAFETY: a live job handle and a correctly sized writable accounting structure.
            if unsafe {
                QueryInformationJobObject(
                    self.handle.as_raw_handle(),
                    JobObjectBasicAccountingInformation,
                    (&mut information as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(),
                    std::mem::size_of_val(&information) as u32,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
            if information.ActiveProcesses == 0 {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

/// Finish even a normally exited leader's remaining descendants before unregistering the command.
pub fn finish_job(groups: &ProcessGroups, job: &Arc<Job>) -> io::Result<()> {
    job.terminate_and_wait()?;
    groups
        .lock()
        .map_err(|_| io::Error::other("process ownership lock poisoned"))?
        .jobs
        .retain(|active| !Arc::ptr_eq(active, job));
    Ok(())
}

/// Prevent new processes first, then synchronously join every command's actual job tree.
pub fn shutdown_jobs(groups: &ProcessGroups) -> io::Result<()> {
    let mut groups = groups
        .lock()
        .map_err(|_| io::Error::other("process ownership lock poisoned"))?;
    groups.stopping = true;
    let mut failure = None;
    for job in &groups.jobs {
        if let Err(error) = job.terminate_and_wait() {
            failure.get_or_insert(error);
        }
    }
    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Synchronous pipes match the daemon's interruptible reader and writer workers.
pub struct Child {
    process: OwnedHandle,
    pub job: Arc<Job>,
    pub stdin: Option<io::PipeWriter>,
    pub stdout: Option<io::PipeReader>,
    pub stderr: Option<io::PipeReader>,
}

impl Child {
    pub fn wait(&mut self) -> io::Result<ExitStatus> {
        self.stdin.take();
        // SAFETY: this child retains the process handle throughout both calls.
        if unsafe { WaitForSingleObject(self.process.as_raw_handle(), INFINITE) } != WAIT_OBJECT_0 {
            return Err(io::Error::last_os_error());
        }
        let mut code = 0;
        // SAFETY: a live process handle, now signaled, and writable exit-code storage.
        if unsafe { GetExitCodeProcess(self.process.as_raw_handle(), &mut code) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(ExitStatus::from_raw(code))
    }
}

struct Attributes(Vec<usize>);

impl Attributes {
    fn new() -> io::Result<Self> {
        let mut bytes = 0;
        // SAFETY: the documented sizing call deliberately passes a null buffer.
        unsafe { InitializeProcThreadAttributeList(std::ptr::null_mut(), 2, 0, &mut bytes) };
        if bytes == 0 {
            return Err(io::Error::last_os_error());
        }
        // Pointer-aligned backing storage for the opaque attribute list.
        let mut storage = vec![0usize; bytes.div_ceil(std::mem::size_of::<usize>())];
        // SAFETY: the buffer is aligned and at least the size returned by the sizing call.
        if unsafe {
            InitializeProcThreadAttributeList(storage.as_mut_ptr().cast(), 2, 0, &mut bytes)
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(storage))
    }

    fn as_mut_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.0.as_mut_ptr().cast()
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: only successfully initialized lists construct Attributes.
        unsafe { DeleteProcThreadAttributeList(self.as_mut_ptr()) };
    }
}

fn inheritable(handle: &OwnedHandle) -> io::Result<OwnedHandle> {
    let mut duplicate = std::ptr::null_mut();
    // SAFETY: duplicate a live handle into this process; only the new duplicate is inheritable.
    if unsafe {
        let process = GetCurrentProcess();
        DuplicateHandle(
            process,
            handle.as_raw_handle(),
            process,
            &mut duplicate,
            0,
            1,
            DUPLICATE_SAME_ACCESS,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: DuplicateHandle returned a new owned handle.
    Ok(unsafe { OwnedHandle::from_raw_handle(duplicate) })
}

/// CreateProcess's job-list attribute installs ownership atomically, before any child instruction.
/// A suspended spawn followed by assignment would still leak a suspended process if the daemon
/// died between those calls. Unsupported job-list or nesting configurations fail closed instead.
pub fn spawn_process(
    program: &str,
    args: &[String],
    cwd: &str,
    env: &Map<String, Value>,
    inherit_env: bool,
    piped_stdin: bool,
    groups: &ProcessGroups,
) -> io::Result<Child> {
    let program = resolve_program(program, cwd, env, inherit_env)
        .map_err(|failure| io::Error::new(io::ErrorKind::NotFound, failure.message))?;
    let application = wide(&program)?;
    let mut line = quote_argument(&program);
    for argument in args {
        line.push(' ');
        line.push_str(&quote_argument(argument));
    }
    let mut line = wide(&line)?;
    // GetFullPathName-style normalization preserves junction/symlink spelling and drive identity.
    let cwd = std::path::absolute(cwd)?;
    let cwd = cwd.to_string_lossy();
    let cwd = if let Some(unc) = cwd.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{unc}")
    } else {
        cwd.strip_prefix("\\\\?\\").unwrap_or(&cwd).to_string()
    };
    let cwd = wide(&cwd)?;
    let mut entries = Vec::new();
    for (key, value) in child_environment(env, inherit_env) {
        // Node chooses case-duplicate names above; std::Command previously supplied the final
        // case-insensitive Windows ordering and NUL rejection when serializing this block.
        if key.contains('\0') || value.contains('\0') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid environment variable",
            ));
        }
        entries.push((wide(&key)?, value));
    }
    let mut sort_error = None;
    entries.sort_by(|(a, _), (b, _)| {
        // SAFETY: both keys are NUL-terminated UTF-16 strings alive for this comparison.
        let order = unsafe { CompareStringOrdinal(a.as_ptr(), -1, b.as_ptr(), -1, 1) };
        if order == 0 {
            sort_error = Some(io::Error::last_os_error());
        }
        order.cmp(&2)
    });
    if let Some(error) = sort_error {
        return Err(error);
    }
    let mut environment = Vec::new();
    for (mut key, value) in entries {
        key.pop();
        environment.extend(key);
        environment.push(b'=' as u16);
        environment.extend(value.encode_utf16());
        environment.push(0);
    }
    if environment.is_empty() {
        environment.push(0);
    }
    environment.push(0);

    let job = Arc::new(Job::new()?);
    let (stdin_child, stdin) = if piped_stdin {
        let (reader, writer) = io::pipe()?;
        (OwnedHandle::from(reader), Some(writer))
    } else {
        (OwnedHandle::from(File::open("NUL")?), None)
    };
    let (stdout, stdout_child) = io::pipe()?;
    let (stderr, stderr_child) = io::pipe()?;
    let stdin_child = inheritable(&stdin_child)?;
    let stdout_child = inheritable(&OwnedHandle::from(stdout_child))?;
    let stderr_child = inheritable(&OwnedHandle::from(stderr_child))?;
    let handles: [HANDLE; 3] = [
        stdin_child.as_raw_handle(),
        stdout_child.as_raw_handle(),
        stderr_child.as_raw_handle(),
    ];
    let jobs: [HANDLE; 1] = [job.handle.as_raw_handle()];
    let mut attributes = Attributes::new()?;
    for (attribute, values) in [
        (PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles.as_slice()),
        (PROC_THREAD_ATTRIBUTE_JOB_LIST, jobs.as_slice()),
    ] {
        // SAFETY: both arrays and their handles outlive the attribute list. The job is deliberately
        // absent from HANDLE_LIST, so descendants cannot keep kill-on-close ownership alive.
        if unsafe {
            UpdateProcThreadAttribute(
                attributes.as_mut_ptr(),
                0,
                attribute as usize,
                values.as_ptr().cast(),
                std::mem::size_of_val(values),
                std::ptr::null_mut(),
                std::ptr::null(),
            )
        } == 0
        {
            let error = io::Error::last_os_error();
            return Err(io::Error::new(
                error.kind(),
                format!(
                    "Windows exec requires Windows 10 / Server 2016 or newer and compatible job nesting (process attribute {attribute}): {error}",
                ),
            ));
        }
    }
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = handles[0];
    startup.StartupInfo.hStdOutput = handles[1];
    startup.StartupInfo.hStdError = handles[2];
    startup.lpAttributeList = attributes.as_mut_ptr();
    let mut information = PROCESS_INFORMATION::default();
    let mut groups = groups
        .lock()
        .map_err(|_| io::Error::other("process ownership lock poisoned"))?;
    if groups.stopping {
        return Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "the connection has ended",
        ));
    }
    // SAFETY: all strings, environment, attribute values and inherited handles remain live through
    // CreateProcessW. JOB_LIST assigns the job as part of process creation, not afterwards.
    if unsafe {
        CreateProcessW(
            application.as_ptr(),
            line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_ptr().cast(),
            cwd.as_ptr(),
            &startup.StartupInfo,
            &mut information,
        )
    } == 0
    {
        let error = io::Error::last_os_error();
        return Err(io::Error::new(
            error.kind(),
            format!(
                "CreateProcessW with mandatory command job failed; Windows 10 / Server 2016 or newer and compatible job nesting are required: {error}",
            ),
        ));
    }
    // SAFETY: successful CreateProcessW returned two newly owned handles.
    let process = unsafe { OwnedHandle::from_raw_handle(information.hProcess) };
    let _thread = unsafe { OwnedHandle::from_raw_handle(information.hThread) };
    groups.jobs.push(job.clone());
    Ok(Child {
        process,
        job,
        stdin,
        stdout: Some(stdout),
        stderr: Some(stderr),
    })
}

/// Exit codes are unsigned 32-bit values on Windows (an access violation is 3221225477).
pub fn exit_code(status: ExitStatus) -> i64 {
    i64::from(status.code().unwrap_or(1) as u32)
}

/// Windows listings keep the file system's order; nothing sorts by raw names.
pub fn raw_name(_name: &OsStr) -> Option<Vec<u8>> {
    None
}

/// The per-drive working directories of the `=C:` variables, which Node's `path.resolve` uses for drive-relative paths.
pub fn drive_cwds() -> Map<String, Value> {
    std::env::vars_os()
        .filter_map(|(key, value)| {
            let key = key.to_str()?;
            let bytes = key.as_bytes();
            (bytes.len() == 3
                && bytes[0] == b'='
                && bytes[1].is_ascii_alphabetic()
                && bytes[2] == b':')
                .then(|| {
                    (
                        key[1..].to_ascii_uppercase(),
                        Value::String(value.to_string_lossy().into_owned()),
                    )
                })
        })
        .collect()
}

/// libuv's `scandir` and `opendir` report a file as `ENOTDIR` (elsewhere `ERROR_DIRECTORY` is `ENOENT`).
pub fn read_dir(path: &str) -> io::Result<std::fs::ReadDir> {
    std::fs::read_dir(path).map_err(|error| {
        if error.raw_os_error() == Some(267) {
            synthetic("ENOTDIR")
        } else {
            error
        }
    })
}

/// Volume serial number and file index of `path`, as libuv's `stat` reports `dev` and `ino`: the creation time is not
/// enough, because NTFS gives a file created under a recently removed name the old one's creation time ("tunneling").
/// Opens a handle, like libuv; falls back to the metadata when the path cannot be opened.
pub fn path_identity(path: &str, metadata: &Metadata, follow: bool) -> (u64, u64) {
    let Ok(name) = wide(path) else {
        return identity(metadata);
    };
    let flags = FILE_FLAG_BACKUP_SEMANTICS
        | if follow {
            0
        } else {
            FILE_FLAG_OPEN_REPARSE_POINT
        };
    // SAFETY: a NUL-terminated wide path; the handle is closed below.
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            flags,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return identity(metadata);
    }
    // SAFETY: a valid handle and a zeroed buffer for the call to fill.
    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let found = unsafe { GetFileInformationByHandle(handle, &mut information) } != 0;
    // SAFETY: the handle opened above.
    unsafe { CloseHandle(handle) };
    if !found {
        return identity(metadata);
    }
    (
        u64::from(information.dwVolumeSerialNumber),
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
    )
}

#[cfg(test)]
mod tests {
    use super::quote_argument;

    #[test]
    fn quotes_arguments_like_libuv() {
        assert_eq!(quote_argument(""), "\"\"");
        assert_eq!(quote_argument("plain"), "plain");
        assert_eq!(quote_argument("a b"), "\"a b\"");
        assert_eq!(quote_argument("*.txt"), "*.txt");
        assert_eq!(quote_argument("say \"hi\""), "\"say \\\"hi\\\"\"");
        assert_eq!(
            quote_argument("C:\\dir with space\\"),
            "\"C:\\dir with space\\\\\""
        );
        assert_eq!(quote_argument("a\\\\b c"), "\"a\\\\b c\"");
    }

    #[test]
    fn resolves_path_entries_in_the_command_working_directory_and_spawns_them() {
        use super::{mkdtemp, resolve_program};
        use serde_json::json;
        use std::path::Path;
        use std::process::Command;

        let root = mkdtemp(&format!(
            "{}\\pi-env-program-",
            std::env::temp_dir().display()
        ))
        .unwrap();
        let tools = Path::new(&root).join("tools");
        std::fs::create_dir(&tools).unwrap();
        let source = Path::new(&std::env::var_os("SystemRoot").unwrap()).join("System32\\cmd.exe");
        let program = "pi-env-cwd-regression";
        let executable = tools.join(format!("{program}.exe"));
        std::fs::copy(&source, &executable).unwrap();
        for path in ["tools".to_string(), tools.to_string_lossy().into_owned()] {
            let env = json!({ "Path": path, "PATHEXT": ".CMD" });
            let resolved =
                resolve_program(program, &root, env.as_object().unwrap(), false).unwrap();
            assert!(Path::new(&resolved).is_absolute());
            assert_eq!(Path::new(&resolved), executable);
            let status = Command::new(&resolved)
                .current_dir(&root)
                .args(["/D", "/C", "exit 23"])
                .status()
                .unwrap();
            assert_eq!(status.code(), Some(23));
        }
        let local = Path::new(&root).join(format!("{program}.exe"));
        std::fs::copy(&source, &local).unwrap();
        let env = json!({ "PATH": ";missing;" });
        assert_eq!(
            Path::new(&resolve_program(program, &root, env.as_object().unwrap(), false).unwrap()),
            local
        );
        std::fs::write(Path::new(&root).join("batch.cmd"), "exit /b 0").unwrap();
        let error =
            resolve_program("batch.cmd", &root, env.as_object().unwrap(), false).unwrap_err();
        assert_eq!(error.code, "spawn_error");
        assert_eq!(error.message, "spawn batch.cmd EINVAL");
        std::fs::remove_dir_all(root).unwrap();
    }
}
