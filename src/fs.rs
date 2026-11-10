//! `zu/fs`: the editor's and file tree's read/write face.
//!
//! Every call names the workspace root it may touch (the active container's
//! cwd); this module canonicalizes both the root and the target and refuses
//! anything that leaves the root. `..`, an absolute path outside the root
//! and a symlink that points out are all rejected before any I/O. The UI
//! never gets an unrestricted file system: the engine's tools and the
//! editor's reads stay separate grants, as `docs/architecture.md` §3.6 says.
//!
//! Saves are atomic: the bytes go to a temporary file in the target's
//! directory, take the target's mode, are flushed, and are renamed over it.
//! A target that changed since `read`/`stat` makes `write` fail with
//! `ERR_FS_STALE` and the current mtime and size, so the editor can turn
//! read-only instead of overwriting somebody else's edit.
//!
//! Errors carry `code` (`error.code === "ERR_FS_STALE"`), as NSH's own file
//! calls do; messages are for people. Sizes and directory counts are capped
//! so one call cannot exhaust the app.

use std::{
    fs,
    io::{ErrorKind, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::UNIX_EPOCH,
};

use nsh_core::prelude::*;

/// The most one `read` returns: larger files are the editor's "too large"
/// state (and a language server's, later) rather than a frozen window.
const MAX_READ_BYTES: u64 = 2 * 1024 * 1024;
/// The most entries one `list` returns.
const MAX_DIR_ENTRIES: usize = 1000;
/// The UTF-8 byte order mark, kept on a save only when the file had one.
const BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];

const ERR_ROOT: &str = "ERR_FS_ROOT";
const ERR_PATH: &str = "ERR_FS_PATH";
const ERR_ESCAPE: &str = "ERR_FS_ESCAPE";
const ERR_BINARY: &str = "ERR_FS_BINARY";
const ERR_TOO_LARGE: &str = "ERR_FS_TOO_LARGE";
const ERR_TOO_MANY: &str = "ERR_FS_TOO_MANY";
const ERR_STALE: &str = "ERR_FS_STALE";
const ERR_ENCODING: &str = "ERR_FS_ENCODING";
const ERR_READONLY: &str = "ERR_FS_READONLY";
const ERR_IO: &str = "ERR_FS_IO";

/// One entry of a directory listing.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct FsEntry {
    /// The file or directory's name (not its path), as a string.
    pub name: String,
    /// Its absolute path; a symlink keeps its own path, not its target's.
    pub path: String,
    /// `"file"`, `"dir"`, `"symlink"` or `"other"`.
    pub kind: String,
    /// Bytes for a file; the entry's own size for a symlink; 0 for a directory.
    pub size: f64,
    /// The last modification, in milliseconds since the Unix epoch (0 when unknown).
    pub modified: f64,
}

/// What `stat` reports about one path.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct FsStat {
    /// The canonical absolute path (a symlink resolves to its target).
    pub path: String,
    /// `"file"`, `"dir"`, `"other"`.
    pub kind: String,
    /// Bytes.
    pub size: f64,
    /// The last modification, in milliseconds since the Unix epoch (0 when unknown).
    pub mtime_ms: f64,
    /// Its permission bits carry no write bit.
    pub readonly: bool,
}

/// A text file's contents, as `read` returns them.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct FsFile {
    /// The text, UTF-8; a file's byte order mark is not part of it.
    pub text: String,
    /// `"utf-8"` or `"utf-8-bom"` (pass the latter back to `write` to keep the mark).
    pub encoding: String,
    /// Always false: a binary file is an `ERR_FS_BINARY` error instead.
    pub binary: bool,
    /// Bytes on disk.
    pub size: f64,
    /// The last modification, in milliseconds since the Unix epoch.
    pub mtime_ms: f64,
}

/// What `write` leaves on disk: the file now, for the editor's next save.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct FsWriteResult {
    /// The canonical absolute path written.
    pub path: String,
    /// Bytes on disk after the save.
    pub size: f64,
    /// Its modification time after the save, in milliseconds since the Unix epoch.
    pub mtime_ms: f64,
}

