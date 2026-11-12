//! `zu/git`: the Changes and History sheets' git face.
//!
//! Every call names the workspace root (the active container's cwd); this
//! module runs `git` with that directory as its working directory and passes
//! every argument on its own — never through a shell. The root must be the
//! repository's own top level (a folder inside a repository is refused), and
//! the paths handed to git are relative, may not contain `..`, may not be
//! absolute and may not use pathspec magic, so no call reaches outside the
//! workspace.
//!
//! No call fetches, pulls, pushes or touches git's global configuration; the
//! one configuration this module writes is a repository's own author
//! identity (`set_identity`), when a commit needs one. Errors carry `code`
//! (`ERR_GIT_ROOT`, `ERR_GIT_NOT_REPO`, `ERR_GIT_PATH`, `ERR_GIT_MESSAGE`,
//! `ERR_GIT_BRANCH`, `ERR_GIT_COMMAND`, `ERR_GIT_IDENTITY`, `ERR_GIT_TOO_LARGE`,
//! `ERR_GIT_IO`) and a failed command adds its `exit` and `stderr`, as
//! `docs/architecture.md` §3.6 says. Diffs are capped at 2 MiB so one file
//! cannot freeze the UI.

use std::{
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
};

use nsh_core::prelude::*;

/// The most one `diff` returns; a bigger patch is the sheet's "too large"
/// state rather than a frozen window.
const MAX_PATCH_BYTES: usize = 2 * 1024 * 1024;
/// The most commits one `log` returns.
const MAX_LOG: u32 = 200;
/// The `log` limit when the caller names none.
const DEFAULT_LOG: u32 = 50;

const ERR_ROOT: &str = "ERR_GIT_ROOT";
const ERR_NOT_REPO: &str = "ERR_GIT_NOT_REPO";
const ERR_PATH: &str = "ERR_GIT_PATH";
const ERR_MESSAGE: &str = "ERR_GIT_MESSAGE";
const ERR_BRANCH: &str = "ERR_GIT_BRANCH";
const ERR_COMMAND: &str = "ERR_GIT_COMMAND";
const ERR_IDENTITY: &str = "ERR_GIT_IDENTITY";
const ERR_TOO_LARGE: &str = "ERR_GIT_TOO_LARGE";
const ERR_IO: &str = "ERR_GIT_IO";

/// One path a status reports, with how it changed.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GitChange {
    /// The path, relative to the workspace root (a rename's new path).
    pub path: String,
    /// The path it was renamed or copied from.
    pub old_path: Option<String>,
    /// `"modified"`, `"added"`, `"deleted"`, `"renamed"`, `"copied"`,
    /// `"typechange"`, `"untracked"` or `"conflicted"`.
    pub status: String,
}

/// A repository's state: which branch, how far it diverged, and every path
/// that differs from the index and the working tree.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GitStatus {
    /// The branch's name; a short hash when HEAD is detached.
    pub branch: String,
    /// HEAD's full hash; empty on an unborn branch.
    pub oid: String,
    /// HEAD is detached (not on a branch).
    pub detached: bool,
    /// The branch has no commit yet.
    pub unborn: bool,
    /// The tracked upstream (`origin/main`), when the branch has one.
    pub upstream: Option<String>,
    /// Commits ahead of the upstream.
    pub ahead: f64,
    /// Commits behind the upstream.
    pub behind: f64,
    /// The index differs from HEAD: what a commit would take.
    pub staged: Vec<GitChange>,
    /// The working tree differs from the index: what staging would take.
    pub unstaged: Vec<GitChange>,
    /// Files git does not track.
    pub untracked: Vec<GitChange>,
    /// Paths with merge conflicts.
    pub conflicted: Vec<GitChange>,
    /// No path differs at all.
    pub clean: bool,
}

/// A unified patch, with the lines it adds and deletes counted from it.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GitDiff {
    /// The patch (`git diff` output), as `DiffView` reads it.
    pub patch: String,
    /// Lines added.
    pub added: f64,
    /// Lines deleted.
    pub deleted: f64,
}

/// One commit of the log.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GitCommit {
    /// Its full hash.
    pub hash: String,
    /// Its abbreviated hash.
    pub short: String,
    /// The author's name.
    pub author: String,
    /// The author's email.
    pub email: String,
    /// The author date, in ISO 8601.
    pub date: String,
    /// The first line of its message.
    pub subject: String,
}

/// One local or remote branch.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GitBranch {
    /// Its short name (`main`, `origin/main`).
    pub name: String,
    /// It is the checked-out branch.
    pub current: bool,
    /// It is a remote-tracking branch.
    pub remote: bool,
    /// The branch it tracks, when it has one.
    pub upstream: Option<String>,
}

/// A repository's branches, local first.
#[derive(Debug, Clone, PartialEq, JsObject)]
pub struct GitBranches {
    /// The checked-out branch; a short hash when detached.
    pub current: String,
    /// HEAD is detached.
    pub detached: bool,
    /// The local branches.
    pub local: Vec<GitBranch>,
    /// The remote-tracking branches.
    pub remote: Vec<GitBranch>,
}

