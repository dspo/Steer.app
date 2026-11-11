import { effect, keymap, signal, Text, token, View } from "nsh";
import { Dialog, Input, Menu, MenuItem, MenuSeparator } from "nsh/base";
import { K, t } from "./i18n";
import {
  closeLauncher,
  createProject,
  launcherLocked,
  launcherProjectId,
  launcherStarting,
  loadProjects,
  projectError,
  projects,
  startFromLauncher,
} from "./projects";
import {
  activeContainerId,
  containers,
  containersLoaded,
  createContainer,
  createExternalContainer,
} from "./containers";
import { openBrowserSheet } from "./browser";
import type { ContainerKind, ProjectRecord } from "./contracts/protocol";
import { Glyph, motionStyle, shadowDialog, shadowRaised, type GlyphName } from "./ui";
import { pickFolder } from "./picker";
import {
  addProjectRoot,
  removeProjectRoot,
  rootPayload,
  setPrimaryProjectRoot,
  type RootDraft,
} from "./project-roots";

/**
 * The Launcher: composer first, container second. It shows on an empty
 * canvas and after a "+", optionally locked to the project row that opened
 * it. The project chip changes the target unless locked.
 */

const AGENT_ACTIONS: Array<{ kind: Exclude<ContainerKind, "Pi">; key: keyof typeof K.external; glyph: GlyphName }> = [
  { kind: "Claude", key: "claude", glyph: "code" },
  { kind: "Codex", key: "codex", glyph: "gear" },
  { kind: "Copilot", key: "copilot", glyph: "branch" },
];

const EXTERNAL_GLYPH: Record<Exclude<ContainerKind, "Pi">, GlyphName> = {
  Terminal: "terminal",
  Claude: "code",
  Codex: "gear",
  Copilot: "branch",
};

