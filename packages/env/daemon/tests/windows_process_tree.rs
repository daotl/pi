#![cfg(windows)]

#[path = "../src/frame.rs"]
#[allow(dead_code)]
mod frame;

use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};

const DEADLINE: Duration = Duration::from_secs(15);

fn wait_for(path: &Path) {
    let until = Instant::now() + DEADLINE;
    while !path.exists() {
        assert!(
            Instant::now() < until,
            "fixture did not create {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(5));
    }
}

fn fixture_child(directory: &Path, mode: &str) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "fixture_process", "--ignored", "--nocapture"])
        .env("PI_ENV_TREE_DIRECTORY", directory)
        .env("PI_ENV_TREE_MODE", mode)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

// A real executable fixture, launched by exec and then recursively by its children.
// All children have independent stdio and a finite lifetime if the regression leaks them.
#[test]
#[ignore]
fn fixture_process() {
    let directory = PathBuf::from(std::env::var_os("PI_ENV_TREE_DIRECTORY").unwrap());
    let mode = std::env::var("PI_ENV_TREE_MODE").unwrap();
    if mode == "probe" {
        let environment: Vec<(String, String)> = std::env::vars()
            .filter(|(key, _)| ["a_case", "Z_CASE", "Ä_CASE"].contains(&key.as_str()))
            .collect();
        let mut stdin = String::new();
        std::io::Read::read_to_string(&mut std::io::stdin(), &mut stdin).unwrap();
        fs::write(
            directory.join("probe.json"),
            serde_json::to_vec(&json!({
                "args": std::env::args().collect::<Vec<_>>(),
                "cwd": std::env::current_dir().unwrap(),
                "environment": environment,
                "stdin": stdin,
            }))
            .unwrap(),
        )
        .unwrap();
        println!("PI_ENV_STDOUT");
        eprintln!("PI_ENV_STDERR");
        return;
    }
    // Spawn immediately, before any readiness I/O: containment must already be installed.
    let _child = match mode.as_str() {
        "leader" => Some(fixture_child(&directory, "child")),
        "child" => Some(fixture_child(&directory, "grandchild")),
        "grandchild" => None,
        _ => panic!("unknown fixture mode"),
    };
    let pending = directory.join(format!("{mode}.pending"));
    fs::write(&pending, std::process::id().to_string()).unwrap();
    fs::rename(pending, directory.join(&mode)).unwrap();
    let until = Instant::now() + DEADLINE;
    while Instant::now() < until {
        if mode == "leader" && directory.join("release").exists() {
            std::process::exit(23);
        }
        thread::sleep(Duration::from_millis(5));
    }
}

struct Tree {
    directory: PathBuf,
    processes: Vec<OwnedHandle>,
}