/// `git` for the Changes and History sheets: status, diffs, log, branches,
/// staging, commits and checkout.
#[module]
pub struct Git;

#[module]
impl Git {
    /// Reports the branch, its divergence and every changed, untracked and
    /// conflicted path. A root that is not a repository's top level fails
    /// with `ERR_GIT_NOT_REPO`.
    pub async fn status(root: String) -> Result<GitStatus, JsError> {
        in_task(move || status_in(&root)).await
    }

    /// The unified patch of the working tree (`staged` false) or of the index
    /// against HEAD (`staged` true), for one relative path or for all.
    /// Untracked files are diffed against `/dev/null`; a patch over 2 MiB
    /// fails with `ERR_GIT_TOO_LARGE` (fields `size` and `limit`).
    pub async fn diff(
        root: String,
        path: Option<String>,
        staged: bool,
    ) -> Result<GitDiff, JsError> {
        in_task(move || diff_in(&root, path.as_deref(), staged)).await
    }

    /// The last commits, newest first (`limit` defaults to 50, at most 200).
    /// An unborn branch has none.
    pub async fn log(root: String, limit: Option<u32>) -> Result<Vec<GitCommit>, JsError> {
        in_task(move || log_in(&root, limit.unwrap_or(DEFAULT_LOG))).await
    }

    /// The local and remote-tracking branches and which one is checked out.
    pub async fn branches(root: String) -> Result<GitBranches, JsError> {
        in_task(move || branches_in(&root)).await
    }

    /// Stages the given relative paths (an empty list stages everything,
    /// deletions included), then reports the new status.
    pub async fn stage(root: String, paths: Vec<String>) -> Result<GitStatus, JsError> {
        in_task(move || stage_in(&root, &paths)).await
    }

    /// Unstages the given relative paths (an empty list unstages everything),
    /// then reports the new status. On an unborn branch the index is cleared
    /// with `git rm --cached`.
    pub async fn unstage(root: String, paths: Vec<String>) -> Result<GitStatus, JsError> {
        in_task(move || unstage_in(&root, &paths)).await
    }

    /// Commits the index with `message`; fails with `ERR_GIT_MESSAGE` for an
    /// empty message and `ERR_GIT_IDENTITY` when git has no author identity
    /// (`set_identity` sets one on the repository).
    pub async fn commit(root: String, message: String) -> Result<GitCommit, JsError> {
        in_task(move || commit_in(&root, &message)).await
    }

    /// Checks out a local branch, then reports the new status.
    pub async fn checkout(root: String, branch: String) -> Result<GitStatus, JsError> {
        in_task(move || checkout_in(&root, &branch)).await
    }

    /// Creates `branch` at HEAD and checks it out, then reports the status.
    pub async fn create_branch(root: String, branch: String) -> Result<GitStatus, JsError> {
        in_task(move || create_branch_in(&root, &branch)).await
    }

    /// Makes the workspace root a repository (`git init`), then reports its
    /// status. The Changes sheet's empty state calls it.
    pub async fn init(root: String) -> Result<GitStatus, JsError> {
        in_task(move || init_in(&root)).await
    }

    /// Sets the repository's own author identity (`user.name` and
    /// `user.email` in its `.git/config`, never the global one), which a
    /// commit needs on a machine that has none. The Changes sheet asks for it
    /// when a commit fails with `ERR_GIT_IDENTITY`.
    pub async fn set_identity(root: String, name: String, email: String) -> Result<(), JsError> {
        in_task(move || set_identity_in(&root, &name, &email)).await
    }
}

// --- the calls, off the engine thread ---------------------------------------

/// Runs blocking git work on the runtime's blocking threads.
async fn in_task<T, F>(work: F) -> Result<T, JsError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, JsError> + Send + 'static,
{
    blocking(work)
        .await
        .map_err(|error| git_error(ERR_IO, format!("the git task failed: {error}")))?
}

// --- the root and the paths -------------------------------------------------

/// Canonicalizes the allowed root; it must exist and be a directory.
fn canonical_root(root: &str) -> Result<PathBuf, JsError> {
    if root.trim().is_empty() {
        return Err(git_error(ERR_ROOT, "no workspace root was given"));
    }
    let raw = Path::new(root);
    if !raw.is_absolute() {
        return Err(git_error(
            ERR_ROOT,
            format!("the workspace root is not absolute: {root}"),
        ));
    }
    let canonical = raw.canonicalize().map_err(|error| {
        git_error(
            ERR_ROOT,
            format!("the workspace root is unusable ({root}): {error}"),
        )
    })?;
    let metadata = std::fs::metadata(&canonical).map_err(|error| {
        git_error(
            ERR_ROOT,
            format!("the workspace root is unusable ({root}): {error}"),
        )
    })?;
    if !metadata.is_dir() {
        return Err(git_error(
            ERR_ROOT,
            format!("the workspace root is not a directory: {root}"),
        ));
    }
    Ok(canonical)
}

