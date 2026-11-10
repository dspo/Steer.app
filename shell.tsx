import { List, PanResponder, signal, Text, token, View } from "nsh";
import { DockArea, Menu, MenuItem, type DockAreaLayout } from "nsh/base";
import { connect, disconnect, info, lastError, phase, recovered, retry, type EnginePhase } from "./engine";
import {
  activeContainerId,
  archiveContainer,
  bindDock,
  containerCount,
  containerError,
  containerTitle,
  layout,
  liveContainers,
  loadContainers,
  onPanelActive,
  openPath,
  setLayout,
  setZoom,
  switchContainer,
} from "./containers";
import {
  containersIn,
  launcherOpen,
  loadProjects,
  moveContainer,
  openLauncher,
  projects,
  projectError,
} from "./projects";
import { Launcher, openProjectDialog, ProjectDialog } from "./launcher";
import { sheetCount } from "./dock";
import { error as sessionError, refreshSessions, sessions, activeId } from "./sessions";
import { SheetBody, sheetGlyph, sheetTitle } from "./sheets";
import { K, shellLocale, t, toggleShellLocale } from "./i18n";
import { UIHost, statuses, unsupportedMethods } from "./ui-host";
import { openSubagents } from "./subagents";
import { Chip, Dot, Glyph, Logo } from "./ui";

/**
 * Zu's shell: the engine's state, the container list, the session list, and
 * the canvas. A container owns one canvas and its layout stash; switching a
 * container saves the current DockArea tree, then restores the target's.
 *
 * The sidebar keeps M1's "all pi sessions on disk" list under the containers:
 * opening a row attaches that session to the active container (or switches
 * to the container that already holds it).
 */

/** Boots the engine and loads the registry; the app calls it once. */
export async function bootShell(): Promise<void> {
  await connect();
  if (phase() === "connected") {
    await loadContainers();
    await loadProjects();
  }
}

/** "now", "5m", "3h", "2d", then the date. */
function relative(at: number): string {
  if (!at) return "";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(at).toISOString().slice(0, 10);
}

/** The last two path segments: `dspo/manox-app`. */
function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

const PHASE_KEY: Record<EnginePhase, string> = {
  stopped: K.phase.stopped,
  starting: K.phase.starting,
  connected: K.phase.connected,
  recovering: K.phase.recovering,
  incompatible: K.phase.incompatible,
  error: K.phase.error,
};

const PHASE_TINT: Record<EnginePhase, string> = {
  stopped: "faint",
  starting: "warn",
  connected: "up",
  recovering: "warn",
  incompatible: "destructive",
  error: "destructive",
};

/** The edge rail: the app mark and the global panes (static in M3). */
function Rail() {
  const panes = [
    { id: "projects", glyph: "folder" as const, label: K.rail.projects },
    { id: "chats", glyph: "chat" as const, label: K.rail.chats },
    { id: "specs", glyph: "tree" as const, label: K.rail.specs },
    { id: "changes", glyph: "diff" as const, label: K.rail.changes },
    { id: "terminal", glyph: "terminal" as const, label: K.rail.terminal },
  ];
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 48, alignItems: "center", paddingTop: 12, paddingBottom: 12, gap: 4 }}>
      <View class="items-center justify-center rounded-[10px] bg-primary" style={{ width: 36, height: 36, marginBottom: 8 }}>
        <Logo size={34} />
      </View>
      <Each of={panes} key="index">
        {(pane, index) => (
          <View
            role="button"
            accessibilityLabel={t(pane().label)}
            class={index() === 1 ? "bg-accent" : ""}
            style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" }}
          >
            <Glyph name={pane().glyph} size={17} tint={index() === 1 ? token("foreground") : token("faint")} />
          </View>
        )}
      </Each>
    </View>
  );
}

const projectAnchors = new Map<string, any>();
const projectTops = new Map<string, number>();
const dragContainer = signal<string | null>(null);
const dragOver = signal<string | null>(null);

