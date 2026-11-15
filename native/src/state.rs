//! `zu/state`: the UI's durable state and the session index (v2 §6).
//!
//! The registry, the projects, the layouts and the settings live as JSON
//! files under the state directory (`~/.pi/zu` unless `ZU_STATE_DIR` or a
//! test points elsewhere). The **UI is the writer** — the writer inversion
//! of v2 — so this module gives TSX three operations:
//!
//! * `read(name)` — the file's raw text plus its top-level `v` version, so
//!   the caller can merge and stamp;
//! * `write(name, text)` — an atomic temp+rename write (a crash leaves the
//!   old file or the new one, never a half one), refusing to clobber a file
//!   whose `v` is newer than the incoming one (`ERR_STATE_STALE`: an older
//!   build never silently downgrades a newer state);
//! * `scan_sessions(watermark)` — the session index's fold: a walk of pi's
//!   session directory whose watermark (the newest mtime, directories
//!   included) skips the parse entirely when nothing moved, and otherwise
//!   reads each file's header line, its name, its first user text and a
//!   message count — bounded, never the whole transcript into memory.
//!
//! Zero protocol semantics: the shapes above these files stay in TSX, the
//! same split as [`crate::acp`]. The engine sidecar has no access here —
//! its own scratch state lives in an `engine/` subdirectory it is pointed
//! at on spawn.

use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::UNIX_EPOCH,
};

use nsh_core::prelude::*;

use crate::{AGENT_DIR, zu_dir};

/// The most bytes of one session file the header scan reads for the name and
/// the preview; the rest of the file only feeds the message count.
const HEADER_SCAN_BYTES: u64 = 512 * 1024;
/// The most session files one scan reports (the engine's old cap).
const MAX_SESSIONS: usize = 2000;
/// The deepest the session walk descends (pi's own layout is flat or one
/// level of project directories).
const MAX_SESSION_DEPTH: usize = 3;
/// How much text of a session's first user message becomes the preview.
const PREVIEW_CHARS: usize = 160;

const ERR_NAME: &str = "ERR_STATE_NAME";
const ERR_STALE: &str = "ERR_STATE_STALE";
const ERR_JSON: &str = "ERR_STATE_JSON";
const ERR_IO: &str = "ERR_STATE_IO";

/// What `read` found: the file's text, its top-level `v` (null when the file
/// has none), and the mtime/size pair a staleness-aware caller may keep.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct StateRead {
    /// The file's text (UTF-8).
    pub text: String,
    /// The top-level `v` version field, when it is a number.
    pub version: Option<f64>,
    /// The last modification, in milliseconds since the Unix epoch.
    pub mtime_ms: f64,
    /// Bytes on disk.
    pub size: f64,
}

/// What `write` left on disk.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct StateWrite {
    /// The canonical absolute path written.
    pub path: String,
    /// The file's size after the write.
    pub size: f64,
    /// Its modification time after the write.
    pub mtime_ms: f64,
}

/// One session of the index, shaped like the old engine's `session.list`.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct ScanSession {
    /// pi's session id (the file name's suffix).
    pub id: String,
    /// The absolute file path.
    pub path: String,
    /// The cwd the session was created in.
    pub cwd: String,
    /// The session's name (`session_info`), empty when pi never named it.
    pub name: String,
    /// Created, from the header's timestamp, in milliseconds.
    pub created: f64,
    /// The file's last modification, in milliseconds.
    pub modified: f64,
    /// The number of message entries in the file.
    pub message_count: f64,
    /// The first user message's text, truncated.
    pub preview: String,
}

/// What `scan_sessions` reports: whether anything moved since the caller's
/// watermark, the new watermark, and (when it did) the full index.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct SessionScan {
    /// False when the watermark matches: keep what you have, nothing parsed.
    pub changed: bool,
    /// The watermark to pass back on the next call.
    pub watermark: f64,
    /// The index, newest first, capped.
    pub sessions: Vec<ScanSession>,
}