/// The repository's top level, which must be the workspace root itself: a
/// folder inside a repository cannot name the files above it, so it is
/// refused instead of showing a partial state.
fn repo_root(root: &str) -> Result<PathBuf, JsError> {
    let canonical = canonical_root(root)?;
    let out = run(&canonical, &["rev-parse", "--show-toplevel"])?;
    if !out.ok {
        return Err(git_error(
            ERR_NOT_REPO,
            format!(
                "the workspace root is not a git repository: {}",
                first_line(&out.stderr)
            ),
        )
        .with("stderr", out.stderr.trim().to_owned()));
    }
    let top = PathBuf::from(out.stdout.trim());
    let top = top.canonicalize().unwrap_or(top);
    if top != canonical {
        return Err(git_error(
            ERR_NOT_REPO,
            format!(
                "the workspace root is inside the repository at {}; open the repository root as the workspace",
                top.display()
            ),
        )
        .with("repository", top.display().to_string()));
    }
    Ok(canonical)
}

/// A relative path inside the root: no `..`, no absolute path, no NUL, no
/// pathspec magic and no leading `-`.
fn check_path(raw: &str) -> Result<String, JsError> {
    if raw.trim().is_empty() {
        return Err(git_error(ERR_PATH, "the path is empty"));
    }
    if raw.contains('\0') {
        return Err(git_error(ERR_PATH, "the path contains a NUL byte"));
    }
    if raw.starts_with('/') {
        return Err(git_error(
            ERR_PATH,
            format!("absolute paths are not allowed: {raw}"),
        ));
    }
    if raw.starts_with('-') {
        return Err(git_error(
            ERR_PATH,
            format!("a path may not start with `-`: {raw}"),
        ));
    }
    if raw.starts_with(':') {
        return Err(git_error(
            ERR_PATH,
            format!("git pathspec magic is not allowed: {raw}"),
        ));
    }
    for component in Path::new(raw).components() {
        match component {
            Component::ParentDir => {
                return Err(git_error(
                    ERR_PATH,
                    format!("`..` is not allowed in a workspace path: {raw}"),
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(git_error(
                    ERR_PATH,
                    format!("the path is not relative to the workspace root: {raw}"),
                ));
            }
            _ => {}
        }
    }
    Ok(raw.to_owned())
}

/// A branch name git accepts, and one no option parser can mistake.
fn check_branch(raw: &str) -> Result<String, JsError> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(git_error(ERR_BRANCH, "the branch name is empty"));
    }
    if name.starts_with('-') || name.contains('\0') || name.contains('\n') {
        return Err(git_error(ERR_BRANCH, format!("not a branch name: {raw}")));
    }
    Ok(name.to_owned())
}

/// Asks git whether a branch name is valid (`check-ref-format --branch`).
fn validate_branch(root: &Path, name: &str) -> Result<(), JsError> {
    let out = run(root, &["check-ref-format", "--branch", name])?;
    if out.ok {
        return Ok(());
    }
    Err(git_error(
        ERR_BRANCH,
        format!(
            "not a valid branch name: {name}{}",
            if out.stderr.trim().is_empty() {
                String::new()
            } else {
                format!(" ({})", first_line(&out.stderr))
            }
        ),
    ))
}

// --- running git ------------------------------------------------------------

/// One finished git command.
struct Output {
    ok: bool,
    code: i32,
    stdout: String,
    stderr: String,
}

/// Runs `git` in `root` with arguments passed one by one. The environment
/// variables that would point git at another repository are removed, and no
/// prompt may wait for a terminal.
fn run(root: &Path, args: &[&str]) -> Result<Output, JsError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_OBJECT_DIRECTORY")
        .env_remove("GIT_ALTERNATE_OBJECT_DIRECTORIES")
        .env_remove("GIT_COMMON_DIR")
        .env_remove("GIT_NAMESPACE")
        .env_remove("GIT_PREFIX")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| git_error(ERR_IO, format!("cannot run git: {error}")))?;
    Ok(Output {
        ok: output.status.success(),
        code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// Runs a command that must succeed; a failure carries git's `stderr` and
/// `exit`.
fn run_ok(root: &Path, args: &[&str]) -> Result<String, JsError> {
    let out = run(root, args)?;
    if !out.ok {
        return Err(git_error(
            ERR_COMMAND,
            format!(
                "`git {}` failed (exit {}): {}",
                args.first().copied().unwrap_or(""),
                out.code,
                first_line(&out.stderr)
            ),
        )
        .with("exit", out.code as f64)
        .with("stderr", out.stderr.trim().to_owned()));
    }
    Ok(out.stdout)
}

/// The first line of a message, for a one-line summary.
fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_owned()
}

/// Whether HEAD names a commit (false on an unborn branch).
fn head_exists(root: &Path) -> Result<bool, JsError> {
    Ok(run(root, &["rev-parse", "--verify", "--quiet", "HEAD"])?.ok)
}

// --- status -----------------------------------------------------------------

/// The status command: porcelain v2, locked to byte-stable NUL records.
fn status_args() -> Vec<&'static str> {
    vec![
        "status",
        "--porcelain=v2",
        "--branch",
        "--untracked-files=all",
        "-z",
    ]
}

fn status_in(root: &str) -> Result<GitStatus, JsError> {
    let root = repo_root(root)?;
    let raw = run_ok(&root, &status_args())?;
    Ok(parse_status(&raw))
}