/// The version a save expects: the mtime and size `read` (or `stat`) last
/// reported. A mismatch is `ERR_FS_STALE`, not an overwrite.
#[derive(Debug, Clone, Default, PartialEq, JsObject)]
pub struct FsExpected {
    /// The last modification, in milliseconds since the Unix epoch.
    pub mtime_ms: Option<f64>,
    /// The size in bytes.
    pub size: Option<f64>,
}

/// The workspace file system: `list`, `stat`, `read`, `write` and `mkdir`
/// under an allowed root.
///
/// Each call takes `root` (the active container's cwd) and a path, relative
/// to that root or absolute; both are canonicalized and the target must stay
/// inside the root. Errors are an `Error` with a `code`:
/// `ERR_FS_ROOT`, `ERR_FS_PATH`, `ERR_FS_ESCAPE`, `ERR_FS_BINARY`,
/// `ERR_FS_TOO_LARGE`, `ERR_FS_TOO_MANY`, `ERR_FS_STALE`,
/// `ERR_FS_ENCODING`, `ERR_FS_READONLY`, `ERR_FS_IO`, or the I/O error's own
/// (`ENOENT`, `EACCES`, ...).
#[module]
pub struct Fs;

#[module]
impl Fs {
    /// Lists `dir` (relative to `root`, or an absolute path inside it):
    /// directories first, then names case-insensitively. Symlinks are
    /// entries of their own and are not followed here.
    pub async fn list(root: String, dir: String) -> Result<Vec<FsEntry>, JsError> {
        in_task(move || list_in(&root, &dir)).await
    }

    /// Reports `path`'s kind, size, mtime and read-only bit; a symlink
    /// resolves to its target.
    pub async fn stat(root: String, path: String) -> Result<FsStat, JsError> {
        in_task(move || stat_in(&root, &path)).await
    }

    /// Creates directory `path` (its parent must exist inside `root`); an
    /// existing directory is returned as it is. Used to make a workspace
    /// folder without opening a file-system capability.
    pub async fn mkdir(root: String, path: String) -> Result<FsStat, JsError> {
        in_task(move || mkdir_in(&root, &path)).await
    }

    /// Reads a UTF-8 text file of at most 2 MiB. A binary or invalid UTF-8
    /// file fails with `ERR_FS_BINARY`; a larger one with
    /// `ERR_FS_TOO_LARGE` (with its `size` and the `limit`).
    pub async fn read(root: String, path: String) -> Result<FsFile, JsError> {
        in_task(move || read_in(&root, &path)).await
    }

    /// Writes `text` to `path` atomically, keeping the file's mode and byte
    /// order mark (as `encoding` says). `expected` is the version last read:
    /// when the file changed since, the save fails with `ERR_FS_STALE`
    /// (fields `mtimeMs`, `size`) and nothing is written.
    pub async fn write(
        root: String,
        path: String,
        text: String,
        expected: Option<FsExpected>,
        encoding: Option<String>,
    ) -> Result<FsWriteResult, JsError> {
        in_task(move || write_in(&root, &path, &text, expected.as_ref(), encoding.as_deref())).await
    }
}

// --- the calls, off the engine thread ---------------------------------------

/// Runs blocking file work on the runtime's blocking threads.
async fn in_task<T, F>(work: F) -> Result<T, JsError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, JsError> + Send + 'static,
{
    blocking(work)
        .await
        .map_err(|error| fs_error(ERR_IO, format!("the file task failed: {error}")))?
}

// --- path policy ------------------------------------------------------------

/// Canonicalizes the allowed root; it must exist and be a directory.
fn canonical_root(root: &str) -> Result<PathBuf, JsError> {
    if root.trim().is_empty() {
        return Err(fs_error(ERR_ROOT, "no workspace root was given"));
    }
    let raw = Path::new(root);
    if !raw.is_absolute() {
        return Err(fs_error(
            ERR_ROOT,
            format!("the workspace root is not absolute: {root}"),
        ));
    }
    let canonical = raw
        .canonicalize()
        .map_err(|error| fs_error(ERR_ROOT, format!("the workspace root is unusable ({root}): {error}")))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| fs_error(ERR_ROOT, format!("the workspace root is unusable ({root}): {error}")))?;
    if !metadata.is_dir() {
        return Err(fs_error(
            ERR_ROOT,
            format!("the workspace root is not a directory: {root}"),
        ));
    }
    Ok(canonical)
}

