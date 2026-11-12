import { expect, test } from "nsh/test";
import { SHEET_FONT } from "./fonts";

// §2.3-16 (DESIGN §3.4): sheet content names the family the crate ships
// (`src/lib.rs`); its test guards the literal against the font files —
// both weights under ONE family, so the layout picks the nearest weight
// (body's 400 reads Light 300, bold's 600+ reads Medium 500).
test("sheet content names the Lilex family the crate ships", () => {
  expect(SHEET_FONT).toBe("Lilex");
});
