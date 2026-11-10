/**
 * The editor's language names, by file name or extension (`languageFor`).
 *
 * The editor and the language-server map both read this table: a sheet and
 * the client that serves it must agree on what a file is, or a `.tsx` would
 * open as TypeScript and be synchronized as something else. Kept out of
 * `editors.ts` so `lsp.ts` can import it without a cycle.
 */

const LANGUAGES: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  yaml: "yaml",
  yml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  py: "python",
  rb: "ruby",
  go: "go",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  m: "objective-c",
  mm: "objective-c",
  cs: "csharp",
  php: "php",
  lua: "lua",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  diff: "diff",
  patch: "diff",
  lock: "plaintext",
};

/** The editor's language for a path. */
export function languageFor(path: string): string {
  const name = path.split("/").pop() ?? path;
  const lower = name.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".editorconfig") return lower;
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  return LANGUAGES[ext] ?? name;
}

