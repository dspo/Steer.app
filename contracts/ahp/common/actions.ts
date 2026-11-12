// Vendored from dspo's AHP spec checkout (microsoft/agent-host-protocol):
//   repo:    ~/projects/github/agent-host-protocol  (remote: https://github.com/microsoft/agent-host-protocol.git)
//   commit:  296b25e7b698a4a84a0ee5a28d9573e70048a0bf  (working tree clean at vendoring time)
//   spec:    v0.9.0 (clients/typescript package.json version), LAST_SYNCED_COMMIT file said 20c6b266 (not resolvable locally)
//   pin:     contracts/ahp/PIN.md — read it before syncing; do not edit these files by hand.
// The only transform applied at vendoring time: relative import specifiers lost
// their `.js` suffix (upstream ships ESM `.js` extensions; this app resolves
// extensionless TS). A second transform (contracts/ahp/enums-to-consts.py,
// see PIN.md) rewrites `export const enum` into const objects + unions +
// namespaces: the nsh bundler's oxc cannot transform TS enums. Everything
// else is byte-identical to the pinned commit.
/**
 * Common Action Types — `ActionEnvelope`, `ActionOrigin`, the central
 * `ActionType` enum, and the `StateAction` discriminated union over every
 * per-channel action declaration.
 *
 * @module common/actions
 */

import type { URI } from './state';

import type {
  RootAgentsChangedAction,
  RootActiveSessionsChangedAction,
  RootTerminalsChangedAction,
  RootConfigChangedAction,
} from '../channels-root/actions';

import type {
  SessionReadyAction,
  SessionCreationFailedAction,
  SessionChatAddedAction,
  SessionChatRemovedAction,
  SessionChatUpdatedAction,
  SessionDefaultChatChangedAction,
  SessionTitleChangedAction,
  SessionServerToolsChangedAction,
  SessionActiveClientSetAction,
  SessionActiveClientRemovedAction,
  SessionWorkingDirectorySetAction,
  SessionWorkingDirectoryRemovedAction,
  SessionWorkingDirectoryReplacedAction,
  SessionInputNeededSetAction,
  SessionInputNeededRemovedAction,
  SessionCustomizationsChangedAction,
  SessionCustomizationToggledAction,
  SessionCustomizationUpdatedAction,
  SessionCustomizationRemovedAction,
  SessionMcpServerStateChangedAction,
  SessionMcpServerStartRequestedAction,
  SessionMcpServerStopRequestedAction,
  SessionMcpServerBackgroundRequestedAction,
  SessionIsReadChangedAction,
  SessionIsArchivedChangedAction,
  SessionActivityChangedAction,
  SessionChangesetsChangedAction,
  SessionConfigChangedAction,
  SessionMetaChangedAction,
} from '../channels-session/actions';

import type {
  ChatTurnStartedAction,
  ChatDeltaAction,
  ChatResponsePartAction,
  ChatToolCallStartAction,
  ChatToolCallDeltaAction,
  ChatToolCallReadyAction,
  ChatToolCallConfirmedAction,
  ChatToolCallCompleteAction,
  ChatToolCallResultConfirmedAction,
  ChatToolCallContentChangedAction,
  ChatToolCallAuthRequiredAction,
  ChatToolCallAuthResolvedAction,
  ChatTurnCompleteAction,
  ChatTurnCancelledAction,
  ChatErrorAction,
  ChatTurnResumeAction,
  ChatActivityChangedAction,
  ChatChangesetsChangedAction,
  ChatWorkingDirectorySetAction,
  ChatWorkingDirectoryRemovedAction,
  ChatUsageAction,
  ChatReasoningAction,
  ChatPendingMessageSetAction,
  ChatPendingMessageRemovedAction,
  ChatQueuedMessagesReorderedAction,
  ChatDraftChangedAction,
  ChatIsArchivedChangedAction,
  ChatInputRequestedAction,
  ChatInputAnswerChangedAction,
  ChatInputCompletedAction,
  ChatTruncatedAction,
  ChatTurnsLoadedAction,
} from '../channels-chat/actions';

import type {
  ChangesetStatusChangedAction,
  ChangesetFileSetAction,
  ChangesetFileRemovedAction,
  ChangesetFilesReviewChangedAction,
  ChangesetContentChangedAction,
  ChangesetOperationsChangedAction,
  ChangesetOperationStatusChangedAction,
  ChangesetClearedAction,
} from '../channels-changeset/actions';

