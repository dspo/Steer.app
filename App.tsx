import { mount, Scroll, signal, Text, token, View } from "nsh";
import { DockArea, type DockAreaLayout, type DockAreaRef } from "nsh/base";
import { connect, info, lastError, phase } from "./engine";
import { hasSheet, initialLayout, sheetCount } from "./dock";
import { error as sessionError, openSession, refreshSessions, sessions, activeId } from "./sessions";
import { SheetBody, sheetGlyph, sheetTitle } from "./sheets";
import { Chip, Dot, Glyph, Logo, SectionTitle } from "./ui";

/**
 * Zu's shell: the engine's state, the session list, and the canvas.
 *
 * M1 keeps one canvas per app (the dock is its final shape, fed here by a
 * single session sheet). The sidebar lists every pi session on disk,
 * whatever created it; opening one shows its transcript.
 */

let booted = false;

async function boot(): Promise<void> {
  await connect();
  if (phase() === "connected") await refreshSessions();
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

const PHASE_LABEL: Record<string, string> = {
  stopped: "未启动",
  starting: "启动中",
  connected: "运行中",
  error: "错误",
};

const PHASE_TINT: Record<string, string> = {
  stopped: "faint",
  starting: "warn",
  connected: "up",
  error: "destructive",
};

/** The edge rail: the app mark and the global panes (static in M1). */
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
      <Each of={panes} key="index">
        {(pane, index) => (
          <View
            role="button"
            accessibilityLabel={pane().id}
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

/** Every pi session on disk; a press opens it in the canvas. */
function Sidebar() {
  const rows = sessions();
  const open = activeId();
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 244 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 }}>
        <Glyph name="chat" size={15} tint={token("muted-foreground")} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: token("foreground") }}>Sessions</Text>
        <Chip label={String(rows.length)} />
      </View>
      <Scroll style={{ flex: 1, paddingBottom: 12 }}>
        <If
          when={rows.length === 0}
          else={
            <Each of={rows} key={(row) => row.path}>
              {(row) => {
                const meta = row();
                const active = meta.id === open;
                return (
                  <View
                    role="button"
                    accessibilityLabel={`Open ${meta.name || meta.preview || meta.id}`}
                    class={active ? "bg-accent" : "hover:bg-hover"}
                    style={{ paddingHorizontal: 12, paddingVertical: 7, gap: 2 }}
                    onPress={() => void openSession(meta.path)}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: active ? "600" : "400", color: token("foreground"), numberOfLines: 1 }}>
                      {meta.name || meta.preview || meta.id}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 10.5, color: token("faint"), numberOfLines: 1 }}>
                        {shortPath(meta.cwd)}
                      </Text>
                      <View style={{ flex: 1 }} />
                      <Text style={{ fontSize: 10.5, color: token("faint") }}>{`${meta.messageCount}`}</Text>
                      <Text style={{ fontSize: 10.5, color: token("faint") }}>{relative(meta.modified)}</Text>
                    </View>
                  </View>
                );
              }}
            </Each>
          }
        >
          <View style={{ paddingHorizontal: 12, paddingVertical: 16 }}>
            <Text style={{ fontSize: 12, color: token("muted-foreground") }}>还没有会话。用 pi 或 Zu 开始一个。</Text>
          </View>
        </If>
      </Scroll>
    </View>
  );
}

/** The engine's state as a chip and the actions that change it. */
function EngineBar() {
  const state = phase();
  const details = info();
  const failure = lastError();
  return (
    <View class="flex-row items-center gap-2 border-b border-line bg-background px-3" style={{ height: 40 }}>
      <Dot tint={token(PHASE_TINT[state] as any)} size={7} />
      <Text class="text-[12px] font-medium text-foreground">{PHASE_LABEL[state] ?? state}</Text>
      <If when={!!details}>
        <Text class="text-[11px] text-faint">{`pi ${details?.pi} · protocol ${details?.protocol}`}</Text>
      </If>
      <If when={state === "error" || state === "stopped"}>
        <View
          role="button"
          accessibilityLabel="Connect"
          class="h-6 items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-70"
          onPress={() => void boot()}
        >
          <Text class="text-[11px] font-medium text-foreground">{state === "error" ? "重试" : "启动引擎"}</Text>
        </View>
      </If>
      <View style={{ flex: 1 }} />
      <If when={!!failure}>
        <Text class="text-[11px] text-destructive" style={{ numberOfLines: 1 }}>
          {failure ?? ""}
        </Text>
      </If>
      <View
        role="button"
        accessibilityLabel="Refresh sessions"
        class="h-6 items-center justify-center rounded-md border border-line px-2 hover:bg-hover active:opacity-70"
        onPress={() => void refreshSessions()}
      >
        <Text class="text-[11px] font-medium text-muted-foreground">刷新</Text>
      </View>
    </View>
  );
}

/** The workbench: rail · sessions · canvas. */
function App() {
  if (!booted) {
    booted = true;
    void boot();
  }
  const layout = signal<DockAreaLayout>(initialLayout());
  let area: DockAreaRef | undefined;
  const zoomed = signal<string | null>(null);
  const failure = sessionError();
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "row" }}>
      <Rail />
      <Sidebar />
      <View class="flex-1 bg-inset" style={{ flexDirection: "column" }}>
        <EngineBar />
        <DockArea
          ref={(r) => (area = r)}
          class="flex-1"
          layout={layout()}
          onLayoutChange={({ layout: next }) => layout.set(next)}
          onZoomChange={({ panel }) => zoomed.set(panel)}
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
              <Text class="text-sm font-semibold text-foreground">选一个会话</Text>
              <Text class="text-xs text-muted-foreground">左侧列出 pi 的全部会话</Text>
            </View>
          )}
        />
        <View class="flex-row items-center gap-4 border-t border-line bg-background px-3" style={{ height: 26 }}>
          <Text class="text-[11px] tabular-nums text-faint">{`${sheetCount(layout())} sheets`}</Text>
          <Text class="text-[11px] text-faint">{`${sessions().length} sessions`}</Text>
          <View style={{ flex: 1 }} />
          <If when={!!failure}>
            <Text class="text-[11px] text-destructive">{failure ?? ""}</Text>
          </If>
          <Text class="text-[11px] text-faint">拖页签换 panel · 拖到组边缘分栏 · 拖手调大小</Text>
        </View>
      </View>
    </View>
  );
}

mount(App);
