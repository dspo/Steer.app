/**
 * Project trust, resolved the way the official CLI resolves it, with one
 * addition: when the answer is "ask" and an ACP client is attached, the
 * question is a standard `elicitation/create` form instead of a TUI prompt.
 *
 * Precedence (CLI `dist/core/project-trust.js`):
 *   1. no trust-requiring resources → the saved decision, else trusted
 *   2. a saved decision in `~/.pi/agent/trust.json`
 *   3. `defaultProjectTrust`: always / never / ask
 *   4. ask without a client → untrusted (the headless behavior)
 */

import { hasTrustRequiringProjectResources, ProjectTrustStore, SettingsManager } from "@earendil-works/pi-coding-agent";

/** One client question; structurally ACP's `elicitation/create` params. */
export type TrustElicit = (request: {
  mode: "form";
  sessionId: string;
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}) => Promise<{ action?: string; content?: Record<string, unknown> }>;

export type TrustSource = "no-resources" | "store" | "default" | "elicitation" | "no-ui";

export interface TrustDecision {
  /** The project has `.pi`/`.agents` resources that need a decision. */
  required: boolean;
  trusted: boolean;
  source: TrustSource;
}

export interface ResolveTrustOptions {
  cwd: string;
  agentDir: string;
  elicit?: TrustElicit;
  log?: (line: string) => void;
}

/**
 * Decides whether `cwd`'s project resources may load. An accepted prompt is
 * remembered in pi's own trust store, so the official CLI sees the same
 * decision; a declined prompt is session-only.
 */
export async function resolveProjectTrust(options: ResolveTrustOptions): Promise<TrustDecision> {
  const { cwd, agentDir, elicit, log } = options;
  const store = new ProjectTrustStore(agentDir);
  const required = hasTrustRequiringProjectResources(cwd);
  const saved = store.get(cwd);

  if (!required) {
    return { required: false, trusted: saved ?? true, source: saved === null ? "no-resources" : "store" };
  }
  if (saved !== null) {
    return { required: true, trusted: saved, source: "store" };
  }

  const bootstrap = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  const defaultTrust = bootstrap.getDefaultProjectTrust();
  if (defaultTrust === "always") return { required: true, trusted: true, source: "default" };
  if (defaultTrust === "never") return { required: true, trusted: false, source: "default" };

  if (!elicit) {
    log?.(`project ${cwd} needs trust; no client UI is attached, running untrusted`);
    return { required: true, trusted: false, source: "no-ui" };
  }

  try {
    const response = await elicit({
      // Trust is negotiated while `session/new` is still in flight; the
      // client's session id does not exist yet. The client dialog keys on
      // cwd, so an empty scope is honest rather than invented.
      mode: "form",
      sessionId: "",
      message: `Trust this project?\n\n${cwd}\n\nIts .pi settings, extensions, skills, packages and MCP servers will load.`,
      requestedSchema: {
        type: "object",
        properties: {
          trusted: {
            type: "boolean",
            title: "Trust this project",
            description: "Project-local resources can execute code and read credentials.",
          },
        },
        required: ["trusted"],
      },
    });
    const trusted = response.action === "accept" && response.content?.trusted === true;
    if (trusted) store.set(cwd, true);
    log?.(`project ${cwd} ${trusted ? "trusted" : "left untrusted"} by the client`);
    return { required: true, trusted, source: "elicitation" };
  } catch (failure) {
    log?.(`project trust question failed for ${cwd}: ${String(failure)}`);
    return { required: true, trusted: false, source: "no-ui" };
  }
}