import type {
  AnnotationsSetAction,
  AnnotationsUpdatedAction,
  AnnotationsRemovedAction,
  AnnotationsEntrySetAction,
  AnnotationsEntryRemovedAction,
} from '../channels-annotations/actions';

import type {
  TerminalDataAction,
  TerminalInputAction,
  TerminalResizedAction,
  TerminalClaimedAction,
  TerminalTitleChangedAction,
  TerminalCwdChangedAction,
  TerminalExitedAction,
  TerminalClearedAction,
  TerminalCommandDetectionAvailableAction,
  TerminalCommandExecutedAction,
  TerminalCommandFinishedAction,
} from '../channels-terminal/actions';

import type {
  ResourceWatchChangedAction,
} from '../channels-resource-watch/actions';
import type {
  AutomationCreateRequestedAction,
  AutomationRemovedAction,
  AutomationSetAction,
  AutomationUpdateRequestedAction,
} from '../channels-automation/actions';
import type {
  AutomationRunLifecycleChangedAction,
  AutomationRunSessionSetAction,
  AutomationRunSessionRemovedAction,
  AutomationRunPrimarySessionChangedAction,
  AutomationRunCancelRequestedAction,
} from '../channels-automation-run/actions';

// ─── Action Type Enum ────────────────────────────────────────────────────────

/**
 * Discriminant values for all state actions.
 *
 * @category Actions
 * @nonexhaustive
 */
