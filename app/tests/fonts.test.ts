import { expect, test } from "nsh/test";
import { SHEET_FONT, SHEET_MONO } from "../ui/fonts";

// §3.4 (DESIGN, issue #20 §4.7): sheet content names the families the crate
// ships (`src/lib.rs`); its tests guard the literals against the font files —
// the sans weights under ONE family and the mono weights under one more, so
// the layout picks the nearest weight within the right face.
test("sheet content names the Geist family the crate ships", () => {
  expect(SHEET_FONT).toBe("Geist");
});

test("the code faces name the Geist Mono family the crate ships", () => {
  expect(SHEET_MONO).toBe("Geist Mono");
});
