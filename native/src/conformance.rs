//! The esctest2 conformance driver: a real esctest run against the session
//! construction path a terminal sheet uses.
//!
//! `esctest2` starts under a PTY like any terminal program and pushes
//! escape sequences at us; the queries it depends on (`CSI 18 t`,
//! device attributes, DECRQCRA, `CSI 8 t`) are answered by the same
//! wiring `TerminalSession` installs, so what passes here is what the
//! product does. The test is `#[ignore]` because it needs a downloaded
//! esctest2, a real PTY and about three minutes: run it through
//! `bun run conformance`, which downloads, times and scores it
//! (`native/conformance/esctest-baseline.txt` holds what the kernel
//! fails upstream, to tell our failures from its).
//!
//! [`TerminalSession`]: crate::session::TerminalSession

use std::{
    io::Read,
    path::PathBuf,
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

/// Runs the whole suite once and prints what `script/tasks.ts` scores:
/// a machine-readable summary, then one failing test per line.
///
/// # Panics
///
/// Without `ZU_ESCTEST_DIR` (the downloaded, sha256-verified esctest2),
/// or when esctest finished without a summary — both are framework
/// failures, not test results.
#[test]
#[ignore = "run via `bun run conformance` (needs ZU_ESCTEST_DIR, a real PTY and ~3 min)"]
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
    let mut args: Vec<String> = vec![script.to_string_lossy().into_owned()];
    args.extend(ESCTEST_ARGS.iter().map(|arg| arg.to_string()));
    args.push(format!("--timeout={ESCTEST_TIMEOUT}"));
    args.push(format!("--logfile={}", logfile.display()));

    let (events, _) = tokio::sync::mpsc::unbounded_channel();
    let shared = Shared::build(events);
    let (exited, exit) = mpsc::channel::<()>();
    let feeder = shared.clone();
    let process = Process::spawn(
        PtyOptions {
            command: Some("python3".to_owned()),
            args: Some(args),
            cwd: Some(dir.to_string_lossy().into_owned()),
            env: None,
            cols: Some(80),
            rows: Some(25),
        },
        move |bytes| feeder.feed(bytes),
        move |_| {
            let _ = exited.send(());
        },
    )
    .expect("a pty for esctest");
    // The same construction path `TerminalSession::open` runs: the grid
    // takes the pty's size, then the session owns the program.
    let (cols, rows) = process.control.size();
    shared.resize(cols, rows, (0, 0));
    shared.adopt(process.control.clone());

    let started = Instant::now();
    loop {
        match exit.recv_timeout(Duration::from_secs(10)) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) if started.elapsed() > RUN_LIMIT => {
                process.control.close();
                panic!(
                    "esctest did not finish in {:?}; its partial log is at {}",
                    RUN_LIMIT,
                    logfile.display()
                );
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
    }

    // esctest flushes the log line by line, but the summary lands between
    // the last bytes we see and the exit; re-read briefly.
    let log = loop {
        match std::fs::File::open(&logfile).and_then(|mut file| {
            let mut log = String::new();
            file.read_to_string(&mut log)?;
            Ok(log)
        }) {
            Ok(log) if parse_summary(&log).is_some() => break log,
            _ if started.elapsed() > RUN_LIMIT => {
                panic!("esctest left no summary in {}", logfile.display())
            }
            _ => std::thread::sleep(Duration::from_millis(200)),
        }
    };

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