async function measureProjects(): Promise<void> {
  for (const [id, ref] of projectAnchors) {
    const measured = await ref?.measure();
    if (measured) projectTops.set(id, measured.pagePosition.y);
  }
}

function projectAt(pageY: number): string | null | undefined {
  const entries = [...projectTops.entries()]
    .filter(([, top]) => typeof top === "number")
    .sort((a, b) => a[1] - b[1]);
  let found: string | null | undefined;
  for (const [id, top] of entries) {
    if (pageY >= top - 8) found = id === "__chats" ? null : id;
  }
  return found;
}

/** One container row, under its project; membership moves by menu or drag. */
function ContainerRow(props: { container: any }) {
  const container = () => props.container;
  const active = () => container().id === activeContainerId();
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 8,
    onPanResponderGrant: () => {
      dragContainer.set(container().id);
      dragOver.set(null);
      void measureProjects();
    },
    onPanResponderMove: (event) => {
      dragOver.set(projectAt(event.pageY) ?? null);
    },
    onPanResponderRelease: (event) => {
      const target = projectAt(event.pageY);
      const id = dragContainer();
      dragContainer.set(null);
      dragOver.set(null);
      if (id && target !== undefined) void moveContainer(id, target);
    },
    onPanResponderTerminate: () => {
      dragContainer.set(null);
      dragOver.set(null);
    },
  });
  return (
    <View
      class={active() ? "bg-accent" : ""}
      style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 2, gap: 2 }}
    >
      <View
        role="button"
        accessibilityLabel={`Open container ${containerTitle(container())}`}
        class={dragContainer() === container().id ? "flex-1 rounded-md opacity-50" : "flex-1 rounded-md hover:bg-hover"}
        style={{ paddingVertical: 4, gap: 2 }}
        onPress={() => void switchContainer(container().id)}
        {...pan.panHandlers}
      >
        <Text style={{ fontSize: 12.5, fontWeight: active() ? "600" : "400", color: token("foreground"), numberOfLines: 1 }}>
          {containerTitle(container())}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 10.5, color: token("faint"), numberOfLines: 1 }}>{shortPath(container().cwd)}</Text>
          <Text style={{ fontSize: 10.5, color: token("faint") }}>
            {t(K.container.sessions, { count: container().sessions.length })}
          </Text>
        </View>
      </View>
      <Menu
        trigger={
          <View
            role="button"
            testID={`container-menu-${container().id}`}
            accessibilityLabel={t(K.project.move)}
            class="h-6 w-5 items-center justify-center rounded-md hover:bg-hover active:opacity-70"
          >
            <Glyph name="caret-down" size={11} tint={token("faint")} />
          </View>
        }
        popupClass="rounded-lg border border-line bg-card p-1"
      >
        <MenuItem class="rounded-md px-2 py-1.5 hover:bg-hover" onSelect={() => void moveContainer(container().id, null)}>
          <Text class="text-[12px] text-foreground">{t(K.project.chats)}</Text>
        </MenuItem>
        <Each of={projects()} key={(project) => project.id}>
          {(project) => (
            <MenuItem
              class="rounded-md px-2 py-1.5 hover:bg-hover"
              onSelect={() => void moveContainer(container().id, project().id)}
            >
              <Text class="text-[12px] text-foreground">{project().name}</Text>
            </MenuItem>
          )}
        </Each>
      </Menu>
      <View
        role="button"
        testID={`archive-${container().id}`}
        accessibilityLabel={`${t(K.container.archive)} ${containerTitle(container())}`}
        class="h-6 w-5 items-center justify-center rounded-md hover:bg-hover active:opacity-70"
        onPress={() => void archiveContainer(container().id)}
      >
        <Glyph name="archive" size={11} tint={token("faint")} />
      </View>
    </View>
  );
}

