//! `listFiles`: the files and directories below a directory, as `fd --hidden --exclude .git` lists them (without
//! following symbolic links), skipping what git ignores. Uses the `ignore` crate, which fd and ripgrep use.

use crate::errors::Failure;
use crate::frame::MAX_PAYLOAD;
use ignore::{IncrementalIgnore, WalkBuilder};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

const DEFAULT_MAX_ENTRIES: u64 = 50_000;
const DEFAULT_MAX_BYTES: u64 = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 10_000;

pub struct Options {
    /// Include names starting with `.` (and, on Windows, hidden files).
    pub hidden: bool,
    /// Skip what git ignores inside git work trees: `.gitignore` files, `.git/info/exclude`, the global excludes file.
    pub gitignore: bool,
    /// Names skipped with everything below them, in addition to `.git`.
    pub exclude: Vec<OsString>,
    pub max_entries: u64,
    /// Bytes of the listing payload: per entry one kind byte, the path, and a NUL.
    pub max_bytes: u64,
    pub timeout: Duration,
}

impl Options {
    pub fn from_json(json: &Value) -> Result<Options, Failure> {
        let count = |key: &str, default: u64| -> Result<u64, Failure> {
            match &json[key] {
                Value::Null => Ok(default),
                value => value
                    .as_u64()
                    .ok_or_else(|| Failure::new("EINVAL", format!("invalid field {key}"))),
            }
        };
        let exclude = match &json["exclude"] {
            Value::Null => Vec::new(),
            Value::Array(names) => names
                .iter()
                .map(|name| name.as_str().map(OsString::from))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| Failure::new("EINVAL", "invalid field exclude"))?,
            _ => return Err(Failure::new("EINVAL", "invalid field exclude")),
        };
        Ok(Options {
            hidden: json["hidden"].as_bool().unwrap_or(true),
            gitignore: json["gitignore"].as_bool().unwrap_or(true),
            exclude,
            max_entries: count("maxEntries", DEFAULT_MAX_ENTRIES)?,
            max_bytes: count("maxBytes", DEFAULT_MAX_BYTES)?.min(MAX_PAYLOAD as u64),
            timeout: Duration::from_millis(count("timeoutMs", DEFAULT_TIMEOUT_MS)?),
        })
    }
}

pub struct Listing {
    /// Records of a kind byte (`f`, `d`, `l`), the path relative to the root with `/` separators, and a NUL.
    pub payload: Vec<u8>,
    pub count: u64,
    pub truncated: bool,
}

type OrderedEntries = BTreeMap<OsString, (PathBuf, fs::FileType)>;

/// The path of `path` below `root`, its components joined with `/`; names that are not UTF-8 get replacement
/// characters, as `readdir` reports them.
fn relative(root: &Path, path: &Path) -> Option<String> {
    let rest = path.strip_prefix(root).ok()?;
    let mut text = String::new();
    for component in rest.components() {
        let Component::Normal(name) = component else {
            return None;
        };
        if !text.is_empty() {
            text.push('/');
        }
        text.push_str(&name.to_string_lossy());
    }
    (!text.is_empty()).then_some(text)
}

fn hidden(entry: &fs::DirEntry) -> bool {
    if entry.file_name().as_encoded_bytes().starts_with(b".") {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return fs::symlink_metadata(entry.path()).is_ok_and(|metadata| {
            metadata.file_attributes()
                & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN
                != 0
        });
    }
    #[cfg(not(windows))]
    false
}