/// Parses `git status --porcelain=v2 --branch -z`. Unknown records are
/// skipped rather than failing the whole sheet.
fn parse_status(raw: &str) -> GitStatus {
    let mut status = GitStatus {
        branch: String::new(),
        oid: String::new(),
        detached: false,
        unborn: false,
        upstream: None,
        ahead: 0.0,
        behind: 0.0,
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        conflicted: Vec::new(),
        clean: true,
    };
    let mut fields = raw.split('\0');
    while let Some(field) = fields.next() {
        if field.is_empty() {
            continue;
        }
        if let Some(header) = field.strip_prefix("# ") {
            parse_header(&mut status, header);
            continue;
        }
        match field.as_bytes().first().copied() {
            Some(b'1') => {
                if let Some((staged, unstaged)) = parse_ordinary(field) {
                    if let Some(change) = staged {
                        status.staged.push(change);
                    }
                    if let Some(change) = unstaged {
                        status.unstaged.push(change);
                    }
                }
            }
            Some(b'2') => {
                let original = fields.next().unwrap_or("").to_owned();
                if let Some((staged, unstaged)) = parse_rename(field, &original) {
                    if let Some(change) = staged {
                        status.staged.push(change);
                    }
                    if let Some(change) = unstaged {
                        status.unstaged.push(change);
                    }
                }
            }
            Some(b'u') => {
                if let Some(path) = field.splitn(11, ' ').nth(10) {
                    status.conflicted.push(GitChange {
                        path: path.to_owned(),
                        old_path: None,
                        status: "conflicted".to_owned(),
                    });
                }
            }
            Some(b'?') => {
                if let Some(path) = field.strip_prefix("? ") {
                    status.untracked.push(GitChange {
                        path: path.to_owned(),
                        old_path: None,
                        status: "untracked".to_owned(),
                    });
                }
            }
            // `!` ignored entries: not shown.
            _ => {}
        }
    }
    if status.detached && status.branch.is_empty() {
        status.branch = short_oid(&status.oid);
    }
    status.clean = status.staged.is_empty()
        && status.unstaged.is_empty()
        && status.untracked.is_empty()
        && status.conflicted.is_empty();
    status
}

/// One `# key value` header of porcelain v2.
fn parse_header(status: &mut GitStatus, header: &str) {
    let Some((key, value)) = header.split_once(' ') else {
        return;
    };
    let value = value.trim();
    match key {
        "branch.oid" => {
            if value == "(initial)" {
                status.unborn = true;
            } else {
                status.oid = value.to_owned();
            }
        }
        "branch.head" => {
            if value == "(detached)" {
                status.detached = true;
            } else {
                status.branch = value.to_owned();
            }
        }
        "branch.upstream" => {
            if value != "(null)" {
                status.upstream = Some(value.to_owned());
            }
        }
        "branch.ab" => {
            let mut parts = value.split_whitespace();
            if let Some(ahead) = parts.next() {
                status.ahead = ahead.trim_start_matches('+').parse().unwrap_or(0.0);
            }
            if let Some(behind) = parts.next() {
                status.behind = behind.trim_start_matches('-').parse().unwrap_or(0.0);
            }
        }
        _ => {}
    }
}

/// `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>`.
fn parse_ordinary(field: &str) -> Option<(Option<GitChange>, Option<GitChange>)> {
    let parts: Vec<&str> = field.splitn(9, ' ').collect();
    if parts.len() < 9 {
        return None;
    }
    Some(changes_of(parts[1], parts[8], None))
}

/// `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>`; the original
/// path is the next NUL record.
fn parse_rename(field: &str, original: &str) -> Option<(Option<GitChange>, Option<GitChange>)> {
    let parts: Vec<&str> = field.splitn(10, ' ').collect();
    if parts.len() < 10 {
        return None;
    }
    Some(changes_of(parts[1], parts[9], Some(original)))
}

/// The index (first `XY` letter) and working-tree (second) changes of one
/// record; `None` for the side that did not change.
fn changes_of(
    xy: &str,
    path: &str,
    old_path: Option<&str>,
) -> (Option<GitChange>, Option<GitChange>) {
    let mut letters = xy.chars();
    let index = letters.next().unwrap_or('.');
    let worktree = letters.next().unwrap_or('.');
    let change = |letter: char, status: &str| {
        (letter != '.').then(|| GitChange {
            path: path.to_owned(),
            old_path: old_path.map(str::to_owned),
            status: status.to_owned(),
        })
    };
    (
        change(index, change_status(index)),
        change(worktree, change_status(worktree)),
    )
}

/// Git's status letter as a word the sheets say.
fn change_status(letter: char) -> &'static str {
    match letter {
        'M' => "modified",
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'T' => "typechange",
        'U' => "conflicted",
        _ => "unknown",
    }
}

fn short_oid(oid: &str) -> String {
    oid.chars().take(7).collect()
}

// --- diff -------------------------------------------------------------------

