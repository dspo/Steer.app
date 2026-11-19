// The compiled binary cannot read its own package.json, so the version is a
// source constant; this keeps it equal to the pin. The app's About page
// mirrors the pin too (`app/shell/about.ts`, which a packaged app can read),
// so all three must stay equal.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const pin = pkg.dependencies["@earendil-works/pi-coding-agent"];
const source = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8");
if (!source.includes(`"${pin}"`)) {
  console.error(`src/version.ts must carry the pinned version ${pin}`);
  process.exit(1);
}
const about = readFileSync(new URL("../../app/shell/about.ts", import.meta.url), "utf8");
if (!about.includes(`PI_SDK_VERSION = "${pin}"`)) {
  console.error(`app/shell/about.ts must mirror the pinned version ${pin}`);
  process.exit(1);
}
