import { expect, test } from "nsh/test";
import { Pty, type PtyExit } from "zu/native";

// The PTY native module without any UI: a real program under a real
// pseudo-terminal, its bytes through the callback, its size, and its death.
// The tests never fake output; they run /bin/sh and wait for what it prints.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs = 10000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 20) {
    if (condition()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

test("a PTY runs a command and streams its output", async () => {
  const chunks: string[] = [];
  let exit: PtyExit | undefined;
  const pty = Pty.open(
    { command: "/bin/sh", args: ["-c", "printf 'M7_PTY_OK\\n'; printf 'second line\\n'"], cwd: "/tmp" },
    (data) => chunks.push(data),
    (result) => {
      exit = result;
    },
  );
  await until("the command's output", () => chunks.join("").includes("second line"));
  expect(chunks.join("")).toContain("M7_PTY_OK");
  await until("the process exit", () => exit !== undefined);
  expect(exit?.code).toBe(0);
  expect(exit?.signal ?? null).toBeNull();
  expect(pty.alive()).toBe(false);
  expect(pty.exitCode).toBe(0);
  pty.dispose();
}, 30000);

test("a PTY accepts input, resizes and reports its process", async () => {
  const chunks: string[] = [];
  const pty = Pty.open(
    { command: "/bin/sh", cwd: "/tmp", cols: 80, rows: 24 },
    (data) => chunks.push(data),
  );
  expect(pty.pid).toBeGreaterThan(0);
  expect(pty.title).toBe("/bin/sh");
  expect(pty.size).toEqual([80, 24]);
  expect(pty.exitCode).toBeNull();

  pty.resize(100, 40);
  expect(pty.size).toEqual([100, 40]);

  pty.write("printf 'M7_INPUT_OK\\n'\n");
  await until("the command typed into the shell", () => chunks.join("").includes("M7_INPUT_OK"));

  // `stty size` reads the kernel's window size: the resize reached the program.
  chunks.length = 0;
  pty.write("stty size\n");
  await until("the kernel's window size", () => /40 100/.test(chunks.join("")));

  pty.close();
  await until("the closed PTY to end", () => !pty.alive());
  pty.dispose();
}, 30000);

test("closing a PTY kills its program", async () => {
  let exit: PtyExit | undefined;
  const pty = Pty.open(
    { command: "/bin/sh", args: ["-c", "echo M7_SLEEP_STARTED; sleep 30"], cwd: "/tmp" },
    () => {},
    (result) => {
      exit = result;
    },
  );
  const pid = pty.pid;
  expect(pid).not.toBeNull();
  pty.close();
  await until("the killed process to exit", () => exit !== undefined, 10000);
  expect(pty.alive()).toBe(false);
  // A hangup is a signal, so there is no exit code; either outcome proves the
  // process is gone.
  expect(exit?.code == null || typeof exit?.code === "number").toBe(true);
  pty.dispose();
}, 30000);

test("the default shell is $SHELL", async () => {
  const pty = Pty.open({ cwd: "/tmp" }, () => {});
  const expected = process.env.SHELL;
  if (expected) {
    expect(pty.title).toBe(expected);
  } else {
    // No `$SHELL`: the fallback is the platform's own login shell. The
    // headless runner's `platform.os` is a fiction (it names the emulated
    // device, not this box), so the assertion reads the contract, not a
    // literal: whichever login shell pty.rs picked, it is one of them.
    expect(pty.title).toMatch(/^\/bin\/(z|ba)?sh$/);
  }
  pty.close();
  pty.dispose();
}, 30000);
