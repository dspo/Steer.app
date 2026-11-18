import { signal, Text, token, View } from "nsh";
import { Dialog, Input } from "nsh/base";
import { K, t } from "../ui/i18n";
import { createProject, projectError } from "../core/projects";
import type { ProjectRecord } from "../core/types";
import { pickFolder } from "../domains/picker";
import { Glyph, motionStyle, shadowDialog } from "../ui/ui";
import {
  addProjectRoot,
  removeProjectRoot,
  rootPayload,
  setPrimaryProjectRoot,
  type RootDraft,
} from "../core/project-roots";

/**
 * The project-creation dialog: a name and Finder-picked roots, no typed
 * paths. It belongs to the shell (projects are the relationship model), and
 * modules open it through `core/shell-actions` rather than importing this
 * file.
 */

/** The last path segment, as the dialog shows a root. */
function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/* Project creation ------------------------------------------------------- */

const projectDialogOpen = signal(false);
const projectNameDraft = signal("");
const projectRootsDraft = signal<RootDraft[]>([]);
const projectDialogError = signal<string | null>(null);
const projectPicking = signal(false);
let projectCreated: ((project: ProjectRecord) => void) | null = null;

/** Opens the project dialog; `onCreated` adopts the new project (the start
 * page's conversation menu is the one caller). */
export function openProjectDialog(onCreated?: (project: ProjectRecord) => void): void {
  projectNameDraft.set("");
  projectRootsDraft.set([]);
  projectDialogError.set(null);
  projectPicking.set(false);
  projectCreated = onCreated ?? null;
  projectDialogOpen.set(true);
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
                {baseName(root().path)}
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

