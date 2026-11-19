import { Scroll, Text, token, View, signal, effect, cleanup } from "nsh";
import { Input } from "nsh/base";
import { abortRun, loadSubagents, runs, selectedRunId, selectRun, transcript } from "./subagents";
import {
  addPlanTodo,
  loadPlan,
  openPlan,
  planFor,
  planError,
  planSheetId,
  promotePlanTodo,
  removePlanTodo,
  togglePlanTodo,
  PLAN_POLL_MS,
} from "./todos";
import { planGroupStatus, type PlanStatus, type PlanTodo } from "./protocol";
import { refreshSessions, releaseSession, sessionHasName, sessionTitle, viewFor } from "./sessions";
import { programTitle } from "./titles";
import { layoutSessions, sessionIdOfSheet } from "./sheets";
import { closeAllSessions } from "./acp/host";
import { activeContainerId, containers, layout } from "../../core/containers";
import { dispatchIntent } from "../../core/registry";
import { visiblePanels } from "../../core/dock";
import { baseName } from "../../domains/fs";
import { ChatView } from "./chat-view";
import { MessageRow } from "./subagent-row";
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
  newSessionInContainer,
  sessionIdsOfContainer,
} from "./container";
import { searchSessions } from "./search";
import { registerVisualizeCard } from "./visualize-card";

