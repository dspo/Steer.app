//! `zu/native`'s `Instance`: one app per state directory.
//!
//! The engine's port is a fixed constant and its state lives in one
//! `~/.pi/zu`, so a second Zu must not start a second engine. This module
//! owns the claim: a lock file under the app's state directory, created
//! exclusively (`create_new`) and recording the process that owns it. A
//! lock whose process is gone is stale and is reclaimed; a lock whose
//! process is alive blocks the new launch, which reports the owner instead
//! of starting anything.
//!
//! The claim is a file, not an OS lock (nsh has no single-instance
//! primitive): the file survives a crash, and the next launch decides from
//! the pid's liveness. The UI uses `claim().acquired` before it boots the
//! engine; `release()` is best-effort on an explicit quit, and a lock left
//! behind by a crash is reclaimed by the pid check.
//!
//! Only the main window's own process claims. Headless runs (the test
//! runner, `platform.os` not a desktop) never call this, so fixtures do not
//! touch a lock.

use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use nsh_core::prelude::*;

/// The lock file's name under the state directory (`~/.pi/zu`).
const LOCK_NAME: &str = "instance.lock";
/// How many create/read rounds a contention takes before giving up. Each
/// round either creates the lock, sees a live owner, or reclaims a stale
/// one, so more than a couple only happens under a startup race.
const CLAIM_ROUNDS: usize = 4;

/// What a claim found.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct InstanceClaim {
    /// This process owns the state directory now.
    pub acquired: bool,
    /// This process already held it (a second call in one process is
    /// idempotent, not a second claim).
    pub already: bool,
    /// A stale lock (its process was gone) was reclaimed on the way.
    pub stale: bool,
    /// The calling process's pid.
    pub pid: u32,
    /// The live owner that blocked this claim; absent when acquired.
    pub owner_pid: Option<u32>,
    /// The lock file the claim used.
    pub path: String,
    /// When the lock was created, in milliseconds since the Unix epoch
    /// (0 when it could not be read).
    pub started_at: f64,
}

/// The claim this process holds, so `claim` is idempotent and `release`
/// removes only our own file.
struct Held {
    path: PathBuf,
    pid: u32,
    started_at: f64,
}

static HELD: Mutex<Option<Held>> = Mutex::new(None);

/// The single-instance lock: claim the app's state directory, or report the
/// process that owns it.
#[module]
pub struct Instance;

#[module]
impl Instance {
    /// Claims the state directory for this process. `acquired: false` means
    /// another live Zu owns it; its pid is `ownerPid`. Calling it again in
    /// the same process returns `acquired: true, already: true`.
    pub fn claim() -> Result<InstanceClaim, String> {
        let path = lock_path()?;
        let pid = std::process::id();
        let mut held = HELD
            .lock()
            .map_err(|_| "instance lock poisoned".to_owned())?;
        if let Some(current) = held.as_ref() {
            if current.path == path {
                return Ok(InstanceClaim {
                    acquired: true,
                    already: true,
                    stale: false,
                    pid: current.pid,
                    owner_pid: Some(current.pid),
                    path: path.display().to_string(),
                    started_at: current.started_at,
                });
            }
            return Err(format!(
                "this process already holds the instance lock at {}",
                current.path.display()
            ));
        }
        let claim = claim_at(&path, pid)?;
        if claim.acquired {
            *held = Some(Held {
                path,
                pid,
                started_at: claim.started_at,
            });
        }
        Ok(claim)
    }

    /// Gives back this process's claim, if it still holds it. A lock owned
    /// by another process is left alone. `false` when there was nothing to
    /// release.
    pub fn release() -> bool {
        let Ok(mut held) = HELD.lock() else {
            return false;
        };
        let Some(current) = held.take() else {
            return false;
        };
        release_at(&current.path, current.pid)
    }

    /// The lock file's path under the state directory.
    pub fn lock_path() -> Result<String, String> {
        Ok(lock_path()?.display().to_string())
    }
}

/// The lock file under the app's state directory.
fn lock_path() -> Result<PathBuf, String> {
    Ok(crate::zu_dir()?.join(LOCK_NAME))
}

