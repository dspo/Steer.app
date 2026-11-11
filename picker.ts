import { Picker } from "zu/native";

/**
 * The Finder folder picker. The native module runs one static `osascript`
 * `choose folder` (cancel is `null`); this module only makes it replaceable,
 * so a headless test can answer with paths and never launch Finder.
 */
export type FolderPicker = (prompt: string) => Promise<string | null>;

const nativePicker: FolderPicker = async (prompt) => (await Picker.pickFolder(prompt)) ?? null;

let transport: FolderPicker = nativePicker;

/** Replaces the picker (tests); `null` restores the native one. */
export function setFolderPicker(next: FolderPicker | null): void {
  transport = next ?? nativePicker;
}

/** Opens the platform's folder picker; `null` when the user cancels. */
export function pickFolder(prompt: string): Promise<string | null> {
  return transport(prompt);
}
