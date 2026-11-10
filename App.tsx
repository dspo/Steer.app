import { mount, platform, Scroll, signal, Text, token, View } from "nsh";
import { DockArea, type DockAreaLayout, type DockAreaRef } from "nsh/base";
import { activateSheet, appendSheet, hasSheet, initialLayout, nextSheetId, sheetCount } from "./dock";
import { sheetGlyph, sheetTitle, SheetBody, TOOLBAR_KINDS, type SheetKind } from "./sheets";
import { Chip, Dot, Glyph, Logo, SectionTitle } from "./ui";

/**
 * Pi Desktop — the workbench shell around a DockArea canvas.
 *
 * 轮廓与内嵌对象分离：the shell (rail, projects pane, toolbar, status
 * line) holds no domain state; the canvas is a `DockArea` whose layout is
 * this file's data. Panels are containers with a tab strip; sheets are
 * the contents (a Pi session, terminals, agents' TUIs, a webview, aux
 * views of a session), moved between panels by dragging, resized by the
 * handles, zoomed through the ref — all `DockArea` behavior. Sheet
 * bodies are mocks: one line of text and a counter that survives moves.
 */

// --- The projects pane's mock data. ---------------------------------------

const project = { name: "manox-app", branch: "main" };

const workspaces = [
  { name: "ahp-store-channels", status: "running" as const, sessions: 2 },
  { name: "ghostty-cache-key", status: "dirty" as const, sessions: 1 },
  { name: "tab-indicator-inset", status: "idle" as const, sessions: 0 },
];
const settled = [
  { name: "updater-dmg-verify", note: "PR #281 merged" },
  { name: "ask-card-ids", note: "quiet for 8 days" },
];
const sessions = [
  { title: "Refactor AhpStore channels", model: "GLM-5.3", cost: "12.3k · $0.42", state: "running" as const },
  { title: "Review chrome boundary", model: "Opus 4.5", cost: "4.1k · $0.28", state: "done" as const },
  { title: "Wire tab indicator inset", model: "GLM-5.3", cost: "—", state: "queued" as const },
];

const TOOLBAR_LABELS: Record<SheetKind, string> = {
  session: "Pi 会话",
  terminal: "终端",
  claude: "Claude Code",
  codex: "Codex",
  copilot: "Copilot",
  webview: "Webview",
  editor: "编辑器",
  diff: "Diff",
  files: "文件",
  subagents: "Subagents",
  tasks: "后台任务",
  traces: "轨迹",
  stats: "统计",
};

const DOCK_TITLES: Record<string, string> = { left: "文件", right: "右栏", bottom: "底部" };

/** A resize handle's thumb: a grip that grows in under the pointer. */
const HANDLE_THUMB =
  "h-11 w-[3px] rounded-full bg-muted-foreground opacity-0 scale-y-0 transition duration-150 ease-out group-hover:opacity-40 group-hover:scale-y-[0.45] group-active:opacity-90 group-active:scale-y-100";

// --- The shell's panes. ----------------------------------------------------

/** The edge tool rail (static: the outline keeps it, the canvas is the show). */
function Rail() {
  const panes = [
    { id: "projects", glyph: "folder" as const },
    { id: "chats", glyph: "chat" as const },
    { id: "specs", glyph: "tree" as const },
    { id: "changes", glyph: "diff" as const },
    { id: "terminal", glyph: "terminal" as const },
  ];
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 48, alignItems: "center", paddingTop: 12, paddingBottom: 12, gap: 4 }}>
      <View class="items-center justify-center rounded-[10px] bg-primary" style={{ width: 36, height: 36, marginBottom: 8 }}>
        <Logo size={34} />
      </View>
      {panes.map((p, i) => (
        <View
          role="button"
          accessibilityLabel={p.id}
          class={i === 1 ? "bg-accent" : ""}
          style={{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" }}
        >
          <Glyph name={p.glyph} size={17} tint={i === 1 ? token("foreground") : token("faint")} />
        </View>
      ))}
    </View>
  );
}

/** The projects pane: the project, its workspaces, the shelf, and its pi
 * sessions — a session's row opens its sheet in the canvas. */