/// The UI's durable state: `read`, `write` and the session index, all under
/// the state directory this app owns.
#[module]
pub struct State;

#[module]
impl State {
    /// Reads `<state>/<name>.json`; `null` when the file does not exist.
    pub fn read(name: String) -> Result<Option<StateRead>, JsError> {
        let path = state_file(&name)?;
        let Ok(metadata) = fs::metadata(&path) else {
            return Ok(None);
        };
        let bytes = fs::read(&path).map_err(|error| {
            state_error(ERR_IO, format!("cannot read {}: {error}", path.display()))
        })?;
        let version: Option<f64> = serde_json::from_slice::<serde_json::Value>(&bytes)
            .ok()
            .and_then(|value| value.get("v").and_then(|v| v.as_f64()));
        Ok(Some(StateRead {
            text: String::from_utf8_lossy(&bytes).into_owned(),
            version,
            mtime_ms: mtime_ms(&metadata),
            size: metadata.len() as f64,
        }))
    }

    /// Writes `<state>/<name>.json` atomically (temp file, rename). A file
    /// whose top-level `v` is a number greater than the incoming text's
    /// refuses the write (`ERR_STATE_STALE`) — a newer state is never
    /// silently downgraded. The incoming text must be a JSON object.
    pub fn write(name: String, text: String) -> Result<StateWrite, JsError> {
        let path = state_file(&name)?;
        write_in(&path, &text)
    }

    /// The session index: pi's session directory folded against a watermark.
    /// An unchanged directory answers `changed: false` and no entries, so a
    /// poll costs one walk's stats and no parsing. The walk and the header
    /// reads run on the blocking pool — a first scan of a big session
    /// directory is real work, and the UI thread never waits on it inside a
    /// call budget. The pi agent directory is `~/.pi/agent` unless a test
    /// pointed it elsewhere (`setAgentDir`).
    pub async fn scan_sessions(watermark: f64) -> Result<SessionScan, JsError> {
        in_task(move || scan_sessions_in(watermark)).await
    }

    /// The user's home folder, when the platform reports one. The UI has no
    /// environment of its own (its `process.env` is a narrow capability
    /// view), and "start anywhere" needs one honest folder.
    pub fn home_dir() -> Option<String> {
        std::env::var("HOME")
            .ok()
            .map(|home| home.trim().to_owned())
            .filter(|home| !home.is_empty())
    }

    /// Points the state directory (registry, layouts, settings) at `path`.
    /// Tests use it to isolate a run; the packaged app never calls it.
    pub fn set_state_dir(path: String) {
        if let Ok(mut dir) = crate::STATE_DIR.lock() {
            *dir = if path.trim().is_empty() {
                None
            } else {
                Some(PathBuf::from(path.trim()))
            };
        }
    }

    /// Points pi's home for the session index at `path`; an empty string
    /// restores `~/.pi/agent`. Tests use it to scan a fixture directory.
    pub fn set_agent_dir(path: String) {
        if let Ok(mut dir) = AGENT_DIR.lock() {
            *dir = if path.trim().is_empty() {
                None
            } else {
                Some(PathBuf::from(path.trim()))
            };
        }
    }
}

/// Runs blocking file work on the runtime's blocking threads (zu/fs's shape).
async fn in_task<T, F>(work: F) -> Result<T, JsError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, JsError> + Send + 'static,
{
    blocking(work)
        .await
        .map_err(|error| state_error(ERR_IO, format!("the state task failed: {error}")))?
}