/// Joins `raw` onto `root`, refusing `..` and NUL before touching disk.
fn join_checked(root: &Path, raw: &str) -> Result<PathBuf, JsError> {
    if raw.trim().is_empty() {
        return Err(fs_error(ERR_PATH, "the path is empty"));
    }
    if raw.contains('\0') {
        return Err(fs_error(ERR_PATH, "the path contains a NUL byte"));
    }
    let path = Path::new(raw);
    for component in path.components() {
        if matches!(component, Component::ParentDir) {
            return Err(fs_error(
                ERR_ESCAPE,
                format!("`..` is not allowed in a workspace path: {raw}"),
            ));
        }
    }
    Ok(if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    })
}

/// The canonical target must sit inside the canonical root.
fn ensure_inside(root: &Path, path: &Path) -> Result<(), JsError> {
    if path.starts_with(root) {
        return Ok(());
    }
    Err(fs_error(
        ERR_ESCAPE,
        format!(
            "the path leaves the workspace root: {}",
            path.display()
        ),
    ))
}

/// Resolves a path that must exist, following symlinks and checking both.
fn resolve_existing(root: &Path, raw: &str) -> Result<PathBuf, JsError> {
    let joined = join_checked(root, raw)?;
    let canonical = joined.canonicalize().map_err(JsError::from)?;
    ensure_inside(root, &canonical)?;
    Ok(canonical)
}

/// Resolves a write target: its parent must exist inside the root, and a
/// symlink target must resolve inside it too.
fn resolve_for_write(root: &Path, raw: &str) -> Result<PathBuf, JsError> {
    let joined = join_checked(root, raw)?;
    let metadata = match fs::symlink_metadata(&joined) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => return Err(JsError::from(error)),
    };
    let target = match &metadata {
        Some(metadata) if metadata.file_type().is_symlink() => {
            let canonical = joined.canonicalize().map_err(JsError::from)?;
            ensure_inside(root, &canonical)?;
            canonical
        }
        _ => joined,
    };
    let parent = target
        .parent()
        .ok_or_else(|| fs_error(ERR_PATH, format!("the path has no parent directory: {raw}")))?;
    let parent = parent.canonicalize().map_err(JsError::from)?;
    ensure_inside(root, &parent)?;
    let name = target
        .file_name()
        .ok_or_else(|| fs_error(ERR_PATH, format!("the path names no file: {raw}")))?;
    Ok(parent.join(name))
}

// --- reading ----------------------------------------------------------------

/// One path's size and mtime, the pair a stale check compares.
struct FileInfo {
    size: f64,
    mtime_ms: f64,
}

/// Milliseconds since the Unix epoch, 0 when the platform has no mtime.
fn mtime_ms(metadata: &fs::Metadata) -> f64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

fn info_of(metadata: &fs::Metadata) -> FileInfo {
    FileInfo {
        size: metadata.len() as f64,
        mtime_ms: mtime_ms(metadata),
    }
}

/// `"file"`, `"dir"`, `"symlink"` or `"other"` for a lstat result.
fn kind_of(metadata: &fs::Metadata) -> &'static str {
    let kind = metadata.file_type();
    if kind.is_dir() {
        "dir"
    } else if kind.is_symlink() {
        "symlink"
    } else if kind.is_file() {
        "file"
    } else {
        "other"
    }
}

fn list_in(root: &str, dir: &str) -> Result<Vec<FsEntry>, JsError> {
    let root = canonical_root(root)?;
    list_limited(&root, dir, MAX_DIR_ENTRIES)
}