function Sidebar(props: { onOpenSession: (id: string) => void }) {
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 224 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 14 }}>
        <Glyph name="folder" size={15} tint={token("muted-foreground")} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: token("foreground"), numberOfLines: 1 }}>{project.name}</Text>
        <Chip label={project.branch} />
      </View>
      <Scroll style={{ flex: 1, paddingBottom: 12 }}>
        <SectionTitle label="WORKSPACES" trailing="3" />
        {workspaces.map((w) => {
          const tint = w.status === "running" ? token("up") : w.status === "dirty" ? token("warn") : token("faint");
          return (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 7 }}>
              <Dot tint={tint} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ fontSize: 12.5, color: token("foreground"), numberOfLines: 1 }}>{w.name}</Text>
                <Text style={{ fontSize: 11, color: token("muted-foreground") }}>
                  {`${w.sessions} session${w.sessions === 1 ? "" : "s"}`}
                </Text>
              </View>
            </View>
          );
        })}
        <SectionTitle label="SETTLED" trailing="2" />
        {settled.map((s) => (
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, gap: 1 }}>
            <Text style={{ fontSize: 12.5, color: token("muted-foreground"), numberOfLines: 1 }}>{s.name}</Text>
            <Text style={{ fontSize: 11, color: token("faint") }}>{s.note}</Text>
          </View>
        ))}
        <SectionTitle label="SESSIONS" trailing="3" />
        {sessions.map((s) => (
          <View
            role="button"
            accessibilityLabel={`打开 ${s.title}`}
            class="hover:bg-hover"
            style={{ paddingHorizontal: 12, paddingVertical: 7, gap: 3 }}
            onPress={() => props.onOpenSession(`session:${s.title}`)}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              {s.state === "running" ? (
                <Dot tint={token("up")} size={6} />
              ) : s.state === "queued" ? (
                <Dot tint={token("info")} size={6} />
              ) : (
                <Glyph name="check" size={11} tint={token("faint")} />
              )}
              <Text style={{ flex: 1, fontSize: 12.5, color: token("foreground"), numberOfLines: 1 }}>{s.title}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 13 }}>
              <Chip label={s.model} />
              <Text style={{ fontSize: 11, color: token("faint") }}>{s.cost}</Text>
            </View>
          </View>
        ))}
      </Scroll>
    </View>
  );
}

// --- The canvas. ------------------------------------------------------------

/** The workbench: rail · projects · canvas. The canvas is a controlled
 * `DockArea`; every sheet op below is a pure edit of the layout value. */
