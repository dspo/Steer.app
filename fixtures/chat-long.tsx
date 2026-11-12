import { mount } from "nsh";
import { seedSession } from "../stores/sessions";
import { Conversation } from "../chat-view";
import { phase } from "../stores/engine";

// A long transcript: the list must render only what is near the viewport.
phase.set("connected");
const rows = Array.from({ length: 2000 }, (_, i) => ({
  role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  text: `row ${i}`,
}));
seedSession("s1", rows, { path: "/tmp/long.jsonl", name: "Long", loaded: true });

mount(() => <Conversation id="s1" />);