/// The diff command, with external helpers, colors and textconv off so the
/// patch is git's own unified format and nothing else.
fn diff_args(path: Option<&str>, staged: bool) -> Vec<String> {
    let mut args = vec![
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--unified=3",
        "--src-prefix=a/",
        "--dst-prefix=b/",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();
    if staged {
        args.push("--cached".to_owned());
    }
    if let Some(path) = path {
        args.push("--".to_owned());
        args.push(path.to_owned());
    }
    args
}

fn diff_in(root: &str, path: Option<&str>, staged: bool) -> Result<GitDiff, JsError> {
    let root = repo_root(root)?;
    let path = match path.map(str::trim).filter(|path| !path.is_empty()) {
        Some(path) => Some(check_path(path)?),
        None => None,
    };
    let args = diff_args(path.as_deref(), staged);
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    let out = run(&root, &borrowed)?;
    if !out.ok {
        return Err(git_error(
            ERR_COMMAND,
            format!(
                "`git diff` failed (exit {}): {}",
                out.code,
                first_line(&out.stderr)
            ),
        )
        .with("exit", out.code as f64)
        .with("stderr", out.stderr.trim().to_owned()));
    }
    let mut patch = out.stdout;
    // An untracked file is not in the index, so `git diff` says nothing:
    // compare it with /dev/null instead (still `git diff`, still no reads
    // outside the workspace except that device).
    if patch.is_empty()
        && !staged
        && let Some(path) = path.as_deref()
    {
        let tracked = run(&root, &["ls-files", "--error-unmatch", "--", path])?.ok;
        if !tracked {
            let no_index = run(
                &root,
                &[
                    "diff",
                    "--no-index",
                    "--no-color",
                    "--no-ext-diff",
                    "--",
                    "/dev/null",
                    path,
                ],
            )?;
            // `--no-index` exits 1 when the files differ, as they do.
            if no_index.ok || no_index.code == 1 {
                patch = no_index.stdout;
            } else {
                return Err(git_error(
                    ERR_COMMAND,
                    format!(
                        "`git diff` failed (exit {}): {}",
                        no_index.code,
                        first_line(&no_index.stderr)
                    ),
                )
                .with("exit", no_index.code as f64)
                .with("stderr", no_index.stderr.trim().to_owned()));
            }
        }
    }
    let size = patch.len();
    if size > MAX_PATCH_BYTES {
        return Err(git_error(
            ERR_TOO_LARGE,
            format!(
                "the diff is {size} bytes, over the {MAX_PATCH_BYTES}-byte limit; open the file in an editor or a terminal"
            ),
        )
        .with("size", size as f64)
        .with("limit", MAX_PATCH_BYTES as f64));
    }
    let (added, deleted) = patch_counts(&patch);
    Ok(GitDiff {
        patch,
        added,
        deleted,
    })
}

/// Added and deleted lines of a unified patch, headers excluded.
fn patch_counts(patch: &str) -> (f64, f64) {
    let mut added = 0.0;
    let mut deleted = 0.0;
    for line in patch.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            added += 1.0;
        } else if line.starts_with('-') {
            deleted += 1.0;
        }
    }
    (added, deleted)
}

// --- log and branches -------------------------------------------------------

/// The log command's record and field separators (the ASCII control
/// characters, which a subject cannot contain).
const LOG_FIELD: char = '\u{1f}';
const LOG_RECORD: char = '\u{1e}';

fn log_args(limit: u32) -> Vec<String> {
    let limit = limit.clamp(1, MAX_LOG);
    vec![
        "log".to_owned(),
        format!("-n{limit}"),
        format!(
            "--format=%H{LOG_FIELD}%h{LOG_FIELD}%an{LOG_FIELD}%ae{LOG_FIELD}%aI{LOG_FIELD}%s{LOG_RECORD}"
        ),
    ]
}

fn log_in(root: &str, limit: u32) -> Result<Vec<GitCommit>, JsError> {
    let root = repo_root(root)?;
    if !head_exists(&root)? {
        return Ok(Vec::new());
    }
    let args = log_args(limit);
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    let raw = run_ok(&root, &borrowed)?;
    Ok(parse_log(&raw))
}

/// Parses the `--format` records `log_args` asks for.
fn parse_log(raw: &str) -> Vec<GitCommit> {
    raw.split(LOG_RECORD)
        .filter(|record| !record.trim().is_empty())
        .filter_map(|record| {
            let fields: Vec<&str> = record.trim_start_matches('\n').split(LOG_FIELD).collect();
            if fields.len() < 6 {
                return None;
            }
            Some(GitCommit {
                hash: fields[0].to_owned(),
                short: fields[1].to_owned(),
                author: fields[2].to_owned(),
                email: fields[3].to_owned(),
                date: fields[4].to_owned(),
                subject: fields[5].trim_end().to_owned(),
            })
        })
        .collect()
}

fn branch_args() -> Vec<&'static str> {
    vec![
        "for-each-ref",
        "--format=%(refname:short)%00%(refname)%00%(HEAD)%00%(upstream:short)%00%(symref)",
        "refs/heads",
        "refs/remotes",
    ]
}

