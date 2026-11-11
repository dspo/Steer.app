import { keymap, List, PanResponder, Scroll, signal, Text, token, View } from "nsh";
import { DockArea, Input, Menu, MenuItem, MenuSeparator, type DockAreaLayout } from "nsh/base";
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
  orderedProjects,
  projectError,
} from "./projects";
import { Launcher, openProjectDialog, ProjectDialog } from "./launcher";
import { panelIds, sheetCount } from "./dock";
import { error as sessionError, refreshSessions, sessions } from "./sessions";
import { SheetBody, sheetGlyph, sheetTitle } from "./sheets";
import { externalKindLabel } from "./terminals";
import { saveActiveEditor } from "./editors";
import { openChangesSheet, openHistorySheet } from "./git";
import { openProblemsSheet } from "./lsp-ui";
import { UpdatesDialog } from "./updates-ui";
import { openUpdates } from "./updates";
import { K, shellLocale, t, toggleShellLocale } from "./i18n";
import { UIHost, unsupportedMethods } from "./ui-host";
import { openSubagents } from "./subagents";
import { dropBrowserPages, openBrowserSheet } from "./browser";
import {
  activeContainer,
  containerMatches,
  containerProjectName,
  openActiveInVSCode,
  pickContainer,
  pickerCandidates,
  pickerSessions,
  sessionMatches,
} from "./titlebar";
import { Chip, Dot, Glyph, type GlyphName, motionStyle, shadowCard, shadowRaised } from "./ui";

/**
 * Zu's shell: the titlebar, the project/container sidebar, the canvas and the
 * status bar. A container owns one canvas and its layout stash; switching a
 * container saves the current DockArea tree, then restores the target's.
 *
 * The titlebar is Steer's single row: a sidebar toggle, a window-centered
 * session picker, and "open the active project in VS Code" + the tools
 * overflow. Engine state, language and the count readouts live in the bottom
 * status bar; the titlebar never grows a second row.
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

/** The titlebar's height; Steer's row is 38, the traffic lights want 40. */
const TITLEBAR_HEIGHT = 40;
/** The picker trigger and its dropdown share this width (Steer's 360). */
const PICKER_WIDTH = 360;
/** The status bar's height (counts, engine state, language). */
const STATUS_HEIGHT = 26;

// ---------------------------------------------------------------------------
// Sidebar and titlebar interaction state
// ---------------------------------------------------------------------------

const sidebarVisible = signal(true);
const sidebarGrouping = signal<"project" | "recent">("project");
const sidebarFilterOpen = signal(false);
const sidebarQuery = signal("");
/** Collapsed project groups, by stable key (the project id, `__chats`). */
const collapsedGroups = signal<Record<string, boolean>>({});
const pickerOpen = signal(false);
const pickerQuery = signal("");
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
// Drag-to-project membership
// ---------------------------------------------------------------------------

const projectAnchors = new Map<string, any>();
const projectTops = new Map<string, number>();
const dragContainer = signal<string | null>(null);
/** The row that actually moved (a press alone never commits a move). */
const dragMoved = signal<string | null>(null);
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