fn list_limited(root: &Path, dir: &str, max: usize) -> Result<Vec<FsEntry>, JsError> {
    let path = resolve_existing(root, dir)?;
    let metadata = fs::metadata(&path).map_err(JsError::from)?;
    if !metadata.is_dir() {
        return Err(JsError::from(std::io::Error::new(
            ErrorKind::NotADirectory,
            format!("not a directory: {}", path.display()),
        )));
    }
    let mut entries = Vec::new();
    for item in fs::read_dir(&path).map_err(JsError::from)? {
        let item = item.map_err(JsError::from)?;
        let name = item.file_name();
        // A name that is not UTF-8 cannot be addressed by a JS string, so it
        // is left out rather than made ambiguous by lossy conversion.
        let Some(name) = name.to_str() else { continue };
        let entry_path = item.path();
        let Ok(metadata) = fs::symlink_metadata(&entry_path) else {
            continue;
        };
        entries.push(FsEntry {
            name: name.to_owned(),
            path: entry_path.display().to_string(),
            kind: kind_of(&metadata).to_owned(),
            size: metadata.len() as f64,
            modified: mtime_ms(&metadata),
        });
        if entries.len() > max {
            return Err(fs_error(
                ERR_TOO_MANY,
                format!("the directory has more than {max} entries"),
            )
            .with("limit", max as f64));
        }
    }
    entries.sort_by(|a, b| {
        let a_dir = a.kind == "dir";
        let b_dir = b.kind == "dir";
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

fn mkdir_in(root: &str, path: &str) -> Result<FsStat, JsError> {
    let root = canonical_root(root)?;
    let target = resolve_for_write(&root, path)?;
    match fs::create_dir(&target) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            let metadata = fs::metadata(&target).map_err(JsError::from)?;
            if !metadata.is_dir() {
                return Err(fs_error(
                    ERR_PATH,
                    format!("a file is in the way: {}", target.display()),
                ));
            }
        }
        Err(error) => return Err(JsError::from(error)),
    }
    let metadata = fs::metadata(&target).map_err(JsError::from)?;
    Ok(FsStat {
        path: target.display().to_string(),
        kind: kind_of(&metadata).to_owned(),
        size: metadata.len() as f64,
        mtime_ms: mtime_ms(&metadata),
        readonly: metadata.permissions().readonly(),
    })
}

fn stat_in(root: &str, path: &str) -> Result<FsStat, JsError> {
    let root = canonical_root(root)?;
    let canonical = resolve_existing(&root, path)?;
    let metadata = fs::metadata(&canonical).map_err(JsError::from)?;
    Ok(FsStat {
        path: canonical.display().to_string(),
        kind: kind_of(&metadata).to_owned(),
        size: metadata.len() as f64,
        mtime_ms: mtime_ms(&metadata),
        readonly: metadata.permissions().readonly(),
    })
}

fn read_in(root: &str, path: &str) -> Result<FsFile, JsError> {
    let root = canonical_root(root)?;
    read_limited(&root, path, MAX_READ_BYTES)
}

fn read_limited(root: &Path, path: &str, limit: u64) -> Result<FsFile, JsError> {
    let canonical = resolve_existing(root, path)?;
    let metadata = fs::metadata(&canonical).map_err(JsError::from)?;
    if metadata.is_dir() {
        return Err(JsError::from(std::io::Error::new(
            ErrorKind::IsADirectory,
            format!("is a directory: {}", canonical.display()),
        )));
    }
    if !metadata.is_file() {
        return Err(fs_error(
            ERR_PATH,
            format!("not a regular file: {}", canonical.display()),
        ));
    }
    let size = metadata.len();
    if size > limit {
        return Err(too_large(size, limit));
    }
    let bytes = fs::read(&canonical).map_err(JsError::from)?;
    if bytes.len() as u64 > limit {
        return Err(too_large(bytes.len() as u64, limit));
    }
    let (text, encoding) = decode(&bytes)?;
    Ok(FsFile {
        text,
        encoding,
        binary: false,
        size: bytes.len() as f64,
        mtime_ms: mtime_ms(&metadata),
    })
}

/// Decodes a file as UTF-8 text, refusing binary bytes and keeping the BOM's
/// presence in the encoding.
fn decode(bytes: &[u8]) -> Result<(String, String), JsError> {
    let window = &bytes[..bytes.len().min(8192)];
    let has_nul = window.contains(&0);
    let (has_bom, body) = if bytes.starts_with(&BOM) {
        (true, &bytes[BOM.len()..])
    } else {
        (false, bytes)
    };
    if has_nul {
        return Err(binary_error());
    }
    match String::from_utf8(body.to_vec()) {
        Ok(text) => Ok((
            text,
            if has_bom { "utf-8-bom" } else { "utf-8" }.to_owned(),
        )),
        Err(_) => Err(binary_error()),
    }
}

// --- writing ----------------------------------------------------------------

fn write_in(
    root: &str,
    path: &str,
    text: &str,
    expected: Option<&FsExpected>,
    encoding: Option<&str>,
) -> Result<FsWriteResult, JsError> {
    let root = canonical_root(root)?;
    let encoding = encoding.unwrap_or("utf-8");
    let bom = match encoding {
        "utf-8" => false,
        "utf-8-bom" => true,
        other => {
            return Err(fs_error(
                ERR_ENCODING,
                format!("unsupported encoding: {other}"),
            ))
        }
    };
    let target = resolve_for_write(&root, path)?;
    let current = match fs::metadata(&target) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => return Err(JsError::from(error)),
    };
    if let Some(metadata) = &current {
        if metadata.is_dir() {
            return Err(JsError::from(std::io::Error::new(
                ErrorKind::IsADirectory,
                format!("is a directory: {}", target.display()),
            )));
        }
        if metadata.permissions().readonly() {
            return Err(fs_error(
                ERR_READONLY,
                format!("the file is read-only: {}", target.display()),
            ));
        }
    }
    if let Some(expected) = expected {
        let metadata = current.as_ref().ok_or_else(|| {
            fs_error(
                ERR_STALE,
                format!("the file is gone: {}", target.display()),
            )
        })?;
        let info = info_of(metadata);
        if !matches_expected(&info, expected) {
            return Err(stale_error(&info));
        }
    }
    let mode = current.as_ref().and_then(mode_of);
    let mut bytes = Vec::with_capacity(text.len() + if bom { BOM.len() } else { 0 });
    if bom {
        bytes.extend_from_slice(&BOM);
    }
    bytes.extend_from_slice(text.as_bytes());
    atomic_write(&target, &bytes, mode)?;
    let metadata = fs::metadata(&target).map_err(JsError::from)?;
    let info = info_of(&metadata);
    Ok(FsWriteResult {
        path: target.display().to_string(),
        size: info.size,
        mtime_ms: info.mtime_ms,
    })
}