/// Unlike either ignore walker, enumeration and ordering here have a checkpoint per directory entry.
/// The crate's matcher still owns all hierarchical ignore and repository-boundary rules.
fn children(
    directory: &Path,
    root: &Path,
    options: &Options,
    matcher: &mut IncrementalIgnore,
    limit: u64,
    stopped: &dyn Fn() -> Result<bool, Failure>,
) -> Result<Option<OrderedEntries>, Failure> {
    let mut children = BTreeMap::new();
    if stopped()? {
        return Ok(None);
    }
    let Ok(mut entries) = fs::read_dir(directory) else {
        return Ok(Some(children));
    };
    loop {
        if stopped()? {
            return Ok(None);
        }
        let Some(entry) = entries.next() else { break };
        if stopped()? {
            return Ok(None);
        }
        let Ok(entry) = entry else { continue };
        let name = entry.file_name();
        if name == ".git"
            || options.exclude.iter().any(|excluded| excluded == &name)
            || (!options.hidden && hidden(&entry))
        {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() && !file_type.is_file() && !file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let ignored = matcher.matched(relative, file_type.is_dir()).is_ignore();
        if stopped()? {
            return Ok(None);
        }
        if ignored {
            continue;
        }
        // Incremental ordering avoids an uncancellable directory-wide sort. Keep only the smallest
        // remaining entry budget plus one: reaching that extra sibling must truncate the listing.
        children.insert(name, (path, file_type));
        if children.len() as u64 > limit {
            children.pop_last();
        }
    }
    if stopped()? {
        return Ok(None);
    }
    Ok(Some(children))
}

/// List `root` depth first, siblings in byte order of their names. Stops with `truncated` at the first entry beyond
/// a bound; fails with `aborted` once `aborted()` is true. Entries that cannot be read are skipped.
pub fn list(root: &str, options: &Options, aborted: &dyn Fn() -> bool) -> Result<Listing, Failure> {
    list_with_elapsed(root, options, aborted, None)
}

fn list_with_elapsed(
    root: &str,
    options: &Options,
    aborted: &dyn Fn() -> bool,
    elapsed: Option<&dyn Fn() -> Duration>,
) -> Result<Listing, Failure> {
    let metadata = fs::metadata(root).map_err(|error| Failure::io(&error, "scandir", root))?;
    if !metadata.is_dir() {
        return Err(Failure::new(
            "ENOTDIR",
            format!("ENOTDIR: not a directory, scandir '{root}'"),
        )
        .path(root));
    }
    let started = Instant::now();
    let elapsed = || elapsed.map_or_else(|| started.elapsed(), |elapsed| elapsed());
    let stopped = || {
        if aborted() {
            return Err(Failure::new("aborted", "aborted"));
        }
        Ok(elapsed() > options.timeout)
    };
    let root_path = Path::new(root);
    let mut matchers = WalkBuilder::new(root_path)
        .hidden(!options.hidden)
        .ignore(false)
        .parents(options.gitignore)
        .git_ignore(options.gitignore)
        .git_exclude(options.gitignore)
        .git_global(options.gitignore)
        .require_git(true)
        .follow_links(false)
        // The global excludes file is found relative to the listed directory, not the daemon's.
        .current_dir(root_path)
        .build_matchers();
    let matcher = &mut matchers[0];
    let mut listing = Listing {
        payload: Vec::new(),
        count: 0,
        truncated: false,
    };
    let Some(entries) = children(
        root_path,
        root_path,
        options,
        matcher,
        options.max_entries.saturating_add(1),
        &stopped,
    )?
    else {
        listing.truncated = true;
        return Ok(listing);
    };
    let mut stack = vec![entries.into_values()];
    while let Some(entries) = stack.last_mut() {
        if stopped()? {
            listing.truncated = true;
            break;
        }
        let Some((path, file_type)) = entries.next() else {
            stack.pop();
            continue;
        };
        let Some(text) = relative(root_path, &path) else {
            continue;
        };
        let size = text.len() as u64 + 2;
        if listing.count >= options.max_entries
            || listing.payload.len() as u64 + size > options.max_bytes
        {
            listing.truncated = true;
            break;
        }
        let kind = if file_type.is_symlink() {
            b'l'
        } else if file_type.is_dir() {
            b'd'
        } else {
            b'f'
        };
        listing.payload.push(kind);
        listing.payload.extend_from_slice(text.as_bytes());
        listing.payload.push(0);
        listing.count += 1;
        if file_type.is_dir() {
            let Some(entries) = children(
                &path,
                root_path,
                options,
                matcher,
                options
                    .max_entries
                    .saturating_sub(listing.count)
                    .saturating_add(1),
                &stopped,
            )?
            else {
                listing.truncated = true;
                break;
            };
            stack.push(entries.into_values());
        }
    }
    listing.truncated |= stopped()?;
    Ok(listing)
}

pub fn run(json: &Value, aborted: &dyn Fn() -> bool) -> Result<(Value, Vec<u8>), Failure> {
    let root = json["path"]
        .as_str()
        .ok_or_else(|| Failure::new("EINVAL", "missing field path"))?;
    let listing = list(root, &Options::from_json(json)?, aborted)?;
    Ok((
        json!({ "count": listing.count, "truncated": listing.truncated }),
        listing.payload,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Tree(std::path::PathBuf);

    impl Tree {
        fn new(files: &[&str]) -> Tree {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "pi-env-list-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let tree = Tree(root);
            for file in files {
                tree.write(file, "");
            }
            tree
        }

        fn write(&self, path: &str, content: &str) {
            let path = self.0.join(path);
            if path.to_string_lossy().ends_with('/') {
                fs::create_dir_all(&path).unwrap();
                return;
            }
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }

        fn list(&self, options: Options) -> (Vec<String>, bool) {
            let listing = list(&self.0.to_string_lossy(), &options, &|| false).unwrap();
            let entries: Vec<String> = listing
                .payload
                .split(|byte| *byte == 0)
                .filter(|record| !record.is_empty())
                .map(|record| {
                    format!(
                        "{} {}",
                        record[0] as char,
                        String::from_utf8_lossy(&record[1..])
                    )
                })
                .collect();
            assert_eq!(entries.len() as u64, listing.count);
            (entries, listing.truncated)
        }
    }

    #[test]
    fn preserves_ignore_walker_rules_across_repository_boundaries() {
        let tree = Tree::new(&[
            "keep",
            "drop.log",
            "sub/keep.log",
            "sub/drop.log",
            "sub/.hidden",
            "nested/keep.log",
            "nested/drop.log",
            "nested/info-only",
            "excluded/child",
            "plain/.ignore",
            "plain/keep",
        ]);
        tree.write(".git/HEAD", "ref: refs/heads/main\n");
        tree.write(".gitignore", "*.log\n");
        tree.write(".git/info/exclude", "info-only\n");
        tree.write("sub/.gitignore", "!keep.log\n");
        tree.write("nested/.git/HEAD", "ref: refs/heads/main\n");
        tree.write("nested/.gitignore", "drop.log\n");
        tree.write("plain/.ignore", "keep\n");

        for gitignore in [false, true] {
            for include_hidden in [false, true] {
                for root in [&tree.0, &tree.0.join("sub"), &tree.0.join("nested")] {
                    let opts = Options {
                        gitignore,
                        hidden: include_hidden,
                        exclude: vec!["excluded".into()],
                        ..options()
                    };
                    let expected: Vec<u8> = WalkBuilder::new(root)
                        .hidden(!include_hidden)
                        .ignore(false)
                        .parents(gitignore)
                        .git_ignore(gitignore)
                        .git_exclude(gitignore)
                        .git_global(gitignore)
                        .require_git(true)
                        .follow_links(false)
                        .current_dir(root)
                        .sort_by_file_name(|a, b| a.cmp(b))
                        .filter_entry(move |entry| {
                            entry.depth() == 0
                                || ((include_hidden
                                    || !entry.file_name().as_encoded_bytes().starts_with(b"."))
                                    && entry.file_name() != ".git"
                                    && entry.file_name() != "excluded")
                        })
                        .build()
                        .filter_map(Result::ok)
                        .filter(|entry| entry.depth() != 0)
                        .flat_map(|entry| {
                            let kind = if entry.file_type().unwrap().is_dir() {
                                b'd'
                            } else {
                                b'f'
                            };
                            let mut record = vec![kind];
                            record.extend_from_slice(
                                relative(root, entry.path()).unwrap().as_bytes(),
                            );
                            record.push(0);
                            record
                        })
                        .collect();
                    let actual = list(&root.to_string_lossy(), &opts, &|| false).unwrap();
                    assert!(!actual.truncated);
                    assert_eq!(
                        actual.payload, expected,
                        "root={root:?}, gitignore={gitignore}, hidden={include_hidden}"
                    );
                }
            }
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn options() -> Options {
        Options::from_json(&json!({})).unwrap()
    }

    #[test]
    fn lists_files_and_directories_depth_first_in_name_order() {
        let tree = Tree::new(&[
            "b.txt",
            "a/z.txt",
            "a/b/c.txt",
            "empty/",
            ".hidden/x",
            "A.txt",
        ]);
        let (entries, truncated) = tree.list(options());
        assert_eq!(
            entries,
            [
                "d .hidden",
                "f .hidden/x",
                "f A.txt",
                "d a",
                "d a/b",
                "f a/b/c.txt",
                "f a/z.txt",
                "f b.txt",
                "d empty"
            ]
        );
        assert!(!truncated);
        let (entries, _) = tree.list(Options {
            hidden: false,
            ..options()
        });
        assert!(!entries.iter().any(|entry| entry.contains(".hidden")));
    }

    #[test]
    fn skips_what_git_ignores_only_in_work_trees() {
        let tree = Tree::new(&[
            "keep.txt",
            "out/x.js",
            "sub/keep.txt",
            "sub/drop.log",
            "node_modules/m/i.js",
        ]);
        tree.write(".gitignore", "out/\n*.log\n");
        tree.write("sub/.gitignore", "!keep.txt\n");
        // Not a work tree yet: everything is listed.
        let (entries, _) = tree.list(options());
        assert!(entries.contains(&"f out/x.js".to_string()));
        tree.write(".git/HEAD", "ref: refs/heads/main\n");
        tree.write(".git/info/exclude", "keep.txt\n");
        let (entries, _) = tree.list(Options {
            exclude: vec!["node_modules".into()],
            ..options()
        });
        assert_eq!(
            entries,
            [
                "f .gitignore",
                "d sub",
                "f sub/.gitignore",
                "f sub/keep.txt"
            ]
        );
        let (entries, _) = tree.list(Options {
            gitignore: false,
            ..options()
        });
        assert!(entries.contains(&"f out/x.js".to_string()));
        assert!(!entries.iter().any(|entry| entry.contains(".git/")));
        // A subdirectory of a work tree applies the rules of its parents.
        let sub = list(&tree.0.join("sub").to_string_lossy(), &options(), &|| false).unwrap();
        assert_eq!(sub.payload, b"f.gitignore\0fkeep.txt\0");
    }

    #[test]
    fn hidden_filter_overrides_gitignore_whitelists_but_not_the_root() {
        let tree = Tree::new(&[".env", ".config/child", "visible"]);
        tree.write(".git/HEAD", "ref: refs/heads/main\n");
        tree.write(".gitignore", "!.env\n!.config/\n");
        let (entries, _) = tree.list(Options {
            hidden: false,
            ..options()
        });
        assert_eq!(entries, ["f visible"]);
        let (entries, _) = tree.list(options());
        assert!(entries.contains(&"f .env".to_string()));
        assert!(entries.contains(&"f .config/child".to_string()));
        let root = tree.0.join(".config");
        let listing = list(
            &root.to_string_lossy(),
            &Options {
                hidden: false,
                ..options()
            },
            &|| false,
        )
        .unwrap();
        assert_eq!(listing.payload, b"fchild\0");
    }

    #[cfg(windows)]
    #[test]
    fn windows_hidden_attributes_override_whitelists_and_preserve_root_traversal() {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_HIDDEN, SetFileAttributesW};
        let tree = Tree::new(&["secret", "private/child", "visible"]);
        tree.write(".git/HEAD", "ref: refs/heads/main\n");
        tree.write(".gitignore", "!secret\n!private/\n");
        for path in [&tree.0, &tree.0.join("secret"), &tree.0.join("private")] {
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            // SAFETY: the path is NUL-terminated and points to a fixture owned by this test.
            assert_ne!(
                unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN) },
                0
            );
        }
        let (entries, _) = tree.list(Options {
            hidden: false,
            ..options()
        });
        assert_eq!(entries, ["f visible"]);
        let (entries, _) = tree.list(options());
        assert!(entries.contains(&"f secret".to_string()));
        assert!(entries.contains(&"f private/child".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn lists_symbolic_links_without_following_them() {
        let tree = Tree::new(&["dir/inner.txt"]);
        std::os::unix::fs::symlink(tree.0.join("dir"), tree.0.join("link")).unwrap();
        std::os::unix::fs::symlink("missing", tree.0.join("dangling")).unwrap();
        std::os::unix::fs::symlink(&tree.0, tree.0.join("dir/loop")).unwrap();
        let (entries, _) = tree.list(options());
        assert_eq!(
            entries,
            [
                "l dangling",
                "d dir",
                "f dir/inner.txt",
                "l dir/loop",
                "l link"
            ]
        );
    }

    #[test]
    fn stops_at_bounds_with_truncated() {
        let tree = Tree::new(&["a", "b", "c"]);
        let (entries, truncated) = tree.list(Options {
            max_entries: 2,
            ..options()
        });
        assert_eq!((entries.len(), truncated), (2, true));
        let (entries, truncated) = tree.list(Options {
            max_entries: 3,
            ..options()
        });
        assert_eq!((entries.len(), truncated), (3, false));
        let (entries, truncated) = tree.list(Options {
            max_bytes: 6,
            ..options()
        });
        assert_eq!(
            (entries, truncated),
            (vec!["f a".to_string(), "f b".to_string()], true)
        );
        let (entries, truncated) = tree.list(Options {
            timeout: Duration::ZERO,
            ..options()
        });
        assert!(truncated && entries.is_empty());
    }

    #[test]
    fn enforces_deadlines_while_every_child_is_filtered() {
        use std::cell::Cell;

        for filter in ["gitignore", "exclude", "hidden"] {
            let tree = Tree::new(&[]);
            fs::create_dir_all(&tree.0).unwrap();
            let mut opts = options();
            for index in 0..64 {
                let name = format!(
                    "{}ignored-{index}",
                    if filter == "hidden" { "." } else { "" }
                );
                tree.write(&name, "");
                if filter == "exclude" {
                    opts.exclude.push(name.into());
                }
            }
            if filter == "gitignore" {
                tree.write(".git/HEAD", "ref: refs/heads/main\n");
                tree.write(".gitignore", "*\n");
            }
            opts.hidden = filter != "hidden";
            opts.timeout = Duration::from_millis(12);
            let ticks = Cell::new(0);
            let listing = list_with_elapsed(
                &tree.0.to_string_lossy(),
                &opts,
                &|| false,
                Some(&|| {
                    ticks.set(ticks.get() + 1);
                    Duration::from_millis(ticks.get())
                }),
            )
            .unwrap();
            assert!(listing.truncated, "{filter} traversal missed its deadline");
            assert_eq!(listing.payload, b"");
            assert_eq!(listing.count, 0);
        }
    }

    #[test]
    fn stops_during_sibling_collection_before_publishing_an_unordered_prefix() {
        use std::cell::Cell;

        let tree = Tree::new(&["z", "a"]);
        for index in 0..64 {
            tree.write(&format!("sibling-{index}"), "");
        }
        let ticks = Cell::new(0);
        let opts = Options {
            timeout: Duration::from_millis(12),
            ..options()
        };
        let listing = list_with_elapsed(
            &tree.0.to_string_lossy(),
            &opts,
            &|| false,
            Some(&|| {
                ticks.set(ticks.get() + 1);
                Duration::from_millis(ticks.get())
            }),
        )
        .unwrap();
        assert!(listing.truncated);
        assert_eq!(listing.payload, b"");
        assert_eq!(listing.count, 0);

        let checks = Cell::new(0);
        let result = list(&tree.0.to_string_lossy(), &options(), &|| {
            checks.set(checks.get() + 1);
            checks.get() >= 12
        });
        assert_eq!(result.err().unwrap().code, "aborted");
    }

    #[test]
    fn aborts_while_every_child_is_gitignored() {
        use std::cell::Cell;

        let tree = Tree::new(&[".git/HEAD"]);
        tree.write(".gitignore", "*\n");
        for index in 0..64 {
            tree.write(&format!("ignored-{index}"), "");
        }
        let checks = Cell::new(0);
        let result = list(&tree.0.to_string_lossy(), &options(), &|| {
            checks.set(checks.get() + 1);
            checks.get() >= 12
        });
        assert_eq!(result.err().unwrap().code, "aborted");
    }

    #[test]
    fn fails_on_missing_roots_files_and_aborts() {
        let tree = Tree::new(&["file"]);
        let missing = list(
            &tree.0.join("missing").to_string_lossy(),
            &options(),
            &|| false,
        );
        assert_eq!(missing.err().unwrap().code, "ENOENT");
        let file = list(&tree.0.join("file").to_string_lossy(), &options(), &|| {
            false
        });
        assert_eq!(file.err().unwrap().code, "ENOTDIR");
        let aborted = list(&tree.0.to_string_lossy(), &options(), &|| true);
        assert_eq!(aborted.err().unwrap().code, "aborted");
    }
}
