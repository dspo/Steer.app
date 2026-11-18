import { expect, open, test } from "nsh/test";

// Q69's acceptance: closing a container's last sheet — the start page included,
// since every tab carries its × now — empties it, and a container with
// nothing to show leaves the sidebar with the 180 ms exit while the canvas
// moves on. The fixture reads the store, so the assertions are sheet ids,
// the archive call and the exit wrapper.

test("closing a container's last sheets archives it, with the row's exit", async () => {
  const app = await open("../fixtures/auto-archive.tsx", { width: 1200, height: 800 });
  await app.waitFor("text:only body");
  // The 4pt drag handle lives in the gutter between the sidebar and the card.
  expect(app.shows("id:sidebar-handle")).toBe(true);

  // The × on each tab: the session's, then the start page's — the last tab of a
  // group is closable too, which is what makes this path reachable.
  await app.press("id:tab-close-home:c1");
  await app.press("id:tab-close-session:s1");

  // The archive reached the transport and the canvas (no container left)
  // lands on the scratch Hero; the sidebar animates the row out (§3.8) and
  // then has nothing to show.
  await app.waitFor("id:launch-zu", { timeout: 5000 });
  const state = () => app.texts().find((text) => text.startsWith("panels=")) ?? "";
  await app.waitUntil(() => state().includes("rows=0") && state().includes("container.archive:c1"), {
    timeout: 5000,
  });
  await app.waitUntil(() => !app.shows("text:only body"), { timeout: 5000 });
  expect(app.shows("id:container-row-c1")).toBe(false);
}, 60000);