/// The scan body, off the UI thread.
fn scan_sessions_in(watermark: f64) -> Result<SessionScan, JsError> {
    let root = sessions_dir()?;
    let current = dir_watermark(&root);
    if watermark != 0.0 && current == watermark {
        return Ok(SessionScan {
            changed: false,
            watermark: current,
            sessions: Vec::new(),
        });
    }
    let mut files = Vec::new();
    collect_jsonl(&root, 0, &mut files);
    let mut sessions = Vec::new();
    for path in files {
        if sessions.len() >= MAX_SESSIONS {
            break;
        }
        if let Some(session) = scan_session(&path) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|a, b| {
        b.modified
            .partial_cmp(&a.modified)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.path.cmp(&a.path))
    });
    sessions.truncate(MAX_SESSIONS);
    Ok(SessionScan {
        changed: true,
        watermark: current,
        sessions,
    })
}

// --- the state files --------------------------------------------------------

/// `<state>/<name>.json`, with the name checked before any I/O: one path
/// segment, no separators, no leading dot, so `name` can never leave the
/// state directory or name a hidden file.
fn state_file(name: &str) -> Result<PathBuf, JsError> {
    let dir = zu_dir().map_err(|error| state_error(ERR_IO, error))?;
    state_file_in(&dir, name)
}

/// The write policy against an explicit path: the JSON object check, the
/// version staleness check, then the atomic rename. The tests' entry point.
fn write_in(path: &Path, text: &str) -> Result<StateWrite, JsError> {
    let incoming: serde_json::Value = serde_json::from_str(text.trim()).map_err(|error| {
        state_error(ERR_JSON, format!("the state to write is not JSON: {error}"))
    })?;
    if !incoming.is_object() {
        return Err(state_error(
            ERR_JSON,
            "the state to write must be a JSON object",
        ));
    }
    let incoming_version = incoming.get("v").and_then(|v| v.as_f64());
    if let Ok(on_disk) = fs::read(path)
        && let Ok(value) = serde_json::from_slice::<serde_json::Value>(&on_disk)
        && let Some(on_disk_version) = value.get("v").and_then(|v| v.as_f64())
        && let Some(incoming_version) = incoming_version
        && on_disk_version > incoming_version
    {
        return Err(state_error(
            ERR_STALE,
            format!(
                "{} on disk carries version {on_disk_version}, newer than the incoming {incoming_version}",
                path.display()
            ),
        )
        .with("version", on_disk_version));
    }
    atomic_write(path, text.trim().as_bytes())?;
    let metadata = fs::metadata(path)
        .map_err(|error| state_error(ERR_IO, format!("cannot stat {}: {error}", path.display())))?;
    Ok(StateWrite {
        path: path.display().to_string(),
        size: metadata.len() as f64,
        mtime_ms: mtime_ms(&metadata),
    })
}

/// The name policy against an explicit directory (the tests' entry point).
fn state_file_in(dir: &Path, name: &str) -> Result<PathBuf, JsError> {
    let trimmed = name.trim();
    // One directory level at most (`layouts/<encoded id>.json`); every
    // segment is non-empty, names no hidden file, and none is `..`.
    let segments: Vec<&str> = trimmed.split('/').collect();
    let valid = !trimmed.is_empty()
        && !trimmed.contains('\\')
        && !trimmed.contains('\0')
        && segments.len() <= 2
        && segments
            .iter()
            .all(|segment| !segment.is_empty() && !segment.starts_with('.') && *segment != "..")
        && trimmed.ends_with(".json");
    if !valid {
        return Err(state_error(
            ERR_NAME,
            format!("a state name is one `[<dir>/]<name>.json` segment: {trimmed:?}"),
        ));
    }
    Ok(dir.join(trimmed))
}

