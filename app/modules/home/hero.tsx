import { effect, keymap, signal, Text, token, View } from "nsh";
import { Dialog, Input, Menu, MenuItem, MenuSeparator, Submenu } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { baseName } from "../../domains/fs";
import {
  containerProject,
  createProject,
  heroLocked,
  heroProjectId,
  heroStarting,
  loadProjects,
  projectError,
  projects,
} from "../../core/projects";
import { activeContainerId, containers, containersLoaded } from "../../core/containers";
import type { TerminalAction } from "../../domains/pty";
import { homeSheetContainer } from "../../core/dock";
import type { ProjectRecord } from "../../core/types";
import { dispatchIntent } from "../../core/registry";
import type { BrandName } from "../../ui/brand-icons";
import { Glyph, motionStyle, shadowDialog, shadowRaised, type GlyphName } from "../../ui/ui";
import { heroStarters, heroTools } from "../../core/registry";
import { shellActions } from "../../core/shell-actions";
import {
  loadPiModels,
  modelId,
  modelLabel,
  piModelsError,
  usableModels,
} from "../../domains/pimodels";
import { PI_EFFORTS } from "../../domains/pimodels";
import { BrandIcon } from "../../ui/brand-icons";

/**
 * The Hero sheet: the canvas's start page (`home:{containerId}` inside a
 * container, `home:scratch` on the scratch canvas), composer first and
 * container second. In a container it starts the conversation in that
 * container; on the scratch canvas it mints one in the chosen project.
 */

type ExternalKind = "Terminal" | "Claude" | "Codex" | "Copilot";

const AGENT_ACTIONS: Array<{ kind: ExternalKind; key: keyof typeof K.external; brand: BrandName }> = [
  { kind: "Claude", key: "claude", brand: "claude" },
  { kind: "Codex", key: "codex", brand: "codex" },
  { kind: "Copilot", key: "copilot", brand: "copilot" },
];

const EXTERNAL_GLYPH: Record<ExternalKind, GlyphName> = {
  Terminal: "terminal",
  Claude: "code",
  Codex: "gear",
  Copilot: "branch",
};

/** What a container Hero's external action runs: the kind's own CLI. */
const EXTERNAL_ACTION: Record<ExternalKind, TerminalAction> = {
  Terminal: "shell",
  Claude: "Claude",
  Codex: "Codex",
  Copilot: "Copilot",
};

/**
 * A canvas's Hero. `home:scratch` has no container: its project chip picks
 * the project the first message will create a container in. A container's
 * Hero is that container's start page — its chip shows where the container
 * lives, and the composer goes to the container's captain session.
 */
/** The harness the Hero's composer addresses: the shell's Pi or a
 * contributed submitter (manox). In-memory for now; a settings key lands
 * with the settings batch. */
const heroHarness = signal<string>("pi");
/** The selected model id (`provider/model`), from the machine's pi list. */
const heroModelId = signal<string | null>(null);
/** The selected reasoning effort (pi's own levels; high is the everyday default). */
const heroEffort = signal<string>("high");

