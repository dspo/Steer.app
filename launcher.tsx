import { signal, Text, token, View, Scroll } from "nsh";
import { Dialog, Input, Menu, MenuItem } from "nsh/base";
import { K, t } from "./i18n";
import {
  closeLauncher,
  createProject,
  launcherLocked,
  launcherOpen,
  launcherProjectId,
  launcherStarting,
  loadProjects,
  openLauncher,
  projectError,
  projects,
  startFromLauncher,
} from "./projects";
import { containers, containersLoaded, createExternalContainer } from "./containers";
import type { ContainerKind } from "./contracts/protocol";
import { Chip, Glyph, motionStyle, shadowDialog, shadowRaised } from "./ui";

/**
 * The Launcher: composer first, container second. It shows on an empty
 * canvas and after a "+", optionally locked to the project row that opened
 * it. The project chip changes the target unless locked.
 */

const EXTERNAL_ACTIONS: Array<{ kind: Exclude<ContainerKind, "Pi">; key: keyof typeof K.external }> = [
  { kind: "Terminal", key: "terminal" },
  { kind: "Claude", key: "claude" },
  { kind: "Codex", key: "codex" },
  { kind: "Copilot", key: "copilot" },
];

export function Launcher() {
  const draft = signal("");
  const externalStarting = signal<string | null>(null);
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
  const selected = () => launcherProjectId();
  const selectedName = () => {
    const id = selected();
    if (id === null) return t(K.project.chats);
    return projects().find((project) => project.id === id)?.name ?? t(K.project.title);
  };
  return (
    <View class="flex-1 items-center justify-center bg-inset" style={{ padding: 32 }}>
      <View
        class="gap-4 rounded-xl border border-border bg-card"
        style={{ width: 560, padding: 20, boxShadow: shadowRaised() }}
      >
        <View style={{ gap: 2 }}>
          <Text class="text-[15px] font-semibold text-foreground">{t(K.launcher.title)}</Text>
          <Text class="text-[12px] text-muted-foreground">{t(K.launcher.subtitle)}</Text>
        </View>

        <View class="flex-row items-center gap-2">
          <Text class="text-[11px] font-medium text-faint">{t(K.launcher.project)}</Text>
          <If
            when={launcherLocked()}
            else={
              <Menu
                trigger={
                  <View
                    role="button"
                    testID="launcher-project"
                    accessibilityLabel={t(K.launcher.project)}
                    class="rounded-lg border border-line px-2 py-1 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                  >
                    <Chip label={selectedName()} tint={token("foreground")} />
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
              </Menu>
            }
          >
            <Chip label={selectedName()} tint={token("foreground")} />
          </If>
          <View style={{ flex: 1 }} />
          <Text class="text-[10.5px] text-faint">
            {launcherLocked() ? t(K.launcher.subtitle) : ""}
          </Text>
        </View>

        <Input
          testID="launcher-input"
          value={draft()}
          onChange={({ value }) => draft.set(value)}
          multiline
          autoFocus
          placeholder={t(K.launcher.placeholder)}
          onSubmit={submit}
          style={{
            minHeight: 120,
            paddingHorizontal: 12,
            paddingVertical: 10,
            fontSize: 13,
            lineHeight: 20,
            color: token("foreground"),
            placeholderColor: token("faint"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 10,
            backgroundColor: token("background"),
            caretColor: token("primary"),
          }}
        />

        <View class="flex-row items-center gap-1.5">
          <Text class="text-[10.5px] font-medium text-faint">{t(K.launcher.terminals)}</Text>
          <Each of={EXTERNAL_ACTIONS} key={(action) => action.kind}>
            {(action) => {
              const value = action();
              const busy = () => externalStarting() === value.kind;
              const label = t(K.external[value.key]);
              return (
                <View
                  role="button"
                  testID={`external-${value.kind.toLowerCase()}`}
                  accessibilityLabel={t(K.external.open, { kind: label })}
                  class={
                    externalStarting() || !readyToCreate()
                      ? "h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-background px-2.5 opacity-50"
                      : "h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-background px-2.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                  }
                  style={{ ...motionStyle("fast") }}
                  disabled={externalStarting() !== null || !readyToCreate()}
                  onPress={() => void startExternal(value.kind)}
                >
                  <Glyph name="terminal" size={11} tint={token("muted-foreground")} />
                  <Text class="text-[11px] font-medium text-foreground">{busy() ? "…" : label}</Text>
                </View>
              );
            }}
          </Each>
        </View>
        <Text class="text-[10px] text-faint" style={{ numberOfLines: 2 }}>{t(K.external.hint)}</Text>

        <View class="flex-row items-center gap-2">
          <View class="rounded-full border border-line px-2 py-0.5">
            <Text class="text-[11px] font-medium text-muted-foreground">pi</Text>
          </View>
          <View style={{ flex: 1 }} />
          <If when={!!projectError()}>
            <Text class="text-[11px] text-destructive" style={{ numberOfLines: 1 }}>
              {projectError() ?? ""}
            </Text>
          </If>
          <View
            role="button"
            testID="launcher-send"
            accessibilityLabel={launcherStarting() ? t(K.launcher.starting) : t(K.launcher.start)}
            class={
              canStart()
                ? "h-8 flex-row items-center gap-1.5 rounded-lg bg-primary px-3 hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                : "h-8 flex-row items-center gap-1.5 rounded-lg bg-muted px-3"
            }
            style={{ ...motionStyle("fast") }}
            onPress={submit}
          >
            <Text class={canStart() ? "text-[12px] font-medium text-primary-foreground" : "text-[12px] font-medium text-faint"}>
              {launcherStarting() ? t(K.launcher.starting) : t(K.launcher.start)}
            </Text>
            <Glyph name="send" size={12} tint={canStart() ? token("primary-foreground") : token("faint")} />
          </View>
        </View>
      </View>
    </View>
  );
}

/* Project creation ------------------------------------------------------- */

export const projectDialogOpen = signal(false);
const projectNameDraft = signal("");
const projectRootsDraft = signal("");
const projectDialogError = signal<string | null>(null);

export function openProjectDialog(): void {
  projectNameDraft.set("");
  projectRootsDraft.set("");
  projectDialogError.set(null);
  projectDialogOpen.set(true);
}

function parseRoots(text: string): Array<{ path: string; primary: boolean }> {
  const roots: Array<{ path: string; primary: boolean }> = [];
  let primary = 0;
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    const starred = line.startsWith("*");
    if (starred) line = line.replace(/^\*\s*/, "").trim();
    if (!line) continue;
    if (starred) primary = roots.length;
    roots.push({ path: line, primary: false });
  }
  if (roots.length > 0) roots[Math.min(primary, roots.length - 1)].primary = true;
  return roots;
}

/** The project creation dialog: one path per line, `*` marks the primary. */
export function ProjectDialog() {
  const isOpen = () => projectDialogOpen();
  const create = () => {
    const roots = parseRoots(projectRootsDraft());
    if (roots.length === 0) {
      projectDialogError.set(t(K.project.rootsHint));
      return;
    }
    void createProject(projectNameDraft(), roots).then((project) => {
      if (!project) {
        projectDialogError.set(projectError() ?? "create failed");
        return;
      }
      projectDialogOpen.set(false);
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
      <Text class="text-[12px] text-muted-foreground">{t(K.project.roots)}</Text>
      <Input
        testID="project-roots"
        value={projectRootsDraft()}
        onChange={({ value }) => projectRootsDraft.set(value)}
        multiline
        placeholder={t(K.project.rootsPlaceholder)}
        style={{ minHeight: 96, paddingHorizontal: 10, paddingVertical: 8, fontSize: 12, lineHeight: 18, color: token("foreground"), placeholderColor: token("faint"), caretColor: token("primary"), borderWidth: 1, borderColor: token("border"), borderRadius: 8, backgroundColor: token("background") }}
      />
      <Text class="text-[11.5px] text-faint">{t(K.project.rootsHint)}</Text>
      <If when={!!projectDialogError()}>
        <Text class="text-[11px] text-destructive">{projectDialogError() ?? ""}</Text>
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
          class="h-8 items-center justify-center rounded-lg bg-primary px-3 hover:bg-primary/90 active:opacity-80 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
          style={{ ...motionStyle("fast") }}
          onPress={create}
        >
          <Text class="text-[12px] font-medium text-primary-foreground">{t(K.project.create)}</Text>
        </View>
      </View>
    </Dialog>
  );
}