fn branches_in(root: &str) -> Result<GitBranches, JsError> {
    let root = repo_root(root)?;
    let raw = run_ok(&root, &branch_args())?;
    let current = current_branch(&root)?;
    let mut branches = parse_branches(&raw);
    branches.current = current.clone();
    branches.detached = current == "HEAD";
    if branches.current == "HEAD" {
        // Detached: name HEAD by its short hash, as `git status` does.
        if let Ok(oid) = run_ok(&root, &["rev-parse", "--short", "HEAD"]) {
            let oid = oid.trim().to_owned();
            if !oid.is_empty() {
                branches.current = oid;
            }
        }
    }
    Ok(branches)
}

/// The checked-out branch (`HEAD` when detached).
fn current_branch(root: &Path) -> Result<String, JsError> {
    let out = run(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if out.ok {
        let name = out.stdout.trim().to_owned();
        if !name.is_empty() {
            return Ok(name);
        }
    }
    // An unborn branch still names itself in the symbolic ref.
    let out = run(root, &["symbolic-ref", "--short", "-q", "HEAD"])?;
    Ok(if out.ok {
        out.stdout.trim().to_owned()
    } else {
        "HEAD".to_owned()
    })
}

/// Parses `for-each-ref`'s records: short name, full ref, HEAD mark,
/// upstream and symbolic target.
fn parse_branches(raw: &str) -> GitBranches {
    let mut branches = GitBranches {
        current: String::new(),
        detached: false,
        local: Vec::new(),
        remote: Vec::new(),
    };
    for line in raw.lines() {
        let fields: Vec<&str> = line.split('\0').collect();
        if fields.len() < 5 || !fields[4].is_empty() {
            continue;
        }
        let name = fields[0];
        if name.is_empty() || name.ends_with("/HEAD") {
            continue;
        }
        let remote = fields[1].starts_with("refs/remotes/");
        let current = fields[2] == "*";
        let branch = GitBranch {
            name: name.to_owned(),
            current,
            remote,
            upstream: (!fields[3].is_empty()).then(|| fields[3].to_owned()),
        };
        if remote {
            branches.remote.push(branch);
        } else {
            branches.local.push(branch);
        }
    }
    if branches.current.is_empty()
        && let Some(current) = branches.local.iter().find(|branch| branch.current)
    {
        branches.current = current.name.clone();
    }
    branches
}

// --- staging, committing, branches ------------------------------------------

fn stage_args(paths: &[String]) -> Vec<String> {
    let mut args = vec!["add".to_owned(), "-A".to_owned()];
    if !paths.is_empty() {
        args.push("--".to_owned());
        args.extend(paths.iter().cloned());
    }
    args
}

fn stage_in(root: &str, paths: &[String]) -> Result<GitStatus, JsError> {
    let root = repo_root(root)?;
    let checked = checked_paths(paths)?;
    let args = stage_args(&checked);
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    run_ok(&root, &borrowed)?;
    status_in(&root.display().to_string())
}

fn unstage_args(paths: &[String], head: bool) -> Vec<String> {
    if head {
        let mut args = vec!["reset".to_owned(), "-q".to_owned(), "HEAD".to_owned()];
        if !paths.is_empty() {
            args.push("--".to_owned());
            args.extend(paths.iter().cloned());
        }
        args
    } else {
        // No commit to reset to: take the paths out of the index directly.
        let mut args = vec![
            "rm".to_owned(),
            "-r".to_owned(),
            "--cached".to_owned(),
            "-q".to_owned(),
        ];
        if paths.is_empty() {
            args.push("--".to_owned());
            args.push(".".to_owned());
        } else {
            args.push("--".to_owned());
            args.extend(paths.iter().cloned());
        }
        args
    }
}

fn unstage_in(root: &str, paths: &[String]) -> Result<GitStatus, JsError> {
    let root = repo_root(root)?;
    let checked = checked_paths(paths)?;
    // An unborn branch has no commit to reset to, and an index with nothing
    // staged has nothing to clear: both are the status as it is, not a
    // failure to report.
    let current = status_in(&root.display().to_string())?;
    if current.staged.is_empty() {
        return Ok(current);
    }
    let head = head_exists(&root)?;
    let args = unstage_args(&checked, head);
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    run_ok(&root, &borrowed)?;
    status_in(&root.display().to_string())
}

/// Every caller-supplied path, checked before any git call.
fn checked_paths(paths: &[String]) -> Result<Vec<String>, JsError> {
    paths.iter().map(|path| check_path(path)).collect()
}

fn commit_args(message: &str) -> Vec<String> {
    vec!["commit".to_owned(), "-m".to_owned(), message.to_owned()]
}

fn commit_in(root: &str, message: &str) -> Result<GitCommit, JsError> {
    let root = repo_root(root)?;
    let message = message.trim_end();
    if message.trim().is_empty() {
        return Err(git_error(ERR_MESSAGE, "the commit message is empty"));
    }
    ensure_identity(&root)?;
    let args = commit_args(message);
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    run_ok(&root, &borrowed)?;
    let mut commits = log_in(&root.display().to_string(), 1)?;
    commits
        .pop()
        .ok_or_else(|| git_error(ERR_COMMAND, "the commit was made but HEAD names nothing"))
}

/// A commit needs an author and a committer; git says which is missing.
fn ensure_identity(root: &Path) -> Result<(), JsError> {
    for variable in ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"] {
        let out = run(root, &["var", variable])?;
        if !out.ok {
            return Err(git_error(
                ERR_IDENTITY,
                format!(
                    "git has no author identity here: {}",
                    first_line(&out.stderr)
                ),
            )
            .with("stderr", out.stderr.trim().to_owned()));
        }
    }
    Ok(())
}