export const ActionType = {

  RootAgentsChanged: 'root/agentsChanged',
  RootActiveSessionsChanged: 'root/activeSessionsChanged',
  SessionReady: 'session/ready',
  SessionCreationFailed: 'session/creationFailed',
  SessionChatAdded: 'session/chatAdded',
  SessionChatRemoved: 'session/chatRemoved',
  SessionChatUpdated: 'session/chatUpdated',
  SessionDefaultChatChanged: 'session/defaultChatChanged',
  ChatTurnStarted: 'chat/turnStarted',
  ChatDelta: 'chat/delta',
  ChatResponsePart: 'chat/responsePart',
  ChatToolCallStart: 'chat/toolCallStart',
  ChatToolCallDelta: 'chat/toolCallDelta',
  ChatToolCallReady: 'chat/toolCallReady',
  ChatToolCallConfirmed: 'chat/toolCallConfirmed',
  ChatToolCallComplete: 'chat/toolCallComplete',
  ChatToolCallResultConfirmed: 'chat/toolCallResultConfirmed',
  ChatToolCallContentChanged: 'chat/toolCallContentChanged',
  ChatToolCallAuthRequired: 'chat/toolCallAuthRequired',
  ChatToolCallAuthResolved: 'chat/toolCallAuthResolved',
  ChatTurnComplete: 'chat/turnComplete',
  ChatTurnCancelled: 'chat/turnCancelled',
  ChatError: 'chat/error',
  ChatTurnResume: 'chat/turnResume',
  ChatActivityChanged: 'chat/activityChanged',
  ChatChangesetsChanged: 'chat/changesetsChanged',
  ChatWorkingDirectorySet: 'chat/workingDirectorySet',
  ChatWorkingDirectoryRemoved: 'chat/workingDirectoryRemoved',
  SessionTitleChanged: 'session/titleChanged',
  ChatUsage: 'chat/usage',
  ChatReasoning: 'chat/reasoning',
  SessionServerToolsChanged: 'session/serverToolsChanged',
  SessionActiveClientSet: 'session/activeClientSet',
  SessionActiveClientRemoved: 'session/activeClientRemoved',
  SessionWorkingDirectorySet: 'session/workingDirectorySet',
  SessionWorkingDirectoryRemoved: 'session/workingDirectoryRemoved',
  SessionWorkingDirectoryReplaced: 'session/workingDirectoryReplaced',
  SessionInputNeededSet: 'session/inputNeededSet',
  SessionInputNeededRemoved: 'session/inputNeededRemoved',
  ChatPendingMessageSet: 'chat/pendingMessageSet',
  ChatPendingMessageRemoved: 'chat/pendingMessageRemoved',
  ChatQueuedMessagesReordered: 'chat/queuedMessagesReordered',
  ChatDraftChanged: 'chat/draftChanged',
  ChatIsArchivedChanged: 'chat/isArchivedChanged',
  ChatInputRequested: 'chat/inputRequested',
  ChatInputAnswerChanged: 'chat/inputAnswerChanged',
  ChatInputCompleted: 'chat/inputCompleted',
  SessionCustomizationsChanged: 'session/customizationsChanged',
  SessionCustomizationToggled: 'session/customizationToggled',
  SessionCustomizationUpdated: 'session/customizationUpdated',
  SessionCustomizationRemoved: 'session/customizationRemoved',
  SessionMcpServerStateChanged: 'session/mcpServerStateChanged',
  SessionMcpServerStartRequested: 'session/mcpServerStartRequested',
  SessionMcpServerStopRequested: 'session/mcpServerStopRequested',
  SessionMcpServerBackgroundRequested: 'session/mcpServerBackgroundRequested',
  ChatTruncated: 'chat/truncated',
  ChatTurnsLoaded: 'chat/turnsLoaded',
  SessionIsReadChanged: 'session/isReadChanged',
  SessionIsArchivedChanged: 'session/isArchivedChanged',
  SessionActivityChanged: 'session/activityChanged',
  SessionChangesetsChanged: 'session/changesetsChanged',
  SessionConfigChanged: 'session/configChanged',
  SessionMetaChanged: 'session/metaChanged',
  ChangesetStatusChanged: 'changeset/statusChanged',
  ChangesetFileSet: 'changeset/fileSet',
  ChangesetFileRemoved: 'changeset/fileRemoved',
  ChangesetFilesReviewChanged: 'changeset/filesReviewChanged',
  ChangesetContentChanged: 'changeset/contentChanged',
  ChangesetOperationsChanged: 'changeset/operationsChanged',
  ChangesetOperationStatusChanged: 'changeset/operationStatusChanged',
  ChangesetCleared: 'changeset/cleared',
  AnnotationsSet: 'annotations/set',
  AnnotationsUpdated: 'annotations/updated',
  AnnotationsRemoved: 'annotations/removed',
  AnnotationsEntrySet: 'annotations/entrySet',
  AnnotationsEntryRemoved: 'annotations/entryRemoved',
  RootTerminalsChanged: 'root/terminalsChanged',
  RootConfigChanged: 'root/configChanged',
  TerminalData: 'terminal/data',
  TerminalInput: 'terminal/input',
  TerminalResized: 'terminal/resized',
  TerminalClaimed: 'terminal/claimed',
  TerminalTitleChanged: 'terminal/titleChanged',
  TerminalCwdChanged: 'terminal/cwdChanged',
  TerminalExited: 'terminal/exited',
  TerminalCleared: 'terminal/cleared',
  TerminalCommandDetectionAvailable: 'terminal/commandDetectionAvailable',
  TerminalCommandExecuted: 'terminal/commandExecuted',
  TerminalCommandFinished: 'terminal/commandFinished',
  ResourceWatchChanged: 'resourceWatch/changed',
  AutomationCreateRequested: 'automation/createRequested',
  AutomationUpdateRequested: 'automation/updateRequested',
  AutomationSet: 'automation/set',
  AutomationRemoved: 'automation/removed',
  AutomationRunLifecycleChanged: 'automationRun/lifecycleChanged',
  AutomationRunSessionSet: 'automationRun/sessionSet',
  AutomationRunSessionRemoved: 'automationRun/sessionRemoved',
  AutomationRunPrimarySessionChanged: 'automationRun/primarySessionChanged',
  AutomationRunCancelRequested: 'automationRun/cancelRequested',
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];
export namespace ActionType {
  export type RootAgentsChanged = (typeof ActionType)["RootAgentsChanged"];
  export type RootActiveSessionsChanged = (typeof ActionType)["RootActiveSessionsChanged"];
  export type SessionReady = (typeof ActionType)["SessionReady"];
  export type SessionCreationFailed = (typeof ActionType)["SessionCreationFailed"];
  export type SessionChatAdded = (typeof ActionType)["SessionChatAdded"];
  export type SessionChatRemoved = (typeof ActionType)["SessionChatRemoved"];
  export type SessionChatUpdated = (typeof ActionType)["SessionChatUpdated"];
  export type SessionDefaultChatChanged = (typeof ActionType)["SessionDefaultChatChanged"];
  export type ChatTurnStarted = (typeof ActionType)["ChatTurnStarted"];
  export type ChatDelta = (typeof ActionType)["ChatDelta"];
  export type ChatResponsePart = (typeof ActionType)["ChatResponsePart"];
  export type ChatToolCallStart = (typeof ActionType)["ChatToolCallStart"];
  export type ChatToolCallDelta = (typeof ActionType)["ChatToolCallDelta"];
  export type ChatToolCallReady = (typeof ActionType)["ChatToolCallReady"];
  export type ChatToolCallConfirmed = (typeof ActionType)["ChatToolCallConfirmed"];
  export type ChatToolCallComplete = (typeof ActionType)["ChatToolCallComplete"];
  export type ChatToolCallResultConfirmed = (typeof ActionType)["ChatToolCallResultConfirmed"];
  export type ChatToolCallContentChanged = (typeof ActionType)["ChatToolCallContentChanged"];
  export type ChatToolCallAuthRequired = (typeof ActionType)["ChatToolCallAuthRequired"];
  export type ChatToolCallAuthResolved = (typeof ActionType)["ChatToolCallAuthResolved"];
  export type ChatTurnComplete = (typeof ActionType)["ChatTurnComplete"];
  export type ChatTurnCancelled = (typeof ActionType)["ChatTurnCancelled"];
  export type ChatError = (typeof ActionType)["ChatError"];
  export type ChatTurnResume = (typeof ActionType)["ChatTurnResume"];
  export type ChatActivityChanged = (typeof ActionType)["ChatActivityChanged"];
  export type ChatChangesetsChanged = (typeof ActionType)["ChatChangesetsChanged"];
  export type ChatWorkingDirectorySet = (typeof ActionType)["ChatWorkingDirectorySet"];
  export type ChatWorkingDirectoryRemoved = (typeof ActionType)["ChatWorkingDirectoryRemoved"];
  export type SessionTitleChanged = (typeof ActionType)["SessionTitleChanged"];
  export type ChatUsage = (typeof ActionType)["ChatUsage"];
  export type ChatReasoning = (typeof ActionType)["ChatReasoning"];
  export type SessionServerToolsChanged = (typeof ActionType)["SessionServerToolsChanged"];
  export type SessionActiveClientSet = (typeof ActionType)["SessionActiveClientSet"];
  export type SessionActiveClientRemoved = (typeof ActionType)["SessionActiveClientRemoved"];
  export type SessionWorkingDirectorySet = (typeof ActionType)["SessionWorkingDirectorySet"];
  export type SessionWorkingDirectoryRemoved = (typeof ActionType)["SessionWorkingDirectoryRemoved"];
  export type SessionWorkingDirectoryReplaced = (typeof ActionType)["SessionWorkingDirectoryReplaced"];
  export type SessionInputNeededSet = (typeof ActionType)["SessionInputNeededSet"];
  export type SessionInputNeededRemoved = (typeof ActionType)["SessionInputNeededRemoved"];
  export type ChatPendingMessageSet = (typeof ActionType)["ChatPendingMessageSet"];
  export type ChatPendingMessageRemoved = (typeof ActionType)["ChatPendingMessageRemoved"];
  export type ChatQueuedMessagesReordered = (typeof ActionType)["ChatQueuedMessagesReordered"];
  export type ChatDraftChanged = (typeof ActionType)["ChatDraftChanged"];
  export type ChatIsArchivedChanged = (typeof ActionType)["ChatIsArchivedChanged"];
  export type ChatInputRequested = (typeof ActionType)["ChatInputRequested"];
  export type ChatInputAnswerChanged = (typeof ActionType)["ChatInputAnswerChanged"];
  export type ChatInputCompleted = (typeof ActionType)["ChatInputCompleted"];
  export type SessionCustomizationsChanged = (typeof ActionType)["SessionCustomizationsChanged"];
  export type SessionCustomizationToggled = (typeof ActionType)["SessionCustomizationToggled"];
  export type SessionCustomizationUpdated = (typeof ActionType)["SessionCustomizationUpdated"];
  export type SessionCustomizationRemoved = (typeof ActionType)["SessionCustomizationRemoved"];
  export type SessionMcpServerStateChanged = (typeof ActionType)["SessionMcpServerStateChanged"];
  export type SessionMcpServerStartRequested = (typeof ActionType)["SessionMcpServerStartRequested"];
  export type SessionMcpServerStopRequested = (typeof ActionType)["SessionMcpServerStopRequested"];
  export type SessionMcpServerBackgroundRequested = (typeof ActionType)["SessionMcpServerBackgroundRequested"];
  export type ChatTruncated = (typeof ActionType)["ChatTruncated"];
  export type ChatTurnsLoaded = (typeof ActionType)["ChatTurnsLoaded"];
  export type SessionIsReadChanged = (typeof ActionType)["SessionIsReadChanged"];
  export type SessionIsArchivedChanged = (typeof ActionType)["SessionIsArchivedChanged"];
  export type SessionActivityChanged = (typeof ActionType)["SessionActivityChanged"];
  export type SessionChangesetsChanged = (typeof ActionType)["SessionChangesetsChanged"];
  export type SessionConfigChanged = (typeof ActionType)["SessionConfigChanged"];
  export type SessionMetaChanged = (typeof ActionType)["SessionMetaChanged"];
  export type ChangesetStatusChanged = (typeof ActionType)["ChangesetStatusChanged"];
  export type ChangesetFileSet = (typeof ActionType)["ChangesetFileSet"];
  export type ChangesetFileRemoved = (typeof ActionType)["ChangesetFileRemoved"];
  export type ChangesetFilesReviewChanged = (typeof ActionType)["ChangesetFilesReviewChanged"];
  export type ChangesetContentChanged = (typeof ActionType)["ChangesetContentChanged"];
  export type ChangesetOperationsChanged = (typeof ActionType)["ChangesetOperationsChanged"];
  export type ChangesetOperationStatusChanged = (typeof ActionType)["ChangesetOperationStatusChanged"];
  export type ChangesetCleared = (typeof ActionType)["ChangesetCleared"];
  export type AnnotationsSet = (typeof ActionType)["AnnotationsSet"];
  export type AnnotationsUpdated = (typeof ActionType)["AnnotationsUpdated"];
  export type AnnotationsRemoved = (typeof ActionType)["AnnotationsRemoved"];
  export type AnnotationsEntrySet = (typeof ActionType)["AnnotationsEntrySet"];
  export type AnnotationsEntryRemoved = (typeof ActionType)["AnnotationsEntryRemoved"];
  export type RootTerminalsChanged = (typeof ActionType)["RootTerminalsChanged"];
  export type RootConfigChanged = (typeof ActionType)["RootConfigChanged"];
  export type TerminalData = (typeof ActionType)["TerminalData"];
  export type TerminalInput = (typeof ActionType)["TerminalInput"];
  export type TerminalResized = (typeof ActionType)["TerminalResized"];
  export type TerminalClaimed = (typeof ActionType)["TerminalClaimed"];
  export type TerminalTitleChanged = (typeof ActionType)["TerminalTitleChanged"];
  export type TerminalCwdChanged = (typeof ActionType)["TerminalCwdChanged"];
  export type TerminalExited = (typeof ActionType)["TerminalExited"];
  export type TerminalCleared = (typeof ActionType)["TerminalCleared"];
  export type TerminalCommandDetectionAvailable = (typeof ActionType)["TerminalCommandDetectionAvailable"];
  export type TerminalCommandExecuted = (typeof ActionType)["TerminalCommandExecuted"];
  export type TerminalCommandFinished = (typeof ActionType)["TerminalCommandFinished"];
  export type ResourceWatchChanged = (typeof ActionType)["ResourceWatchChanged"];
  export type AutomationCreateRequested = (typeof ActionType)["AutomationCreateRequested"];
  export type AutomationUpdateRequested = (typeof ActionType)["AutomationUpdateRequested"];
  export type AutomationSet = (typeof ActionType)["AutomationSet"];
  export type AutomationRemoved = (typeof ActionType)["AutomationRemoved"];
  export type AutomationRunLifecycleChanged = (typeof ActionType)["AutomationRunLifecycleChanged"];
  export type AutomationRunSessionSet = (typeof ActionType)["AutomationRunSessionSet"];
  export type AutomationRunSessionRemoved = (typeof ActionType)["AutomationRunSessionRemoved"];
  export type AutomationRunPrimarySessionChanged = (typeof ActionType)["AutomationRunPrimarySessionChanged"];
  export type AutomationRunCancelRequested = (typeof ActionType)["AutomationRunCancelRequested"];
}