export function HeroSheet(props: { id: string }) {
  const draft = signal("");
  const focused = signal(false);
  const busy = signal<string | null>(null);
  effect(() => {
    void loadPiModels();
  });
  const containerId = () => homeSheetContainer(props.id);
  const container = () => containers().find((row) => row.id === containerId());
  const scratch = () => containerId() === null;
  // Only a Pi container can host a Pi session; a terminal/TUI container's
  // Hero starts the conversation in a new Pi container instead.
  // The scratch Hero's chip is the page's target; a container's is a fact.
  const locked = () => (scratch() ? heroLocked() : true);
  const projectOf = () => {
    if (scratch()) return heroProjectId();
    const record = container();
    return record ? containerProject(record) : null;
  };
  /** Where a new Pi container goes: the Hero's project, and its cwd when the
   * Hero is a container's (the scratch one lets the engine choose). */
  const piTarget = () => (scratch() ? { projectId: heroProjectId() } : { cwd: container()!.cwd, projectId: projectOf() });
  const starting = () => busy() !== null || heroStarting();
  // A registry whose first load is still in flight must not be raced by a
  // create (the load's empty-state reset would win). A store that already
  // holds rows is past that point; fixtures seed it directly.
  const readyToCreate = () => !scratch() || containersLoaded() || containers().length > 0;
  // DESIGN §4.1: on the scratch canvas an action that mints a workspace needs
  // a project first; only the browser and the chip work without one.
  const needsProject = () => scratch() && heroProjectId() === null;
  const canStart = () => draft().trim().length > 0 && !starting() && readyToCreate();
  // A contributed harness goes through its submitter whatever the canvas: a
  // manox thread is its own container, not this canvas's session.
  const submitter = () => heroStarters().find((row) => row.id === heroHarness()) ?? null;
  const chosenModel = () => {
    const id = heroModelId();
    if (id) return id;
    return usableModels()[0] ? modelId(usableModels()[0].provider.id, usableModels()[0].model.id) : null;
  };
  const projectCwd = () => {
    const id = projectOf();
    if (id === null) return null;
    const record = projects().find((project) => project.id === id);
    return record?.roots.find((root) => root.primary)?.path ?? record?.roots[0]?.path ?? null;
  };
  const submit = () => {
    if (!canStart()) return;
    const text = draft();
    const id = containerId();
    draft.set("");
    busy.set("send");
    const done = () => busy.set(null);
    const harness = submitter();
    if (harness) {
      void harness
        .submit(text, { cwd: projectCwd(), model: chosenModel(), effort: heroEffort(), sheetId: props.id })
        .catch(() => {})
        .finally(done);
      return;
    }
    const target = id
      ? { containerId: id, sheetId: props.id }
      : { cwd: scratch() ? undefined : piTarget().cwd, projectId: projectOf() };
    void Promise.resolve(
      dispatchIntent(
        "pi.submit",
        { text, model: chosenModel(), effort: heroEffort(), ...target },
        { containerId: id },
      ),
    ).finally(done);
  };
  // Cmd+Enter is the explicit send lane; Return (and Shift+Return for a line
  // break) already belongs to the Input. The binding follows the focused
  // composer, so it cannot fire from another surface.
  effect(() => {
    if (!focused()) return;
    return keymap.bind("mod+enter", () => submit(), { when: "always" });
  });
  const startExternal = async (kind: ExternalKind) => {
    if (busy() || !readyToCreate()) return;
    const id = containerId();
    // In a container, the shell or TUI is a terminal resource of *that*
    // container: the Hero's tab becomes the terminal's and the sidebar keeps
    // one row. The scratch canvas has no container to hold one, so it still
    // mints an external one (the project chip's target, §2.1-3).
    if (id) {
      void dispatchIntent(
        "terminal.open",
        { containerId: id, action: EXTERNAL_ACTION[kind], fromSheet: props.id },
        { containerId: id },
      );
      return;
    }
    busy.set(kind);
    try {
      // The scratch canvas mints a real container for the action; its
      // canvas takes over (the terminal sheet is that container's).
      await dispatchIntent(
        "terminal.createExternal",
        { action: EXTERNAL_ACTION[kind], projectId: projectOf() },
        { containerId: null },
      );
      await loadProjects();
    } finally {
      busy.set(null);
    }
  };
  const startPi = async () => {
    if (busy() || !readyToCreate()) return;
    const id = containerId();
    // In a container, Pi is the native CLI as a terminal resource of *that*
    // container (F3): the Hero's tab becomes the TUI's, and the Zu session
    // stays exactly where it was. Only the composer starts a Zu session.
    if (id) {
      dispatchIntent("terminal.open", { containerId: id, action: "Pi", fromSheet: props.id }, { containerId: id });
      return;
    }
    busy.set("pi");
    try {
      // The scratch canvas has no container to host the TUI: mint the
      // container first (F3's boundary), then open `pi` inside it.
      const target = piTarget();
      const sheet = await dispatchIntent(
        "pi.create",
        { cwd: target.cwd ?? null, projectId: target.projectId },
        { containerId: null },
      );
      if (sheet) {
        await loadProjects();
        const id = activeContainerId();
        if (id) dispatchIntent("terminal.open", { containerId: id, action: "Pi" }, { containerId: id });
      }
    } finally {
      busy.set(null);
    }
  };
  const selectedName = () => {
    const id = projectOf();
    if (id === null) return t(K.project.chats);
    return projects().find((project) => project.id === id)?.name ?? t(K.project.title);
  };
  // A browser works on either canvas: on the scratch one its page is held
  // there until the Hero mints a container, then it moves with it.
  const browse = () => {
    // The browser takes the Hero's tab: acting on the Hero consumes it.
    dispatchIntent(
      "browser.open",
      { containerId: containerId(), replace: props.id },
      { containerId: containerId() },
    );
  };
  // A stale `home:{id}` (its container archived) has nothing to start.
  if (!scratch() && !container()) {
    return (
      <View class="flex-1 items-center justify-center bg-background" style={{ paddingHorizontal: 32 }}>
        <Text class="text-[12px] text-muted-foreground">{t(K.container.empty)}</Text>
      </View>
    );
  }
  return (
    <View class="flex-1 items-center justify-center bg-background" style={{ paddingHorizontal: 32, paddingVertical: 32 }}>
      <View style={{ width: "100%", maxWidth: 720, gap: 18 }}>
        <Text class="text-[15px] font-bold text-foreground" style={{ textAlign: "center" }}>
          {t(K.hero.title)}
        </Text>

        {/* The project chip sits ABOVE the composer, left-aligned: it names
            where the first message lands before any typing (2026-11-13
            redesign). A container's chip is a fact, the scratch one picks. */}
        <View class="flex-row items-center" style={{ gap: 0 }}>
          <View class="flex-row items-center gap-1.5">
            <Glyph name="folder" size={12} tint={token("muted-foreground")} />
            <If
              when={locked()}
              else={
                <Menu
                  trigger={
                    <View
                      role="button"
                      testID="hero-project"
                      accessibilityLabel={t(K.hero.project)}
                      class="h-7 flex-row items-center gap-1 rounded-lg px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                      style={{ ...motionStyle("fast") }}
                    >
                      <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                        {selectedName()}
                      </Text>
                      <Glyph name="caret-down" size={9} tint={token("faint")} />
                    </View>
                  }
                  popupClass="rounded-xl border border-border bg-popover p-1"
                  popupStyle={{ boxShadow: shadowRaised() }}
                >
                  <MenuItem class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => heroProjectId.set(null)}>
                    <Text class="text-[12px] text-foreground">{t(K.project.chats)}</Text>
                  </MenuItem>
                  <Each of={projects()} key={(project) => project.id}>
                    {(project) => (
                      <MenuItem
                        testID={`hero-project-${project().id}`}
                        class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                        onSelect={() => heroProjectId.set(project().id)}
                      >
                        <Text class="text-[12px] text-foreground">{project().name}</Text>
                      </MenuItem>
                    )}
                  </Each>
                  <MenuSeparator class="my-1 h-px bg-line" />
                  <MenuItem
                    testID="hero-new-project"
                    class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                    onSelect={() => shellActions()?.openProjectDialog((project) => heroProjectId.set(project.id))}
                  >
                    <Text class="text-[12px] text-foreground">{t(K.project.create)}</Text>
                  </MenuItem>
                </Menu>
              }
            >
              <Text class="text-[12px] font-medium text-muted-foreground">{selectedName()}</Text>
            </If>
          </View>
        </View>

        {/* The composer as a card: a quiet rounded surface, generous padding
            (the 2026-11-13 redesign references Steer's hero — the input is
            the page's focal point, so it earns a box here). */}
        <View
          class="rounded-2xl border border-border bg-card"
          style={{ paddingHorizontal: 16, paddingVertical: 14, boxShadow: shadowRaised() }}
        >
          <Input
            testID="hero-input"
            value={draft()}
            onChange={({ value }) => draft.set(value)}
            multiline
            submitBehavior="submit"
            autoFocus
            placeholder={t(K.hero.placeholder)}
            onSubmit={submit}
            onFocus={() => focused.set(true)}
            onBlur={() => focused.set(false)}
            style={{
              minHeight: 88,
              paddingHorizontal: 0,
              paddingVertical: 0,
              fontSize: 14,
              lineHeight: 21,
              color: token("foreground"),
              placeholderColor: token("faint"),
              caretColor: token("primary"),
              selectionColor: token("brand"),
              backgroundColor: "transparent",
              borderWidth: 0,
            }}
          />
          {/* The pickers live INSIDE the composer, on its bottom bar (the
              Steer idiom): the harness toggle and the model/effort menus are
              footer controls of the input, not a row beneath it. One model
              list for every harness: the machine's pi configuration (cx's
              provider set is not used). */}
          <View
            class="flex-row items-center gap-2"
            style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: token("line") }}
          >
            <View class="flex-row items-center rounded-md bg-inset" style={{ padding: 2, ...motionStyle("fast") }}>
              <HarnessOption testID="hero-harness-pi" label="Pi" active={heroHarness() === "pi"} onPress={() => heroHarness.set("pi")} />
              <Each of={heroStarters()} key={(row) => row.id}>
                {(row) => (
                  <HarnessOption
                    testID={`hero-harness-${row().id}`}
                    label={row().label}
                    active={heroHarness() === row().id}
                    onPress={() => heroHarness.set(row().id)}
                  />
                )}
              </Each>
            </View>
            <ModelPicker
              testID="hero-model"
              selected={chosenModel()}
              onSelect={(id) => heroModelId.set(id)}
              refresh={() => void loadPiModels()}
            />
            <EffortPicker selected={heroEffort()} onSelect={(level) => heroEffort.set(level)} />
            <View style={{ flex: 1 }} />
          </View>
        </View>

        {/* Or-open divider, then the direct entries as generous pills. */}
        <View class="flex-row items-center gap-3" style={{ marginTop: 6 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: token("line") }} />
          <Text class="text-[10.5px] text-faint">{t(K.hero.orOpen)}</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: token("line") }} />
        </View>
        <View class="flex-row flex-wrap items-center gap-3">
          <HeroTool
            testID="external-terminal"
            label={t(K.external.terminal)}
            glyph={EXTERNAL_GLYPH.Terminal}
            disabled={starting() || !readyToCreate() || needsProject()}
            busy={busy() === "Terminal"}
            onPress={() => void startExternal("Terminal")}
          />
          <HeroTool
            testID="hero-browser"
            label={t(K.browser.open)}
            glyph="globe"
            disabled={starting()}
            onPress={browse}
          />
          <Each of={AGENT_ACTIONS} key={(action) => action.kind}>
            {(action) => {
              const value = action();
              return (
                <HeroTool
                  testID={`external-${value.kind.toLowerCase()}`}
                  label={t(K.external[value.key])}
                  brand={value.brand}
                  disabled={starting() || !readyToCreate() || needsProject()}
                  busy={busy() === value.kind}
                  onPress={() => void startExternal(value.kind)}
                />
              );
            }}
          </Each>
          <HeroTool
            testID="hero-pi"
            label={t(K.external.pi)}
            brand="pi"
            disabled={starting() || !readyToCreate() || needsProject()}
            busy={busy() === "pi"}
            onPress={() => void startPi()}
          />
          <Each of={heroTools()} key={(tool) => tool.id}>
            {(tool) => (
              <View
                role="button"
                testID={tool().testID}
                accessibilityLabel={tool().label}
                disabled={tool().disabled?.() ?? false}
                class={
                  (tool().disabled?.() ?? false)
                    ? "h-11 flex-row items-center gap-2 rounded-xl border border-line bg-card px-4 opacity-40"
                    : "h-11 flex-row items-center gap-2 rounded-xl border border-line bg-card px-4 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                }
                style={{ ...motionStyle("fast") }}
                onPress={() => {
                  if (!(tool().disabled?.() ?? false)) tool().onPress();
                }}
              >
                <Glyph name={(tool().glyph ?? "file") as GlyphName} size={15} tint={token("muted-foreground")} />
                <Text class="text-[12.5px] font-medium text-foreground">{tool().label}</Text>
              </View>
            )}
          </Each>
        </View>

        <If when={!!projectError()}>
          <Text class="text-center text-[11px] text-destructive" style={{ numberOfLines: 2 }}>
            {projectError() ?? ""}
          </Text>
        </If>
      </View>
    </View>
  );
}