/// Writes `bytes` beside `target`, then renames over it; the temporary file
/// is removed on every failure.
fn atomic_write(target: &Path, bytes: &[u8]) -> Result<(), JsError> {
    let parent = target
        .parent()
        .ok_or_else(|| state_error(ERR_IO, "the target has no parent directory"))?;
    let _ = fs::create_dir_all(parent);
    let (temp, mut file) = create_temp(parent)?;
    struct Guard {
        path: PathBuf,
        keep: bool,
    }
    impl Drop for Guard {
        fn drop(&mut self) {
            if !self.keep {
                let _ = fs::remove_file(&self.path);
            }
        }
    }
    let mut guard = Guard {
        path: temp.clone(),
        keep: false,
    };
    file.write_all(bytes).map_err(|error| {
        state_error(ERR_IO, format!("cannot write {}: {error}", temp.display()))
    })?;
    file.sync_all().map_err(|error| {
        state_error(ERR_IO, format!("cannot flush {}: {error}", temp.display()))
    })?;
    drop(file);
    fs::rename(&temp, target).map_err(|error| {
        state_error(
            ERR_IO,
            format!("cannot move {} into place: {error}", temp.display()),
        )
    })?;
    guard.keep = true;
    if let Ok(directory) = fs::File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

/// A fresh `.zu-state-<pid>-<n>.tmp` in `parent`.
fn create_temp(parent: &Path) -> Result<(PathBuf, fs::File), JsError> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let pid = std::process::id();
    for _ in 0..16 {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(".zu-state-{pid}-{n}.tmp"));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(state_error(
                    ERR_IO,
                    format!("cannot make a temporary file: {error}"),
                ));
            }
        }
    }
    Err(state_error(
        ERR_IO,
        "cannot make a temporary file beside the target",
    ))
}

fn state_error(code: &str, message: impl Into<String>) -> JsError {
    JsError::Error(message.into()).with_code(code)
}

// --- the session index ------------------------------------------------------

/// pi's session directory (`<agent dir>/sessions`), created on use.
fn sessions_dir() -> Result<PathBuf, JsError> {
    let agent = AGENT_DIR
        .lock()
        .ok()
        .and_then(|dir| dir.clone())
        .unwrap_or_else(default_agent_dir);
    let root = agent.join("sessions");
    let _ = fs::create_dir_all(&root);
    Ok(root)
}

fn default_agent_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return Path::new(&home).join(".pi").join("agent");
    }
    PathBuf::from(".pi/agent")
}

/// The newest mtime under `dir`, directories included (so a created or
/// deleted file moves the watermark even when every survivor is older) —
/// the engine's old watermark rule, kept.
fn dir_watermark(dir: &Path) -> f64 {
    let mut newest = 0.0;
    if let Ok(metadata) = fs::metadata(dir) {
        newest = mtime_ms(&metadata);
    }
    let mut entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return newest,
    };
    let mut children = Vec::new();
    for entry in entries.by_ref().flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            children.push(entry.path());
        } else {
            newest = newest.max(mtime_ms(&metadata));
        }
    }
    drop(entries);
    for child in children {
        newest = newest.max(dir_watermark(&child));
    }
    newest
}

/// Every `.jsonl` file under `dir`, depth-capped.
fn collect_jsonl(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_SESSION_DEPTH || out.len() > MAX_SESSIONS * 2 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_jsonl(&path, depth + 1, out);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

/// One session file's index entry: the header line (id, cwd, created), the
/// last `session_info` name within the scan cap, the first user message's
/// text, and a whole-file count of the message entries. Anything unreadable
/// yields `None` — a broken file never blocks the index.
fn scan_session(path: &Path) -> Option<ScanSession> {
    let metadata = fs::metadata(path).ok()?;
    let modified = mtime_ms(&metadata);
    let mut file = fs::File::open(path).ok()?;
    let mut head = Vec::new();
    let mut remaining = HEADER_SCAN_BYTES;
    let mut buffer = [0u8; 64 * 1024];
    while remaining > 0 {
        let wanted = remaining.min(buffer.len() as u64) as usize;
        match file.read(&mut buffer[..wanted]) {
            Ok(0) => break,
            Ok(n) => {
                head.extend_from_slice(&buffer[..n]);
                remaining -= n as u64;
            }
            Err(_) => break,
        }
    }
    let head_text = String::from_utf8_lossy(&head);
    let mut lines = head_text.lines();
    // The header: pi writes it as the first line of every session file.
    let header: serde_json::Value = serde_json::from_str(lines.next()?).ok()?;
    if header.get("type")?.as_str()? != "session" {
        return None;
    }
    let id = header.get("id")?.as_str()?.to_owned();
    let cwd = header
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_owned();
    let created = timestamp_ms(header.get("timestamp").and_then(|v| v.as_str()));
    // Within the scanned head: the name and the first user text.
    let mut name = String::new();
    let mut preview = String::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) == Some("session_info") {
            if let Some(named) = value.get("name").and_then(|v| v.as_str()) {
                name = truncate_chars(named, PREVIEW_CHARS);
            }
            continue;
        }
        if preview.is_empty() && value.get("type").and_then(|v| v.as_str()) == Some("message") {
            let message = value.get("message");
            if message.and_then(|m| m.get("role")).and_then(|r| r.as_str()) == Some("user") {
                preview = truncate_chars(&first_text(message), PREVIEW_CHARS);
            }
        }
        if !name.is_empty() && !preview.is_empty() {
            break;
        }
    }
    let message_count = count_pattern(path, b"\"type\":\"message\"");
    Some(ScanSession {
        id,
        path: path.display().to_string(),
        cwd,
        name,
        created,
        modified,
        message_count: message_count as f64,
        preview,
    })
}

