import { keymap, List, PanResponder, signal, Text, token, View } from "nsh";
import { DockArea, Menu, MenuItem, type DockAreaLayout } from "nsh/base";
import { Window } from "nsh/desktop";
import { connect, disconnect, info, lastError, phase, recovered, retry, type EnginePhase } from "./engine";
import {
  activeContainerId,
  archiveContainer,
  bindDock,
  containerCount,
  containerError,
  containerTitle,
  containers,
  layout,
  liveContainers,
  loadContainers,
  onPanelActive,
  openFilesSheet,
  openPath,
  setLayout,
  setZoom,
  switchContainer,
} from "./containers";
import {
  containerProject,
  containersIn,
  launcherOpen,
  loadProjects,
  moveContainer,
  openLauncher,
  projects,
  projectError,
} from "./projects";
import { Launcher, openProjectDialog, ProjectDialog } from "./launcher";
import { panelIds, sheetCount } from "./dock";
import { error as sessionError, refreshSessions, sessions, activeId } from "./sessions";
import { SheetBody, sheetGlyph, sheetTitle } from "./sheets";
import { externalKindLabel } from "./terminals";
import { saveActiveEditor } from "./editors";
import { K, shellLocale, t, toggleShellLocale } from "./i18n";
import { UIHost, statuses, unsupportedMethods } from "./ui-host";
import { openSubagents } from "./subagents";
import { Chip, Dot, Glyph, motionStyle, shadowCard, shadowRaised } from "./ui";

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

/** A small count in the brand tint, as Steer shows project membership. */
function CountBadge(props: { value: string }) {
  return (
    <View class="items-center justify-center rounded-full bg-brand-tint" style={{ minWidth: 18, height: 18, paddingHorizontal: 5 }}>
      <Text style={{ fontSize: 10, fontWeight: "600", color: token("brand") }}>{props.value}</Text>
    </View>
  );
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
      class={active() ? "group bg-card" : "group hover:bg-hover"}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        marginHorizontal: 8,
        marginVertical: 1,
        paddingVertical: 7,
        paddingLeft: 9,
        paddingRight: 6,
        borderRadius: 10,
        backgroundColor: active() ? token("card") : "transparent",
        boxShadow: active() ? shadowCard() : "none",
        ...motionStyle("medium"),
      }}
    >
      <View
        role="button"
        accessibilityLabel={`Open container ${containerTitle(container())}`}
        class={dragContainer() === container().id ? "flex-1 rounded-lg opacity-50" : "flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 active:bg-accent/60"}
        style={{ paddingVertical: 1, gap: 2 }}
        onPress={() => void switchContainer(container().id)}
        {...pan.panHandlers}
      >
        <Text style={{ fontSize: 13, fontWeight: active() ? "600" : "400", color: token("foreground"), numberOfLines: 1 }}>
          {containerTitle(container())}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 10.5, color: token("faint"), numberOfLines: 1 }}>{shortPath(container().cwd)}</Text>
          <Text style={{ fontSize: 10.5, color: token("faint") }}>
            {container().kind === "Pi"
              ? t(K.container.sessions, { count: container().sessions.length })
              : externalKindLabel(container().kind)}
          </Text>
        </View>
      </View>
      <View class="opacity-0 group-hover:opacity-100 focus-within:opacity-100 flex-row items-center" style={{ ...motionStyle("fast") }}>
        <Menu
          trigger={
            <View
              role="button"
              testID={`container-menu-${container().id}`}
              accessibilityLabel={t(K.project.move)}
              class="h-6 w-5 items-center justify-center rounded-lg hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            >
              <Glyph name="caret-down" size={11} tint={token("faint")} />
            </View>
          }
          popupClass="rounded-xl border border-border bg-popover p-1"
          popupStyle={{ boxShadow: shadowRaised() }}
        >
          <MenuItem class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => void moveContainer(container().id, null)}>
            <Text class="text-[12px] text-foreground">{t(K.project.chats)}</Text>
          </MenuItem>
          <Each of={projects()} key={(project) => project.id}>
            {(project) => (
              <MenuItem
                class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
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
          class="h-6 w-5 items-center justify-center rounded-lg hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          onPress={() => void archiveContainer(container().id)}
        >
          <Glyph name="archive" size={11} tint={token("faint")} />
        </View>
      </View>
    </View>
  );
}