impl Tree {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "pi-env-tree space é-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir(&directory).unwrap();
        Self {
            directory,
            processes: Vec::new(),
        }
    }

    fn ready(&mut self) {
        for name in ["leader", "child", "grandchild"] {
            let path = self.directory.join(name);
            wait_for(&path);
            let pid = fs::read_to_string(&path).unwrap().parse::<u32>().unwrap();
            // SAFETY: query an existing fixture process; retain the handle to avoid PID reuse.
            let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
            assert!(
                !handle.is_null(),
                "fixture process {name} already disappeared"
            );
            // SAFETY: OpenProcess returned a new owned handle.
            self.processes
                .push(unsafe { OwnedHandle::from_raw_handle(handle) });
        }
    }

    fn assert_stopped(&self, milliseconds: u32) {
        for (name, handle) in ["leader", "child", "grandchild"]
            .into_iter()
            .zip(&self.processes)
        {
            // SAFETY: this tree retains the process handle throughout the wait.
            assert_eq!(
                unsafe { WaitForSingleObject(handle.as_raw_handle(), milliseconds) },
                WAIT_OBJECT_0,
                "{name} survived cleanup"
            );
        }
    }

    fn assert_running(&self) {
        for handle in &self.processes {
            // SAFETY: this tree retains each process handle.
            assert_eq!(
                unsafe { WaitForSingleObject(handle.as_raw_handle(), 0) },
                WAIT_TIMEOUT,
                "another command was killed"
            );
        }
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

struct Daemon {
    child: Child,
    input: Option<ChildStdin>,
    replies: Receiver<frame::Frame>,
}

impl Daemon {
    fn start() -> Self {
        Self::start_in(&std::env::current_dir().unwrap())
    }

    fn start_in(cwd: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_pi-env"))
            .args(["serve", "--token", "tree-test"])
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        let (sender, replies) = mpsc::channel();
        thread::spawn(move || {
            let mut output = BufReader::new(stdout);
            let mut greeting = String::new();
            output.read_line(&mut greeting).unwrap();
            assert_eq!(greeting.trim_end(), "PI-ENV tree-test");
            while let Some(reply) = frame::read_frame(&mut output).unwrap() {
                if sender.send(reply).is_err() {
                    break;
                }
            }
        });
        Self {
            child,
            input,
            replies,
        }
    }

    fn exec(&mut self, id: u32, tree: &Tree) {
        self.exec_options(id, tree, json!({}));
    }

    fn exec_options(&mut self, id: u32, tree: &Tree, options: Value) {
        let mut request = json!({
            "op": "exec",
            "argv": [std::env::current_exe().unwrap().to_string_lossy(), "--exact", "fixture_process", "--ignored", "--nocapture"],
            "cwd": tree.directory.to_string_lossy(),
            "env": { "PI_ENV_TREE_DIRECTORY": tree.directory.to_string_lossy(), "PI_ENV_TREE_MODE": "leader" },
            "timeoutMs": 12000,
        });
        request
            .as_object_mut()
            .unwrap()
            .extend(options.as_object().unwrap().clone());
        frame::write_frame(
            self.input.as_mut().unwrap(),
            &frame::Frame::new(frame::REQUEST, id, request),
        )
        .unwrap();
    }

    fn cancel(&mut self, id: u32) {
        frame::write_frame(
            self.input.as_mut().unwrap(),
            &frame::Frame::new(frame::CANCEL, id, json!({})),
        )
        .unwrap();
    }

    fn reply(&self, id: u32) -> (u8, Value) {
        let until = Instant::now() + DEADLINE;
        loop {
            let reply = self
                .replies
                .recv_timeout(until.saturating_duration_since(Instant::now()))
                .expect("daemon did not settle exec");
            if reply.id == id && matches!(reply.kind, frame::RESULT | frame::ERROR) {
                return (reply.kind, reply.json);
            }
        }
    }

    fn wait(&mut self) {
        let until = Instant::now() + DEADLINE;
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "daemon cleanup failed: {status}");
                return;
            }
            assert!(Instant::now() < until, "daemon did not shut down");
            thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn normal_exit_joins_descendants_after_the_leader_exits() {
    let mut daemon = Daemon::start();
    let mut tree = Tree::new();
    daemon.exec(1, &tree);
    tree.ready();
    fs::write(tree.directory.join("release"), "").unwrap();
    let (kind, result) = daemon.reply(1);
    assert_eq!(kind, frame::RESULT);
    assert_eq!(result["exitCode"], 23);
    tree.assert_stopped(0);
}

#[test]
fn cancellation_joins_only_its_own_process_tree() {
    let mut daemon = Daemon::start();
    let mut first = Tree::new();
    let mut second = Tree::new();
    daemon.exec(1, &first);
    daemon.exec(2, &second);
    first.ready();
    second.ready();
    daemon.cancel(1);
    let (kind, result) = daemon.reply(1);
    assert_eq!(kind, frame::ERROR);
    assert_eq!(result["code"], "aborted");
    first.assert_stopped(0);
    second.assert_running();
    daemon.cancel(2);
    assert_eq!(daemon.reply(2).1["code"], "aborted");
    second.assert_stopped(0);
}

#[test]
fn kill_without_abort_joins_only_its_tree_and_reports_137() {
    let mut daemon = Daemon::start();
    let mut first = Tree::new();
    let mut second = Tree::new();
    daemon.exec(1, &first);
    daemon.exec(2, &second);
    first.ready();
    second.ready();
    frame::write_frame(
        daemon.input.as_mut().unwrap(),
        &frame::Frame::new(frame::CANCEL, 1, json!({ "mode": "kill" })),
    ).unwrap();
    let (kind, result) = daemon.reply(1);
    assert_eq!(kind, frame::RESULT);
    assert_eq!(result["exitCode"], 137);
    first.assert_stopped(0);
    second.assert_running();
    fs::write(second.directory.join("release"), "").unwrap();
    let (kind, result) = daemon.reply(2);
    assert_eq!(kind, frame::RESULT);
    assert_eq!(result["exitCode"], 23);
    second.assert_stopped(0);
}

#[test]
fn connection_eof_joins_all_descendants_before_daemon_exit() {
    let mut daemon = Daemon::start();
    let mut first = Tree::new();
    let mut second = Tree::new();
    daemon.exec(1, &first);
    daemon.exec(2, &second);
    first.ready();
    second.ready();
    drop(daemon.input.take());
    daemon.wait();
    first.assert_stopped(0);
    second.assert_stopped(0);
}

#[test]
fn abrupt_daemon_exit_closes_noninherited_jobs_and_kills_descendants() {
    let mut daemon = Daemon::start();
    let mut tree = Tree::new();
    daemon.exec(1, &tree);
    tree.ready();
    daemon.child.kill().unwrap();
    daemon.child.wait().unwrap();
    // Kill-on-close termination is asynchronous; wait on actual process handles.
    tree.assert_stopped(5000);
}

#[test]
fn timeout_joins_descendants_before_reporting_timeout() {
    let mut daemon = Daemon::start();
    let mut tree = Tree::new();
    daemon.exec_options(1, &tree, json!({ "timeoutMs": 5000 }));
    tree.ready();
    let (kind, result) = daemon.reply(1);
    assert_eq!(kind, frame::ERROR);
    assert_eq!(result["code"], "timeout");
    tree.assert_stopped(0);
}

#[test]
fn windows_launch_preserves_quoting_unicode_environment_cwd_and_stdio() {
    let mut daemon = Daemon::start();
    let tree = Tree::new();
    let tools = tree.directory.join("tools");
    fs::create_dir(&tools).unwrap();
    fs::copy(
        std::env::current_exe().unwrap(),
        tools.join("pi-env-probe.exe"),
    )
    .unwrap();
    let argument = "quoted \"value\" and trailing \\";
    daemon.exec_options(1, &tree, json!({
        "argv": ["pi-env-probe", "--exact", "fixture_process", "--ignored", "--nocapture", "--skip", argument],
        "inheritEnv": false,
        "env": {
            "PI_ENV_TREE_DIRECTORY": tree.directory.to_string_lossy(),
            "PI_ENV_TREE_MODE": "probe",
            "Z_CASE": "last ASCII", "a_case": "first ASCII", "Ä_CASE": "Unicode value é",
            "PATH": "tools",
        },
    }));
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let until = Instant::now() + DEADLINE;
    loop {
        let reply = daemon
            .replies
            .recv_timeout(until.saturating_duration_since(Instant::now()))
            .unwrap();
        if reply.id != 1 {
            continue;
        }
        if reply.kind == frame::EVENT {
            match reply.json["stream"].as_str() {
                Some("stdout") => stdout.extend(reply.payload),
                Some("stderr") => stderr.extend(reply.payload),
                _ => {}
            }
        } else if matches!(reply.kind, frame::RESULT | frame::ERROR) {
            assert_eq!(reply.kind, frame::RESULT);
            assert_eq!(reply.json["exitCode"], 0);
            break;
        }
    }
    let probe: Value =
        serde_json::from_slice(&fs::read(tree.directory.join("probe.json")).unwrap()).unwrap();
    assert_eq!(probe["args"].as_array().unwrap().last().unwrap(), argument);
    assert_eq!(Path::new(probe["cwd"].as_str().unwrap()), tree.directory);
    assert_eq!(
        probe["environment"],
        json!([
            ["a_case", "first ASCII"],
            ["Z_CASE", "last ASCII"],
            ["Ä_CASE", "Unicode value é"],
        ])
    );
    assert_eq!(probe["stdin"], "");
    assert!(String::from_utf8(stdout).unwrap().contains("PI_ENV_STDOUT"));
    assert!(String::from_utf8(stderr).unwrap().contains("PI_ENV_STDERR"));
}

#[test]
fn command_cwd_preserves_directory_junction_spelling() {
    let tree = Tree::new();
    let target = tree.directory.join("target");
    let junction = tree.directory.join("junction");
    fs::create_dir(&target).unwrap();
    let cmd = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32\\cmd.exe");
    let created = Command::new(&cmd)
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&junction)
        .arg(&target)
        .output()
        .unwrap();
    assert!(
        created.status.success(),
        "failed to create test junction: {}",
        String::from_utf8_lossy(&created.stderr)
    );
    let mut daemon = Daemon::start();
    daemon.exec_options(1, &tree, json!({
        "cwd": junction.to_string_lossy(),
        "env": { "PI_ENV_TREE_DIRECTORY": tree.directory.to_string_lossy(), "PI_ENV_TREE_MODE": "probe" },
    }));
    let (kind, result) = daemon.reply(1);
    assert_eq!(kind, frame::RESULT);
    assert_eq!(result["exitCode"], 0);
    let probe: Value =
        serde_json::from_slice(&fs::read(tree.directory.join("probe.json")).unwrap()).unwrap();
    assert_eq!(Path::new(probe["cwd"].as_str().unwrap()), junction);
}