fn set_identity_in(root: &str, name: &str, email: &str) -> Result<(), JsError> {
    let root = repo_root(root)?;
    let name = name.trim();
    let email = email.trim();
    if name.is_empty() || email.is_empty() {
        return Err(git_error(
            ERR_IDENTITY,
            "both the author name and email are required",
        ));
    }
    if name.contains('\n') || email.contains('\n') || name.contains('\0') || email.contains('\0') {
        return Err(git_error(
            ERR_IDENTITY,
            "the author name and email must be one line each",
        ));
    }
    // Repository-local only: the user's global git configuration is never
    // touched.
    for (key, value) in [("user.name", name), ("user.email", email)] {
        run_ok(&root, &["config", "--local", key, value])?;
    }
    Ok(())
}

fn checkout_in(root: &str, branch: &str) -> Result<GitStatus, JsError> {
    let root = repo_root(root)?;
    let branch = check_branch(branch)?;
    validate_branch(&root, &branch)?;
    run_ok(&root, &["checkout", &branch])?;
    status_in(&root.display().to_string())
}

fn create_branch_in(root: &str, branch: &str) -> Result<GitStatus, JsError> {
    let root = repo_root(root)?;
    let branch = check_branch(branch)?;
    validate_branch(&root, &branch)?;
    run_ok(&root, &["checkout", "-b", &branch])?;
    status_in(&root.display().to_string())
}

fn init_in(root: &str) -> Result<GitStatus, JsError> {
    let root = canonical_root(root)?;
    run_ok(&root, &["init", "--quiet"])?;
    status_in(&root.display().to_string())
}

// --- errors -----------------------------------------------------------------

