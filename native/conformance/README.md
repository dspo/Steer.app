# esctest-baseline.txt

The 114 esctest2 tests the pinned libghostty-vt kernel (`042b16b`) also
fails when Ghostty's own esctest runner drives it: the kernel's ceiling,
not our embedding's. A conformance failure on this list is
kernel-limited (bookkeeping in `docs/upstream-watch.md`, improves with
the next Ghostty bump); one outside this list is ours.

Regenerate on the same machine, per issue #46 §四:

```sh
cd ~/projects/github/ghostty/test/esctest && rm -rf .zig-cache zig-out
# main.zig's std.c.T.IOCSWINSZ is a Linux constant; on macOS the ioctl
# line becomes @bitCast(@as(u32, 0x80087467)) — revert after the run.
~/Library/Caches/openidea-gui/ghostty-vt/zig/zig-aarch64-macos-0.17.0/zig build run > upstream.log
git checkout src/main.zig
awk '/tests passed/{f=1;next} f && /^Failing tests:/{next} f && NF' upstream.log > <repo>/native/conformance/esctest-baseline.txt
```

The count must stay 114 while the Ghostty pin does not move.
