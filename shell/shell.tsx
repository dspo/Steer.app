import { keymap, List, PanResponder, Scroll, signal, Text, token, View } from "nsh";
import { DockArea, Input, Menu, MenuItem, MenuSeparator, type DockAreaLayout } from "nsh/base";
import { Window } from "nsh/desktop";
import { containerTitle } from "../canvas/titles";
import { loadSettings, setSidebarWidth, sidebarWidth, SIDEBAR_DEFAULT_WIDTH } from "../stores/settings";
import { setSlashActions } from "../stores/slash";
import { connect, disconnect, lastError, phase, recovered, retry, type EnginePhase } from "../stores/engine";
import {
  closeSheet,
  activeContainerId,
  archiveContainer,
  bindDock,
  containerError,
  containers,
  layout,
  liveContainers,
  loadContainers,
  onPanelActive,
  openFilesSheet,
  openHomeSheet,
  openPath,
  setLayout,
  setZoom,
  switchContainer,
  zoomedPanel,
} from "../stores/containers";
import {
  containerProject,
  containersIn,
  loadProjects,
  openHero,
  orderedProjects,
  projectError,
} from "../stores/projects";
import { ProjectDialog } from "../sheets/hero";
import { panelIds } from "../stores/dock";
import { error as sessionError, refreshSessions, sessions } from "../stores/sessions";
import { SheetBody, sheetGlyph, sheetTitle } from "../canvas/sheets";
import { externalKindLabel } from "../stores/terminals";
import { saveActiveEditor } from "../stores/editors";
import { openChangesSheet, openHistorySheet } from "../stores/git";
import { openProblemsSheet } from "../sheets/lsp-ui";
import { K, t } from "../ui/i18n";
import { UIHost, unsupportedMethods } from "../ui/ui-host";
import { dropBrowserPages, openBrowserSheet } from "../stores/browser";
import {
  openActiveInVSCode,
} from "../stores/vscode";
import { containerMatches, sessionMatches } from "../stores/search";
import { Chip, Dot, Glyph, type GlyphName, motionStyle, shadowCard, shadowRaised } from "../ui/ui";
import { TabBarPlus } from "../canvas/tab-plus";

/**
 * Zu's shell: the titlebar, the project/container sidebar, the canvas and the
 * status bar. A container owns one canvas and its layout stash; switching a
 * container saves the current DockArea tree, then restores the target's.
 *
 * The titlebar is Steer's single row: a sidebar toggle, a window-centered
 * session picker, and "open the active project in VS Code" + the tools
 * overflow. There is no bottom status bar: a compact inline indicator carries
 * an engine state only while it is not the normal connected state, and the
 * overflow holds the engine controls.
 */