fn git_error(code: &str, message: impl Into<String>) -> JsError {
    JsError::Error(message.into()).with_code(code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A unique directory removed when the test ends.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "zu-git-test-{}-{}-{n}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_nanos())
                    .unwrap_or(0)
            ));
            fs::create_dir_all(&path).expect("a temporary root");
            Self(path)
        }

        fn path(&self) -> &str {
            self.0.to_str().expect("a UTF-8 path")
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Whether git can run here; the repository tests skip without it.
    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    fn code(error: &JsError) -> Option<&str> {
        error.code()
    }

    #[test]
    fn a_status_record_separates_the_index_from_the_working_tree() {
        let raw = concat!(
            "# branch.oid 0123456789abcdef\0",
            "# branch.head main\0",
            "# branch.upstream origin/main\0",
            "# branch.ab +2 -1\0",
            "1 M. N... 100644 100644 100644 aaa bbb staged.txt\0",
            "1 .M N... 100644 100644 100644 aaa bbb worktree.txt\0",
            "1 MM N... 100644 100644 100644 aaa bbb both.txt\0",
            "? untracked.txt\0",
        );
        let status = parse_status(raw);
        assert_eq!(status.branch, "main");
        assert_eq!(status.oid, "0123456789abcdef");
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2.0, 1.0));
        assert!(!status.clean);
        assert_eq!(status.staged.len(), 2);
        assert_eq!(status.staged[0].path, "staged.txt");
        assert_eq!(status.staged[0].status, "modified");
        assert_eq!(status.staged[1].path, "both.txt");
        assert_eq!(status.unstaged.len(), 2);
        assert_eq!(status.unstaged[0].path, "worktree.txt");
        assert_eq!(status.unstaged[1].path, "both.txt");
        assert_eq!(status.untracked.len(), 1);
        assert_eq!(status.untracked[0].status, "untracked");
        assert!(status.conflicted.is_empty());
    }

    #[test]
    fn a_status_record_reads_a_rename_and_an_unborn_branch() {
        let raw = concat!(
            "# branch.oid (initial)\0",
            "# branch.head main\0",
            "2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt\0",
            "old name.txt\0",
        );
        let status = parse_status(raw);
        assert!(status.unborn);
        assert_eq!(status.branch, "main");
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].path, "new name.txt");
        assert_eq!(status.staged[0].old_path.as_deref(), Some("old name.txt"));
        assert_eq!(status.staged[0].status, "renamed");
        assert!(status.unstaged.is_empty());
    }

    #[test]
    fn a_conflict_and_a_detached_head_are_named() {
        let raw = concat!(
            "# branch.oid abcdef1234567890\0",
            "# branch.head (detached)\0",
            "u UU N... 100644 100644 100644 100644 aaa bbb ccc path/conflicted.txt\0",
        );
        let status = parse_status(raw);
        assert!(status.detached);
        assert_eq!(status.branch, "abcdef1");
        assert_eq!(status.conflicted.len(), 1);
        assert_eq!(status.conflicted[0].path, "path/conflicted.txt");
        assert_eq!(status.conflicted[0].status, "conflicted");
    }

    #[test]
    fn a_clean_repository_has_no_records() {
        let status = parse_status("# branch.oid abc\0# branch.head main\0");
        assert!(status.clean);
        assert!(status.staged.is_empty() && status.unstaged.is_empty());
    }

    #[test]
    fn a_password_is_not_a_path_and_neither_is_a_parent() {
        for bad in ["../escape.txt", "a/../../b", "/etc/passwd", "", "  ", "-x"] {
            let error = check_path(bad).unwrap_err();
            assert_eq!(code(&error), Some(ERR_PATH), "{bad}");
        }
        assert_eq!(check_path("src/main.rs").unwrap(), "src/main.rs");
        assert_eq!(check_path("a b/c d.txt").unwrap(), "a b/c d.txt");
    }

    #[test]
    fn pathspec_magic_is_refused() {
        for bad in [":/etc", ":(glob)**/x", ":!keep"] {
            let error = check_path(bad).unwrap_err();
            assert_eq!(code(&error), Some(ERR_PATH), "{bad}");
        }
    }

    #[test]
    fn the_diff_arguments_name_the_forms_and_end_with_the_path() {
        let args = diff_args(Some("src/main.rs"), false);
        assert!(args.contains(&"--no-ext-diff".to_owned()));
        assert!(args.contains(&"--no-textconv".to_owned()));
        assert!(!args.contains(&"--cached".to_owned()));
        assert_eq!(args[args.len() - 2..], ["--", "src/main.rs"]);
        let staged = diff_args(None, true);
        assert!(staged.contains(&"--cached".to_owned()));
        assert!(!staged.contains(&"--".to_owned()));
    }

    #[test]
    fn staging_and_unstaging_pass_a_list_and_a_double_dash() {
        let paths = vec!["a.txt".to_owned(), "d b/c.txt".to_owned()];
        assert_eq!(
            stage_args(&paths),
            ["add", "-A", "--", "a.txt", "d b/c.txt"]
        );
        assert_eq!(stage_args(&[]), ["add", "-A"]);
        assert_eq!(
            unstage_args(&paths, true),
            ["reset", "-q", "HEAD", "--", "a.txt", "d b/c.txt"]
        );
        assert_eq!(
            unstage_args(&[], false),
            ["rm", "-r", "--cached", "-q", "--", "."]
        );
    }

    #[test]
    fn a_commit_message_is_passed_as_one_argument() {
        assert_eq!(
            commit_args("a message; with $(echo) and \"quotes\""),
            ["commit", "-m", "a message; with $(echo) and \"quotes\""]
        );
    }

    #[test]
    fn a_branch_name_with_an_option_is_refused() {
        let error = check_branch("--upload-pack=x").unwrap_err();
        assert_eq!(code(&error), Some(ERR_BRANCH));
        assert_eq!(check_branch(" feature/x ").unwrap(), "feature/x");
    }

    #[test]
    fn a_workspace_outside_git_is_not_a_repository() {
        if !git_available() {
            return;
        }
        let root = TempRoot::new();
        let error = status_in(root.path()).unwrap_err();
        assert_eq!(code(&error), Some(ERR_NOT_REPO));
    }

    #[test]
    fn a_folder_inside_a_repository_is_refused() {
        if !git_available() {
            return;
        }
        let root = TempRoot::new();
        init_in(root.path()).unwrap();
        let inner = Path::new(root.path()).join("inner");
        fs::create_dir_all(&inner).unwrap();
        let error = status_in(inner.to_str().unwrap()).unwrap_err();
        assert_eq!(code(&error), Some(ERR_NOT_REPO));
    }

    #[test]
    fn a_repository_round_trips_through_status_stage_commit_diff_and_checkout() {
        if !git_available() {
            return;
        }
        let root = TempRoot::new();
        let path = root.path();
        init_in(path).unwrap();
        // The initial branch is git's own choice (`master` unless configured).
        let base = status_in(path).unwrap().branch;
        set_identity_in(path, "Zu Test", "zu@example.test").unwrap();

        fs::write(Path::new(path).join("a.txt"), "first\n").unwrap();
        let status = status_in(path).unwrap();
        assert_eq!(status.untracked.len(), 1);
        assert_eq!(status.untracked[0].path, "a.txt");

        stage_in(path, &["a.txt".to_owned()]).unwrap();
        let status = status_in(path).unwrap();
        assert_eq!(status.staged.len(), 1);
        assert_eq!(status.staged[0].status, "added");

        let commit = commit_in(path, "add a.txt").unwrap();
        assert_eq!(commit.subject, "add a.txt");
        assert_eq!(commit.author, "Zu Test");
        let log = log_in(path, 10).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].hash, commit.hash);

        fs::write(Path::new(path).join("a.txt"), "first\nsecond\n").unwrap();
        let diff = diff_in(path, Some("a.txt"), false).unwrap();
        assert!(diff.patch.contains("@@ -1 +1,2 @@"), "{}", diff.patch);
        assert_eq!((diff.added, diff.deleted), (1.0, 0.0));

        create_branch_in(path, "feature").unwrap();
        assert_eq!(status_in(path).unwrap().branch, "feature");
        checkout_in(path, &base).unwrap();
        let status = status_in(path).unwrap();
        assert_eq!(status.branch, base);
        assert_eq!(status.unstaged.len(), 1);
    }
}