/// Claims `path` for `pid`: exclusive create, or reclaim a dead owner's
/// lock. Returns what happened; a live owner is reported, never killed.
fn claim_at(path: &Path, pid: u32) -> Result<InstanceClaim, String> {
    let mut stale = false;
    for _ in 0..CLAIM_ROUNDS {
        let started_at = now_ms();
        match create_lock(path, pid, started_at) {
            Ok(()) => {
                return Ok(InstanceClaim {
                    acquired: true,
                    already: false,
                    stale,
                    pid,
                    owner_pid: None,
                    path: path.display().to_string(),
                    started_at,
                });
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                let raw = match fs::read_to_string(path) {
                    Ok(raw) => raw,
                    // The lock went away between create and read: try again.
                    Err(error) if error.kind() == ErrorKind::NotFound => continue,
                    Err(error) => return Err(format!("read {}: {error}", path.display())),
                };
                match parse_lock(&raw) {
                    Some((owner, created)) if owner == pid => {
                        return Ok(InstanceClaim {
                            acquired: true,
                            already: true,
                            stale,
                            pid,
                            owner_pid: Some(owner),
                            path: path.display().to_string(),
                            started_at: created,
                        });
                    }
                    Some((owner, created)) if pid_is_alive(owner) => {
                        return Ok(InstanceClaim {
                            acquired: false,
                            already: false,
                            stale,
                            pid,
                            owner_pid: Some(owner),
                            path: path.display().to_string(),
                            started_at: created,
                        });
                    }
                    // A dead owner's lock, or a truncated one (the write
                    // is atomic, so this is damage rather than a race):
                    // reclaim it.
                    _ => {
                        stale = true;
                        reclaim_stale(path, &raw);
                        continue;
                    }
                }
            }
            Err(error) => {
                return Err(format!("create {}: {error}", path.display()));
            }
        }
    }
    // Every round was taken by a concurrent startup. Report the owner we
    // last saw rather than claim twice.
    let (owner, created) = fs::read_to_string(path)
        .ok()
        .and_then(|raw| parse_lock(&raw))
        .unwrap_or((0, 0.0));
    Ok(InstanceClaim {
        acquired: false,
        already: false,
        stale,
        pid,
        owner_pid: (owner != 0).then_some(owner),
        path: path.display().to_string(),
        started_at: created,
    })
}

/// Removes a lock only while it still names the same dead owner; a lock
/// replaced in the meantime is left for the next round.
fn reclaim_stale(path: &Path, seen: &str) {
    match fs::read_to_string(path) {
        Ok(again) if again == seen => {
            let _ = fs::remove_file(path);
        }
        _ => {}
    }
}

/// Creates `path` exclusively, fully written.
///
/// The lock's bytes go to a temporary file in the same directory first and
/// the lock is a hard link to it: `link` fails with `AlreadyExists` instead
/// of replacing, and a reader never sees a half-written lock (a plain
/// `create_new` + `write` has a window where a competing claim sees an
/// empty file and would take it for a crash remnant).
fn create_lock(path: &Path, pid: u32, started_at: f64) -> std::io::Result<()> {
    static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
    let dir = path.parent().ok_or_else(|| {
        std::io::Error::new(ErrorKind::InvalidInput, "the lock has no directory")
    })?;
    let temp = dir.join(format!(
        ".{LOCK_NAME}.{pid}.{}.{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        // The first line is the pid (the only field a claim needs); the
        // second is diagnostics.
        file.write_all(format!("{pid}\n{started_at}\n").as_bytes())?;
        file.sync_all()
    })();
    let linked = written.and_then(|()| fs::hard_link(&temp, path));
    let _ = fs::remove_file(&temp);
    linked
}

/// Reads the pid and creation time from a lock file.
fn parse_lock(raw: &str) -> Option<(u32, f64)> {
    let mut lines = raw.lines();
    let pid = lines.next()?.trim().parse::<u32>().ok()?;
    let started_at = lines
        .next()
        .and_then(|line| line.trim().parse::<f64>().ok())
        .unwrap_or(0.0);
    (pid != 0).then_some((pid, started_at))
}

/// Gives back `path` when it still names `pid`.
fn release_at(path: &Path, pid: u32) -> bool {
    let Ok(raw) = fs::read_to_string(path) else {
        return false;
    };
    if parse_lock(&raw).map(|(owner, _)| owner) != Some(pid) {
        return false;
    }
    fs::remove_file(path).is_ok()
}

