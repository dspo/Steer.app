import { mount } from "nsh";
import { seedSession } from "../modules/pi/sessions";
import { Conversation } from "../modules/pi/chat-view";

// A long transcript: the list must render only what is near the viewport.
const rows = Array.from({ length: 2000 }, (_, i) => ({
  role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
  text: `row ${i}`,
}));
seedSession("s1", rows, { path: "/tmp/long.jsonl", name: "Long", loaded: true });

mount(() => <Conversation id="s1" />);