/** Boots the engine and loads the registry; the app calls it once. */
export async function bootShell(): Promise<void> {
  await connect();
  if (phase() === "connected") {
    await loadContainers();
    await loadProjects();
    await loadSettings();
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

/** The titlebar's height: compact, with the traffic lights still centered. */
const TITLEBAR_HEIGHT = 40;
/** The picker trigger and its dropdown share this width (Steer's 360). */
/** The picker is the titlebar's main control, so it nearly fills the row. */

// ---------------------------------------------------------------------------
// Sidebar and titlebar interaction state
// ---------------------------------------------------------------------------

const sidebarVisible = signal(true);
const sidebarGrouping = signal<"project" | "recent">("project");
const sidebarFilterOpen = signal(false);
const sidebarQuery = signal("");
/** Collapsed project groups, by stable key (the project id, `__chats`). */
const collapsedGroups = signal<Record<string, boolean>>({});
/** A one-line report from a titlebar action (VS Code refused, no folder). */
const shellNote = signal<string | null>(null);
let noteTimer: any = null;

/** Shows `text` in the status bar for a few seconds. */
function note(text: string): void {
  shellNote.set(text);
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => shellNote.set(null), 6000);
}

// ---------------------------------------------------------------------------
function CountBadge(props: { value: string }) {
  return (
    <View class="items-center justify-center rounded-full bg-brand-tint" style={{ minWidth: 18, height: 18, paddingHorizontal: 5 }}>
      <Text style={{ fontSize: 10, fontWeight: "600", color: token("brand") }}>{props.value}</Text>
    </View>
  );
}

/** A quiet icon button in the titlebar/status bar. */
function BarIcon(props: {
  testID: string;
  label: string;
  glyph: GlyphName;
  size?: number;
  tint?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const size = props.size ?? 14;
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      tooltip={props.label}
      disabled={props.disabled ?? false}
      class={
        props.disabled
          ? "items-center justify-center rounded-md opacity-40"
          : "items-center justify-center rounded-md hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      }
      style={{ width: 26, height: 26, ...motionStyle("fast") }}
      onPress={() => {
        if (!props.disabled) props.onPress();
      }}
    >
      <Glyph name={props.glyph} size={size} tint={token((props.tint ?? "muted-foreground") as any)} />
    </View>
  );
}

/** A project's current group key: its id, or the Chats bucket. */
function groupKey(projectId: string | null): string {
  return projectId ?? "__chats";
}

/** Expands the group a container just switched into (a collapsed group hides its active row). */
function revealContainer(container: any): void {
  const key = groupKey(containerProject(container));
  const current = collapsedGroups();
  if (current[key]) collapsedGroups.set({ ...current, [key]: false });
}

/** One container row, under its project. A container belongs to the project it
 * was created under: there is no gesture that moves it. */
function ContainerRow(props: { container: any }) {
  const container = () => props.container;
  const active = () => container().id === activeContainerId();
  const press = () => {
    revealContainer(container());
    void switchContainer(container().id, true);
  };
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
        testID={`container-row-${container().id}`}
        accessibilityLabel={`Open container ${containerTitle(container())}`}
        accessibilityState={{ selected: active() }}
        class="flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 active:bg-accent/60"
        style={{ paddingVertical: 1, gap: 2 }}
        onPress={press}
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
        <View
          role="button"
          testID={`archive-${container().id}`}
          accessibilityLabel={`${t(K.container.archive)} ${containerTitle(container())}`}
          class="h-6 w-5 items-center justify-center rounded-lg hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          onPress={() =>
            void archiveContainer(container().id).then(() => {
              // The container's browser state is UI only; it goes with it.
              if (!containers().some((row) => row.id === container().id)) {
                dropBrowserPages(container().id);
              }
            })
          }
        >
          <Glyph name="archive" size={11} tint={token("faint")} />
        </View>
      </View>
    </View>
  );
}

/** A project's header and its containers. */
function ProjectGroup(props: { projectId: string | null; name: string; onCreate: () => void }) {
  const key = groupKey(props.projectId);
  const rows = () => containersIn(props.projectId);
  const collapsed = () => !!collapsedGroups()[key];
  const toggle = () => collapsedGroups.set({ ...collapsedGroups(), [key]: !collapsed() });
  return (
    <View style={{ gap: 1, paddingBottom: 2 }}>
      <View
        role="button"
        testID={`project-header-${key}`}
        accessibilityLabel={props.name}
        accessibilityState={{ expanded: !collapsed() }}
        onPress={toggle}
        class="group hover:bg-hover"
        style={{ flexDirection: "row", alignItems: "center", gap: 5, marginHorizontal: 8, paddingHorizontal: 4, height: 30, borderRadius: 8, ...motionStyle("fast") }}
      >
        <Glyph name={collapsed() ? "caret-right" : "caret-down"} size={10} tint={token("faint")} />
        <Glyph name={props.projectId === null ? "chat" : "folder"} size={13} tint={token("muted-foreground")} />
        <Text class="flex-1 text-[12.5px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
          {props.name}
        </Text>
        <CountBadge value={String(rows().length)} />
        <View
          role="button"
          testID={`new-container-${key}`}
          accessibilityLabel={t(K.container.create)}
          class="h-6 w-6 items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          onPress={props.onCreate}
        >
          <Glyph name="plus" size={11} tint={token("faint")} />
        </View>
      </View>
      <If when={!collapsed()}>
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
      </If>
    </View>
  );
}

