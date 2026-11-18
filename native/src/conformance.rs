//! The conformance drivers: real tool runs against the session
//! construction path a terminal sheet uses.
//!
//! [`esctest2`] starts under a PTY like any terminal program and pushes
//! escape sequences at us; the queries it depends on (`CSI 18 t`,
//! device attributes, DECRQCRA, `CSI 8 t`) are answered by the same
//! wiring `TerminalSession` installs, so what passes here is what the
//! product does. It is scored against
//! `native/conformance/esctest-baseline.txt` — what the kernel fails
//! upstream — to tell our failures from its. [`ucs-detect`] measures
//! wide-character and emoji widths through the same session; it is
//! record-only: the results are reported, never gated.
//!
//! Both are `#[ignore]` — they need a real PTY, minutes of runtime and
//! (for esctest2) a downloaded suite: run them through
//! `bun run conformance`, which downloads, times and scores.
//!
//! [`esctest2`]: https://github.com/ThomasDickey/esctest2
//! [`ucs-detect`]: https://github.com/jquast/ucs-detect
//! [`TerminalSession`]: crate::session::TerminalSession

use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::mpsc::{self, RecvTimeoutError},
    time::{Duration, Instant},
};

use crate::pty::{Process, PtyOptions};
use crate::session::Shared;

/// The arguments every run passes, before the task's own: esctest only
/// knows how to test a terminal that answers like some real one, and
/// xterm is the closest to libghostty-vt.
const ESCTEST_ARGS: [&str; 3] = [
    "--expected-terminal=xterm",
    "--xterm-checksum=411",
    "--xterm-reverse-wrap=411",
];

/// Per-read timeout inside esctest itself: a real PTY round-trips every
/// reply, slower than the official runner's in-process pty, so we get
/// more slack than its 0.2 s.
const ESCTEST_TIMEOUT: &str = "0.3";

/// How long the whole run may take before the driver gives up (the task
/// allows 15 minutes; the driver should lose first so the log says why).
const RUN_LIMIT: Duration = Duration::from_secs(12 * 60);

/// The canonical last line: `*** 411 tests passed, 42 known bugs,
/// 114 TESTS FAILED ***` (lowercase `failed` when there are none; every
/// word pluralizes or not on its own).
fn parse_summary(log: &str) -> Option<(u64, u64, u64)> {
    let line = log
        .lines()
        .find(|line| line.contains("***") && line.contains("passed,"))?;
    let inner = line
        .trim()
        .trim_start_matches('*')
        .trim_end_matches('*')
        .trim();
    let mut counts = [0u64; 3];
    for (slot, part) in inner.split(',').enumerate() {
        counts[slot] = part.split_whitespace().next()?.parse().ok()?;
    }
    Some((counts[0], counts[1], counts[2]))
}

/// The names after `Failing tests:` — the run's last lines, one per test.
/// They all look like `SomeClass.test_Some_Case`; anything else (the
/// per-op debug lines a `-v 3` run writes after the marker) is noise.
fn failing_names(log: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut in_list = false;
    for line in log.lines() {
        match line.trim() == "Failing tests:" {
            true => in_list = true,
            false if in_list && line.trim().contains(".test_") => {
                names.push(line.trim().to_owned())
            }
            _ => {}
        }
    }
    names
}