function App() {
  const layout = signal<DockAreaLayout>(initialLayout());
  const zoomed = signal<string | null>(null);
  let area: DockAreaRef | undefined;
  let current: string | undefined;

  const openSheet = (id: string) => {
    const cur = layout();
    layout.set(hasSheet(cur, id) ? activateSheet(cur, id) : appendSheet(cur, id, current));
  };
  const addKind = (kind: SheetKind) => openSheet(nextSheetId(kind));
  const toggleZoom = () => {
    if (zoomed()) {
      area?.toggleZoom(null);
      return;
    }
    if (!current) return;
    void area?.groupOf(current).then((group) => {
      if (group != null) area?.toggleZoom(group);
    });
  };

  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "row" }}>
      <Rail />
      <Sidebar onOpenSession={openSheet} />
      <View class="flex-1 bg-inset" style={{ flexDirection: "column" }}>
        {/* The canvas toolbar: add a sheet of a kind to the shown group,
            zoom the group, or put the workbench back. */}
        <View class="flex-row items-center gap-1.5 border-b border-line bg-background px-2" style={{ height: 40 }}>
          {TOOLBAR_KINDS.map((kind) => (
            <View
              role="button"
              accessibilityLabel={`添加 ${TOOLBAR_LABELS[kind]}`}
              class="h-7 flex-row items-center gap-1 rounded-lg border border-line px-2 hover:bg-hover active:opacity-70"
              onPress={() => addKind(kind)}
            >
              <Glyph name="plus" size={11} tint={token("muted-foreground")} />
              <Text class="text-[12px] font-medium text-muted-foreground">{TOOLBAR_LABELS[kind]}</Text>
            </View>
          ))}
          <View style={{ flex: 1 }} />
          <View
            role="button"
            accessibilityLabel="Zoom"
            class={zoomed() ? "h-7 items-center justify-center rounded-lg border border-primary px-2.5" : "h-7 items-center justify-center rounded-lg border border-line px-2.5 hover:bg-hover"}
            onPress={toggleZoom}
          >
            <Text class={zoomed() ? "text-[12px] font-medium text-foreground" : "text-[12px] font-medium text-muted-foreground"}>Zoom</Text>
          </View>
          <View
            role="button"
            accessibilityLabel="重置布局"
            class="h-7 items-center justify-center rounded-lg border border-line px-2.5 hover:bg-hover active:opacity-70"
            onPress={() => layout.set(initialLayout())}
          >
            <Text class="text-[12px] font-medium text-muted-foreground">重置</Text>
          </View>
        </View>

        <DockArea
          ref={(r) => (area = r)}
          class="flex-1"
          layout={layout()}
          onLayoutChange={({ layout: next }) => layout.set(next)}
          onPanelActiveChange={({ panel, active }) => {
            if (active) current = panel;
          }}
          onPanelRemove={({ panel }) => {
            if (current === panel) current = undefined;
          }}
          onZoomChange={({ panel }) => zoomed.set(panel)}
          groupClass="flex-1 border border-line bg-card"
          tabBarClass="flex-row gap-0.5 border-b border-line px-1 pt-1"
          tabClass="group"
          contentClass="flex-1"
          handleClass="basis-px bg-line"
          handleThumbClass={HANDLE_THUMB}
          dockClass="bg-card"
          dropIndicatorClass="rounded-lg border-2 border-brand bg-brand-tint"
          renderTab={(tab) => (
            <View class="relative h-9 flex-row items-center gap-1.5 px-3">
              <Glyph name={sheetGlyph(tab.panel)} size={12} tint={tab.active ? token("foreground") : token("faint")} />
              <Text
                class={`max-w-44 text-[13px] font-medium transition-colors ${tab.active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
                style={{ numberOfLines: 1 }}
              >
                {sheetTitle(tab.panel)}
              </Text>
              {tab.closable && (platform.desktop || tab.active) ? (
                <View
                  role="button"
                  accessibilityLabel={`关闭 ${sheetTitle(tab.panel)}`}
                  class="absolute right-1 top-2 size-5 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-raised"
                  onPress={() => area?.closePanel(tab.panel)}
                >
                  <Text class="text-[13px] text-muted-foreground">×</Text>
                </View>
              ) : null}
              {tab.active ? (
                <View class="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-primary" style={{ pointerEvents: "none" }} />
              ) : null}
            </View>
          )}
          renderDock={(dock) => (
            <View class="h-8 flex-row items-center border-b border-line pl-3 pr-1">
              <Text class="flex-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
                {DOCK_TITLES[dock.placement] ?? dock.placement}
              </Text>
              <View
                role="button"
                accessibilityLabel={`收起 ${DOCK_TITLES[dock.placement] ?? dock.placement}`}
                class="rounded-md px-2 py-0.5 hover:bg-hover active:opacity-70"
                onPress={() => area?.toggleDock(dock.placement)}
              >
                <Text class="text-xs font-medium text-muted-foreground">收起</Text>
              </View>
            </View>
          )}
          renderPanel={(panel) => <SheetBody id={panel.id} />}
          renderEmpty={() => (
            <View class="flex-1 items-center justify-center gap-1 bg-card">
              <Text class="text-sm font-semibold text-foreground">画布已空</Text>
              <Text class="text-xs text-muted-foreground">从上方工具栏加一个 sheet，或重置布局</Text>
            </View>
          )}
        />

        <View class="flex-row items-center gap-4 border-t border-line bg-background px-3" style={{ height: 26 }}>
          <Text class="text-[11px] tabular-nums text-faint">{`${sheetCount(layout())} sheets`}</Text>
          {zoomed() ? <Text class="text-[11px] text-faint">已放大一个 panel</Text> : null}
          <View style={{ flex: 1 }} />
          <Text class="text-[11px] text-faint">拖页签换 panel · 拖到组边缘分栏 · 拖手调大小 · 页签上 × 关闭</Text>
        </View>
      </View>
    </View>
  );
}

mount(App);