/** One container row, under its project; membership moves by menu or drag. */
function ContainerRow(props: { container: any; draggable?: boolean }) {
  const container = () => props.container;
  const active = () => container().id === activeContainerId();
  const draggable = () => props.draggable !== false;
  // A press only arms the row; the drag state is set once the pointer has
  // actually moved past the threshold, so releasing a plain click can never
  // write a membership move. The press itself is the inner view's, so the
  // pan responder never swallows it.
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      dragMoved.set(null);
      dragOver.set(null);
    },
    onPanResponderMove: (event, gesture) => {
      if (Math.abs(gesture.dy) <= 8) return;
      dragMoved.set(container().id);
      dragContainer.set(container().id);
      void measureProjects();
      dragOver.set(projectAt(event.pageY) ?? null);
    },
    onPanResponderRelease: (event) => {
      const id = container().id;
      const moved = dragMoved() === id;
      const target = projectAt(event.pageY);
      dragMoved.set(null);
      dragContainer.set(null);
      dragOver.set(null);
      // `undefined` is "outside every group"; a release with no real move is
      // a click, not a membership gesture.
      if (moved && target !== undefined) void moveContainer(id, target);
    },
    onPanResponderTerminate: () => {
      dragMoved.set(null);
      dragContainer.set(null);
      dragOver.set(null);
    },
  });
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
        class={
          dragMoved() === container().id
            ? "flex-1 rounded-lg opacity-50"
            : "flex-1 rounded-lg focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 active:bg-accent/60"
        }
        style={{ paddingVertical: 1, gap: 2 }}
        onPress={press}
        {...(draggable() ? pan.panHandlers : {})}
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
          <MenuItem testID="move-to-chats" class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => void moveContainer(container().id, null)}>
            <Text class="text-[12px] text-foreground">{t(K.project.chats)}</Text>
          </MenuItem>
          <Each of={orderedProjects()} key={(project) => project.id}>
            {(project) => (
              <MenuItem
                testID={`move-to-${project().id}`}
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
        ref={(ref) => projectAnchors.set(key, ref)}
        role="button"
        testID={`project-header-${key}`}
        accessibilityLabel={props.name}
        accessibilityState={{ expanded: !collapsed() }}
        onPress={toggle}
        class={dragOver() === (props.projectId ?? null) && dragContainer() ? "bg-brand-tint" : "group hover:bg-hover"}
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
            {(row) => <ContainerRow container={row()} draggable={false} />}
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
function Sidebar() {
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 232, flexShrink: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6, height: 40 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: token("foreground"), flexShrink: 0 }}>{t(K.sidebar.title)}</Text>
        <View style={{ flex: 1 }} />
        <View
          role="button"
          testID="new-container"
          accessibilityLabel={t(K.container.create)}
          class="h-7 flex-row items-center gap-1 rounded-lg border border-line bg-card px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={() => openLauncher(null)}
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
                      onCreate={() => openLauncher(project().id, true)}
                    />
                  )}
                </Each>
                <ProjectGroup
                  projectId={null}
                  name={t(K.project.chats)}
                  onCreate={() => openLauncher(null, true)}
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
            if (row.kind === "container") return <ContainerRow container={row.container} draggable={false} />;
            return <SessionSearchRow session={row.session} />;
          }}
        </List>
      </If>

      <View
        role="button"
        testID="new-project"
        accessibilityLabel={t(K.project.create)}
        class="flex-row items-center gap-2 border-t border-line px-3 hover:bg-hover active:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-1px]"
        style={{ height: 30, ...motionStyle("fast") }}
        onPress={openProjectDialog}
      >
        <Glyph name="plus" size={11} tint={token("faint")} />
        <Text style={{ fontSize: 11.5, color: token("muted-foreground") }}>{t(K.project.create)}</Text>
      </View>
    </View>
  );
}