/// Runs `argv` under a fresh session's pty — the same construction path
/// `TerminalSession::open` runs, the grid takes the pty's size, then the
/// session owns the program — and waits for its exit, bounded by
/// [`RUN_LIMIT`]. `Ok` only when the program exited in time.
fn run_in_session(argv: Vec<String>, cwd: Option<String>) -> Result<(), String> {
    let (events, _) = tokio::sync::mpsc::unbounded_channel();
    let shared = Shared::build(events);
    let (exited, exit) = mpsc::channel::<()>();
    let feeder = shared.clone();
    let process = Process::spawn(
        PtyOptions {
            command: Some(argv[0].clone()),
            args: Some(argv[1..].to_vec()),
            cwd,
            env: None,
            cols: Some(80),
            rows: Some(25),
        },
        move |bytes| feeder.feed(bytes),
        move |_| {
            let _ = exited.send(());
        },
    )?;
    let (cols, rows) = process.control.size();
    shared.resize(cols, rows, (0, 0));
    shared.adopt(process.control.clone());

    let started = Instant::now();
    loop {
        match exit.recv_timeout(Duration::from_secs(10)) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => return Ok(()),
            Err(RecvTimeoutError::Timeout) if started.elapsed() > RUN_LIMIT => {
                process.control.close();
                return Err(format!("did not finish in {RUN_LIMIT:?}"));
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

/// The whole esctest suite once, printing what `script/tasks.ts` scores:
/// a machine-readable summary, then one failing test per line.
///
/// # Panics
///
/// Without `ZU_ESCTEST_DIR` (the downloaded, sha256-verified esctest2),
/// or when esctest finished without a summary — both are framework
/// failures, not test results.
#[test]
#[ignore = "run via `bun run conformance` (needs ZU_ESCTEST_DIR, a real PTY and ~1 min)"]
fn esctest() {
    let dir = match std::env::var("ZU_ESCTEST_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => panic!("ZU_ESCTEST_DIR is unset: run through `bun run conformance`"),
    };
    let script = dir.join("esctest").join("esctest.py");
    assert!(
        script.is_file(),
        "esctest2 not found at {}: the cache is broken, rerun `bun run conformance`",
        script.display()
    );

    // esctest writes the report to a file, not the terminal; the task
    // reads ours after the exit.
    let logfile = std::env::temp_dir().join(format!("zu-esctest-{}.log", std::process::id()));
    let mut argv: Vec<String> = vec!["python3".to_owned(), script.to_string_lossy().into_owned()];
    argv.extend(ESCTEST_ARGS.iter().map(|arg| arg.to_string()));
    argv.push(format!("--timeout={ESCTEST_TIMEOUT}"));
    argv.push(format!("--logfile={}", logfile.display()));

    run_in_session(argv, Some(dir.to_string_lossy().into_owned()))
        .unwrap_or_else(|error| panic!("esctest {error}"));

    // esctest flushes the log line by line, but the summary lands between
    // the last bytes we see and the exit; re-read briefly.
    let log = read_until(
        &logfile,
        |log| parse_summary(log).is_some(),
        "esctest left no summary in",
    );

    let Some((passed, known, failed)) = parse_summary(&log) else {
        panic!("esctest left no summary in {}", logfile.display())
    };
    let names = failing_names(&log);
    println!("{log}");
    println!(
        "ESCTEST-SUMMARY passed={passed} known={known} failed={failed} total={}",
        passed + known + failed
    );
    for name in names {
        println!("ESCTEST-FAILED {name}");
    }
}

/// Where `ucs-detect` lives, when this machine has it: `$ZU_UCS_DETECT`,
/// then the PATH, then the spots user pip installs land in.
fn locate_ucs_detect() -> Option<PathBuf> {
    if let Some(given) = std::env::var_os("ZU_UCS_DETECT") {
        let given = PathBuf::from(given);
        if given.is_file() {
            return Some(given);
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("ucs-detect");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let home = PathBuf::from(std::env::var_os("HOME")?);
    let mut candidates = vec![home.join(".local/bin/ucs-detect")];
    if let Ok(versions) = std::fs::read_dir(home.join("Library/Python")) {
        for version in versions.flatten() {
            candidates.push(version.path().join("bin/ucs-detect"));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

/// The ucs-detect run, record-only (issue #46 P2): the results are
/// reported for the evidence, never gated, and a machine without the
/// binary skips with an install hint.
#[test]
#[ignore = "run via `bun run conformance -- ucs` (needs ucs-detect, a real PTY)"]
fn ucs() {
    let Some(binary) = locate_ucs_detect() else {
        println!("UCS-DETECT-SKIPPED no ucs-detect on this machine");
        println!(
            "install it with `pipx install ucs-detect` (or `pip3 install --user ucs-detect`), then rerun"
        );
        return;
    };

    // Everything ucs-detect writes — its drawn UI and the cursor/device
    // queries it needs answered — must stay on the terminal, so stderr is
    // not redirected; the measured data takes a side exit through
    // --save-json. The limits are Ghostty's fixed ones
    // (test/ucs-detect.sh); its `--limit-words` is `--limit-graphemes`
    // since ucs-detect 2.3 — the old name survives only in old YAML reruns.
    let results = std::env::temp_dir().join(format!("zu-ucs-{}.json", std::process::id()));
    let script = format!(
        "{} --limit-codepoints=5000 --limit-graphemes=5000 --limit-errors=1000 --stream=stderr --save-json={}",
        shell_quoted(&binary),
        shell_quoted(&results)
    );
    run_in_session(vec!["sh".to_owned(), "-c".to_owned(), script], None).unwrap_or_else(|error| {
        panic!(
            "ucs-detect {error}; its partial results are at {}",
            results.display()
        )
    });

    let report = read_until(
        &results,
        |report| serde_json::from_str::<serde_json::Value>(report).is_ok(),
        "ucs-detect left no results in",
    );
    let json: serde_json::Value = serde_json::from_str(&report).expect("results parse");
    let text = |value: &serde_json::Value| value.as_str().unwrap_or("?").to_owned();
    println!(
        "UCS-DETECT-SUMMARY software={} version={} ambiguous_width={} size={}x{} seconds={}",
        text(&json["software_name"]),
        text(&json["software_version"]),
        json["ambiguous_width"].as_u64().unwrap_or(0),
        json["width"].as_u64().unwrap_or(0),
        json["height"].as_u64().unwrap_or(0),
        json["seconds_elapsed"].as_f64().unwrap_or(0.0) as u64,
    );
    println!("UCS-DETECT-JSON");
    println!("{report}");
}

/// Reads `path` until `accept` says the content is complete, with brief
/// retries inside [`RUN_LIMIT`] (the program flushes its report between
/// the last bytes we see and the exit).
fn read_until(path: &Path, accept: impl Fn(&str) -> bool, missing: &str) -> String {
    let started = Instant::now();
    loop {
        match std::fs::File::open(path).and_then(|mut file| {
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            Ok(content)
        }) {
            Ok(content) if accept(&content) => return content,
            _ if started.elapsed() > RUN_LIMIT => panic!("{missing} {}", path.display()),
            _ => std::thread::sleep(Duration::from_millis(200)),
        }
    }
}

/// A path as a single shell word.
fn shell_quoted(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_summary_line_parses_in_both_spellings() {
        assert_eq!(
            parse_summary("*** 411 tests passed, 42 known bugs, 114 TESTS FAILED ***"),
            Some((411, 42, 114))
        );
        assert_eq!(
            parse_summary("*** 453 tests passed, 0 known bugs, 0 tests failed ***"),
            Some((453, 0, 0))
        );
        assert_eq!(
            parse_summary("*** 1 test passed, 1 known bug, 1 TEST FAILED ***"),
            Some((1, 1, 1))
        );
        assert_eq!(parse_summary("no summary here"), None);
    }

    #[test]
    fn failing_names_come_after_the_marker() {
        let log = "*** 1 test passed, 0 known bugs, 2 TESTS FAILED ***\n\
                   Failing tests:\n\
                   CUPTests.test_CUP_DefaultParams\n\
                   DECSTRTests.test_DECSTR_ResetsModes\n";
        assert_eq!(
            failing_names(log),
            vec![
                "CUPTests.test_CUP_DefaultParams".to_owned(),
                "DECSTRTests.test_DECSTR_ResetsModes".to_owned(),
            ]
        );
        assert!(failing_names("*** 1 test passed, 0 known bugs, 0 tests failed ***").is_empty());
    }
}
