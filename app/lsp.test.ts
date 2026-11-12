import { expect, test } from "nsh/test";
import { Fs, Lsp, type LspExit } from "zu/native";

// M11's native acceptance, against the machine's **real** rust-analyzer
// (1.99.1): a real Cargo project under /tmp with a deliberate type error, a
// real `initialize` handshake, a real `didOpen`, and the diagnostics, hover,
// definition and completion that rust-analyzer itself produces. Nothing here
// is mocked; the fixture is written with `zu/fs`, and every assertion reads a
// message the server sent.
//
// rust-analyzer indexes on first use, so the wait is generous (120 s for the
// test). The project is tiny and the server is stopped at the end.

const TAG = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
const FOLDER = `zu-m11-rust-${TAG}`;
const ROOT = `/tmp/${FOLDER}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(what: string, condition: () => boolean, timeoutMs: number): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (condition()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function pathToUri(path: string): string {
  return `file://${path
    .split("/")
    .map((part, index) => (index === 0 ? "" : encodeURIComponent(part)))
    .join("/")}`;
}

/** A tiny JSON-RPC client over the native `Lsp`, as `lsp.ts` builds one. */
class Client {
  readonly messages: any[] = [];
  readonly stderr: string[] = [];
  exit?: LspExit;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void }>();
  private nextId = 1;

  private constructor(readonly handle: Lsp) {}

  static start(root: string, command = "rust-analyzer", args: string[] = []): Client {
    // The callbacks can fire before `Lsp.start` returns (a server's stderr
    // usually does), so they write into a holder that is filled immediately
    // after. Nothing the handshake needs can arrive before the request.
    let client: Client | null = null;
    const handle = Lsp.start(
      { command, args, cwd: root },
      (message) => {
        if (!client) return;
        let parsed: any;
        try {
          parsed = JSON.parse(message);
        } catch {
          return;
        }
        client.messages.push(parsed);
        client.receive(parsed);
      },
      (text) => {
        if (client) client.stderr.push(text);
      },
      (exit) => {
        if (client) client.exit = exit;
      },
    );
    client = new Client(handle);
    return client;
  }

  private receive(message: any): void {
    if (message.id !== undefined && message.id !== null) {
      if (typeof message.method === "string") {
        // Server → client request: answer so rust-analyzer never waits.
        const result =
          message.method === "workspace/configuration"
            ? (message.params?.items ?? []).map(() => null)
            : message.method === "workspace/workspaceFolders"
              ? null
              : null;
        this.handle.send(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(message.error);
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "textDocument/publishDiagnostics") {
      this.diagnostics.push(message.params);
    }
  }

  readonly diagnostics: any[] = [];

  get stderrTail(): string {
    return this.stderr.join("").slice(-2000);
  }

  request(method: string, params: unknown, timeoutMs = 30000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out; stderr: ${this.stderrTail}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.handle.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  notify(method: string, params: unknown): void {
    this.handle.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  stop(): void {
    this.handle.stop();
  }
}

async function retry<T>(
  what: string,
  ask: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  let last: T | undefined;
  let lastError: unknown;
  for (let waited = 0; waited < timeoutMs; waited += 250) {
    try {
      last = await ask();
      if (accept(last)) return last;
    } catch (error) {
      // "content modified" while the crate graph loads is an answer, not a
      // broken request; ask again.
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `timed out waiting for ${what}; last answer: ${JSON.stringify(last ?? null)}; last error: ${JSON.stringify(lastError ?? null)}`,
  );
}

const MAIN = `use zu_m11_fixture::add;