/** The Recent grouping: one flat list, newest activity first. */
function RecentGroup() {
  const rows = () => liveContainers();
  return (
    <View style={{ gap: 1, paddingBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginHorizontal: 8, paddingHorizontal: 4, height: 30 }}>
        <Glyph name="pulse" size={13} tint={token("muted-foreground")} />
        <Text class="flex-1 text-[12.5px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
          {t(K.sidebar.recent)}
        </Text>
        <CountBadge value={String(rows().length)} />
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

/** The first text of a session row. */
function sessionLabel(row: any): string {
  return row.name || row.preview || row.id;
}

type SearchEntry =
  | { kind: "section"; key: string; label: string; count: number }
  | { kind: "container"; key: string; container: any }
  | { kind: "session"; key: string; session: any };

/**
 * The filtering view: container hits (title/cwd/project), then session hits
 * (name/preview/cwd/path). The all-sessions list is not part of the resting
 * sidebar; it appears only while a query is active, which is the one place
 * the shell still shows sessions that no container holds.
 */
function searchEntries(): SearchEntry[] {
  const query = sidebarQuery();
  if (!query.trim()) return [];
  const entries: SearchEntry[] = [];
  const containerHits = liveContainers().filter((container) => containerMatches(container, query));
  if (containerHits.length > 0) {
    entries.push({ kind: "section", key: "section-containers", label: t(K.sidebar.containers), count: containerHits.length });
    for (const container of containerHits) {
      entries.push({ kind: "container", key: `container:${container.id}`, container });
    }
  }
  const sessionHits = sessions().filter((session) => sessionMatches(session, query));
  if (sessionHits.length > 0) {
    entries.push({ kind: "section", key: "section-sessions", label: t(K.sidebar.sessions), count: sessionHits.length });
    for (const session of sessionHits) {
      entries.push({ kind: "session", key: `session:${session.path}`, session });
    }
  }
  return entries;
}

/** A session hit: opens (or attaches) the session's own container. */
function SessionSearchRow(props: { session: any }) {
  return (
    <View
      role="button"
      testID={`session-result-${props.session.id}`}
      accessibilityLabel={`Open ${sessionLabel(props.session)}`}
      class="hover:bg-hover active:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ marginHorizontal: 8, marginVertical: 1, paddingHorizontal: 7, paddingVertical: 6, borderRadius: 10, gap: 2, ...motionStyle("medium") }}
      onPress={() => void openPath(props.session.path)}
    >
      <Text style={{ fontSize: 12.5, color: token("foreground"), numberOfLines: 1 }}>{sessionLabel(props.session)}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 10.5, color: token("faint"), numberOfLines: 1 }}>{shortPath(props.session.cwd)}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 10.5, color: token("faint") }}>{`${props.session.messageCount}`}</Text>
        <Text style={{ fontSize: 10.5, color: token("faint") }}>{relative(props.session.modified)}</Text>
      </View>
    </View>
  );
}

/** A section label inside the filtering list. */
function SearchSection(props: { label: string; count: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 3 }}>
      <Text style={{ flex: 1, fontSize: 10.5, fontWeight: "600", letterSpacing: 0.4, color: token("faint") }}>{props.label}</Text>
      <Text style={{ fontSize: 10, color: token("faint") }}>{String(props.count)}</Text>
    </View>
  );
}

/** The sidebar: header actions, the filter, and project → container. */
/**
 * The 4pt hot zone on the sidebar's right edge: dragging sets the width
 * (clamped 200–360) at once and persists it to `zu/settings.json` on the
 * engine, so a restart opens at the width the user left.
 */
