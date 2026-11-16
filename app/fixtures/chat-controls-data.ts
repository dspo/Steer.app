import type { PiConfigOption } from "../modules/pi/acp/host";

/**
 * The composer footer's protocol state, shared by the chat fixtures: the
 * permission modes the distro offers (current `auto`) and its `thought_level`
 * selector (current `high`). Seeded into the views so the mode switch and the
 * effort picker render without an engine.
 */

export const SESSION_MODES = [
  { id: "ask", name: "Ask", description: "Ask before destructive tools and commands." },
  { id: "auto", name: "Auto", description: "Run tools without asking." },
  { id: "read-only", name: "Read-only", description: "Block writes, commands and network tools." },
];

export const THOUGHT_LEVEL: PiConfigOption = {
  id: "thought_level",
  name: "Thought level",
  type: "select",
  currentValue: "high",
  options: [
    { value: "off", name: "off" },
    { value: "minimal", name: "minimal" },
    { value: "low", name: "low" },
    { value: "medium", name: "medium" },
    { value: "high", name: "high" },
    { value: "xhigh", name: "xhigh" },
    { value: "max", name: "max" },
  ],
};
