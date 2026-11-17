import { expect, test } from "nsh/test";
import { TerminalSession, type TerminalSessionEvent } from "zu/native";

// The session without any view: a real program under a real PTY, its output
// read back from the emulator, its effects heard as events. The emulator is
// fed in Rust, so nothing here passes output through TSX.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 20) {
    if (condition()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

test("a session's emulator reads its program, without a view", async () => {
  const events: TerminalSessionEvent[] = [];
  const session = TerminalSession.open(
    {
      command: "/bin/sh",
      args: ["-c", "printf '\\033]0;SESSION_TITLE\\007'; printf 'CJK\\344\\270\\255\\346\\226\\207 ok\\n'; sleep 0.2"],
      cwd: "/tmp",
      cols: 40,
      rows: 5,
    },
    (event) => events.push(event),
  );
  expect(session.id).toBeGreaterThan(0);
  await until("the output in the emulator", () => session.viewportText().includes("CJK中文 ok"));
  await until("the title event", () => events.some((e) => e.kind === "title" && e.text === "SESSION_TITLE"));
  expect(session.title).toBe("SESSION_TITLE");
  await until("the exit event", () => events.some((e) => e.kind === "exit"));
  expect(events.find((e) => e.kind === "exit")?.code).toBe(0);
  expect(session.alive()).toBe(false);
  // The emulator keeps what the program left after it ended.
  expect(session.text()).toContain("CJK中文 ok");
  session.dispose();
}, 30000);

test("a session takes input, resizes and keeps its history", async () => {
  const session = TerminalSession.open({ command: "/bin/sh", cwd: "/tmp", cols: 80, rows: 10 }, () => {});
  session.write("for i in $(seq 1 60); do echo HIST$i; done\n");
  await until("the history", () => session.text().includes("HIST60"));
  // Sixty lines in ten rows: the first are history, not the screen.
  expect(session.text()).toContain("HIST1\n");
  expect(session.viewportText()).not.toContain("HIST1\n");
  session.scrollBy(-1000);
  expect(session.viewportText()).toContain("HIST1");
  session.scrollToBottom();

  session.resize(100, 20);
  expect(session.size).toEqual([100, 20]);
  session.write("stty size\n");
  await until("the kernel's window size", () => session.viewportText().includes("20 100"));

  // OSC 52: the program's clipboard write is the app's to apply.
  const heard: TerminalSessionEvent[] = [];
  const clip = TerminalSession.open(
    { command: "/bin/sh", args: ["-c", "printf '\\033]52;c;SGVsbG8=\\007'; sleep 0.2"], cwd: "/tmp" },
    (event) => heard.push(event),
  );
  await until("the clipboard event", () => heard.some((e) => e.kind === "clipboard"));
  expect(heard.find((e) => e.kind === "clipboard")?.text).toBe("Hello");

  session.close();
  await until("the closed session to end", () => !session.alive());
  session.dispose();
  clip.dispose();
}, 30000);

test("find walks the history's matches and selects them", async () => {
  const session = TerminalSession.open({ command: "/bin/sh", cwd: "/tmp", cols: 60, rows: 6 }, () => {});
  session.write("for i in 1 2 3; do echo NEEDLE$i; done; seq 1 40\n");
  await until("the output", () => session.text().includes("NEEDLE3") && session.text().includes("\n40"));
  const found = session.find("NEEDLE");
  // The command line itself holds one more; newest first.
  expect(found.total).toBeGreaterThanOrEqual(3);
  expect(found.index).toBe(0);
  expect(session.selectedText()).toBe("NEEDLE");
  const older = session.findStep(1);
  expect(older.index).toBe(1);
  // The match is in the history: the viewport moved to it.
  expect(session.viewportText()).toContain("NEEDLE");
  expect(session.find("").total).toBe(0);
  session.close();
  session.dispose();
}, 30000);

test("a program's notifications, progress and color-scheme query reach the app", async () => {
  const events: TerminalSessionEvent[] = [];
  const session = TerminalSession.open(
    {
      command: "/bin/sh",
      args: [
        "-c",
        // OSC 777 notify, OSC 9;4 progress at 42%, a color-scheme query
        // whose answer the program reads back and prints.
        "printf '\\033]777;notify;Build;done\\007\\033]9;4;1;42\\007'; " +
          "stty raw -echo; printf '\\033[?996n'; answer=$(dd bs=1 count=9 2>/dev/null); stty sane; " +
          "printf 'SCHEME[%s]\\n' \"$(printf '%s' \"$answer\" | tr -d '\\033')\"; sleep 0.2",
      ],
      cwd: "/tmp",
    },
    (event) => events.push(event),
  );
  await until("the notification", () => events.some((e) => e.kind === "notify"));
  const notify = events.find((e) => e.kind === "notify");
  expect(notify?.title).toBe("Build");
  expect(notify?.text).toBe("done");
  await until("the progress", () => events.some((e) => e.kind === "progress"));
  const progress = events.find((e) => e.kind === "progress");
  expect(progress?.text).toBe("set");
  expect(progress?.percent).toBe(42);
  // A light background by default: `?997;2n`.
  await until("the scheme answer", () => session.viewportText().includes("SCHEME["));
  expect(session.viewportText()).toContain("SCHEME[[?997;2n]");
  session.dispose();
}, 30000);