/** One direct tool below the hero composer. */
function HeroTool(props: {
  testID: string;
  label: string;
  glyph?: GlyphName;
  brand?: BrandName;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const disabled = () => props.disabled ?? false;
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      disabled={disabled()}
      class={
        disabled()
          ? "h-11 flex-row items-center gap-2 rounded-xl border border-line bg-card px-4 opacity-40"
          : "h-11 flex-row items-center gap-2 rounded-xl border border-line bg-card px-4 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      }
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!disabled()) props.onPress();
      }}
    >
      {props.brand ? (
        <BrandIcon brand={props.brand} size={15} tint={token("muted-foreground")} />
      ) : (
        <Glyph name={props.glyph ?? "file"} size={15} tint={token("muted-foreground")} />
      )}
      <Text class="text-[12.5px] font-medium text-foreground">{props.busy ? "…" : props.label}</Text>
    </View>
  );
}

/** One arm of the harness segment: the active arm reads as a raised chip. */
function HarnessOption(props: { testID: string; label: string; active: boolean; onPress: () => void }) {
  return (
    <View
      role="button"
      testID={props.testID}
      accessibilityLabel={props.label}
      class={
        props.active
          ? "h-5.5 items-center justify-center rounded bg-background px-2 shadow-[0_0_0_1px_token(border)]"
          : "h-5.5 items-center justify-center rounded px-2"
      }
      style={{ ...motionStyle("fast") }}
      onPress={props.onPress}
    >
      <Text class={props.active ? "text-[10.5px] font-semibold text-foreground" : "text-[10.5px] font-medium text-muted-foreground"}>
        {props.label}
      </Text>
    </View>
  );
}