function SidebarHandle() {
  const startWidth = signal(SIDEBAR_DEFAULT_WIDTH);
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => startWidth.set(sidebarWidth()),
    onPanResponderMove: (_event, gesture) =>
      setSidebarWidth(startWidth() + (gesture?.dx ?? 0)),
    onPanResponderRelease: () => setSidebarWidth(sidebarWidth()),
  });
  return (
    <View
      testID="sidebar-handle"
      accessibilityLabel={t(K.sidebar.resize)}
      {...pan.panHandlers}
      class="h-full w-4 items-center justify-center hover:bg-line"
      style={{ width: 4, borderRadius: 2, marginHorizontal: -2, ...motionStyle("fast") }}
    />
  );
}

function Sidebar() {
  return (
    <View class="bg-sidebar" style={{ width: sidebarWidth(), flexShrink: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, height: 36 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: token("foreground"), flexShrink: 0 }}>{t(K.sidebar.title)}</Text>
        <View style={{ flex: 1 }} />
        <View
          role="button"
          testID="new-container"
          accessibilityLabel={t(K.container.create)}
          class="h-7 flex-row items-center gap-1 rounded-lg border border-line bg-card px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={() => openHero(null)}
        >
          <Glyph name="plus" size={10} tint={token("foreground")} />
          <Text class="text-[11px] font-medium text-foreground">{t(K.sidebar.new)}</Text>
        </View>
        <BarIcon
          testID="sidebar-grouping"
          label={t(K.sidebar.grouping)}
          glyph="sort"
          size={13}
          tint={sidebarGrouping() === "recent" ? "brand" : "muted-foreground"}
          onPress={() => sidebarGrouping.set(sidebarGrouping() === "project" ? "recent" : "project")}
        />
        <BarIcon
          testID="sidebar-search"
          label={t(K.sidebar.search)}
          glyph="search"
          size={13}
          tint={sidebarFilterOpen() ? "brand" : "muted-foreground"}
          onPress={() => {
            const next = !sidebarFilterOpen();
            sidebarFilterOpen.set(next);
            if (!next) sidebarQuery.set("");
          }}
        />
      </View>

      <If when={sidebarFilterOpen()}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 10, marginBottom: 6, height: 28, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: token("border"), backgroundColor: token("card") }}>
          <Glyph name="search" size={12} tint={token("faint")} />
          <Input
            testID="sidebar-search-input"
            value={sidebarQuery()}
            onChange={({ value }) => sidebarQuery.set(value)}
            autoFocus
            placeholder={t(K.sidebar.searchPlaceholder)}
            style={{
              flex: 1,
              height: 26,
              fontSize: 12,
              color: token("foreground"),
              placeholderColor: token("faint"),
            }}
          />
          <If when={sidebarQuery().length > 0}>
            <View
              role="button"
              testID="sidebar-search-clear"
              accessibilityLabel={t(K.sidebar.clear)}
              class="h-5 w-5 items-center justify-center rounded-md hover:bg-hover active:opacity-70"
              onPress={() => sidebarQuery.set("")}
            >
              <Glyph name="close" size={10} tint={token("faint")} />
            </View>
          </If>
        </View>
      </If>

      <If
        when={sidebarQuery().trim().length > 0}
        else={
          <Scroll style={{ flex: 1 }} contentStyle={{ paddingBottom: 8 }}>
            <If
              when={sidebarGrouping() === "project"}
              else={<RecentGroup />}
            >
              <View>
                <Each of={orderedProjects()} key={(project) => project.id}>
                  {(project) => (
                    <ProjectGroup
                      projectId={project().id}
                      name={project().name}
                      onCreate={() => openHero(project().id, true)}
                    />
                  )}
                </Each>
                <ProjectGroup
                  projectId={null}
                  name={t(K.project.chats)}
                  onCreate={() => openHero(null, true)}
                />
              </View>
            </If>
            <If when={!!projectError()}>
              <Text class="px-3 py-1 text-[10.5px] text-destructive" style={{ numberOfLines: 1 }}>
                {projectError() ?? ""}
              </Text>
            </If>
          </Scroll>
        }
      >
        <List
          testID="session-list"
          each={searchEntries()}
          keyExtractor={(entry) => entry.key}
          style={{ flex: 1 }}
          empty={
            <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
              <Text style={{ fontSize: 11.5, color: token("muted-foreground") }}>{t(K.sidebar.noResults)}</Text>
              <Text style={{ fontSize: 10.5, color: token("faint"), marginTop: 2 }}>{t(K.sidebar.noResultsHint)}</Text>
            </View>
          }
        >
          {(entry) => {
            const row = entry();
            if (row.kind === "section") return <SearchSection label={row.label} count={row.count} />;
            if (row.kind === "container") return <ContainerRow container={row.container} />;
            return <SessionSearchRow session={row.session} />;
          }}
        </List>
      </If>
    </View>
  );
}