export function Launcher() {
  const draft = signal("");
  const focused = signal(false);
  const externalStarting = signal<string | null>(null);
  const piStarting = signal(false);
  // A registry whose first load is still in flight must not be raced by a
  // create (the load's empty-state reset would win). A store that already
  // holds rows is past that point; fixtures seed it directly.
  const readyToCreate = () => containersLoaded() || containers().length > 0;
  const canStart = () => draft().trim().length > 0 && !launcherStarting() && readyToCreate();
  const submit = () => {
    if (!canStart()) return;
    const text = draft();
    draft.set("");
    void startFromLauncher(text);
  };
  // Cmd+Enter is the explicit send lane; Return (and Shift+Return for a line
  // break) already belongs to the Input. The binding follows the focused
  // composer, so it cannot fire from another surface.
  effect(() => {
    if (!focused()) return;
    return keymap.bind("mod+enter", () => submit(), { when: "always" });
  });
  const startExternal = async (kind: Exclude<ContainerKind, "Pi">) => {
    if (externalStarting() || !readyToCreate()) return;
    externalStarting.set(kind);
    try {
      const id = await createExternalContainer(kind, launcherProjectId());
      if (id) {
        await loadProjects();
        closeLauncher();
      }
    } finally {
      externalStarting.set(null);
    }
  };
  const startPi = async () => {
    if (piStarting() || !readyToCreate()) return;
    piStarting.set(true);
    try {
      const id = await createContainer(undefined, launcherProjectId());
      if (id) {
        await loadProjects();
        closeLauncher();
      }
    } finally {
      piStarting.set(false);
    }
  };
  const selected = () => launcherProjectId();
  const selectedName = () => {
    const id = selected();
    if (id === null) return t(K.project.chats);
    return projects().find((project) => project.id === id)?.name ?? t(K.project.title);
  };
  const hint = () => keymap.label("mod+enter");
  return (
    <View class="flex-1 items-center justify-center bg-background" style={{ paddingHorizontal: 32, paddingVertical: 32 }}>
      <View style={{ width: "100%", maxWidth: 720, gap: 18 }}>
        <Text class="text-[15px] font-bold text-foreground" style={{ textAlign: "center" }}>
          {t(K.launcher.title)}
        </Text>

        {/* The same bare composer as an empty session's hero: no card, no
            shadow, no bubble around the input. */}
        <View style={{ gap: 6 }}>
          <Input
            testID="launcher-input"
            value={draft()}
            onChange={({ value }) => draft.set(value)}
            multiline
            submitBehavior="submit"
            autoFocus
            placeholder={t(K.launcher.placeholder)}
            onSubmit={submit}
            onFocus={() => focused.set(true)}
            onBlur={() => focused.set(false)}
            style={{
              minHeight: 72,
              paddingHorizontal: 2,
              paddingVertical: 4,
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
          <View class="flex-row items-center gap-2 border-t border-line" style={{ paddingTop: 8 }}>
            <View class="flex-row items-center gap-1.5">
              <Text class="text-[10.5px] font-medium text-faint">{t(K.launcher.project)}</Text>
              <If
                when={launcherLocked()}
                else={
                  <Menu
                    trigger={
                      <View
                        role="button"
                        testID="launcher-project"
                        accessibilityLabel={t(K.launcher.project)}
                        class="h-6 flex-row items-center gap-1 rounded-md px-1.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                        style={{ ...motionStyle("fast") }}
                      >
                        <Text class="text-[11px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                          {selectedName()}
                        </Text>
                        <Glyph name="caret-down" size={9} tint={token("faint")} />
                      </View>
                    }
                    popupClass="rounded-xl border border-border bg-popover p-1"
                    popupStyle={{ boxShadow: shadowRaised() }}
                  >
                    <MenuItem class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent" onSelect={() => launcherProjectId.set(null)}>
                      <Text class="text-[12px] text-foreground">{t(K.project.chats)}</Text>
                    </MenuItem>
                    <Each of={projects()} key={(project) => project.id}>
                      {(project) => (
                        <MenuItem
                          class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                          onSelect={() => launcherProjectId.set(project().id)}
                        >
                          <Text class="text-[12px] text-foreground">{project().name}</Text>
                        </MenuItem>
                      )}
                    </Each>
                    <MenuSeparator class="my-1 h-px bg-line" />
                    <MenuItem
                      testID="launcher-new-project"
                      class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                      onSelect={() => openProjectDialog((project) => launcherProjectId.set(project.id))}
                    >
                      <Text class="text-[12px] text-foreground">{t(K.project.create)}</Text>
                    </MenuItem>
                  </Menu>
                }
              >
                <Text class="text-[11px] font-medium text-muted-foreground">{selectedName()}</Text>
              </If>
            </View>
            <View style={{ flex: 1 }} />
            <Text class="text-[10px] text-faint" testID="launcher-hint">
              {launcherStarting() ? t(K.launcher.starting) : t(K.launcher.hint, { shortcut: hint() })}
            </Text>
          </View>
        </View>

        {/* Direct tools, left-aligned in two rows. No heading, no suffix:
            the labels are the actions. */}
        <View style={{ gap: 6, alignItems: "flex-start" }}>
          <View class="flex-row items-center gap-4">
            <LauncherTool
              testID="external-terminal"
              label={t(K.external.terminal)}
              glyph={EXTERNAL_GLYPH.Terminal}
              disabled={externalStarting() !== null || !readyToCreate()}
              busy={externalStarting() === "Terminal"}
              onPress={() => void startExternal("Terminal")}
            />
            <LauncherTool
              testID="launcher-browser"
              label={t(K.browser.open)}
              glyph="globe"
              disabled={activeContainerId() === null}
              onPress={() => {
                if (openBrowserSheet()) closeLauncher();
              }}
            />
          </View>
          <View class="flex-row flex-wrap items-center gap-4">
            <Each of={AGENT_ACTIONS} key={(action) => action.kind}>
              {(action) => {
                const value = action();
                return (
                  <LauncherTool
                    testID={`external-${value.kind.toLowerCase()}`}
                    label={t(K.external[value.key])}
                    glyph={value.glyph}
                    disabled={externalStarting() !== null || piStarting() || !readyToCreate()}
                    busy={externalStarting() === value.kind}
                    onPress={() => void startExternal(value.kind)}
                  />
                );
              }}
            </Each>
            <LauncherTool
              testID="launcher-pi"
              label={t(K.external.pi)}
              glyph="pi"
              disabled={piStarting() || externalStarting() !== null || !readyToCreate()}
              busy={piStarting()}
              onPress={() => void startPi()}
            />
          </View>
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
function LauncherTool(props: {
  testID: string;
  label: string;
  glyph: GlyphName;
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
          ? "h-6 flex-row items-center gap-1.5 rounded-md px-2 opacity-40"
          : "h-6 flex-row items-center gap-1.5 rounded-md px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      }
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!disabled()) props.onPress();
      }}
    >
      <Glyph name={props.glyph} size={11} tint={token("faint")} />
      <Text class="text-[11.5px] font-medium text-muted-foreground">{props.busy ? "…" : props.label}</Text>
    </View>
  );
}

/* Project creation ------------------------------------------------------- */

export const projectDialogOpen = signal(false);
const projectNameDraft = signal("");
const projectRootsDraft = signal<RootDraft[]>([]);
const projectDialogError = signal<string | null>(null);
const projectPicking = signal(false);
let projectCreated: ((project: ProjectRecord) => void) | null = null;

/** Opens the project dialog; `onCreated` adopts the new project (the Launcher's chip). */
export function openProjectDialog(onCreated?: (project: ProjectRecord) => void): void {
  projectNameDraft.set("");
  projectRootsDraft.set([]);
  projectDialogError.set(null);
  projectPicking.set(false);
  projectCreated = onCreated ?? null;
  projectDialogOpen.set(true);
}

function folderName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** The project creation dialog: a name and Finder-picked roots, no paths typed. */
export function ProjectDialog() {
  const isOpen = () => projectDialogOpen();
  const roots = () => projectRootsDraft();
  const canCreate = () => roots().length > 0 && !projectPicking();
  const choose = async () => {
    if (projectPicking()) return;
    projectPicking.set(true);
    projectDialogError.set(null);
    try {
      const path = await pickFolder(t(K.project.pickPrompt));
      if (path) projectRootsDraft.set(addProjectRoot(roots(), path));
    } catch (failure) {
      projectDialogError.set(t(K.project.pickFailed, { error: String(failure) }));
    } finally {
      projectPicking.set(false);
    }
  };
  const create = () => {
    if (!canCreate()) {
      projectDialogError.set(t(K.project.noRoots));
      return;
    }
    void createProject(projectNameDraft(), rootPayload(roots())).then((project) => {
      if (!project) {
        projectDialogError.set(projectError() ?? "create failed");
        return;
      }
      const adopt = projectCreated;
      projectCreated = null;
      projectDialogOpen.set(false);
      adopt?.(project);
    });
  };
  return (
    <Dialog
      testID="project-dialog"
      open={isOpen()}
      animation="fade"
      class="m-auto w-[480px] gap-4 rounded-xl border border-border bg-card p-5"
      style={{ boxShadow: shadowDialog() }}
      backdropClass="bg-scrim"
      onCancel={() => projectDialogOpen.set(false)}
    >
      <Text class="text-[15px] font-semibold text-foreground">{t(K.project.dialogTitle)}</Text>
      <Text class="text-[12px] text-muted-foreground">{t(K.project.name)}</Text>
      <Input
        testID="project-name"
        value={projectNameDraft()}
        onChange={({ value }) => projectNameDraft.set(value)}
        placeholder={t(K.project.namePlaceholder)}
        style={{ height: 36, paddingHorizontal: 10, fontSize: 13, color: token("foreground"), placeholderColor: token("faint"), caretColor: token("primary"), borderWidth: 1, borderColor: token("border"), borderRadius: 8, backgroundColor: token("background") }}
      />
      <View class="flex-row items-center gap-2">
        <Text class="text-[12px] text-muted-foreground">{t(K.project.roots)}</Text>
        <View style={{ flex: 1 }} />
        <View
          role="button"
          testID="project-add-root"
          accessibilityLabel={t(K.project.pickFolder)}
          disabled={projectPicking()}
          class={
            projectPicking()
              ? "h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 opacity-40"
              : "h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 hover:bg-hover active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          }
          style={{ ...motionStyle("fast") }}
          onPress={() => void choose()}
        >
          <Glyph name="folder" size={11} tint={token("muted-foreground")} />
          <Text class="text-[11.5px] font-medium text-foreground">
            {projectPicking() ? t(K.project.picking) : t(K.project.pickFolder)}
          </Text>
        </View>
      </View>
      <If when={roots().length === 0}>
        <View
          testID="project-roots-empty"
          class="items-center justify-center rounded-lg border border-line bg-inset px-3"
          style={{ minHeight: 64 }}
        >
          <Text class="text-[11.5px] text-faint" style={{ textAlign: "center" }}>
            {t(K.project.noRoots)}
          </Text>
        </View>
      </If>
      <Each of={roots()} key={(root) => root.path}>
        {(root, index) => (
          <View
            testID={`project-root-${index()}`}
            class="flex-row items-center gap-2 rounded-lg border border-line bg-background px-2.5 py-1.5"
          >
            <Glyph name="folder" size={12} tint={token("muted-foreground")} />
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text class="text-[12px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                {folderName(root().path)}
              </Text>
              <Text class="text-[10px] text-faint" style={{ numberOfLines: 1 }} tooltip={root().path}>
                {root().path}
              </Text>
            </View>
            <If
              when={root().primary}
              else={
                <View
                  role="button"
                  testID={`project-root-primary-${index()}`}
                  accessibilityLabel={t(K.project.setPrimary)}
                  class="h-6 items-center justify-center rounded-md px-1.5 hover:bg-hover active:opacity-70"
                  onPress={() => projectRootsDraft.set(setPrimaryProjectRoot(roots(), root().path))}
                >
                  <Text class="text-[10.5px] text-muted-foreground">{t(K.project.setPrimary)}</Text>
                </View>
              }
            >
              <View class="items-center justify-center rounded-full bg-brand-tint px-2" style={{ height: 18 }}>
                <Text class="text-[10px] font-medium text-brand">{t(K.project.primary)}</Text>
              </View>
            </If>
            <View
              role="button"
              testID={`project-root-remove-${index()}`}
              accessibilityLabel={t(K.project.removeRoot)}
              class="h-6 w-5 items-center justify-center rounded-md hover:bg-hover active:opacity-70"
              onPress={() => projectRootsDraft.set(removeProjectRoot(roots(), root().path))}
            >
              <Glyph name="close" size={10} tint={token("faint")} />
            </View>
          </View>
        )}
      </Each>
      <Text class="text-[11.5px] text-faint">{t(K.project.rootsHint)}</Text>
      <If when={!!projectDialogError()}>
        <Text testID="project-dialog-error" class="text-[11px] text-destructive">
          {projectDialogError() ?? ""}
        </Text>
      </If>
      <View class="flex-row justify-end gap-2">
        <View
          role="button"
          testID="project-cancel"
          accessibilityLabel={t(K.dialog.cancel)}
          class="h-8 items-center justify-center rounded-lg border border-line px-3 hover:bg-hover active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          style={{ ...motionStyle("fast") }}
          onPress={() => projectDialogOpen.set(false)}
        >
          <Text class="text-[12px] font-medium text-foreground">{t(K.dialog.cancel)}</Text>
        </View>
        <View
          role="button"
          testID="project-create"
          accessibilityLabel={t(K.project.create)}
          disabled={!canCreate()}
          class={
            canCreate()
              ? "h-8 items-center justify-center rounded-lg bg-primary px-3 hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
              : "h-8 items-center justify-center rounded-lg bg-primary px-3 opacity-40"
          }
          style={{ ...motionStyle("fast") }}
          onPress={create}
        >
          <Text class="text-[12px] font-medium text-primary-foreground">{t(K.project.create)}</Text>
        </View>
      </View>
    </Dialog>
  );
}
