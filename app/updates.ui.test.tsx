import { expect, open, test } from "nsh/test";

/**
 * The Updates dialog's visible states with a fake `nsh/updater` (see
 * `fixtures/updates.tsx`). The real check/download/install against a
 * signed release cannot run here: this repository has no updater source,
 * no public key and no release. The dialog says so, and the state machine
 * is driven through every state the real one would show.
 */

test("a development build says updates are off, not that it is up to date", async () => {
  const app = await open("./fixtures/updates.tsx");
  await app.press("id:open-dev");
  await app.waitUntil(() => app.texts().includes("开发构建不检查更新；打包后的应用才会读取 nsh.json 的安装源。"));
  expect(app.texts()).toContain("更新");
  // The check is disabled: there is no source to ask.
  expect(app.enabled("id:updates-check")).toBe(false);
  await app.press("id:updates-close");
  await app.waitUntil(() => !app.shows("id:updates-dialog"));
});

test("check, progress and install are shown from a fake release", async () => {
  const app = await open("./fixtures/updates.tsx");
  await app.press("id:open-packaged");
  await app.waitUntil(() => app.texts().includes("当前版本 0.1.0（build 1）"));
  expect(app.enabled("id:updates-check")).toBe(true);

  await app.press("id:updates-check");
  await app.waitUntil(() => app.texts().includes("发现新版本 0.2.0。"));
  expect(app.texts()).toContain("notes for 0.2.0");
  expect(app.texts()).toContain("新版本");

  await app.press("id:updates-download");
  await app.waitUntil(() => app.texts().includes("更新已下载并通过校验。"));
  // The row keeps the bytes of the fake download (512 KiB of 1 MiB).
  expect(app.texts().some((text) => text.includes("512 KB"))).toBe(true);
  expect(app.texts().some((text) => text.includes("1 MB"))).toBe(true);

  await app.press("id:updates-install");
  await app.waitUntil(() => app.texts().includes("正在安装；成功时应用会重启。"));
  // The fake install resolved, but the dialog does not claim it installed.
  expect(app.texts().some((text) => text.includes("已安装") && !text.includes("正在安装"))).toBe(false);
});

test("the notification permission row asks the system from its own button", async () => {
  const app = await open("./fixtures/updates.tsx");
  await app.press("id:open-release-behind");
  await app.waitUntil(() => app.texts().includes("尚未授权；第一次发通知时系统会询问。"));
  await app.press("id:notifications-enable");
  await app.waitUntil(() => app.texts().includes("已允许；窗口不在前台时，回合完成会发系统通知。"));
  expect(app.count("id:notifications-enable")).toBe(0);
});