/** The model picker: the machine's pi list behind a two-level menu — one
 * submenu per provider, its models inside. The trigger reads like the
 * session composer's own footer control (`provider · model`). */
function ModelPicker(props: { testID: string; selected: string | null; onSelect: (id: string) => void; refresh: () => void }) {
  const rows = () => usableModels();
  const error = () => piModelsError();
  const providers = () => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const row of rows()) {
      if (!seen.has(row.provider.id)) seen.set(row.provider.id, { id: row.provider.id, name: row.provider.name || row.provider.id });
    }
    return [...seen.values()];
  };
  const modelsOf = (providerId: string) => rows().filter((row) => row.provider.id === providerId);
  const label = () => {
    const id = props.selected;
    const hit = rows().find((row) => modelId(row.provider.id, row.model.id) === id);
    if (hit) return `${hit.provider.name || hit.provider.id} · ${modelLabel(hit)}`;
    return t(K.hero.model);
  };
  return (
    <Menu
      trigger={
        <View
          role="button"
          testID={props.testID}
          accessibilityLabel={t(K.hero.model)}
          class="h-6 min-w-0 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
          onPress={props.refresh}
        >
          <Text class="min-w-0 text-[11px] text-muted-foreground" style={{ numberOfLines: 1 }}>
            {label()}
          </Text>
          <Glyph name="caret-down" size={8} tint={token("faint")} />
        </View>
      }
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 300, maxHeight: 420, boxShadow: shadowRaised() }}
    >
      <If
        when={rows().length > 0}
        else={
          <MenuItem class="rounded-lg px-2.5 py-1.5" disabled>
            <Text class="text-[11.5px] text-faint">{error() ?? t(K.hero.modelNone)}</Text>
          </MenuItem>
        }
      >
        <Each of={providers()} key={(provider) => provider.id}>
          {(provider) => (
            <Submenu
              trigger={
                <View
                  role="button"
                  testID={`hero-provider-${provider().id}`}
                  accessibilityLabel={provider().name}
                  class="flex-row items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                  style={{ ...motionStyle("fast") }}
                >
                  <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1, flex: 1 }}>
                    {provider().name}
                  </Text>
                  <Glyph name="chevron-right" size={10} tint={token("faint")} />
                </View>
              }
            >
              <Each of={modelsOf(provider().id)} key={(row) => modelId(row.provider.id, row.model.id)}>
                {(row) => {
                  const value = row();
                  const id = modelId(value.provider.id, value.model.id);
                  return (
                    <MenuItem
                      testID={`hero-model-${value.provider.id}-${value.model.id}`}
                      class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                      onSelect={() => props.onSelect(id)}
                    >
                      <Text class="text-[12px] text-foreground" style={{ numberOfLines: 1 }}>
                        {modelLabel(value)}
                      </Text>
                    </MenuItem>
                  );
                }}
              </Each>
            </Submenu>
          )}
        </Each>
      </If>
    </Menu>
  );
}

/** The reasoning-effort picker: pi's own ladder, one small menu. */
function EffortPicker(props: { selected: string; onSelect: (level: string) => void }) {
  return (
    <Menu
      trigger={
        <View
          role="button"
          testID="hero-effort"
          accessibilityLabel={t(K.hero.effort)}
          class="h-6 min-w-0 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
          style={{ ...motionStyle("fast") }}
        >
          <Glyph name="chat" size={10} tint={token("faint")} />
          <Text class="text-[11px] text-muted-foreground">{props.selected}</Text>
          <Glyph name="caret-down" size={8} tint={token("faint")} />
        </View>
      }
      popupClass="rounded-xl border border-border bg-popover p-1"
      popupStyle={{ width: 160, boxShadow: shadowRaised() }}
    >
      <Each of={[...PI_EFFORTS]} key={(level) => level}>
        {(level) => (
          <MenuItem
            testID={`hero-effort-${level()}`}
            class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
            onSelect={() => props.onSelect(level())}
          >
            <Text class={level() === props.selected ? "text-[12px] font-semibold text-foreground" : "text-[12px] text-foreground"}>
              {level()}
            </Text>
          </MenuItem>
        )}
      </Each>
    </Menu>
  );
}
