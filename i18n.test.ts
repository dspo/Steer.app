import { expect, test } from "nsh/test";
import { K, SHELL_KEYS, t } from "./i18n";
import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";

// Parity is structural: the two tables and the shell's key list must be the
// same set, and no Chinese entry may be a copy of its English one (which is
// how a forgotten translation would look).
test("zh-CN and en cover exactly the shell's keys", () => {
  const english = Object.keys(en).sort();
  const chinese = Object.keys(zhCN).sort();
  const keys = [...SHELL_KEYS].sort();
  expect(english).toEqual(chinese);
  expect(english).toEqual(keys);
  for (const key of keys) {
    expect(en[key].length).toBeGreaterThan(0);
    expect(zhCN[key].length).toBeGreaterThan(0);
    expect(zhCN[key]).not.toBe(en[key]);
  }
});

test("the table fills arguments and falls back", () => {
  expect(t(K.status.sheets, { count: 3, locale: "en" })).toContain("3");
  expect(t(K.engine.recovered, { generation: 7, locale: "zh-CN" })).toContain("7");
  // An unknown key stays visible rather than becoming an empty string.
  expect(t("app.not.a.key", { locale: "en" })).toBe("app.not.a.key");
  // A language tag picks the base language.
  expect(t(K.sidebar.title, { locale: "zh-Hant-TW" })).toBe(zhCN[K.sidebar.title]);
});
