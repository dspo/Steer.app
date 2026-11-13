/**
 * The ACP capability's typed face: the native harness process pump.
 *
 * Only `app/domains/` may import `zu/native` (docs/sheet-module-ARCHITECTURE.md
 * §5). The protocol client lives with the pi module; this file is the boundary.
 */
export { Acp } from "zu/native";
export type { AcpExit, AcpOptions } from "zu/native";
