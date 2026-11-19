//! Emits the manox pin as a compile-time constant: every `manox-*` git
//! dependency in Cargo.toml carries the same `tag = "vX.Y.Z"` — one tag for
//! the whole crate family — and the About surface reports it as the host's
//! version (`Manox::version`). If the tag lines ever disagree, the build
//! stops here rather than shipping a mixed host.

use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::PathBuf;

/// What marks a dependency's pin line: `tag = "` inside its `{ … }` table.
const TAG_NEEDLE: &str = "tag = \"";

fn main() {
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("Cargo.toml");
    let source = fs::read_to_string(&manifest).expect("read Cargo.toml");
    let mut tags = BTreeSet::new();
    for line in source.lines() {
        // Comments may mention the pin in prose (with a placeholder), so
        // only dependency lines count.
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        // The tag sits mid-line inside a dependency's `{ … }` table.
        let Some(start) = line.find(TAG_NEEDLE) else {
            continue;
        };
        let rest = &line[start + TAG_NEEDLE.len()..];
        let Some(tag) = rest.split('"').next() else {
            continue;
        };
        if !tag.is_empty() {
            tags.insert(tag.to_owned());
        }
    }
    let mut tags = tags.into_iter();
    let Some(pin) = tags.next() else {
        panic!("no `tag = \"v…\"` manox pin found in Cargo.toml");
    };
    if tags.next().is_some() {
        panic!("the manox git dependencies disagree on their `tag` pin in Cargo.toml");
    }
    println!("cargo:rustc-env=ZU_MANOX_PIN={pin}");
    println!("cargo:rerun-if-changed=Cargo.toml");
}