/** The window-centered session picker: trigger + a searchable recent list. */
function SessionPicker() {
  const active = () => activeContainer();
  const title = () => (active() ? containerTitle(active()!) : t(K.titlebar.sessionPicker));
  const meta = () => {
    const container = active();
    if (!container) return t(K.titlebar.noSession);
    const project = containerProjectName(container);
    return project ? `${project} · ${shortPath(container.cwd)}` : shortPath(container.cwd);
  };
  const candidates = () => pickerCandidates(pickerQuery());
  return (
    <Menu
      open={pickerOpen()}
      onOpenChange={({ open }) => {
        pickerOpen.set(open);
        if (open) pickerQuery.set("");
      }}
      align="center"
      offset={6}
      popupClass="rounded-xl border border-border bg-popover"
      popupStyle={{ width: PICKER_WIDTH, padding: 6, boxShadow: shadowRaised() }}
      trigger={
        <View
          role="button"
          testID="session-picker"
          accessibilityLabel={t(K.titlebar.sessionPicker)}
          accessibilityState={{ expanded: pickerOpen(), hasPopup: true }}
          class="h-full flex-row items-center gap-1.5 rounded-md border border-border bg-card px-2 hover:bg-hover active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
        >
          <Glyph name="folder" size={12} tint={token("muted-foreground")} />
          <View style={{ flex: 1, minWidth: 0, gap: 0 }}>
            <Text style={{ fontSize: 12, fontWeight: "500", color: token("foreground"), numberOfLines: 1 }}>{title()}</Text>
          </View>
          <Text style={{ fontSize: 9.5, color: token("faint"), flexShrink: 1, numberOfLines: 1 }}>{meta()}</Text>
          <Glyph name="caret-down" size={9} tint={token("faint")} />
        </View>
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 28, paddingHorizontal: 8, marginBottom: 4, borderRadius: 8, borderWidth: 1, borderColor: token("border") }}>
        <Glyph name="search" size={12} tint={token("faint")} />
        <Input
          testID="session-picker-input"
          value={pickerQuery()}
          onChange={({ value }) => pickerQuery.set(value)}
          autoFocus
          placeholder={t(K.titlebar.pickerPlaceholder)}
          style={{ flex: 1, height: 26, fontSize: 12, color: token("foreground"), placeholderColor: token("faint") }}
        />
      </View>
      <MenuSeparator class="my-1 h-px bg-line" />
      <If when={candidates().length === 0}>
        <Text class="px-2 py-2 text-[11.5px] text-faint">{t(K.titlebar.pickerEmpty)}</Text>
      </If>
      <Each of={candidates()} key={(container) => container.id}>
        {(container) => (
          <MenuItem
            testID={`picker-container-${container().id}`}
            accessibilityLabel={`Open container ${containerTitle(container())}`}
            onSelect={() => {
              const id = container().id;
              pickerOpen.set(false);
              revealContainer(container());
              void pickContainer(id);
            }}
            class="rounded-lg px-2 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: container().id === activeContainerId() ? token("brand") : "transparent",
                  flexShrink: 0,
                }}
              />
              <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: "500", color: token("foreground"), numberOfLines: 1 }}>
                  {containerTitle(container())}
                </Text>
                <Text style={{ fontSize: 10, color: token("faint"), numberOfLines: 1 }}>
                  {[containerProjectName(container()), shortPath(container().cwd)].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </View>
          </MenuItem>
        )}
      </Each>
      <If when={pickerSessions(pickerQuery()).length > 0}>
        <MenuSeparator class="my-1 h-px bg-line" />
        <Text class="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
          {t(K.sidebar.sessions)}
        </Text>
        <Each of={pickerSessions(pickerQuery())} key={(session) => session.path}>
          {(session) => (
            <MenuItem
              testID={`picker-session-${session().id}`}
              accessibilityLabel={`Open ${sessionLabel(session())}`}
              onSelect={() => {
                pickerOpen.set(false);
                void openPath(session().path);
              }}
              class="rounded-lg px-2 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minWidth: 0 }}>
                <Glyph name="chat" size={11} tint={token("faint")} />
                <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: "500", color: token("foreground"), numberOfLines: 1 }}>
                    {sessionLabel(session())}
                  </Text>
                  <Text style={{ fontSize: 10, color: token("faint"), numberOfLines: 1 }}>
                    {shortPath(session().cwd)} · {relative(session().modified)}
                  </Text>
                </View>
              </View>
            </MenuItem>
          )}
        </Each>
      </If>
    </Menu>
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
  const openEditor = async () => {
    const result = await openActiveInVSCode();
    if (result.kind === "no-folder") note(t(K.titlebar.noFolder));
    else if (result.kind === "failed") note(t(K.titlebar.openFailed, { error: result.error }));
  };
  return (
    <View
      class="flex-row items-center border-b border-line bg-background"
      style={{ height: TITLEBAR_HEIGHT, flexShrink: 0 }}
      desktop={{ windowDrag: true }}
    >
      {/* The traffic-light inset lives inside the left wing, not on the row:
          two equal wings then put the fixed 360 picker exactly on the
          window's center line (the row's own padding would bias it). */}
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
      <View style={{ width: PICKER_WIDTH, height: 24, flexShrink: 0 }}>
        <SessionPicker />
      </View>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
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
          <MenuItem testID="open-browser" disabled={!hasContainer()} class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => openBrowserSheet()}>
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
          <MenuItem testID="open-subagents" class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={openSubagents}>
            <Text class="text-[12px] text-foreground">{t(K.subagents.title)}</Text>
          </MenuItem>
          <MenuSeparator class="my-1 h-px bg-line" />
          <MenuItem testID="updates" class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={openUpdates}>
            <Text class="text-[12px] text-foreground">{t(K.updates.title)}</Text>
          </MenuItem>
        </Menu>
        <View style={{ width: 10 }} />
      </View>
    </View>
  );
}

