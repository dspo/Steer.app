// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). Everything else is byte-identical to the pinned commit.
/**
 * Automation Commands — trigger discovery, manual execution, and run-history
 * loading.
 *
 * @module channels-automation/commands
 */

import type { BaseParams } from '../common/commands';
import type { URI } from '../common/state';
import type { AutomationRunState } from '../channels-automation-run/state';
import type { AgentInfo } from '../channels-root/state';
import type { AutomationSetAction } from './actions';
import type {
  AutomationDefinition,
  AutomationEntry,
  AutomationSessionTemplate,
  AutomationTriggerDefinition,
} from './state';

/**
 * Discover event-trigger types available for a prospective session template.
 *
 * Hosts may vary definitions by provider, workspace, and session
 * configuration. Schedule triggers are protocol-defined and therefore do not
 * appear in this result. The result describes current authoring and validation
 * choices. Saved {@link AutomationEventTrigger} values retain their selected
 * event descriptors for display but do not establish current availability.
 *
 * @category Commands
 * @method listAutomationTriggerDefinitions
 * @direction Client → Server
 * @messageType Request
 * @version 1
 */
export interface ListAutomationTriggerDefinitionsParams extends BaseParams {
  /** Trigger definitions are discovered from the root channel. */
  channel: 'ahp-root://';
  /** Prospective provider id matching {@link AgentInfo.provider}, or omitted for the host default. */
  provider?: string;
  /** Prospective {@link AutomationSessionTemplate.workingDirectories}. */
  workingDirectories?: URI[];
  /** Prospective resolved {@link AutomationSessionTemplate.config}. */
  sessionConfig?: Record<string, unknown>;
}

/**
 * Host-defined event trigger types available for the supplied context.
 *
 * @category Commands
 */
export interface ListAutomationTriggerDefinitionsResult {
  /** Available event trigger definitions. */
  items: AutomationTriggerDefinition[];
}

/**
 * Start a manual run of an automation.
 *
 * Manual execution is independent of {@link AutomationDefinition.enabled}.
 * The host persists the run before beginning session side effects.
 *
 * @category Commands
 * @method runAutomation
 * @direction Client → Server
 * @messageType Request
 * @version 1
 */
export interface RunAutomationParams extends BaseParams {
  /** Manual runs are scoped to the catalogue channel. */
  channel: 'ahp-automations://';
  /** Target {@link AutomationEntry.resource}. */
  automation: URI;
  /**
   * Durable client-generated idempotency key. Retrying with the same key and
   * automation MUST return the original run URI rather than create another
   * run.
   */
  requestId: string;
}

/**
 * Result identifying the existing or newly created run.
 *
 * @category Commands
 */
export interface RunAutomationResult {
  /** Subscribable `ahp-automation-run:` URI matching {@link AutomationRunState.resource}. */
  resource: URI;
}

/**
 * Load one older page into a catalogued automation's run-history state.
 *
 * The response only acknowledges the request. The updated full state arrives
 * through {@link AutomationSetAction | `automation/set`} on the
 * `ahp-automations://` channel, keeping all catalogue subscribers synchronized
 * through the normal action stream.
 *
 * @category Commands
 * @method fetchAutomationRuns
 * @direction Client → Server
 * @messageType Request
 * @version 1
 */
export interface FetchAutomationRunsParams extends BaseParams {
  /** Run-history loading is scoped to the catalogue channel. */
  channel: 'ahp-automations://';
  /** Target {@link AutomationEntry.resource}. */
  automation: URI;
  /**
   * Cursor previously received as {@link AutomationEntry.runsNextCursor}.
   * Omit to request the first page not already included by the snapshot.
   */
  cursor?: string;
}

/**
 * Empty acknowledgement; the updated automation state is delivered by action.
 *
 * @category Commands
 */
export interface FetchAutomationRunsResult {}
