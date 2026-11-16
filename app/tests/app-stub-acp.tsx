import { host } from "nsh";
import { setAcpCommandOverride } from "../modules/pi/acp/acp";
import { stubCommandAt } from "../fixtures/stub-command";

// The app under test with a scripted harness. `nsh test app` must pass on a
// machine with no built pi harness — CI never builds one (the compile target
// pins darwin-arm64, so its pipeline only runs check-version + bun test), and
// a fresh checkout has none either — while the boot's real paths (the active
// container's hydration, the Hero's mint) spawn `pi-acp` through the app's
// own module graph. This entry stands the stub in for `dist/pi-acp`, the
// same stand-in the transport tests drive, before that graph runs;
// `STUB_FILE_REPLAY` makes a session/load stream the file's own rows, which
// is what the real distro does and what the transcript assertions read. The
// packaged app never sees any of this.
//
// The stub's path rides `host.params` — an app VM's `import.meta.url` is no
// file path, so an entry cannot locate repo files itself; the test (whose
// module URLs are real) hands it over. A subdirectory entry needs nothing
// special: the bundler locates the app by walking up from the entry's own
// directory to `nsh.json`, so the theme and the `assets/` it ships resolve
// the same from `tests/` as from the root — the entry's position is
// irrelevant.
const stubPath = (host.params as { acpStub?: string } | null)?.acpStub;
if (stubPath) {
  setAcpCommandOverride(stubCommandAt(stubPath, { STUB_FILE_REPLAY: "1" }));
}

// The real entry, imported only after the override is in place: a static
// import would evaluate — and mount — before this body runs.
await import("../App");