fn matches_expected(info: &FileInfo, expected: &FsExpected) -> bool {
    expected
        .mtime_ms
        .map(|wanted| (info.mtime_ms - wanted).abs() < 0.5)
        .unwrap_or(true)
        && expected
            .size
            .map(|wanted| (info.size - wanted).abs() < 0.5)
            .unwrap_or(true)
}

/// Writes `bytes` beside `target`, then renames over it. The temporary file
/// is removed on every failure.
fn atomic_write(target: &Path, bytes: &[u8], mode: Option<u32>) -> Result<(), JsError> {
    let parent = target
        .parent()
        .ok_or_else(|| fs_error(ERR_PATH, "the target has no parent directory"))?;
    let (temp, mut file) = create_temp(parent)?;
    let mut guard = TempGuard {
        path: temp.clone(),
        keep: false,
    };
    #[cfg(unix)]
    if let Some(mode) = mode {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(mode & 0o7777))
            .map_err(JsError::from)?;
    }
    #[cfg(not(unix))]
    let _ = mode;
    file.write_all(bytes).map_err(JsError::from)?;
    file.sync_all().map_err(JsError::from)?;
    drop(file);
    fs::rename(&temp, target).map_err(JsError::from)?;
    guard.keep = true;
    // The rename is durable once the directory's own entries are flushed.
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

/// A fresh `.zu-<pid>-<n>.tmp` in `parent`.
fn create_temp(parent: &Path) -> Result<(PathBuf, fs::File), JsError> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let pid = std::process::id();
    for _ in 0..16 {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(".zu-{pid}-{n}.tmp"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(JsError::from(error)),
        }
    }
    Err(fs_error(
        ERR_IO,
        "cannot make a temporary file beside the target",
    ))
}