/// The first `"text"` of a message's content blocks, as plain text.
fn first_text(message: Option<&serde_json::Value>) -> String {
    let Some(content) = message.and_then(|m| m.get("content")) else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_owned();
    }
    if let Some(blocks) = content.as_array() {
        for block in blocks {
            if block.get("type").and_then(|v| v.as_str()) == Some("text")
                && let Some(text) = block.get("text").and_then(|v| v.as_str())
            {
                return text.to_owned();
            }
        }
    }
    String::new()
}

/// Counts occurrences of `pattern` over the whole file, streaming, with one
/// byte of overlap per chunk so a split match is never missed.
fn count_pattern(path: &Path, pattern: &[u8]) -> usize {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return 0,
    };
    let mut count = 0usize;
    let mut tail: Vec<u8> = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                let chunk: Vec<u8> = tail
                    .iter()
                    .copied()
                    .chain(buffer[..n].iter().copied())
                    .collect();
                count += chunk
                    .windows(pattern.len())
                    .filter(|w| *w == pattern)
                    .count();
                let keep = pattern.len().saturating_sub(1).min(chunk.len());
                tail = chunk[chunk.len() - keep..].to_vec();
            }
            Err(_) => break,
        }
    }
    count
}

/// Truncates to `max` characters on a char boundary, with an ellipsis.
fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let cut: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{cut}\u{2026}")
}

/// pi's ISO timestamp → milliseconds since the epoch; 0 when unparsable.
fn timestamp_ms(raw: Option<&str>) -> f64 {
    timestamp_ms_inner(raw).unwrap_or(0.0)
}

/// The parse, as an `Option` so `?` can carry the failure shapes.
fn timestamp_ms_inner(raw: Option<&str>) -> Option<f64> {
    let raw = raw?;
    // pi stamps RFC 3339 UTC (`2026-07-20T03:38:58.868Z`). A manual parse
    // avoids a chrono dependency for one shape this build owns.
    let bytes = raw.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let year: i64 = raw.get(0..4)?.parse().ok()?;
    let month: i64 = raw.get(5..7)?.parse().ok()?;
    let day: i64 = raw.get(8..10)?.parse().ok()?;
    let hour: i64 = raw.get(11..13)?.parse().ok()?;
    let minute: i64 = raw.get(14..16)?.parse().ok()?;
    let second: i64 = raw.get(17..19)?.parse().ok()?;
    let millis: i64 = if bytes.len() >= 24 && bytes[19] == b'.' {
        let mut fraction = String::new();
        for byte in &bytes[20..] {
            if byte.is_ascii_digit() && fraction.len() < 3 {
                fraction.push(*byte as char);
            } else {
                break;
            }
        }
        while fraction.len() < 3 {
            fraction.push('0');
        }
        fraction.parse().unwrap_or(0)
    } else {
        0
    };
    // Days from the civil epoch, Howard Hinnant's algorithm.
    let days = days_from_civil(year, month, day);
    let secs = hour * 3600 + minute * 60 + second;
    Some(((days * 86_400_000) + (secs * 1000) + millis) as f64)
}

