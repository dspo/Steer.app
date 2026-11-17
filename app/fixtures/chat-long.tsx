import { mount } from "nsh";
import { assistantEntry, userEntry } from "../modules/pi/transcript";
import { seedSession } from "../modules/pi/sessions";
import { Conversation } from "../modules/pi/chat-view";

// A long transcript: the list must render only what is near the viewport.
const rows = Array.from({ length: 2000 }, (_, i) =>
  i % 2 === 0 ? userEntry(`u${i}`, `row ${i}`) : assistantEntry(`a${i}`, `row ${i}`),
);
seedSession("s1", rows, { path: "/tmp/long.jsonl", name: "Long", loaded: true });

mount(() => <Conversation id="s1" />);