/** A project's header and its containers. */
function ProjectGroup(props: { projectId: string | null; name: string; roots?: number; onCreate?: () => void }) {
  const rows = () => containersIn(props.projectId);
  const key = props.projectId ?? "__chats";
  return (
    <View style={{ gap: 2, paddingBottom: 4 }}>
      <View
        ref={(ref) => projectAnchors.set(key, ref)}
        class={dragOver() === (props.projectId ?? null) && dragContainer() ? "bg-brand-tint" : ""}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 }}
      >
        <Glyph name={props.projectId === null ? "chat" : "folder"} size={13} tint={token("muted-foreground")} />
        <Text class="flex-1 text-[12px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
          {props.name}
        </Text>
        {props.roots !== undefined ? (
          <Text class="text-[10px] text-faint">{t(K.project.rootsCount, { count: props.roots })}</Text>
        ) : null}
        <If when={!!props.onCreate}>
          <View
            role="button"
            testID={`new-container-${props.projectId ?? "chats"}`}
            accessibilityLabel={t(K.container.create)}
            class="h-5 w-5 items-center justify-center rounded-md hover:bg-hover active:opacity-70"
            onPress={props.onCreate}
          >
            <Glyph name="plus" size={10} tint={token("faint")} />
          </View>
        </If>
      </View>
      <If
        when={rows().length === 0}
        else={
          <Each of={rows()} key={(row) => row.id}>
            {(row) => <ContainerRow container={row()} />}
          </Each>
        }
      >
        <Text class="px-3 pb-1 text-[10.5px] text-faint">{t(K.project.empty)}</Text>
      </If>
    </View>
  );
}

/** Project groups over a virtualized all-sessions list. */
function Sidebar() {
  const moved = () => projectError();
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 244 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: token("foreground") }}>{t(K.project.title)}</Text>
        <View
          role="button"
          testID="new-project"
          accessibilityLabel={t(K.project.create)}
          class="h-6 w-6 items-center justify-center rounded-md border border-line hover:bg-hover active:opacity-70"
          onPress={openProjectDialog}
        >
          <Glyph name="plus" size={11} tint={token("foreground")} />
        </View>
        <View
          role="button"
          testID="new-container"
          accessibilityLabel={t(K.container.create)}
          class="h-6 w-6 items-center justify-center rounded-md border border-line hover:bg-hover active:opacity-70"
          onPress={() => openLauncher(null)}
        >
          <Glyph name="chat" size={11} tint={token("foreground")} />
        </View>
      </View>

      <Each of={projects()} key={(project) => project.id}>
        {(project) => (
          <ProjectGroup
            projectId={project().id}
            name={project().name}
            roots={project().roots.length}
            onCreate={() => openLauncher(project().id, true)}
          />
        )}
      </Each>
      <ProjectGroup
        projectId={null}
        name={t(K.project.chats)}
        onCreate={() => openLauncher(null, true)}
      />

      <If when={!!moved()}>
        <Text class="px-3 py-1 text-[10.5px] text-destructive" style={{ numberOfLines: 1 }}>
          {moved() ?? ""}
        </Text>
      </If>

      <List
        testID="session-list"
        each={sessions()}
        keyExtractor={(row) => row.path}
        style={{ flex: 1 }}
        header={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, borderTopWidth: 1, borderColor: token("border") }}>
            <Glyph name="chat" size={13} tint={token("muted-foreground")} />
            <Text style={{ flex: 1, fontSize: 12, fontWeight: "600", color: token("foreground") }}>{t(K.sidebar.allSessions)}</Text>
            <Chip label={String(sessions().length)} />
            <View
              role="button"
              accessibilityLabel={t(K.engine.refresh)}
              class="h-6 w-6 items-center justify-center rounded-md hover:bg-hover active:opacity-70"
              onPress={() => void refreshSessions()}
            >
              <Glyph name="pulse" size={11} tint={token("faint")} />
            </View>
          </View>
        }
        empty={
          <View style={{ paddingHorizontal: 12, paddingVertical: 12 }}>
            <Text style={{ fontSize: 11.5, color: token("muted-foreground") }}>{t(K.sidebar.empty)}</Text>
          </View>
        }
      >
        {(row) => {
          const meta = row();
          const active = meta.id === activeId();
          return (
            <View
              role="button"
              accessibilityLabel={`Open ${meta.name || meta.preview || meta.id}`}
              class={active ? "bg-accent" : "hover:bg-hover"}
              style={{ paddingHorizontal: 12, paddingVertical: 6, gap: 2 }}
              onPress={() => void openPath(meta.path)}
            >
              <Text style={{ fontSize: 12, fontWeight: active ? "600" : "400", color: token("foreground"), numberOfLines: 1 }}>
                {meta.name || meta.preview || meta.id}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 10.5, color: token("faint"), numberOfLines: 1 }}>{shortPath(meta.cwd)}</Text>
                <View style={{ flex: 1 }} />
                <Text style={{ fontSize: 10.5, color: token("faint") }}>{`${meta.messageCount}`}</Text>
                <Text style={{ fontSize: 10.5, color: token("faint") }}>{relative(meta.modified)}</Text>
              </View>
            </View>
          );
        }}
      </List>
    </View>
  );
}