/// Removes the temporary file unless the rename took it.
struct TempGuard {
    path: PathBuf,
    keep: bool,
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(unix)]
fn mode_of(metadata: &fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(metadata.permissions().mode())
}

#[cfg(not(unix))]
fn mode_of(_metadata: &fs::Metadata) -> Option<u32> {
    None
}

// --- errors -----------------------------------------------------------------

fn fs_error(code: &str, message: impl Into<String>) -> JsError {
    JsError::Error(message.into()).with_code(code)
}

fn binary_error() -> JsError {
    fs_error(
        ERR_BINARY,
        "the file is binary or not UTF-8; the editor shows text files only",
    )
}

fn too_large(size: u64, limit: u64) -> JsError {
    fs_error(
        ERR_TOO_LARGE,
        format!(
            "the file is {size} bytes, over the {limit}-byte limit; open it outside the editor"
        ),
    )
    .with("size", size as f64)
    .with("limit", limit as f64)
}

fn stale_error(info: &FileInfo) -> JsError {
    fs_error(
        ERR_STALE,
        "the file changed on disk since it was read; reload before saving",
    )
    .with("mtimeMs", info.mtime_ms)
    .with("size", info.size)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A unique directory removed when the test ends.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "zu-fs-test-{}-{}-{n}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_nanos())
                    .unwrap_or(0)
            ));
            fs::create_dir_all(&path).expect("a temporary root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn code(error: &JsError) -> Option<&str> {
        error.code()
    }

    #[test]
    fn a_parent_segment_is_not_a_path() {
        let root = TempRoot::new();
        let error = read_in(&root.path().display().to_string(), "../escape.txt").unwrap_err();
        assert_eq!(code(&error), Some(ERR_ESCAPE));
    }

    #[test]
    fn an_absolute_path_outside_the_root_is_refused() {
        let root = TempRoot::new();
        let error = read_in(&root.path().display().to_string(), "/etc/hosts").unwrap_err();
        assert_eq!(code(&error), Some(ERR_ESCAPE));
    }

    #[test]
    fn a_symlink_out_of_the_root_is_refused() {
        let root = TempRoot::new();
        let outside = root.path().parent().unwrap().join(format!(
            "zu-fs-outside-{}.txt",
            std::process::id()
        ));
        fs::write(&outside, "secret").unwrap();
        let link = root.path().join("link.txt");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        #[cfg(not(unix))]
        {
            let _ = &link;
            return;
        }
        let error =
            read_in(&root.path().display().to_string(), "link.txt").unwrap_err();
        assert_eq!(code(&error), Some(ERR_ESCAPE));
        let _ = fs::remove_file(&outside);
    }

    #[test]
    fn a_write_is_atomic_and_keeps_the_mode() {
        let root = TempRoot::new();
        let target = root.path().join("main.rs");
        fs::write(&target, "fn main() {}\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
        }
        let written = write_in(
            &root.path().display().to_string(),
            "main.rs",
            "fn main() { saved(); }\n",
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            "fn main() { saved(); }\n"
        );
        assert_eq!(written.size, 23.0);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o640);
        }
        let leftovers: Vec<_> = fs::read_dir(root.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".zu-"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files left: {leftovers:?}");
    }

    #[test]
    fn a_directory_is_made_inside_the_root_and_never_outside_it() {
        let root = TempRoot::new();
        let root_path = root.path().display().to_string();
        let made = mkdir_in(&root_path, "notes").unwrap();
        assert_eq!(made.kind, "dir");
        assert!(root.path().join("notes").is_dir());
        // Idempotent for an existing directory.
        mkdir_in(&root_path, "notes").unwrap();
        let error = mkdir_in(&root_path, "../escape").unwrap_err();
        assert_eq!(code(&error), Some(ERR_ESCAPE));
    }

    #[test]
    fn a_changed_file_is_stale_and_a_matching_one_is_not() {
        let root = TempRoot::new();
        let root_path = root.path().display().to_string();
        write_in(&root_path, "notes.md", "first\n", None, None).unwrap();
        let read = read_in(&root_path, "notes.md").unwrap();
        let expected = FsExpected {
            mtime_ms: Some(read.mtime_ms),
            size: Some(read.size),
        };
        // Another writer changes the size (mtime alone is too coarse to race).
        fs::write(root.path().join("notes.md"), "first\nsecond\n").unwrap();
        let error = write_in(
            &root_path,
            "notes.md",
            "mine\n",
            Some(&expected),
            None,
        )
        .unwrap_err();
        assert_eq!(code(&error), Some(ERR_STALE));
        assert_eq!(
            fs::read_to_string(root.path().join("notes.md")).unwrap(),
            "first\nsecond\n"
        );

        let current = read_in(&root_path, "notes.md").unwrap();
        let expected = FsExpected {
            mtime_ms: Some(current.mtime_ms),
            size: Some(current.size),
        };
        write_in(&root_path, "notes.md", "mine\n", Some(&expected), None).unwrap();
        assert_eq!(
            fs::read_to_string(root.path().join("notes.md")).unwrap(),
            "mine\n"
        );
    }

    #[test]
    fn a_binary_file_is_refused() {
        let root = TempRoot::new();
        fs::write(root.path().join("blob.bin"), [0u8, 1, 2, 3]).unwrap();
        let error = read_in(&root.path().display().to_string(), "blob.bin").unwrap_err();
        assert_eq!(code(&error), Some(ERR_BINARY));
    }

    #[test]
    fn an_invalid_utf8_file_is_refused() {
        let root = TempRoot::new();
        fs::write(root.path().join("latin1.txt"), [0xE9, 0x74, 0xE9]).unwrap();
        let error = read_in(&root.path().display().to_string(), "latin1.txt").unwrap_err();
        assert_eq!(code(&error), Some(ERR_BINARY));
    }

    #[test]
    fn a_file_over_the_limit_is_refused() {
        let root = TempRoot::new();
        fs::write(root.path().join("big.txt"), "0123456789").unwrap();
        let root_path = root.path().canonicalize().unwrap();
        let error = read_limited(&root_path, "big.txt", 4).unwrap_err();
        assert_eq!(code(&error), Some(ERR_TOO_LARGE));
    }

    #[test]
    fn a_directory_over_the_limit_is_refused() {
        let root = TempRoot::new();
        for name in ["a.txt", "b.txt", "c.txt"] {
            fs::write(root.path().join(name), "x").unwrap();
        }
        let root_path = root.path().canonicalize().unwrap();
        let error = list_limited(&root_path, ".", 2).unwrap_err();
        assert_eq!(code(&error), Some(ERR_TOO_MANY));
    }

    #[test]
    fn a_listing_puts_directories_first_and_keeps_the_bom_on_a_save() {
        let root = TempRoot::new();
        let root_path = root.path().display().to_string();
        fs::create_dir(root.path().join("src")).unwrap();
        fs::write(root.path().join("b.txt"), "b").unwrap();
        fs::write(root.path().join("A.txt"), "a").unwrap();
        let entries = list_in(&root_path, ".").unwrap();
        let names: Vec<_> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(names, ["src", "A.txt", "b.txt"]);

        write_in(&root_path, "bom.txt", "hello\n", None, Some("utf-8-bom")).unwrap();
        let bytes = fs::read(root.path().join("bom.txt")).unwrap();
        assert!(bytes.starts_with(&BOM));
        let read = read_in(&root_path, "bom.txt").unwrap();
        assert_eq!(read.encoding, "utf-8-bom");
        assert_eq!(read.text, "hello\n");
    }

    #[test]
    fn a_write_through_a_symlink_inside_the_root_keeps_the_link() {
        let root = TempRoot::new();
        let root_path = root.path().display().to_string();
        fs::write(root.path().join("real.txt"), "old\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("real.txt", root.path().join("alias.txt")).unwrap();
        #[cfg(not(unix))]
        return;
        write_in(&root_path, "alias.txt", "new\n", None, None).unwrap();
        assert_eq!(
            fs::read_to_string(root.path().join("real.txt")).unwrap(),
            "new\n"
        );
        assert!(fs::symlink_metadata(root.path().join("alias.txt"))
            .unwrap()
            .file_type()
            .is_symlink());
    }
}