/// Days from 1970-01-01 to the given civil date.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique directory removed when the test ends.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "zu-state-test-{}-{}-{n}",
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
    fn a_name_is_one_json_segment() {
        let root = TempRoot::new();
        assert_eq!(
            state_file_in(root.path(), "registry").unwrap_err().code(),
            Some(ERR_NAME)
        );
        assert_eq!(
            state_file_in(root.path(), "../escape.json")
                .unwrap_err()
                .code(),
            Some(ERR_NAME)
        );
        assert_eq!(
            state_file_in(root.path(), ".hidden.json")
                .unwrap_err()
                .code(),
            Some(ERR_NAME)
        );
        assert_eq!(
            state_file_in(root.path(), "no-extension")
                .unwrap_err()
                .code(),
            Some(ERR_NAME)
        );
        assert_eq!(
            state_file_in(root.path(), "a/b/c.json").unwrap_err().code(),
            Some(ERR_NAME)
        );
        assert_eq!(
            state_file_in(root.path(), "layouts/../x.json")
                .unwrap_err()
                .code(),
            Some(ERR_NAME)
        );
        assert_eq!(
            state_file_in(root.path(), "/abs.json").unwrap_err().code(),
            Some(ERR_NAME)
        );
        assert!(state_file_in(root.path(), "registry.json").is_ok());
        assert!(state_file_in(root.path(), "layouts%3Aa.json").is_ok());
        assert!(state_file_in(root.path(), "layouts/pi%3Aabc.json").is_ok());
        let nested = state_file_in(root.path(), "layouts/pi%3Aabc.json").unwrap();
        assert!(nested.starts_with(root.path().join("layouts/")));
    }

    #[test]
    fn a_write_is_atomic_and_stale_checked() {
        let root = TempRoot::new();
        // A first write with no file present.
        let written = write_in(
            &root.path().join("registry.json"),
            r#"{"v":1,"containers":[]}"#,
        )
        .unwrap();
        assert!(written.size > 0.0);
        // A same-version rewrite passes.
        write_in(
            &root.path().join("registry.json"),
            r#"{"v":1,"containers":["a"]}"#,
        )
        .unwrap();
        // An older build writing an older version is refused, file intact.
        let error = write_in(&root.path().join("registry.json"), r#"{"v":0}"#).unwrap_err();
        assert_eq!(code(&error), Some(ERR_STALE));
        let on_disk = fs::read_to_string(root.path().join("registry.json")).unwrap();
        assert!(
            on_disk.contains("\"a\""),
            "the newer file stands: {on_disk}"
        );
        // Non-JSON and non-object payloads are refused before touching disk.
        assert_eq!(
            code(&write_in(&root.path().join("x.json"), "[1]").unwrap_err()),
            Some(ERR_JSON)
        );
        assert_eq!(
            code(&write_in(&root.path().join("x.json"), "nope").unwrap_err()),
            Some(ERR_JSON)
        );
        // No temporary files are left behind.
        let leftovers: Vec<_> = fs::read_dir(root.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".zu-state-"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files left: {leftovers:?}");
    }

    #[test]
    fn a_session_file_scans_to_an_index_entry() {
        let root = TempRoot::new();
        let sessions = root.path().join("sessions").join("--tmp-demo--");
        fs::create_dir_all(&sessions).unwrap();
        let file =
            sessions.join("2026-07-20T03-38-58-867Z_a2326702-1b70-4587-920a-0fba0f2c1455.jsonl");
        fs::write(
            &file,
            concat!(
                r#"{"type":"session","version":3,"id":"a2326702-1b70-4587-920a-0fba0f2c1455","timestamp":"2026-07-20T03:38:58.868Z","cwd":"/tmp/demo"}"#,
                "\n",
                r#"{"type":"model_change","id":"x","timestamp":"2026-07-20T03:38:58.871Z","provider":"p","modelId":"m"}"#,
                "\n",
                r#"{"type":"session_info","id":"y","timestamp":"2026-07-20T03:38:58.872Z","name":"the demo session"}"#,
                "\n",
                r#"{"type":"message","id":"m1","timestamp":"2026-07-20T03:43:26.310Z","message":{"role":"user","content":[{"type":"text","text":"hello there"}]}}"#,
                "\n",
                r#"{"type":"message","id":"m2","timestamp":"2026-07-20T03:43:30.000Z","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}"#,
                "\n",
            ),
        )
        .unwrap();
        let entry = scan_session(&file).expect("the file scans");
        assert_eq!(entry.id, "a2326702-1b70-4587-920a-0fba0f2c1455");
        assert_eq!(entry.cwd, "/tmp/demo");
        assert_eq!(entry.name, "the demo session");
        assert_eq!(entry.preview, "hello there");
        assert_eq!(entry.message_count, 2.0);
        assert!(
            entry.created > 1_700_000_000_000.0,
            "created parses: {}",
            entry.created
        );
        assert!(entry.modified > 0.0);
    }

    #[test]
    fn a_watermark_that_has_not_moved_skips_the_parse() {
        let root = TempRoot::new();
        let sessions = root.path().join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        let file = sessions.join("t_one.jsonl");
        fs::write(&file, header_line("one", "/tmp")).unwrap();
        let first = dir_watermark(&sessions);
        assert!(first > 0.0);
        // The same walk twice answers the same watermark; the scan op's
        // early return is the caller's `changed: false`.
        assert_eq!(dir_watermark(&sessions), first);
        // A new file moves it.
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(sessions.join("t_two.jsonl"), header_line("two", "/tmp")).unwrap();
        assert!(dir_watermark(&sessions) > first);
    }

    fn header_line(id: &str, cwd: &str) -> String {
        format!(
            r#"{{"type":"session","version":3,"id":"{id}","timestamp":"2026-07-20T03:38:58.868Z","cwd":"{cwd}"}}"#
        )
    }

    #[test]
    fn a_broken_session_file_is_skipped_not_fatal() {
        let root = TempRoot::new();
        let file = root.path().join("broken.jsonl");
        fs::write(&file, "not json at all\n").unwrap();
        assert!(scan_session(&file).is_none());
        let empty = root.path().join("empty.jsonl");
        fs::write(&empty, "").unwrap();
        assert!(scan_session(&empty).is_none());
    }

    #[test]
    fn the_pattern_counter_sees_matches_across_chunk_edges() {
        let root = TempRoot::new();
        let file = root.path().join("counted.jsonl");
        let mut body = Vec::new();
        for i in 0..5000 {
            body.extend_from_slice(format!(r#"{{"type":"message","id":"{i}"}}"#).as_bytes());
            body.push(b'\n');
        }
        fs::write(&file, &body).unwrap();
        assert_eq!(count_pattern(&file, b"\"type\":\"message\""), 5000);
    }

    #[test]
    fn timestamps_parse_and_truncation_stays_on_chars() {
        assert_eq!(
            timestamp_ms(Some("2026-07-20T03:38:58.868Z")),
            1_784_518_738_868.0
        );
        assert_eq!(
            timestamp_ms(Some("2026-07-20T03:38:58Z")),
            1_784_518_738_000.0
        );
        assert_eq!(timestamp_ms(Some("nope")), 0.0);
        assert_eq!(truncate_chars("hello", 10), "hello");
        let truncated = truncate_chars("你好世界", 3);
        assert_eq!(truncated.chars().count(), 3);
        assert!(truncated.ends_with('\u{2026}'));
    }
}