/** The engine's state as a chip, the extensions' status, and the actions that change it. */
function EngineBar() {
  return (
    <View class="flex-row items-center gap-2 border-b border-line bg-background px-3" style={{ height: 40 }}>
      <Dot tint={token(PHASE_TINT[phase()] as any)} size={7} />
      <Text class="text-[12px] font-medium text-foreground">{t(PHASE_KEY[phase()])}</Text>
      <If when={!!info()}>
        <Text class="text-[11px] text-faint">{`pi ${info()?.pi} · protocol ${info()?.protocol} · gen ${info()?.generation}`}</Text>
      </If>
      <If when={!!recovered()}>
        <Chip label={t(K.engine.recovered, { generation: recovered()?.to ?? 0 })} tint={token("up")} />
      </If>
      <Each of={Object.entries(statuses())} key={(entry) => entry[0]}>
        {(entry) => <Chip label={`${entry()[0]}: ${entry()[1]}`} />}
      </Each>
      <If when={phase() === "error" || phase() === "stopped" || phase() === "recovering" || phase() === "incompatible"}>
        <View
          role="button"
          accessibilityLabel={phase() === "recovering" ? t(K.engine.reconnect) : t(K.engine.retry)}
          class="h-6 items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-70"
          onPress={() => void (phase() === "stopped" ? bootShell() : retry())}
        >
          <Text class="text-[11px] font-medium text-foreground">
            {phase() === "recovering" ? t(K.engine.reconnect) : t(K.engine.retry)}
          </Text>
        </View>
      </If>
      <View style={{ flex: 1 }} />
      <If when={!!lastError()}>
        <Text class="text-[11px] text-destructive" style={{ numberOfLines: 1 }}>
          {lastError() ?? ""}
        </Text>
      </If>
      <View
        role="button"
        testID="language"
        accessibilityLabel={t(K.status.language)}
        class="h-6 min-w-8 items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-70"
        onPress={toggleShellLocale}
      >
        <Text class="text-[11px] font-medium text-muted-foreground">{shellLocale() === "zh-CN" ? "EN" : "中"}</Text>
      </View>
      <View
        role="button"
        testID="open-subagents"
        accessibilityLabel={t(K.subagents.title)}
        class="h-6 flex-row items-center gap-1 rounded-md border border-line px-2 hover:bg-hover active:opacity-70"
        onPress={openSubagents}
      >
        <Glyph name="branch" size={11} tint={token("muted-foreground")} />
        <Text class="text-[11px] font-medium text-muted-foreground">{t(K.subagents.title)}</Text>
      </View>
      <If when={phase() === "connected" || phase() === "starting" || phase() === "recovering"}>
        <View
          role="button"
          testID="engine-stop"
          accessibilityLabel={t(K.engine.stop)}
          class="h-6 items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-70"
          onPress={() => void disconnect()}
        >
          <Text class="text-[11px] font-medium text-muted-foreground">{t(K.engine.stop)}</Text>
        </View>
      </If>
      <View
        role="button"
        accessibilityLabel={t(K.engine.refresh)}
        class="h-6 items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-70"
        onPress={() => void refreshSessions()}
      >
        <Text class="text-[11px] font-medium text-muted-foreground">{t(K.engine.refresh)}</Text>
      </View>
    </View>
  );
}

