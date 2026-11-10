import { mount, Scroll, signal, Text, token, View } from "nsh";
import { DockArea, type DockAreaLayout } from "nsh/base";
import { connect, disconnect, info, lastError, phase, recovered, retry, type EnginePhase } from "./engine";
import { initialLayout, sheetCount } from "./dock";
import { error as sessionError, openSession, refreshSessions, sessions, activeId } from "./sessions";
import { SheetBody, sheetGlyph, sheetTitle } from "./sheets";
import { K, shellLocale, t, toggleShellLocale } from "./i18n";
import { UIHost, statuses, unsupportedMethods } from "./ui-host";
import { Chip, Dot, Glyph, Logo } from "./ui";

/**
 * Zu's shell: the engine's state, the session list, and the canvas.
 *
 * M1 keeps one canvas per app (the dock is its final shape, fed here by a
 * single session sheet). The sidebar lists every pi session on disk,
 * whatever created it; opening one shows its transcript. M2 adds the
 * supervised connection, the extension UI host and the copy table.
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

/** The edge rail: the app mark and the global panes (static in M1). */
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

/** Every pi session on disk; a press opens it in the canvas. */
function Sidebar() {
  return (
    <View class="bg-sidebar border-r border-line" style={{ width: 244 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 4 }}>
        <Glyph name="chat" size={15} tint={token("muted-foreground")} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: token("foreground") }}>{t(K.sidebar.title)}</Text>
        <Chip label={String(sessions().length)} />
      </View>
      <Scroll style={{ flex: 1, paddingBottom: 12 }}>
        <If
          when={sessions().length === 0}
          else={
            <Each of={sessions()} key={(row) => row.path}>
              {(row) => {
                const meta = row();
                const active = meta.id === activeId();
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
            <Text style={{ fontSize: 12, color: token("muted-foreground") }}>{t(K.sidebar.empty)}</Text>
          </View>
        </If>
      </Scroll>
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
          onPress={() => void (phase() === "stopped" ? boot() : retry())}
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

/** The workbench: rail · sessions · canvas. */
function App() {
  if (!booted) {
    booted = true;
    void boot();
  }
  const layout = signal<DockAreaLayout>(initialLayout());
  return (
    <View class="flex-1 bg-background" style={{ flexDirection: "row" }}>
      <Rail />
      <Sidebar />
      <View class="flex-1 bg-inset" style={{ flexDirection: "column" }}>
        <EngineBar />
        <DockArea
          class="flex-1"
          layout={layout()}
          onLayoutChange={({ layout: next }) => layout.set(next)}
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
        <View class="flex-row items-center gap-4 border-t border-line bg-background px-3" style={{ height: 26 }}>
          <Text class="text-[11px] tabular-nums text-faint">{t(K.status.sheets, { count: sheetCount(layout()) })}</Text>
          <Text class="text-[11px] text-faint">{t(K.status.sessions, { count: sessions().length })}</Text>
          <If when={unsupportedMethods().length > 0}>
            <Text class="text-[11px] text-warn">
              {t(K.status.unsupported, { count: unsupportedMethods().length })}
            </Text>
          </If>
          <View style={{ flex: 1 }} />
          <If when={!!sessionError()}>
            <Text class="text-[11px] text-destructive">{sessionError() ?? ""}</Text>
          </If>
          <Text class="text-[11px] text-faint">{t(K.status.hint)}</Text>
        </View>
      </View>
      <UIHost />
    </View>
  );
}

mount(App);
