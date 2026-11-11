//! The macOS folder picker: one static `osascript` `choose folder` script.
//!
//! The script is fixed; only the prompt is escaped into it, so the picker
//! never builds a shell command from user text. Cancel is `null` (the script
//! catches AppleScript's `-128`), and a chosen folder comes back as the POSIX
//! path `osascript` printed, normalized (an absolute path, no trailing slash).
//! Blocking work runs off the engine thread, as [`crate::fs`] does.

use std::process::Command;

use nsh_core::prelude::*;

const ERR_PLATFORM: &str = "ERR_PICKER_PLATFORM";
const ERR_FAILED: &str = "ERR_PICKER_FAILED";
const ERR_PATH: &str = "ERR_PICKER_PATH";

/// The folder picker; `None` when the user cancelled.
#[module]
pub struct Picker;

#[module]
impl Picker {
    /// Opens the platform's folder chooser with `prompt` and resolves the
    /// chosen folder's absolute POSIX path. Cancel resolves `null`; a picker
    /// that cannot open fails with an `Error` whose `code` is
    /// `ERR_PICKER_PLATFORM` or `ERR_PICKER_FAILED`.
    pub async fn pick_folder(prompt: Option<String>) -> Result<Option<String>, JsError> {
        let text = prompt.unwrap_or_else(|| "Choose a folder".to_owned());
        blocking(move || pick_folder_blocking(&text))
            .await
            .map_err(|error| picker_error(ERR_FAILED, format!("the picker task failed: {error}")))?
    }
}

fn pick_folder_blocking(prompt: &str) -> Result<Option<String>, JsError> {
    if !cfg!(target_os = "macos") {
        return Err(picker_error(
            ERR_PLATFORM,
            "the native folder picker is macOS only",
        ));
    }
    let script = folder_script(prompt);
    let output = Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|error| picker_error(ERR_FAILED, format!("/usr/bin/osascript did not run: {error}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(picker_error(
            ERR_FAILED,
            format!("the folder picker failed: {}", stderr.trim()),
        ));
    }
    parse_picker_output(&String::from_utf8_lossy(&output.stdout))
        .map_err(|message| picker_error(ERR_PATH, message))
}

/// The one AppleScript the picker runs. `prompt` is escaped, never trusted.
fn folder_script(prompt: &str) -> String {
    format!(
        "try\n  set chosenFolder to choose folder with prompt \"{}\"\n  return POSIX path of chosenFolder\non error number -128\n  return \"\"\nend try",
        escape_applescript(prompt)
    )
}

/// A prompt inside an AppleScript string literal: backslash and quote are
/// escaped, and line breaks are flattened so the script stays one statement.
fn escape_applescript(prompt: &str) -> String {
    let mut escaped = String::with_capacity(prompt.len());
    for character in prompt.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' | '\r' | '\t' => escaped.push(' '),
            other => escaped.push(other),
        }
    }
    escaped
}

/// `osascript`'s stdout as a path: the first non-empty line, absolute and
/// without a trailing slash; empty output is the user's cancel (`None`).
fn parse_picker_output(stdout: &str) -> Result<Option<String>, String> {
    let Some(line) = stdout.lines().find(|line| !line.trim().is_empty()) else {
        return Ok(None);
    };
    let path = line.trim();
    if path.is_empty() {
        return Ok(None);
    }
    if !path.starts_with('/') {
        return Err(format!("the picker returned a non-absolute path: {path}"));
    }
    if path.contains('\0') {
        return Err("the picker returned a path with a NUL byte".to_owned());
    }
    let path = if path.len() > 1 { path.trim_end_matches('/') } else { path };
    let path = if path.is_empty() { "/" } else { path };
    Ok(Some(path.to_owned()))
}

fn picker_error(code: &str, message: impl Into<String>) -> JsError {
    JsError::Error(message.into()).with_code(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_script_escapes_quotes_and_backslashes() {
        let script = folder_script("Pick \"this\" \\ folder");
        assert!(script.contains("Pick \\\"this\\\" \\\\ folder"));
        // The script stays a single AppleScript block; the prompt cannot end it.
        assert_eq!(script.matches("end try").count(), 1);
    }

    #[test]
    fn the_script_flattens_line_breaks_in_the_prompt() {
        assert_eq!(escape_applescript("a\nb\tc"), "a b c");
    }

    #[test]
    fn empty_output_is_a_cancel() {
        assert_eq!(parse_picker_output(""), Ok(None));
        assert_eq!(parse_picker_output("\n  \n"), Ok(None));
    }

    #[test]
    fn a_folder_path_loses_its_trailing_slash() {
        assert_eq!(
            parse_picker_output("/Users/me/Project/\n"),
            Ok(Some("/Users/me/Project".to_owned()))
        );
        assert_eq!(
            parse_picker_output("/\n"),
            Ok(Some("/".to_owned()))
        );
    }

    #[test]
    fn a_relative_or_nul_path_is_an_error() {
        assert!(parse_picker_output("relative/path").is_err());
        assert!(parse_picker_output("/tmp/a\0b").is_err());
    }
}