/** The workbench: rail · containers/sessions · canvas (no boot side effects). */
export function Workbench() {
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "row" }}>
      <Rail />
      <Sidebar />
      <View class="flex-1 bg-inset" style={{ flexDirection: "column" }}>
        <EngineBar />
        <If when={launcherOpen() || activeContainerId() === null}>
          <Launcher />
        </If>
        <If when={!(launcherOpen() || activeContainerId() === null)}>
        <DockArea
          ref={(ref) => bindDock(ref)}
          class="flex-1"
          layout={layout()}
          onLayoutChange={({ layout: next }) => setLayout(next)}
          onZoomChange={({ panel }) => setZoom(panel)}
          onPanelActiveChange={({ panel, active }) => onPanelActive(panel, active)}
          groupClass="flex-1 border border-line bg-card"
          tabBarClass="flex-row gap-0.5 border-b border-line px-1 pt-1"
          tabClass="group"
          contentClass="flex-1"
          handleClass="basis-px bg-line"
          dropIndicatorClass="rounded-lg border-2 border-brand bg-brand-tint"
          renderTab={(tab) => (
            <View class="relative h-9 flex-row items-center gap-1.5 px-3">
              <Glyph name={sheetGlyph(tab.panel)} size={12} tint={tab.active ? token("foreground") : token("faint")} />
              <Text
                class={`max-w-44 text-[13px] font-medium ${tab.active ? "text-foreground" : "text-muted-foreground"}`}
                style={{ numberOfLines: 1 }}
              >
                {sheetTitle(tab.panel)}
              </Text>
              {tab.active ? (
                <View class="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-primary" style={{ pointerEvents: "none" }} />
              ) : null}
            </View>
          )}
          renderPanel={(panel) => <SheetBody id={panel.id} />}
          renderEmpty={() => (
            <View class="flex-1 items-center justify-center gap-1 bg-card">
              <Text class="text-sm font-semibold text-foreground">{t(K.canvas.emptyTitle)}</Text>
              <Text class="text-xs text-muted-foreground">{t(K.canvas.emptyNote)}</Text>
            </View>
          )}
        />
        </If>
        <View class="flex-row items-center gap-4 border-t border-line bg-background px-3" style={{ height: 26 }}>
          <Text class="text-[11px] tabular-nums text-faint">{t(K.status.sheets, { count: sheetCount(layout()) })}</Text>
          <Text class="text-[11px] text-faint">{t(K.status.containers, { count: containerCount() })}</Text>
          <Text class="text-[11px] text-faint">{t(K.status.sessions, { count: sessions().length })}</Text>
          <If when={unsupportedMethods().length > 0}>
            <Text class="text-[11px] text-warn">{t(K.status.unsupported, { count: unsupportedMethods().length })}</Text>
          </If>
          <View style={{ flex: 1 }} />
          <If when={!!(sessionError() ?? containerError() ?? projectError())}>
            <Text class="text-[11px] text-destructive" style={{ numberOfLines: 1 }}>
              {sessionError() ?? containerError() ?? projectError() ?? ""}
            </Text>
          </If>
          <Text class="text-[11px] text-faint">{t(K.status.hint)}</Text>
        </View>
      </View>
      <UIHost />
      <ProjectDialog />
    </View>
  );
}
