/**
 * One Pi runtime, assembled the way the official CLI assembles it.
 *
 * `createAgentSessionServices` owns the order that matters: settings →
 * resource loader (with the trust resolver) → extension provider
 * registrations → model refresh. We supply the one process-wide
 * `ModelRuntime` (so every session and subagent shares auth/model state) and
 * the official built-in factories.
 *
 * `zu` extensions (permission gate, dispatch) are inline factories appended
 * after the built-ins, exactly where the CLI puts caller-supplied factories.
 */

import { join } from "node:path";
import {
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SettingsManager,
  type AgentSessionServices,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { acpMcpExtension, type AcpMcpServer } from "./mcp";
import { OFFICIAL_BUILTIN_EXTENSIONS } from "./official";
import { resolveProjectTrust, type TrustElicit } from "./trust";

export interface PiServicesOptions {
  cwd: string;
  /** Defaults to `getAgentDir()`; explicit for tests and subagents. */
  agentDir?: string;
  /** Zu factories: the permission gate, dispatch, or a fixture. */
  extensionFactories?: InlineExtension[];
  /** ACP `session/new` servers (captain only; subagents have none). */
  mcpServers?: AcpMcpServer[];
  /** Known trust for a child session; when absent, trust is resolved. */
  trusted?: boolean;
  elicit?: TrustElicit;
  noExtensions?: boolean;
  additionalExtensionPaths?: string[];
  appendSystemPrompt?: string[];
  log?: (line: string) => void;
}

export interface PiServicesResult {
  services: AgentSessionServices;
  trusted: boolean;
  agentDir: string;
}

const runtimes = new Map<string, Promise<ModelRuntime | undefined>>();

/**
 * One ModelRuntime per agent dir for the process. Failure is logged and the
 * session falls back to the SDK's default runtime rather than refusing to
 * start: a model directory problem is not a process-level failure.
 */
export function sharedModelRuntime(agentDir: string, log: (line: string) => void = () => {}): Promise<ModelRuntime | undefined> {
  const existing = runtimes.get(agentDir);
  if (existing) return existing;
  const created = ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
  }).catch((failure: unknown) => {
    log(`model runtime unavailable: ${String(failure)}`);
    return undefined;
  });
  runtimes.set(agentDir, created);
  return created;
}

/** Builds the services one captain or subagent session runs on. */
export async function createPiServices(options: PiServicesOptions): Promise<PiServicesResult> {
  const agentDir = options.agentDir ?? getAgentDir();
  const log = options.log ?? (() => {});
  const settingsManager = SettingsManager.create(options.cwd, agentDir, {
    projectTrusted: options.trusted ?? false,
  });
  const modelRuntime = await sharedModelRuntime(agentDir, log);

  const extensionFactories: InlineExtension[] = [
    ...OFFICIAL_BUILTIN_EXTENSIONS,
    ...(options.extensionFactories ?? []),
    ...(options.mcpServers && options.mcpServers.length > 0
      ? [acpMcpExtension(options.mcpServers, log)]
      : []),
  ];

  const services = await createAgentSessionServices({
    cwd: options.cwd,
    agentDir,
    settingsManager,
    ...(modelRuntime ? { modelRuntime } : {}),
    resourceLoaderOptions: {
      extensionFactories,
      ...(options.noExtensions ? { noExtensions: true } : {}),
      ...(options.additionalExtensionPaths && options.additionalExtensionPaths.length > 0
        ? { additionalExtensionPaths: options.additionalExtensionPaths }
        : {}),
      ...(options.appendSystemPrompt && options.appendSystemPrompt.length > 0
        ? { appendSystemPrompt: options.appendSystemPrompt }
        : {}),
    },
    // A child session receives its captain's decision and must not ask again.
    ...(options.trusted === undefined
      ? {
          resourceLoaderReloadOptions: {
            resolveProjectTrust: async ({ extensionsResult }) =>
              (await resolveProjectTrust({
                cwd: options.cwd,
                agentDir,
                extensionsResult,
                ...(options.elicit ? { elicit: options.elicit } : {}),
                log,
              })).trusted,
          },
        }
      : {}),
  });

  for (const diagnostic of services.diagnostics) {
    log(`${diagnostic.type}: ${diagnostic.message}`);
  }
  return {
    services,
    trusted: services.settingsManager.isProjectTrusted(),
    agentDir,
  };
}