/**
 * The engine's inline state: a tinted dot, with words only while it is not
 * the normal connected state. Pressing it retries a stopped or failed
 * engine, so the old status bar's retry affordance is still one gesture.
 */
function EngineIndicator() {
  const label = () => t(PHASE_KEY[phase()]);
  const abnormal = () => phase() !== "connected";
  const retryEngine = () => {
    if (phase() === "stopped") void bootShell();
    else if (phase() !== "starting" && phase() !== "recovering") void retry();
  };
  return (
    <View
      role="button"
      testID="engine-state"
      accessibilityLabel={label()}
      tooltip={label()}
      disabled={!abnormal()}
      class="h-6 flex-row items-center gap-1.5 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (abnormal()) retryEngine();
      }}
    >
      <Dot tint={token(PHASE_TINT[phase()] as any)} size={5.5} />
      <If when={abnormal()}>
        <Text class="text-[10px] font-medium text-muted-foreground">{label()}</Text>
      </If>
    </View>
  );
}

/** The titlebar: sidebar toggle · centered picker · editor + tools overflow. */
function TitleBar() {
  const titlebar = () => {
    try {
      return Window.get("main")?.titleBar() ?? { height: 0, left: 0, right: 0 };
    } catch {
      return { height: 0, left: 0, right: 0 };
    }
  };
  // The traffic-light cluster sits at the window's top left when the title
  // bar is hidden; reserve its reported width (plus the row's own inset).
  const padLeft = () => (titlebar().height > 0 ? titlebar().left + 12 : 14);
  const hasContainer = () => activeContainerId() !== null;
  const canStop = () => phase() === "connected" || phase() === "starting" || phase() === "recovering";
  const canRetry = () => phase() !== "connected" && phase() !== "starting";
  const failure = () => sessionError() ?? containerError() ?? projectError() ?? lastError();
  const openEditor = async () => {
    const result = await openActiveInVSCode();
    if (result.kind === "no-folder") note(t(K.titlebar.noFolder));
    else if (result.kind === "failed") note(t(K.titlebar.openFailed, { error: result.error }));
  };
  return (
    // Same material as the sidebar: the window is one layer, no divider.
    <View
      class="flex-row items-center"
      style={{ height: TITLEBAR_HEIGHT, flexShrink: 0 }}
      desktop={{ windowDrag: true }}
    >
      {/* The traffic-light inset lives inside the left wing, not on the row. */}
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: padLeft() }} />
        <BarIcon
          testID="sidebar-toggle"
          label={sidebarVisible() ? t(K.titlebar.hideSidebar) : t(K.titlebar.showSidebar)}
          glyph="sidebar"
          size={15}
          tint={sidebarVisible() ? "foreground" : "muted-foreground"}
          onPress={() => sidebarVisible.set(!sidebarVisible())}
        />
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, minWidth: 0 }}>
        <If when={!!recovered()}>
          <Chip label={t(K.engine.recovered, { generation: recovered()?.to ?? 0 })} tint={token("up")} />
        </If>
        <If when={!!failure()}>
          <Text class="text-[10px] text-destructive" style={{ maxWidth: 260, flexShrink: 1, numberOfLines: 1 }}>
            {failure() ?? ""}
          </Text>
        </If>
        <If when={!!shellNote()}>
          <Text class="text-[10px] text-warn" style={{ maxWidth: 240, flexShrink: 1, numberOfLines: 1 }}>
            {shellNote() ?? ""}
          </Text>
        </If>
        <EngineIndicator />
        <BarIcon
          testID="open-vscode"
          label={t(K.titlebar.openVSCode)}
          glyph="code"
          size={14}
          disabled={!hasContainer()}
          onPress={() => void openEditor()}
        />
        <Menu
          trigger={
            <View
              role="button"
              testID="titlebar-tools"
              accessibilityLabel={t(K.titlebar.more)}
              class="h-[26px] w-[26px] items-center justify-center rounded-md hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
            >
              <Glyph name="more" size={14} tint={token("muted-foreground")} />
            </View>
          }
          align="end"
          popupClass="rounded-xl border border-border bg-popover p-1"
          popupStyle={{ width: 196, boxShadow: shadowRaised() }}
        >
          <MenuItem testID="open-files" disabled={!hasContainer()} class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => openFilesSheet()}>
            <Text class="text-[12px] text-foreground">{t(K.files.title)}</Text>
          </MenuItem>
          {/* The browser is the one sheet a canvas without a container can
              hold (DESIGN §4.1); the rest name a workspace. */}
          <MenuItem testID="open-browser" class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => openBrowserSheet()}>
            <Text class="text-[12px] text-foreground">{t(K.browser.open)}</Text>
          </MenuItem>
          <MenuItem testID="open-changes" disabled={!hasContainer()} class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => openChangesSheet()}>
            <Text class="text-[12px] text-foreground">{t(K.git.changesTitle)}</Text>
          </MenuItem>
          <MenuItem testID="open-history" disabled={!hasContainer()} class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => openHistorySheet()}>
            <Text class="text-[12px] text-foreground">{t(K.git.historyTitle)}</Text>
          </MenuItem>
          <MenuItem testID="open-problems" disabled={!hasContainer()} class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => openProblemsSheet()}>
            <Text class="text-[12px] text-foreground">{t(K.lsp.problems)}</Text>
          </MenuItem>

          <MenuItem testID="engine-refresh" class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => void refreshSessions()}>
            <Text class="text-[12px] text-foreground">{t(K.engine.refresh)}</Text>
          </MenuItem>
          <If when={canRetry()}>
            <MenuItem
              testID="engine-retry"
              class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
              onSelect={() => void (phase() === "stopped" ? bootShell() : retry())}
            >
              <Text class="text-[12px] text-foreground">{t(K.engine.retry)}</Text>
            </MenuItem>
          </If>
          <If when={canStop()}>
            <MenuItem testID="engine-stop" class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => void disconnect()}>
              <Text class="text-[12px] text-foreground">{t(K.engine.stop)}</Text>
            </MenuItem>
          </If>
          <If when={unsupportedMethods().length > 0}>
            <MenuItem testID="unsupported-methods" disabled class="rounded-lg px-2.5 py-1.5">
              <Text class="text-[12px] text-muted-foreground">{t(K.status.unsupported, { count: unsupportedMethods().length })}</Text>
            </MenuItem>
          </If>
        </Menu>
        <View style={{ width: 10 }} />
      </View>
    </View>
  );
}

