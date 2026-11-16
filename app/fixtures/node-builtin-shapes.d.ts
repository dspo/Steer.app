// The Node builtin shapes `acp-stub-agent.ts` uses. That file runs under
// real bun (the tests spawn it through bun), not in the app VM — but
// `nsh check` type-checks every app file against the VM's ambient types,
// which carry no Node builtins. This file is the bun side of that line:
// ambient declarations (a .d.ts, so they register instead of augmenting)
// for exactly the builtins the stub imports, at the shapes it uses.
declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean; dev: number; ino: number };
}

declare module "node:readline" {
  export interface Interface {
    on(event: "line", handler: (line: string) => void): void;
    on(event: "close", handler: () => void): void;
  }
  export function createInterface(options: { input: unknown }): Interface;
}
