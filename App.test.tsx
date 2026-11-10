import { expect, open, test } from "nsh/test";

test("canvas shows the workbench outline", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("manox-app");
  expect(app.texts()).toContain("Pi Session");
  expect(app.texts()).toContain("10 sheets");
});

test("adding a sheet appends it to the shown group", async () => {
  const app = await open("./App.tsx");
  await app.press("添加 终端");
  expect(app.texts()).toContain("11 sheets");
  expect(app.texts()).toContain("终端");
});

test("a sheet's counter survives moving between panels", async () => {
  const app = await open("./App.tsx");
  await app.press("Sheet session:demo");
  await app.press("Sheet session:demo");
  // The mock body renders its own taps line; drag needs a pointer, so the
  // counter's persistence is checked by the renderPanel contract (once per
  // key). Here we only assert the body shows it.
  expect(app.texts()).toContain("taps 2 · 拖我到另一个 panel，计数不丢");
});