/** The bottom line: counts, failures, engine state, language, stop/retry. */
function StatusBar() {
  const canStop = () => phase() === "connected" || phase() === "starting" || phase() === "recovering";
  const canRetry = () => phase() !== "connected" && phase() !== "starting";
  const failure = () => sessionError() ?? containerError() ?? projectError() ?? lastError();
  return (
    <View
      class="flex-row items-center gap-3 border-t border-line bg-background pl-3 pr-2"
      style={{ height: STATUS_HEIGHT, flexShrink: 0 }}
    >
      <Text class="text-[10.5px] tabular-nums text-faint">{t(K.status.sheets, { count: sheetCount(layout()) })}</Text>
      <Text class="text-[10.5px] text-faint">{t(K.status.containers, { count: containerCount() })}</Text>
      <Text class="text-[10.5px] text-faint">{t(K.status.sessions, { count: sessions().length })}</Text>
      <If when={unsupportedMethods().length > 0}>
        <Text class="text-[10.5px] text-warn">{t(K.status.unsupported, { count: unsupportedMethods().length })}</Text>
      </If>
      <If when={!!recovered()}>
        <Chip label={t(K.engine.recovered, { generation: recovered()?.to ?? 0 })} tint={token("up")} />
      </If>
      <View style={{ flex: 1 }} />
      <If when={!!failure()}>
        <View style={{ minWidth: 0, flexShrink: 1 }}>
          <Text class="text-[10.5px] text-destructive" style={{ numberOfLines: 1 }}>{failure() ?? ""}</Text>
        </View>
      </If>
      <If when={!!shellNote()}>
        <View style={{ minWidth: 0, flexShrink: 1 }}>
          <Text class="text-[10.5px] text-warn" style={{ numberOfLines: 1 }}>{shellNote() ?? ""}</Text>
        </View>
      </If>
      <If when={!!info()}>
        <Text class="text-[10.5px] text-faint" style={{ flexShrink: 0, numberOfLines: 1 }}>{`pi ${info()?.pi} · gen ${info()?.generation}`}</Text>
      </If>
      <BarIcon testID="engine-refresh" label={t(K.engine.refresh)} glyph="reload" size={12} onPress={() => void refreshSessions()} />
      <If when={canRetry()}>
        <View
          role="button"
          testID="engine-retry"
          accessibilityLabel={t(K.engine.retry)}
          class="h-[20px] items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          onPress={() => void (phase() === "stopped" ? bootShell() : retry())}
        >
          <Text class="text-[10.5px] font-medium text-foreground">{t(K.engine.retry)}</Text>
        </View>
      </If>
      <If when={canStop()}>
        <BarIcon testID="engine-stop" label={t(K.engine.stop)} glyph="stop" size={11} onPress={() => void disconnect()} />
      </If>
      <View
        role="button"
        testID="language"
        accessibilityLabel={t(K.status.language)}
        class="h-[22px] min-w-[24px] items-center justify-center rounded-md hover:bg-hover active:opacity-60 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        onPress={toggleShellLocale}
      >
        <Text class="text-[10.5px] font-medium text-muted-foreground">{shellLocale() === "zh-CN" ? "EN" : "中"}</Text>
      </View>
      <View class="flex-row items-center gap-1.5 rounded-full border border-line px-2" style={{ height: 20 }}>
        <Dot tint={token(PHASE_TINT[phase()] as any)} size={5.5} />
        <Text class="text-[10px] font-medium text-muted-foreground">{t(PHASE_KEY[phase()])}</Text>
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

/** The workbench: titlebar · sidebar + canvas · status bar (no boot side effects). */
export function Workbench() {
  // The app's Mod+S saves the editor sheet on screen; a binding made while a
  // component renders goes with the component, and the workbench lives as
  // long as the app.
  keymap.bind("mod+s", () => saveActiveEditor());
  const empty = () => launcherOpen() || activeContainerId() === null;
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "column", minHeight: 0 }}>
      <TitleBar />
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        <If when={sidebarVisible()}>
          <Sidebar />
        </If>
        <View class="flex-1 bg-background" style={{ flexDirection: "column", minWidth: 0, minHeight: 0 }}>
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
        </View>
      </View>
      <StatusBar />
      <UIHost />
      <ProjectDialog />
      <UpdatesDialog />
    </View>
  );
}