/**
 * The canvas's panels, all closable: the tab's × is drawn below, and closing
 * a container's last sheet is how it leaves (Q69's auto-archive) — an
 * external container included, whose exit kills its PTY.
 */
function canvasPanels(): Array<{ id: string; closable: boolean }> {
  return panelIds(layout()).map((id) => ({ id, closable: true }));
}

/**
 * The canvas: the sheet tree and nothing else. Every surface here is a sheet
 * — a container's conversation, terminal, browser, Hero, or the scratch
 * canvas's Hero — so there is no page state to fall out of step with the
 * tabs. The `+` overlay sits above each group's tab bar.
 */
function Canvas() {
  const size = signal({ width: 0, height: 0 });
  const measured = () => size();
  // The card is the content's only container (DESIGN §3.1): everything the
  // canvas draws — tab bars, panels, the composer — lives inside it, and
  // its corners clip. The `+` overlay measures the card, so its geometry
  // stays the DockArea's own.
  return (
    <View
      class="flex-1 overflow-hidden bg-card"
      style={{
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        borderRadius: 14,
        // 8–10pt of the window's `sidebar` showing on all sides (DESIGN §3);
        // the left gap is the gutter the sidebar handle lives in.
        marginTop: 8,
        marginRight: 10,
        marginBottom: 10,
      }}
      onLayout={({ bounds }) => {
        const { width, height } = bounds.size;
        if (measured().width !== width || measured().height !== height) size.set({ width, height });
      }}
    >
      <DockArea
        ref={(ref) => bindDock(ref)}
        class="flex-1"
        layout={layout()}
        panels={canvasPanels()}
        onLayoutChange={({ layout: next }) => setLayout(next)}
        onZoomChange={({ panel }) => setZoom(panel)}
        onPanelActiveChange={({ panel, active }) => onPanelActive(panel, active)}
        groupClass="flex-1 bg-background overflow-hidden"
        tabBarClass="flex-row items-end gap-0.5 border-b border-line bg-card px-2"
        // The right strip is the `+`'s: a tab never ends under the overlay.
        tabBarStyle={{ height: 34, paddingRight: 30 }}
        tabClass="group focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-1px] active:opacity-80"
        contentClass="flex-1 bg-background overflow-hidden"
        handleClass="basis-px bg-line"
        dropIndicatorClass="rounded-lg border-2 border-brand bg-brand-tint"
        renderDragPreview={(tab) => (
          // The ghost: a tab's shape that follows the pointer (DESIGN §3.7) —
          // card, shadow, its own icon and title.
          <View
            class="h-8 flex-row items-center gap-1.5 rounded-lg px-2.5 bg-card"
            style={{ width: 144, boxShadow: shadowCard() }}
          >
            <Glyph name={sheetGlyph(tab.panel)} size={11.5} tint={token("foreground")} />
            <Text class="text-[12.5px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
              {sheetTitle(tab.panel)}
            </Text>
          </View>
        )}
        renderDropIndicator={(indicator) =>
          // On a tab bar slot the drop lands between two tabs: a 2pt brand
          // line (DESIGN §3.7). Group splits and edges keep the block look.
          indicator.index !== null && indicator.side === null ? (
            <View class="bg-brand" style={{ width: 2, height: 22, borderRadius: 1 }} />
          ) : (
            <View class="rounded-lg border-2 border-brand bg-brand-tint" style={{ flexGrow: 1 }} />
          )
        }
        renderTab={(tab) => (
          // Chrome-style widths (DESIGN §3.2): 72–240, squeezed evenly when
          // the panel narrows or tabs multiply; the title truncates.
          <View
            class={`relative h-8 flex-row items-center gap-1.5 rounded-lg px-2.5 ${tab.active ? "bg-card" : "hover:bg-hover"}`}
            style={{
              minWidth: 72,
              maxWidth: 240,
              flexGrow: 0,
              flexShrink: 1,
              borderRadius: 8,
              backgroundColor: tab.active ? token("card") : "transparent",
              boxShadow: tab.active ? shadowCard() : "none",
              ...motionStyle("medium"),
            }}
          >
            <Glyph name={sheetGlyph(tab.panel)} size={11.5} tint={tab.active ? token("foreground") : token("faint")} />
            <Text
              class={`min-w-0 flex-1 text-[12.5px] font-medium ${tab.active ? "text-foreground" : "text-muted-foreground"}`}
              style={{ numberOfLines: 1 }}
            >
              {sheetTitle(tab.panel)}
            </Text>
            {/* Appears under the pointer, as Steer's tabs do. Every tab is
                closable — nsh hides a group's last ×, and closing the last
                sheet is how a container with nothing left leaves (Q69). */}
            <If when={true}>
              <View
                role="button"
                testID={`tab-close-${tab.panel}`}
                accessibilityLabel={t(K.canvas.closeSheet, { name: sheetTitle(tab.panel) })}
                class="absolute right-1 top-1.5 size-5 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-raised"
                onPress={() => void closeSheet(tab.panel)}
              >
                <Glyph name="close" size={10} tint={token("muted-foreground")} />
              </View>
            </If>
            {tab.active ? (
              <View class="absolute bottom-[-1px] left-2.5 right-2.5 h-0.5 rounded-full bg-primary" style={{ pointerEvents: "none" }} />
            ) : null}
          </View>
        )}
        renderPanel={(panel) => <SheetBody id={panel.id} />}
        renderEmpty={() => (
          // A canvas with no sheet: the Hero is one click away, and it is a
          // sheet like any other (closing it leaves this state).
          <View class="flex-1 items-center justify-center gap-2 bg-card">
            <Text class="text-sm font-semibold text-foreground">{t(K.canvas.emptyTitle)}</Text>
            <Text class="text-xs text-muted-foreground">{t(K.canvas.emptyNote)}</Text>
            <View
              role="button"
              testID="empty-open-hero"
              accessibilityLabel={t(K.canvas.openHero)}
              class="mt-1 h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 hover:bg-hover active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
              style={{ ...motionStyle("fast") }}
              onPress={() => openHomeSheet()}
            >
              <Glyph name="plus" size={10} tint={token("foreground")} />
              <Text class="text-[11.5px] font-medium text-foreground">{t(K.canvas.openHero)}</Text>
            </View>
          </View>
        )}
      />
      <TabBarPlus
        layout={layout()}
        width={measured().width}
        height={measured().height}
        zoomed={zoomedPanel()}
        onOpen={(anchor) => openHomeSheet(anchor)}
      />
    </View>
  );
}

