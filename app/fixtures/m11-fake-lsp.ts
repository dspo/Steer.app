/**
 * The controlled language server of the M11 UI test.
 *
 * Not a mock inside the app: it is a real child process, started through
 * `zu/lsp`'s `Lsp` with real `Content-Length` framing over stdin/stdout. It
 * answers the four requests the UI maps (publishDiagnostics, hover,
 * definition, completion) with fixed, recognizable values, so the test can
 * prove the app's own paths end to end without waiting for rust-analyzer to
 * index. The native acceptance (`lsp.test.ts`) uses the real rust-analyzer;
 * this file is only the UI test's fixture, and its answers are labelled
 * "fake" on screen.
 */
export const FAKE_LSP_SOURCE = `// A controlled LSP server: real process, real framing, fixed answers.
process.stderr.write("fake-lsp started\\n");

let buffer = Buffer.alloc(0);
let rootUri = "";

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
  process.stdout.write(body);
}

function publish(uri) {
  send({
    jsonrpc: "2.0",
    method: "textDocument/publishDiagnostics",
    params: {
      uri: uri,
      diagnostics: [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          code: "E0308",
          source: "fake-lsp",
          message: "fake diagnostic: mismatched types",
          tags: [1],
        },
        {
          range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
          severity: 2,
          code: "dead_code",
          source: "fake-lsp",
          message: "fake warning: unused helper",
        },
      ],
    },
  });
}

function handle(message) {
  if (message.method === "initialize") {
    rootUri = (message.params && message.params.rootUri) || "";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          definitionProvider: true,
          completionProvider: { triggerCharacters: [".", ":"] },
        },
        serverInfo: { name: "fake-lsp", version: "0.1.0" },
      },
    });
    return;
  }
  if (message.method === "initialized") {
    process.stderr.write("fake-lsp initialized\\n");
    return;
  }
  if (message.method === "textDocument/didOpen") {
    publish(message.params.textDocument.uri);
    return;
  }
  if (message.method === "textDocument/didChange") {
    publish(message.params.textDocument.uri);
    return;
  }
  if (message.method === "textDocument/hover") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        contents: {
          kind: "markdown",
          value: ["### fake hover", "", "fake hover: fn main() -> ()"].join("\\n"),
        },
      },
    });
    return;
  }
  if (message.method === "textDocument/definition") {
    const target = rootUri.replace(/\\/$/, "") + "/src/target.rs";
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: [
        {
          uri: target,
          range: { start: { line: 1, character: 4 }, end: { line: 1, character: 10 } },
          targetUri: target,
          targetRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } },
          targetSelectionRange: { start: { line: 1, character: 4 }, end: { line: 1, character: 10 } },
        },
      ],
    });
    return;
  }
  if (message.method === "textDocument/completion") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        isIncomplete: false,
        items: [
          {
            label: "fake_completion",
            kind: 3,
            detail: "fn() -> i32",
            documentation: "fake completion docs",
            insertText: "fake_completion",
          },
        ],
      },
    });
    return;
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
    return;
  }
  if (message.id !== undefined && message.id !== null) {
    send({ jsonrpc: "2.0", id: message.id, result: null });
  }
}

function pump() {
  for (;;) {
    const head = buffer.indexOf("\\r\\n\\r\\n");
    if (head < 0) return;
    const header = buffer.slice(0, head).toString("utf8");
    const match = /content-length:\\s*(\\d+)/i.exec(header);
    if (!match) {
      buffer = Buffer.alloc(0);
      return;
    }
    const length = Number(match[1]);
    if (buffer.length < head + 4 + length) return;
    const body = buffer.slice(head + 4, head + 4 + length).toString("utf8");
    buffer = buffer.slice(head + 4 + length);
    try {
      handle(JSON.parse(body));
    } catch (error) {
      process.stderr.write("fake-lsp bad message: " + String(error) + "\\n");
    }
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  pump();
});
process.stdin.on("end", () => process.exit(0));
`;