#[test]
fn relative_configured_shell_is_anchored_to_daemon_cwd_not_command_cwd() {
    let tree = Tree::new();
    let daemon_cwd = tree.directory.join("daemon");
    let command_cwd = tree.directory.join("command");
    fs::create_dir(&daemon_cwd).unwrap();
    fs::create_dir(&command_cwd).unwrap();
    let source = PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32\\cmd.exe");
    let trusted = daemon_cwd.join("configured-shell.exe");
    fs::copy(source, &trusted).unwrap();
    // A different file exists under the same relative name in exec's cwd. It must not be launched.
    fs::write(
        command_cwd.join("configured-shell.exe"),
        b"not an executable",
    )
    .unwrap();
    let expected = Command::new(&trusted)
        .args(["-c", "exit 23"])
        .current_dir(&command_cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .unwrap();
    let mut daemon = Daemon::start_in(&daemon_cwd);
    daemon.exec_options(
        1,
        &tree,
        json!({
            "command": "exit 23",
            "shellPath": "configured-shell.exe",
            "cwd": command_cwd.to_string_lossy(),
        }),
    );
    let (kind, result) = daemon.reply(1);
    assert_eq!(
        kind,
        frame::RESULT,
        "validated shell was replaced by exec-cwd decoy: {result}"
    );
    assert_eq!(
        result["exitCode"],
        i64::from(expected.code().unwrap() as u32)
    );
}