/** The workbench: titlebar · sidebar + canvas (no boot side effects). */
export function Workbench() {
  // The app's Mod+S saves the editor sheet on screen; a binding made while a
  // component renders goes with the component, and the workbench lives as
  // long as the app.
  keymap.bind("mod+s", () => saveActiveEditor());
  // `/resume` (the composer's slash table) opens the sidebar's search: the
  // shell owns that surface, so it installs the action.
  setSlashActions({
    openSidebarSearch: () => {
      sidebarVisible.set(true);
      sidebarFilterOpen.set(true);
    },
  });
  // New is a scratch canvas wherever the user is; the sidebar's button and
  // a project row's `+` reach the same canvas.
  keymap.bind("mod+n", () => openHero(null));
  return (
    // S3's one-layer shell: the whole window is `sidebar`; the content is
    // the card the Canvas draws (DESIGN §3).
    <View class="flex-1 bg-sidebar" style={{ flexDirection: "column", minHeight: 0 }}>
      <TitleBar />
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        <If when={sidebarVisible()}>
          <Sidebar />
        </If>
        {/* The 10pt gutter between the sidebar and the card carries the
            4pt drag handle (DESIGN §3: 200–360, persisted). */}
        <View style={{ width: 10, flexShrink: 0, flexDirection: "row", justifyContent: "center" }}>
          <If when={sidebarVisible()}>
            <SidebarHandle />
          </If>
        </View>
        <Canvas />
      </View>
      <UIHost />
      <ProjectDialog />
    </View>
  );
}