/// Whether `pid` names a live process. Unix uses the null signal: `0`
/// means it exists, `EPERM` that it exists under another user.
#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    // SAFETY: `kill(pid, 0)` only checks for the process; it sends nothing.
    let result = unsafe { kill(pid as i32, 0) };
    if result == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(1) // EPERM
}

/// Other targets have no pid check here: an existing lock is treated as a
/// live owner, so a stale file is never clobbered. Zu ships for macOS.
#[cfg(not(unix))]
fn pid_is_alive(_pid: u32) -> bool {
    true
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    /// A fresh directory per test (the tests run in parallel).
    fn temp_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "zu-instance-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn the_first_claim_wins_and_the_same_process_claims_once() {
        let dir = temp_dir("once");
        let path = dir.join(LOCK_NAME);
        let pid = std::process::id();

        let first = claim_at(&path, pid).expect("claim");
        assert!(first.acquired);
        assert!(!first.already);
        assert!(!first.stale);
        assert_eq!(first.pid, pid);
        assert_eq!(first.owner_pid, None);
        assert!(path.is_file());
        let raw = fs::read_to_string(&path).expect("lock file");
        assert!(raw.starts_with(&format!("{pid}\n")));

        // The same process asking again is the same claim, not a second one.
        let second = claim_at(&path, pid).expect("second claim");
        assert!(second.acquired);
        assert!(second.already);
        assert_eq!(second.owner_pid, Some(pid));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_live_owner_blocks_a_second_instance_without_killing_it() {
        let dir = temp_dir("contended");
        let path = dir.join(LOCK_NAME);
        // pid 1 (launchd, init) is alive on every Unix.
        fs::write(&path, "1\n1234\n").expect("pre-write a live owner");

        let blocked = claim_at(&path, std::process::id()).expect("claim");
        assert!(!blocked.acquired);
        assert!(!blocked.already);
        assert_eq!(blocked.owner_pid, Some(1));
        // The owner's file is untouched: a second instance never kills or
        // steals the first app's claim.
        assert_eq!(fs::read_to_string(&path).expect("still there"), "1\n1234\n");

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_dead_owners_lock_is_reclaimed() {
        let dir = temp_dir("stale");
        let path = dir.join(LOCK_NAME);
        // Beyond any platform's pid range, so the process is certainly gone.
        fs::write(&path, "4000000\n99\n").expect("pre-write a dead owner");
        assert!(!pid_is_alive(4_000_000));

        let claim = claim_at(&path, std::process::id()).expect("claim");
        assert!(claim.acquired);
        assert!(claim.stale);
        assert!(!claim.already);
        let raw = fs::read_to_string(&path).expect("lock file");
        assert!(raw.starts_with(&format!("{}\n", std::process::id())));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_truncated_lock_is_reclaimed() {
        let dir = temp_dir("truncated");
        let path = dir.join(LOCK_NAME);
        fs::write(&path, "").expect("pre-write a truncated lock");

        let claim = claim_at(&path, std::process::id()).expect("claim");
        assert!(claim.acquired);
        assert!(claim.stale);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn release_removes_only_our_own_lock() {
        let dir = temp_dir("release");
        let path = dir.join(LOCK_NAME);
        let pid = std::process::id();
        assert!(claim_at(&path, pid).expect("claim").acquired);

        // Another pid cannot release our claim.
        assert!(!release_at(&path, if pid == 1 { 2 } else { 1 }));
        assert!(path.is_file());

        assert!(release_at(&path, pid));
        assert!(!path.exists());
        assert!(!release_at(&path, pid));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_claims_yield_exactly_one_owner() {
        let dir = temp_dir("race");
        let path = Arc::new(dir.join(LOCK_NAME));
        let barrier = Arc::new(Barrier::new(2));
        let mut handles = Vec::new();
        for pid in [1u32, std::process::id()] {
            let path = Arc::clone(&path);
            let barrier = Arc::clone(&barrier);
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                claim_at(&path, pid).expect("claim")
            }));
        }
        let claims: Vec<InstanceClaim> = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread"))
            .collect();
        let acquired = claims.iter().filter(|claim| claim.acquired).count();
        assert_eq!(acquired, 1, "exactly one process owns the lock: {claims:?}");
        // The other sees the winner, alive, and leaves it alone.
        let blocked = claims.iter().find(|claim| !claim.acquired).expect("loser");
        assert!(blocked.owner_pid.is_some());

        let _ = fs::remove_dir_all(&dir);
    }
}