/** A subagent's status in the shell's language. */
function statusLabel(status: string): string {
  switch (status) {
    case "queued":
      return t(K.subagents.queued);
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

/** The toggle's 15pt circle: hollow, a blue dot while running, a green check puck when done. */
function PlanToggle(props: { id: string; status: PlanStatus; onToggle: () => void }) {
  return (
    <View
      role="button"
      testID={`plan-toggle-${props.id}`}
      accessibilityLabel={t(props.status === "done" ? K.plan.reopen : K.plan.complete)}
      class="h-[15px] w-[15px] items-center justify-center rounded-full border border-line hover:bg-hover"
      style={{ backgroundColor: props.status === "done" ? token("up") : "transparent" }}
      onPress={props.onToggle}
    >
      <If when={props.status === "done"}>
        <Glyph name="check" size={9} tint={token("background")} />
      </If>
      <If when={props.status === "in_progress"}>
        <Dot tint={token("info")} size={7} />
      </If>
    </View>
  );
}

/** One plan row: the toggle, the title, the quiet remove. */
function PlanItemRow(props: { sessionId: string; todo: PlanTodo; onPromote?: () => void }) {
  const todo = () => props.todo;
  return (
    <View
      testID={`plan-item-${todo().id}`}
      class="flex-row items-center gap-2 px-3 py-1"
      style={{ opacity: todo().status === "done" ? 0.75 : 1 }}
    >
      <PlanToggle
        id={todo().id}
        status={todo().status}
        onToggle={() => void togglePlanTodo(props.sessionId, todo().id, todo().status !== "done")}
      />
      <Text
        class={`flex-1 text-[12px] ${todo().status === "done" ? "text-muted-foreground" : "text-foreground"}`}
        style={{ numberOfLines: 1 }}
      >
        {todo().title}
      </Text>
      <If when={!!props.onPromote}>
        <View
          role="button"
          testID={`plan-promote-${todo().id}`}
          accessibilityLabel={t(K.plan.promote)}
          class="h-6 items-center justify-center rounded-lg border border-line px-2 hover:bg-hover active:opacity-70"
          onPress={props.onPromote}
        >
          <Text class="text-[10.5px] text-muted-foreground">{t(K.plan.promote)}</Text>
        </View>
      </If>
      <View
        role="button"
        testID={`plan-remove-${todo().id}`}
        accessibilityLabel={t(K.plan.remove)}
        class="h-6 w-6 items-center justify-center rounded-lg hover:bg-hover active:opacity-70"
        onPress={() => void removePlanTodo(props.sessionId, todo().id)}
      >
        <Glyph name="close" size={11} tint={token("faint")} />
      </View>
    </View>
  );
}

/**
 * The plan panel (`plan:{containerId}`): a single column over the
 * container's first session's shared TODO plan — loose drafts on top, then
 * one block per group. The panel edits through `_zu/todos/write` (the
 * harness steers the model on its side: notes, wakes, interrupts on
 * removal) and polls while mounted, because the model writes mid-turn and a
 * re-read is cheaper than a push channel.
 */
export function PlanBody(props: { containerId: string }) {
  const draft = signal("");
  // The plan belongs to the container's first session; the split-right entry
  // guarantees the banner that opens this panel sits on that same session.
  const sessionId = () => sessionIdsOfContainer(props.containerId)[0] ?? "";
  // The poll lives while the sheet is drawn; cleanup stops it when the
  // panel goes (hidden sheets render placeholders, so hidden = stopped).
  // Its first tick is the mount load — render bodies must stay read-only.
  effect(() => {
    const refresh = () => {
      if (visiblePanels().includes(planSheetId(props.containerId))) void loadPlan(props.containerId);
    };
    refresh();
    const timer = setInterval(refresh, PLAN_POLL_MS);
    cleanup(() => clearInterval(timer));
  });
  const current = () => planFor(sessionId());
  const submitDraft = () => {
    const title = draft().trim();
    if (!title) return;
    draft.set("");
    void addPlanTodo(sessionId(), title);
  };
  return (
    <View class="flex-1 bg-background">
      <View class="flex-row items-center gap-2 border-b border-line px-3 py-2">
        <View style={{ flex: 1, minWidth: 0 }}>
          <Input
            testID="plan-add-input"
            value={draft()}
            onChange={({ value }) => draft.set(value)}
            placeholder={t(K.plan.addPlaceholder)}
            style={{ minHeight: 0, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12 }}
          />
        </View>
        <View
          role="button"
          testID="plan-add"
          accessibilityLabel={t(K.plan.add)}
          class="h-7 items-center justify-center rounded-lg border border-line px-2.5 hover:bg-hover active:opacity-70"
          onPress={submitDraft}
        >
          <Text class="text-[11px] font-medium text-foreground">{t(K.plan.add)}</Text>
        </View>
      </View>
      <If when={!current()}>
        <View class="flex-1 items-center justify-center gap-1">
          <Text class="text-[12px] text-muted-foreground">{planError() ?? t(K.plan.empty)}</Text>
        </View>
      </If>
      <If when={!!current()}>
        <Scroll style={{ flex: 1 }} contentStyle={{ paddingVertical: 8 }}>
          <If when={current()!.todos.length === 0 && current()!.groups.length === 0}>
            <Text class="px-3 py-6 text-[11.5px] text-muted-foreground">{t(K.plan.empty)}</Text>
          </If>
          <If when={current()!.todos.length > 0}>
            <View class="px-3 pb-1">
              <Text class="text-[10.5px] font-medium uppercase text-faint">{t(K.plan.loose)}</Text>
            </View>
            <Each of={current()!.todos} key={(todo) => todo.id}>
              {(todo) => (
                <PlanItemRow
                  sessionId={sessionId()}
                  todo={todo()}
                  onPromote={() => void promotePlanTodo(sessionId(), todo().id)}
                />
              )}
            </Each>
          </If>
          <Each of={current()!.groups} key={(group) => group.id}>
            {(group) => {
              const status = () => planGroupStatus(group());
              return (
                <View testID={`plan-group-${group().id}`} class="mt-2">
                  <View class="flex-row items-center gap-2 border-b border-line px-3 pb-1 pt-2">
                    <Dot
                      tint={token(status() === "done" ? "up" : status() === "active" ? "info" : "faint")}
                      size={6}
                    />
                    <Text class="flex-1 text-[12px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
                      {group().title}
                    </Text>
                    <Text class="text-[10px] text-faint">
                      {t(
                        status() === "done" ? K.plan.groupDone : status() === "active" ? K.plan.groupActive : K.plan.groupPending,
                      )}
                    </Text>
                  </View>
                  <Each of={group().todos} key={(todo) => todo.id}>
                    {(todo) => <PlanItemRow sessionId={sessionId()} todo={todo()} />}
                  </Each>
                </View>
              );
            }}
          </Each>
        </Scroll>
      </If>
    </View>
  );
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
                        <Dot tint={token(value.status === "running" ? "info" : value.status === "settled" ? "up" : value.status === "queued" ? "faint" : "destructive")} size={6} />
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
          <Text class="text-[11px] text-faint">{t(K.session.hidden, { count: view()?.transcript.entries.length ?? 0 })}</Text>
        </View>
      </If>
      <If when={visible()}>
        <ChatView id={props.id} />
      </If>
    </View>
  );
}

/** Each container's open session sheets, so a closed tab closes its process
 * and an archived container closes all of them. */
const openByContainer = new Map<string, Set<string>>();

function releaseClosedSessions(): void {
  const containerId = activeContainerId();
  if (!containerId) return;
  // The notification's ids span every canvas now (the terminal module
  // reconciles globally). This ledger is per container — the archive path
  // releases everything filed under it — so the diff runs on the canvas
  // being shown; `layout` is already the edited one when a change notifies.
  const next = new Set(layoutSessions(layout()));
  const previous = openByContainer.get(containerId) ?? new Set<string>();
  for (const old of previous) {
    if (!next.has(old)) void releaseSession(old);
  }
  openByContainer.set(containerId, next);
}

/** The pi module's kinds. The module also owns the subagent roster and the
 * container operations (create, show, open a file, hydrate). */
/** The plan kind's title, with the folder suffix the other sheets share. */
function planSheetTitle(id: string): string {
  const container = containers().find((row) => row.id === id.slice("plan:".length));
  const folder = container ? baseName(container.cwd) : "";
  return folder ? `${t(K.sheet.planTitle)} · ${folder}` : t(K.sheet.planTitle);
}

export const piModule: SheetModule = {
  id: "pi",
  capabilities: ["acp", "state"],
  initialize: () => {
    registerVisualizeCard();
    // The restored layout asks for its visible sessions before the sidebar's
    // file scan has the path/cwd they need; hydrate again once it lands, or
    // the sheet keeps its title and draws an empty conversation.
    void refreshSessions().then(() => hydrateVisible());
  },
  onSheetActivated: (id) => {
    const sessionId = sessionIdOfSheet(id);
    if (sessionId) void hydrateSession(sessionId);
  },
  onContainerShown: (containerId) => {
    rememberContainerSessions(containerId);
    hydrateVisible();
  },
  onLayoutChanged: () => releaseClosedSessions(),
  onContainerArchive: (containerId) => {
    for (const sessionId of openByContainer.get(containerId) ?? []) void releaseSession(sessionId);
    openByContainer.delete(containerId);
  },
  onAppQuit: () => {
    void closeAllSessions();
  },
  search: (query) => searchSessions(query),
  intents: {
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
    "pi.plan": (payload) => {
      const { containerId = null } = (payload ?? {}) as { containerId?: string | null };
      const sessionId = containerId ? sessionIdsOfContainer(containerId)[0] : null;
      if (!sessionId) return null;
      openPlan(sessionId);
      return planSheetId(containerId!);
    },
  },
  launchers: [
    {
      id: "zu",
      label: () => "Zu",
      glyph: "chat",
      group: "conversation",
      order: 10,
      asksProject: true,
      instantiate: async (context) => {
        if (context.containerId) {
          await newSessionInContainer(context.containerId);
          return;
        }
        await createContainer(context.cwd ?? undefined, context.projectId);
      },
    },
    {
      id: "pi",
      label: () => t(K.external.pi),
      brand: "pi",
      group: "agent",
      order: 40,
      instantiate: async (context) => {
        if (context.containerId) {
          dispatchIntent(
            "terminal.open",
            { containerId: context.containerId, action: "Pi" },
            { containerId: context.containerId },
          );
          return;
        }
        await dispatchIntent(
          "terminal.createExternal",
          { action: "Pi", projectId: context.projectId, cwd: context.cwd },
          { containerId: null },
        );
      },
    },
  ],
  kinds: [
    {
      kind: "session",
      glyph: "chat",
      tint: "brand",
      title: (id) => {
        const sessionId = sessionIdOfSheet(id);
        return sessionId ? sessionTitle(sessionId) : t(K.sheet.sessionTitle);
      },
      // Issue #73: a tool's OSC title renames this session's tab and
      // nothing else — the container keeps the session's own name.
      tabTitle: (id) => {
        const sessionId = sessionIdOfSheet(id);
        return sessionId ? programTitle(sessionId) : "";
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
    {
      kind: "plan",
      glyph: "check",
      tint: "muted-foreground",
      title: (id) => planSheetTitle(id),
      body: ({ containerId }) => <PlanBody containerId={containerId ?? ""} />,
      parse: (id) => (id.startsWith("plan:") ? id.slice("plan:".length) : null),
    },
  ],
};
