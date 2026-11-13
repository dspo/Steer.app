import { Scroll, Text, token, View } from "nsh";
import { abortRun, loadSubagents, runs, selectedRunId, selectRun, transcript } from "./subagents";
import { refreshSessions, sessionHasName, sessionTitle, viewFor } from "./sessions";
import { setSessionPrefs } from "./acp/acp";
import { sessionIdOfSheet } from "./sheets";
import { visiblePanels } from "../../core/dock";
import { ChatView, MessageRow } from "./chat-view";
import { K, t } from "../../ui/i18n";
import { Chip, Dot, Glyph } from "../../ui/ui";
import type { SheetModule } from "../../../contracts/module";
import {
  createContainer,
  hydrateSession,
  hydrateVisible,
  openAuxSheet,
  rememberContainerSessions,
  openPath,
  sessionIdsOfContainer,
  startFromScratch,
  startInContainer,
} from "./container";
import { searchSessions } from "./search";

/** A subagent's status in the shell's language. */
function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return t(K.subagents.running);
    case "settled":
      return t(K.subagents.settled);
    case "failed":
      return t(K.subagents.failed);
    case "aborted":
      return t(K.subagents.aborted);
    default:
      return t(K.subagents.interrupted);
  }
}

/** The roster: live and settled runs, with a read-only transcript. */
export function SubagentsBody(props: { containerId: string }) {
  void loadSubagents(props.containerId);
  const selected = () => runs().find((run) => run.runId === selectedRunId());
  return (
    <View class="flex-1 flex-row bg-card">
      <View class="border-r border-line" style={{ width: 300 }}>
        <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
          <Glyph name="branch" size={13} tint={token("muted-foreground")} />
          <Text class="flex-1 text-[11px] text-muted-foreground">{t(K.subagents.count, { count: runs().length })}</Text>
          <Chip label={String(runs().length)} />
        </View>
        <Scroll style={{ flex: 1 }} contentStyle={{ paddingVertical: 4 }}>
          <If
            when={runs().length === 0}
            else={
              <Each of={runs()} key={(run) => run.runId}>
                {(run) => {
                  const value = run();
                  const active = value.runId === selectedRunId();
                  return (
                    <View
                      role="button"
                      testID={`subagent-run-${value.runId}`}
                      accessibilityLabel={`Subagent ${value.agent} ${value.runId}`}
                      class={active ? "bg-accent" : "hover:bg-hover"}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, gap: 2 }}
                      onPress={() => void selectRun(value.runId)}
                    >
                      <View class="flex-row items-center gap-1.5">
                        <Dot tint={token(value.status === "running" ? "info" : value.status === "settled" ? "up" : "destructive")} size={6} />
                        <Text class="text-[12px] font-medium text-foreground" style={{ flex: 1, numberOfLines: 1 }}>
                          {value.agent}
                        </Text>
                        <Text class="text-[10px] text-faint">{statusLabel(value.status)}</Text>
                      </View>
                      <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                        {value.task}
                      </Text>
                      <Text class="text-[10px] font-mono text-faint">{value.runId}</Text>
                    </View>
                  );
                }}
              </Each>
            }
          >
            <Text class="px-3 py-4 text-[11.5px] text-muted-foreground">{t(K.subagents.empty)}</Text>
          </If>
        </Scroll>
      </View>
      <View class="flex-1">
        <If
          when={!!selected()}
          else={
            <View class="flex-1 items-center justify-center gap-1">
              <Text class="text-[12px] text-muted-foreground">{t(K.subagents.transcript)}</Text>
            </View>
          }
        >
          <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
            <View style={{ flex: 1 }}>
              <Text class="text-[12px] font-semibold text-foreground">{`${selected()?.agent ?? ""} · ${selectedRunId() ?? ""}`}</Text>
              <Text class="text-[10.5px] text-muted-foreground" style={{ numberOfLines: 1 }}>
                {selected()?.task ?? ""}
              </Text>
            </View>
            <If when={selected()?.status === "running"}>
              <View
                role="button"
                testID="subagent-abort"
                accessibilityLabel={t(K.subagents.abort)}
                class="rounded-md border border-line px-2 py-1 hover:bg-hover"
                onPress={() => selectedRunId() && void abortRun(selectedRunId()!)}
              >
                <Text class="text-[11px] text-destructive">{t(K.subagents.abort)}</Text>
              </View>
            </If>
          </View>
          <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
            <Each of={transcript()} key="index">
              {(message) => (
                <MessageRow message={message} streaming={() => false} />
              )}
            </Each>
          </Scroll>
        </If>
      </View>
    </View>
  );
}