/** A project's header and its containers. */
function ProjectGroup(props: { projectId: string | null; name: string; roots?: number; onCreate?: () => void }) {
  const rows = () => containersIn(props.projectId);
  const key = props.projectId ?? "__chats";
  return (
    <View style={{ gap: 1, paddingBottom: 2 }}>
      <View
        ref={(ref) => projectAnchors.set(key, ref)}
        class={dragOver() === (props.projectId ?? null) && dragContainer() ? "bg-brand-tint" : ""}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 8, paddingHorizontal: 4, height: 30, borderRadius: 8, ...motionStyle("fast") }}
      >
        <Glyph name={props.projectId === null ? "chat" : "folder"} size={14} tint={token("muted-foreground")} />
        <Text class="flex-1 text-[13px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
          {props.name}
        </Text>
        {props.roots !== undefined ? <CountBadge value={String(rows().length)} /> : null}
        <If when={!!props.onCreate}>
          <View
            role="button"
            testID={`new-container-${props.projectId ?? "chats"}`}
            accessibilityLabel={t(K.container.create)}
            class="h-6 w-6 items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            onPress={props.onCreate}
          >
            <Glyph name="plus" size={11} tint={token("faint")} />
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
  const titleBar = () => {
    try {
      return Window.get("main")?.titleBar() ?? { height: 0, left: 0, right: 0 };
    } catch {
      return { height: 0, left: 0, right: 0 };
    }
  };
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 232 }}>
      <View desktop={{ windowDrag: true }} style={{ height: Math.max(titleBar().height + 8, 8) }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 2, paddingBottom: 8, height: 40 }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: "600", color: token("foreground") }}>{t(K.sidebar.title)}</Text>
        <View
          role="button"
          testID="new-container"
          accessibilityLabel={t(K.container.create)}
          class="h-7 flex-row items-center gap-1 rounded-lg border border-line bg-card px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={() => openLauncher(null)}
        >
          <Glyph name="plus" size={11} tint={token("foreground")} />
          <Text class="text-[11px] font-medium text-foreground">{t(K.sidebar.new)}</Text>
        </View>
        <View
          role="button"
          testID="new-project"
          accessibilityLabel={t(K.project.create)}
          class="h-7 w-7 items-center justify-center rounded-lg hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={openProjectDialog}
        >
          <Glyph name="folder" size={14} tint={token("muted-foreground")} />
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
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderColor: token("line") }}>
            <Text style={{ flex: 1, fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: token("faint") }}>{t(K.sidebar.allSessions)}</Text>
            <Text style={{ fontSize: 10.5, color: token("faint") }}>{String(sessions().length)}</Text>
            <View
              role="button"
              accessibilityLabel={t(K.engine.refresh)}
              class="h-6 w-6 items-center justify-center rounded-lg hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
              style={{ ...motionStyle("fast") }}
              onPress={() => void refreshSessions()}
            >
              <Glyph name="pulse" size={11} tint={token("faint")} />
            </View>
          </View>
        }
        empty={
          <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
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
              class={active ? "bg-card active:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1" : "hover:bg-hover active:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"}
              style={{
                marginHorizontal: 8,
                marginVertical: 1,
                paddingHorizontal: 7,
                paddingVertical: 6,
                borderRadius: 10,
                gap: 2,
                boxShadow: active ? shadowCard() : "none",
                ...motionStyle("medium"),
              }}
              onPress={() => void openPath(meta.path)}
            >
              <Text style={{ fontSize: 12.5, fontWeight: active ? "600" : "400", color: token("foreground"), numberOfLines: 1 }}>
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

/** The top bar: the active workspace on the left, quiet engine controls on the right. */
function EngineBar() {
  const activeContainer = () => liveContainers().find((row) => row.id === activeContainerId());
  const activeProject = () => {
    const container = activeContainer();
    if (!container) return null;
    const project = containerProject(container);
    return project ? projects().find((row) => row.id === project) ?? null : null;
  };
  const title = () => (activeContainer() ? containerTitle(activeContainer()!) : "Zu");
  const subtitle = () => {
    const project = activeProject();
    const container = activeContainer();
    if (project && container) return `${project.name} · ${shortPath(container.cwd)}`;
    return container ? shortPath(container.cwd) : t(K.engine.start);
  };
  return (
    <View
      class="flex-row items-center gap-2 border-b border-line bg-background pl-4 pr-3"
      style={{ height: 48 }}
      desktop={{ windowDrag: true }}
    >
      <View class="min-w-0" style={{ flex: 1, gap: 1 }}>
        <Text style={{ fontSize: 13.5, fontWeight: "600", color: token("foreground"), numberOfLines: 1 }}>{title()}</Text>
        <Text style={{ fontSize: 10.5, color: token("faint"), numberOfLines: 1 }}>{subtitle()}</Text>
      </View>
      <If when={!!recovered()}>
        <Chip label={t(K.engine.recovered, { generation: recovered()?.to ?? 0 })} tint={token("up")} />
      </If>
      <Each of={Object.entries(statuses())} key={(entry) => entry[0]}>
        {(entry) => <Text style={{ fontSize: 10.5, color: token("faint") }}>{`${entry()[0]}: ${entry()[1]}`}</Text>}
      </Each>
      <If when={phase() !== "connected"}>
        <View
          role="button"
          accessibilityLabel={phase() === "recovering" ? t(K.engine.reconnect) : t(K.engine.retry)}
          class="h-7 items-center justify-center rounded-lg border border-line px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={() => void (phase() === "stopped" ? bootShell() : retry())}
        >
          <Text class="text-[11px] font-medium text-foreground">
            {phase() === "recovering" ? t(K.engine.reconnect) : t(K.engine.retry)}
          </Text>
        </View>
      </If>
      <View
        role="button"
        testID="open-files"
        accessibilityLabel={t(K.files.title)}
        tooltip={t(K.files.title)}
        disabled={activeContainerId() === null}
        class={
          activeContainerId() === null
            ? "h-7 w-7 items-center justify-center rounded-lg opacity-40"
            : "h-7 w-7 items-center justify-center rounded-lg hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        }
        style={{ ...motionStyle("fast") }}
        onPress={() => openFilesSheet()}
      >
        <Glyph name="folder" size={15} tint={token("muted-foreground")} />
      </View>
      <View
        role="button"
        testID="open-subagents"
        accessibilityLabel={t(K.subagents.title)}
        tooltip={t(K.subagents.title)}
        class="h-7 w-7 items-center justify-center rounded-lg hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        style={{ ...motionStyle("fast") }}
        onPress={openSubagents}
      >
        <Glyph name="branch" size={15} tint={token("muted-foreground")} />
      </View>
      <View
        role="button"
        testID="engine-refresh"
        accessibilityLabel={t(K.engine.refresh)}
        tooltip={t(K.engine.refresh)}
        class="h-7 w-7 items-center justify-center rounded-lg hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        style={{ ...motionStyle("fast") }}
        onPress={() => void refreshSessions()}
      >
        <Glyph name="pulse" size={15} tint={token("muted-foreground")} />
      </View>
      <If when={phase() === "connected" || phase() === "starting" || phase() === "recovering"}>
        <View
          role="button"
          testID="engine-stop"
          accessibilityLabel={t(K.engine.stop)}
          tooltip={t(K.engine.stop)}
          class="h-7 w-7 items-center justify-center rounded-lg hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={() => void disconnect()}
        >
          <Glyph name="stop" size={13} tint={token("muted-foreground")} />
        </View>
      </If>
      <View
        role="button"
        testID="language"
        accessibilityLabel={t(K.status.language)}
        class="h-7 min-w-8 items-center justify-center rounded-lg hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        style={{ ...motionStyle("fast") }}
        onPress={toggleShellLocale}
      >
        <Text class="text-[11px] font-medium text-muted-foreground">{shellLocale() === "zh-CN" ? "EN" : "中"}</Text>
      </View>
      <View class="flex-row items-center gap-1.5 rounded-full border border-line px-2" style={{ height: 24 }}>
        <Dot tint={token(PHASE_TINT[phase()] as any)} size={6} />
        <Text class="text-[10.5px] font-medium text-muted-foreground">{t(PHASE_KEY[phase()])}</Text>
      </View>
    </View>
  );
}

/**
 * An external container is its terminal: closing that sheet would leave a
 * container with no way back, so its tab is not closable. Archive the
 * container instead (which kills the PTY).
 */
function terminalPanels(): Array<{ id: string; closable: boolean }> {
  return panelIds(layout())
    .filter((id) => id.startsWith("terminal:"))
    .map((id) => ({ id, closable: false }));
}

/** The workbench: containers/sessions sidebar · canvas (no boot side effects). */
export function Workbench() {
  // The app's Mod+S saves the editor sheet on screen; a binding made while a
  // component renders goes with the component, and the workbench lives as
  // long as the app.
  keymap.bind("mod+s", () => saveActiveEditor());
  const empty = () => launcherOpen() || activeContainerId() === null;
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "row" }}>
      <Sidebar />
      <View class="flex-1 bg-background" style={{ flexDirection: "column" }}>
        <EngineBar />
        <If when={empty()}>
          <Launcher />
        </If>
        <If when={!empty()}>
          <DockArea
            ref={(ref) => bindDock(ref)}
            class="flex-1"
            layout={layout()}
            panels={terminalPanels()}
            onLayoutChange={({ layout: next }) => setLayout(next)}
            onZoomChange={({ panel }) => setZoom(panel)}
            onPanelActiveChange={({ panel, active }) => onPanelActive(panel, active)}
            groupClass="flex-1 bg-background"
            tabBarClass="flex-row items-end gap-0.5 border-b border-line bg-inset px-2"
            tabBarStyle={{ height: 34 }}
            tabClass="group focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-1px] active:opacity-80"
            contentClass="flex-1 bg-background"
            handleClass="basis-px bg-line"
            dropIndicatorClass="rounded-lg border-2 border-brand bg-brand-tint"
            renderTab={(tab) => (
              <View
                class={`relative h-8 flex-row items-center gap-1.5 rounded-lg px-2.5 ${tab.active ? "bg-card" : "hover:bg-hover"}`}
                style={{
                  borderRadius: 8,
                  backgroundColor: tab.active ? token("card") : "transparent",
                  boxShadow: tab.active ? shadowCard() : "none",
                  ...motionStyle("medium"),
                }}
              >
                <Glyph name={sheetGlyph(tab.panel)} size={11.5} tint={tab.active ? token("foreground") : token("faint")} />
                <Text
                  class={`max-w-44 text-[12.5px] font-medium ${tab.active ? "text-foreground" : "text-muted-foreground"}`}
                  style={{ numberOfLines: 1 }}
                >
                  {sheetTitle(tab.panel)}
                </Text>
                {tab.active ? (
                  <View class="absolute bottom-[-1px] left-2.5 right-2.5 h-0.5 rounded-full bg-primary" style={{ pointerEvents: "none" }} />
                ) : null}
              </View>
            )}
            renderPanel={(panel) => <SheetBody id={panel.id} />}
            renderEmpty={() => (
              <View class="flex-1 items-center justify-center gap-1 bg-background">
                <Text class="text-sm font-semibold text-foreground">{t(K.canvas.emptyTitle)}</Text>
                <Text class="text-xs text-muted-foreground">{t(K.canvas.emptyNote)}</Text>
              </View>
            )}
          />
        </If>
        <View class="flex-row items-center gap-4 border-t border-line bg-background pl-4 pr-3" style={{ height: 24 }}>
          <Text class="text-[10.5px] tabular-nums text-faint">{t(K.status.sheets, { count: sheetCount(layout()) })}</Text>
          <Text class="text-[10.5px] text-faint">{t(K.status.containers, { count: containerCount() })}</Text>
          <Text class="text-[10.5px] text-faint">{t(K.status.sessions, { count: sessions().length })}</Text>
          <If when={unsupportedMethods().length > 0}>
            <Text class="text-[10.5px] text-warn">{t(K.status.unsupported, { count: unsupportedMethods().length })}</Text>
          </If>
          <View style={{ flex: 1 }} />
          <If when={!!(sessionError() ?? containerError() ?? projectError() ?? lastError())}>
            <View class="min-w-0" style={{ flexShrink: 1 }}>
              <Text class="text-[10.5px] text-destructive" style={{ numberOfLines: 1 }}>
                {sessionError() ?? containerError() ?? projectError() ?? lastError() ?? ""}
              </Text>
            </View>
          </If>
          <If when={!!info()}>
            <Text class="text-[10.5px] text-faint">{`pi ${info()?.pi} · gen ${info()?.generation}`}</Text>
          </If>
          <Text class="text-[10.5px] text-faint" style={{ flexShrink: 0, numberOfLines: 1 }}>{t(K.status.hint)}</Text>
        </View>
      </View>
      <UIHost />
      <ProjectDialog />
    </View>
  );
}