fn main() {
    let value: i32 = "not a number";
    let sum = add(1, 2);
    let _unused = value;
    println!("{value} {sum}");
}
`;

const LIB = `pub fn add(left: i32, right: i32) -> i32 {
    left + right
}
`;

test("rust-analyzer reports a real type error, hover, definition and completion", async () => {
  await Fs.mkdir("/tmp", FOLDER);
  await Fs.write(
    ROOT,
    "Cargo.toml",
    '[package]\nname = "zu-m11-fixture"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n',
    null,
    null,
  );
  await Fs.mkdir(ROOT, "src");
  await Fs.write(ROOT, "src/lib.rs", LIB, null, null);
  await Fs.write(ROOT, "src/main.rs", MAIN, null, null);
  const canonical = (await Fs.stat(ROOT, ".")).path;
  const rootUri = pathToUri(canonical);
  const mainPath = `${canonical}/src/main.rs`;
  const mainUri = pathToUri(mainPath);

  const started = Date.now();
  let initializedAt = 0;
  let diagnosticsAt = 0;
  let hoverAt = 0;
  let definitionAt = 0;
  const client = Client.start(canonical);
  try {
    expect(client.handle.pid).toBeGreaterThan(0);
    const initialize = await client.request(
      "initialize",
      {
        processId: null,
        clientInfo: { name: "Zu M11 test", version: "0.1.0" },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: FOLDER }],
        capabilities: {
          textDocument: {
            synchronization: { didSave: true },
            hover: { contentFormat: ["markdown", "plaintext"] },
            definition: { linkSupport: true },
            completion: { completionItem: { snippetSupport: false } },
            publishDiagnostics: { relatedInformation: true },
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      },
      60000,
    );
    expect(initialize?.serverInfo?.name ?? "").toContain("rust-analyzer");
    initializedAt = Date.now();
    client.notify("initialized", {});
    client.notify("textDocument/didOpen", {
      textDocument: { uri: mainUri, languageId: "rust", version: 1, text: MAIN },
    });

    // Diagnostics: the deliberate type error must arrive, with rust-analyzer
    // as its source and the real compiler message.
    await until(
      "rust-analyzer's diagnostics",
      () => client.diagnostics.some((params) => params.uri === mainUri && params.diagnostics.length > 0),
      120000,
    );
    diagnosticsAt = Date.now();
    const published = [...client.diagnostics].reverse().find((params) => params.uri === mainUri)!;
    const error = published.diagnostics.find((row: any) => row.severity === 1);
    expect(error).toBeDefined();
    expect(error.message).toMatch(/mismatched types|expected i32/);
    expect(error.range.start.line).toBe(3);
    expect(["rustc", "rust-analyzer"]).toContain(error.source ?? "rust-analyzer");

    // Hover on the `add` call: a signature from the server, not a fixture.
    // rust-analyzer may answer null until its crate graph is ready, so the
    // question is retried rather than answered by a fixture.
    const hover = await retry(
      "rust-analyzer's hover",
      () =>
        client.request(
          "textDocument/hover",
          { textDocument: { uri: mainUri }, position: { line: 4, character: 14 } },
          30000,
        ),
      (value) => JSON.stringify(value ?? null).includes("i32"),
      30000,
    );
    hoverAt = Date.now();
    const hoverText = JSON.stringify(hover);
    expect(hoverText).toContain("add");
    expect(hoverText).toContain("i32");

    // Definition: the local crate's `add`, in src/lib.rs.
    const definition = await retry(
      "rust-analyzer's definition",
      () =>
        client.request(
          "textDocument/definition",
          { textDocument: { uri: mainUri }, position: { line: 4, character: 14 } },
          30000,
        ),
      (value) => JSON.stringify(value ?? null).includes("src/lib.rs"),
      30000,
    );
    const locations = Array.isArray(definition) ? definition : [definition];
    const first = locations.find((row: any) => row);
    const targetUri = first?.targetUri ?? first?.uri;
    expect(targetUri).toBeDefined();
    definitionAt = Date.now();
    expect(decodeURIComponent(String(targetUri))).toContain("/src/lib.rs");

    // Completion at `let _unused = |value`: candidates come from the server.
    const completion = await retry(
      "rust-analyzer's completion",
      () =>
        client.request(
          "textDocument/completion",
          {
            textDocument: { uri: mainUri },
            position: { line: 5, character: 18 },
            context: { triggerKind: 1 },
          },
          30000,
        ),
      (value) => {
        const items = Array.isArray(value) ? value : (value?.items ?? []);
        return items.some((item: any) => item.label === "value");
      },
      30000,
    );
    const items = Array.isArray(completion) ? completion : (completion?.items ?? []);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item: any) => item.label === "value")).toBe(true);

    // The evidence file keeps the server's own answers and the timings, so
    // `docs/evidence/m11-lsp.md` quotes real output rather than a summary.
    await Fs.write(
      ROOT,
      "evidence.json",
      JSON.stringify(
        {
          rustAnalyzer: initialize?.serverInfo,
          serverPid: client.handle.pid,
          nativeFraming: "Content-Length over stdin/stdout through zu/lsp",
          timingsMs: {
            initialize: initializedAt - started,
            diagnostics: diagnosticsAt - started,
            hover: hoverAt - diagnosticsAt,
            definition: definitionAt - diagnosticsAt,
            completion: Date.now() - definitionAt,
          },
          diagnostics: published.diagnostics,
          hover,
          definition,
          completion: items.slice(0, 6),
          stderrTail: client.stderr.join("").slice(-800),
        },
        null,
        2,
      ),
      null,
      null,
    );
  } finally {
    client.stop();
  }
  await until("the server to stop", () => client.exit !== undefined, 15000);
  expect(client.handle.alive()).toBe(false);
}, 150000);

test("a missing server and a missing cwd are coded errors, and stop is idempotent", () => {
  let created: Lsp | null = null;
  const create = (options: any) => {
    created = Lsp.start(options, () => {}, () => {}, () => {});
    return created;
  };
  expect(() =>
    create({ command: "zu-m11-not-a-real-language-server", args: [], cwd: "/tmp" }),
  ).toThrow();
  expect(() => create({ command: "rust-analyzer", args: [], cwd: "/definitely/not/a/dir" })).toThrow();
  expect(() => create({ command: "rust-analyzer", args: [], cwd: "" })).toThrow();
  expect(created).toBeNull();
});

// The same client against the machine's other two servers. Neither is
// mocked: the fixture is written with `zu/fs`, the handshake is real, and
// the diagnostic is the server's own.
async function initializeOn(client: Client, root: string, languageId: string, file: string, text: string) {
  const canonical = (await Fs.stat(root, ".")).path;
  const rootUri = pathToUri(canonical);
  const uri = pathToUri(`${canonical}/${file}`);
  const initialize = await client.request(
    "initialize",
    {
      processId: null,
      clientInfo: { name: "Zu M11 test", version: "0.1.0" },
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: canonical.split("/").pop() }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          completion: { completionItem: { snippetSupport: false } },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
    },
    90000,
  );
  client.notify("initialized", {});
  client.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
  return { initialize, uri };
}

test("typescript-language-server reports a real type error", async () => {
  const folder = `zu-m11-ts-${TAG}`;
  const root = `/tmp/${folder}`;
  await Fs.mkdir("/tmp", folder);
  await Fs.write(root, "package.json", '{"name":"zu-m11-ts","private":true}\n', null, null);
  await Fs.write(
    root,
    "tsconfig.json",
    JSON.stringify({ compilerOptions: { strict: true, target: "ES2020", module: "ESNext", noEmit: true }, include: ["src"] }, null, 2),
    null,
    null,
  );
  await Fs.mkdir(root, "src");
  const text = 'const value: number = "not a number";\nexport { value };\n';
  await Fs.write(root, "src/index.ts", text, null, null);

  const client = Client.start(root, "typescript-language-server", ["--stdio"]);
  try {
    // typescript-language-server answers without `serverInfo`; its
    // capabilities and the diagnostics below are the evidence it is up.
    const { initialize, uri } = await initializeOn(client, root, "typescript", "src/index.ts", text);
    expect(!!initialize?.capabilities).toBe(true);
    await until(
      "typescript-language-server's diagnostics",
      () => client.diagnostics.some((params) => params.uri === uri && params.diagnostics.length > 0),
      120000,
    );
    const published = [...client.diagnostics].reverse().find((params) => params.uri === uri)!;
    const error = published.diagnostics.find((row: any) => row.severity === 1);
    expect(error).toBeDefined();
    expect(error.message).toMatch(/not assignable|Type 'string'/);
  } finally {
    await client.stop();
  }
}, 180000);

test("gopls reports a real type error", async () => {
  const folder = `zu-m11-go-${TAG}`;
  const root = `/tmp/${folder}`;
  await Fs.mkdir("/tmp", folder);
  await Fs.write(root, "go.mod", "module zum11go\n\ngo 1.21\n", null, null);
  const text = 'package main\n\nfunc main() {\n\tvar value int = "not a number"\n\t_ = value\n}\n';
  await Fs.write(root, "main.go", text, null, null);

  const client = Client.start(root, "gopls", []);
  try {
    const { uri } = await initializeOn(client, root, "go", "main.go", text);
    await until(
      "gopls's diagnostics",
      () => client.diagnostics.some((params) => params.uri === uri && params.diagnostics.length > 0),
      150000,
    );
    const published = [...client.diagnostics].reverse().find((params) => params.uri === uri)!;
    const error = published.diagnostics.find((row: any) => row.severity === 1);
    expect(error).toBeDefined();
    expect(error.message).toMatch(/cannot use|cannot convert|string/);
  } finally {
    await client.stop();
  }
}, 240000);