// ─── Action Envelope ─────────────────────────────────────────────────────────

/**
 * Identifies the client that originally dispatched an action.
 */
export interface ActionOrigin {
  clientId: string;
  clientSeq: number;
}

/**
 * Every action is wrapped in an `ActionEnvelope`.
 *
 * The envelope identifies the channel the action belongs to (e.g.
 * `ahp-root://` for root actions, the session URI for session actions, the
 * terminal URI for terminal actions). Individual action payloads carry only
 * fields that are intrinsic to the action; the channel comes from the
 * envelope so that any subscribable resource can route its actions uniformly.
 */
export interface ActionEnvelope {
  /** Channel URI this action belongs to. */
  readonly channel: URI;
  readonly action: StateAction;
  readonly serverSeq: number;
  readonly origin: ActionOrigin | undefined;
  readonly rejectionReason?: string;
}

// ─── Discriminated Union ─────────────────────────────────────────────────────

/**
 * Discriminated union of all state actions.
 */
export type StateAction =
  | RootAgentsChangedAction
  | RootActiveSessionsChangedAction
  | RootTerminalsChangedAction
  | RootConfigChangedAction
  | SessionReadyAction
  | SessionCreationFailedAction
  | SessionChatAddedAction
  | SessionChatRemovedAction
  | SessionChatUpdatedAction
  | SessionDefaultChatChangedAction
  | SessionTitleChangedAction
  | SessionServerToolsChangedAction
  | SessionActiveClientSetAction
  | SessionActiveClientRemovedAction
  | SessionWorkingDirectorySetAction
  | SessionWorkingDirectoryRemovedAction
  | SessionWorkingDirectoryReplacedAction
  | SessionInputNeededSetAction
  | SessionInputNeededRemovedAction
  | SessionCustomizationsChangedAction
  | SessionCustomizationToggledAction
  | SessionCustomizationUpdatedAction
  | SessionCustomizationRemovedAction
  | SessionMcpServerStateChangedAction
  | SessionMcpServerStartRequestedAction
  | SessionMcpServerStopRequestedAction
  | SessionMcpServerBackgroundRequestedAction
  | SessionIsReadChangedAction
  | SessionIsArchivedChangedAction
  | SessionActivityChangedAction
  | SessionChangesetsChangedAction
  | SessionConfigChangedAction
  | SessionMetaChangedAction
  | ChatTurnStartedAction
  | ChatDeltaAction
  | ChatResponsePartAction
  | ChatToolCallStartAction
  | ChatToolCallDeltaAction
  | ChatToolCallReadyAction
  | ChatToolCallConfirmedAction
  | ChatToolCallCompleteAction
  | ChatToolCallResultConfirmedAction
  | ChatToolCallContentChangedAction
  | ChatToolCallAuthRequiredAction
  | ChatToolCallAuthResolvedAction
  | ChatTurnCompleteAction
  | ChatTurnCancelledAction
  | ChatErrorAction
  | ChatTurnResumeAction
  | ChatActivityChangedAction
  | ChatChangesetsChangedAction
  | ChatWorkingDirectorySetAction
  | ChatWorkingDirectoryRemovedAction
  | ChatUsageAction
  | ChatReasoningAction
  | ChatPendingMessageSetAction
  | ChatPendingMessageRemovedAction
  | ChatQueuedMessagesReorderedAction
  | ChatDraftChangedAction
  | ChatIsArchivedChangedAction
  | ChatInputRequestedAction
  | ChatInputAnswerChangedAction
  | ChatInputCompletedAction
  | ChatTruncatedAction
  | ChatTurnsLoadedAction
  | ChangesetStatusChangedAction
  | ChangesetFileSetAction
  | ChangesetFileRemovedAction
  | ChangesetFilesReviewChangedAction
  | ChangesetContentChangedAction
  | ChangesetOperationsChangedAction
  | ChangesetOperationStatusChangedAction
  | ChangesetClearedAction
  | AnnotationsSetAction
  | AnnotationsUpdatedAction
  | AnnotationsRemovedAction
  | AnnotationsEntrySetAction
  | AnnotationsEntryRemovedAction
  | TerminalDataAction
  | TerminalInputAction
  | TerminalResizedAction
  | TerminalClaimedAction
  | TerminalTitleChangedAction
  | TerminalCwdChangedAction
  | TerminalExitedAction
  | TerminalClearedAction
  | TerminalCommandDetectionAvailableAction
  | TerminalCommandExecutedAction
  | TerminalCommandFinishedAction
  | ResourceWatchChangedAction
  | AutomationCreateRequestedAction
  | AutomationUpdateRequestedAction
  | AutomationSetAction
  | AutomationRemovedAction
  | AutomationRunLifecycleChangedAction
  | AutomationRunSessionSetAction
  | AutomationRunSessionRemovedAction
  | AutomationRunPrimarySessionChangedAction
  | AutomationRunCancelRequestedAction;