/**
 * The conversation sheet. A sheet that is not the displayed tab of its group
 * (or is behind a zoom) draws only a compact placeholder: its view keeps
 * updating in the store, but the Markdown tree and the composer are not
 * mounted until it is visible again.
 */
export function SessionBody(props: { id: string; sheetId: string }) {
  const view = () => viewFor(props.id);
  const visible = () => visiblePanels().includes(props.sheetId);
  return (
    <View class="flex-1 bg-background">
      <If when={!visible()}>
        <View class="flex-1 items-center justify-center gap-2 bg-background">
          <Glyph name="chat" size={20} tint={token("faint")} />
          <Text class="text-[12px] font-medium text-muted-foreground">{sessionTitle(props.id)}</Text>
          <Text class="text-[11px] text-faint">{t(K.session.hidden, { count: view()?.messages.length ?? 0 })}</Text>
        </View>
      </If>
      <If when={visible()}>
        <ChatView id={props.id} />
      </If>
    </View>
  );
}

/** The pi module's kinds. The module also owns the subagent roster and the
 * container operations (create, show, open a file, hydrate). */
export const piModule: SheetModule = {
  id: "pi",
  capabilities: ["acp", "state", "pimodels"],
  initialize: () => void refreshSessions(),
  onSheetActivated: (id) => {
    const sessionId = sessionIdOfSheet(id);
    if (sessionId) void hydrateSession(sessionId);
  },
  onContainerShown: (containerId) => {
    rememberContainerSessions(containerId);
    hydrateVisible();
  },
  search: (query) => searchSessions(query),
  intents: {
    "pi.create": (payload) => {
      const { cwd = null, projectId = null } = (payload ?? {}) as { cwd?: string | null; projectId?: string | null };
      return createContainer(cwd ?? undefined, projectId).then((id) => (id ? `session:${id}` : null));
    },
    "pi.submit": async (payload) => {
      const target = (payload ?? {}) as {
        text: string;
        cwd?: string | null;
        projectId?: string | null;
        containerId?: string | null;
        sheetId?: string;
        model?: string | null;
        effort?: string | null;
      };
      // The pi arm's pick rides the spawn env (ZU_PI_MODEL/ZU_PI_EFFORT).
      setSessionPrefs({ model: target.model ?? null, effort: target.effort ?? null });
      if (target.containerId) await startInContainer(target.containerId, target.text, target.sheetId);
      else await startFromScratch(target.text, { cwd: target.cwd ?? undefined, projectId: target.projectId ?? null });
      return null;
    },
    "pi.openPath": async (payload) => {
      const { path } = (payload ?? {}) as { path?: string };
      if (path) await openPath(path);
      return null;
    },
    "pi.subagents": (payload) => {
      const { containerId = null } = (payload ?? {}) as { containerId?: string | null };
      if (!containerId || sessionIdsOfContainer(containerId).length === 0) return null;
      openAuxSheet("subagents");
      return `subagents:${containerId}`;
    },
  },
  kinds: [
    {
      kind: "session",
      glyph: "chat",
      tint: "brand",
      title: (id) => {
        const sessionId = sessionIdOfSheet(id);
        return sessionId ? sessionTitle(sessionId) : t(K.sheet.sessionTitle);
      },
      body: ({ id }) => {
        const sessionId = sessionIdOfSheet(id);
        return <SessionBody id={sessionId ?? "pending"} sheetId={id} />;
      },
      parse: (id) => sessionIdOfSheet(id),
      namesContainer: (id) => {
        const sessionId = sessionIdOfSheet(id);
        return !!sessionId && sessionHasName(sessionId);
      },
    },
    {
      kind: "subagents",
      glyph: "branch",
      tint: "muted-foreground",
      title: () => t(K.subagents.title),
      body: ({ containerId }) => <SubagentsBody containerId={containerId ?? ""} />,
      parse: (id) => (id.startsWith("subagents:") ? id.slice("subagents:".length) : null),
    },
  ],
};
