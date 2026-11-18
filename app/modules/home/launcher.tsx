import { signal, Text, token, View } from "nsh";
import { Menu, MenuItem, MenuSeparator } from "nsh/base";
import { K, t } from "../../ui/i18n";
import { containerProject, launchProjectId, projects } from "../../core/projects";
import { containerError, containers, projectCwd } from "../../core/containers";
import { homeSheetContainer } from "../../core/dock";
import type { LaunchContext, Launcher, LauncherGroup } from "../../../contracts/module";
import { startPageLaunchers } from "../../core/registry";
import { shellActions } from "../../core/shell-actions";
import { chatsCwd } from "../../core/workspace";
import type { BrandName } from "../../ui/brand-icons";
import { BrandIcon } from "../../ui/brand-icons";
import { Glyph, motionStyle, shadowRaised, type GlyphName } from "../../ui/ui";

/**
 * The start page (`home:{containerId}` / `home:scratch`): the objects this
 * build can instantiate, and nothing else. It looks the same outside, inside
 * a project and inside a container — the context only pins the attributes a
 * new instance inherits (container / project / cwd). Every press mints a new
 * instance (a sheet); nothing here focuses an existing one.
 *
 * The entries are contributions (`docs/sheet-module-ARCHITECTURE.md §8`):
 * home resolves the attributes and draws; the modules own what a tile does.
 */

/** The rows, top to bottom: conversations, tools, terminal agents. */
const GROUPS: LauncherGroup[] = ["conversation", "tool", "agent"];

export function StartPage(props: { id: string }) {
  const busy = signal<string | null>(null);
  const failure = signal<string | null>(null);
  const containerId = () => homeSheetContainer(props.id);
  const container = () => containers().find((row) => row.id === containerId());
  const scratch = () => containerId() === null;
  /** The project the context pins: the container's, else the canvas's
   * (a sidebar project row's `+`), else Chats. */
  const projectOf = () => {
    if (scratch()) return launchProjectId();
    const record = container();
    return record ? containerProject(record) : null;
  };
  const launchersOf = (group: LauncherGroup) =>
    startPageLaunchers()
      .filter((launcher) => launcher.group === group)
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  /** The context's pinned cwd: a container's, else the project's root. */
  const pinnedCwd = (projectId: string | null) => {
    if (!scratch()) return container()?.cwd ?? null;
    return projectId ? (projectCwd(projectId) ?? null) : null;
  };
  /** The attributes for `launcher`, with the project the tile resolved. */
  const contextFor = async (
    launcher: Launcher,
    projectId: string | null = projectOf(),
  ): Promise<LaunchContext> => {
    const pinned = pinnedCwd(projectId);
    // Only a conversation needs a folder when the context pins none; a tool
    // mints its own scratch folder once it knows its container id.
    const cwd = pinned ?? (launcher.group === "conversation" ? await chatsCwd() : null);
    return { containerId: containerId(), projectId, cwd };
  };
  const run = async (launcher: Launcher, projectId: string | null = projectOf()) => {
    if (busy()) return;
    busy.set(launcher.id);
    failure.set(null);
    containerError.set(null);
    try {
      await launcher.instantiate(await contextFor(launcher, projectId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failure.set(message);
      containerError.set(message);
    } finally {
      busy.set(null);
    }
  };
  // A conversation started outside a project asks where it goes; a tool
  // defaults to Chats and mints its own folder.
  const asksProject = (launcher: Launcher) => scratch() && projectOf() === null && launcher.asksProject === true;
  // A stale `home:{id}` (its container archived) has nothing to start.
  if (!scratch() && !container()) {
    return (
      <View class="flex-1 items-center justify-center bg-background" style={{ paddingHorizontal: 32 }}>
        <Text class="text-[12px] text-muted-foreground">{t(K.container.empty)}</Text>
      </View>
    );
  }
  return (
    <View
      class="flex-1 items-center justify-center bg-background"
      style={{ paddingHorizontal: 32, paddingVertical: 32 }}
    >
      <View style={{ width: "100%", maxWidth: 560, gap: 18 }}>
        <Text class="text-[15px] font-bold text-foreground" style={{ textAlign: "center" }}>
          {t(K.launcher.title)}
        </Text>
        <View style={{ gap: 10 }}>
          <Each of={GROUPS} key={(group) => group}>
            {(group) => (
              <View class="flex-row flex-wrap items-center justify-center" style={{ gap: 8 }}>
                <Each of={launchersOf(group())} key={(launcher) => launcher.id}>
                  {(launcher) => {
                    const value = launcher();
                    return asksProject(value) ? (
                      <Menu
                        trigger={<LaunchTile launcher={value} busy={busy() === value.id} />}
                        popupClass="rounded-xl border border-border bg-popover p-1"
                        popupStyle={{ width: 240, boxShadow: shadowRaised() }}
                      >
                        <MenuItem
                          testID={`launch-${value.id}-chats`}
                          class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                          onSelect={() => void run(value, null)}
                        >
                          <Text class="text-[12px] text-foreground">{t(K.project.chats)}</Text>
                        </MenuItem>
                        <Each of={projects()} key={(project) => project.id}>
                          {(project) => (
                            <MenuItem
                              testID={`launch-${value.id}-project-${project().id}`}
                              class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                              onSelect={() => void run(value, project().id)}
                            >
                              <Text class="text-[12px] text-foreground">{project().name}</Text>
                            </MenuItem>
                          )}
                        </Each>
                        <MenuSeparator class="my-1 h-px bg-line" />
                        <MenuItem
                          testID={`launch-${value.id}-new-project`}
                          class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                          onSelect={() =>
                            shellActions()?.openProjectDialog((project) => void run(value, project.id))
                          }
                        >
                          <Text class="text-[12px] text-foreground">{t(K.project.create)}</Text>
                        </MenuItem>
                      </Menu>
                    ) : (
                      <LaunchTile launcher={value} busy={busy() === value.id} onPress={() => void run(value)} />
                    );
                  }}
                </Each>
              </View>
            )}
          </Each>
        </View>
        <If when={!!failure()}>
          <Text class="text-center text-[11px] text-destructive" style={{ numberOfLines: 2 }}>
            {failure() ?? ""}
          </Text>
        </If>
      </View>
    </View>
  );
}

/** One object's tile: glyph or brand, its label, and a busy ellipsis while
 * its instance is being made. The same shape in every context. */
function LaunchTile(props: { launcher: Launcher; busy: boolean; onPress?: () => void }) {
  const launcher = () => props.launcher;
  const brand = () => (launcher().brand ? (launcher().brand as BrandName) : null);
  return (
    <View
      role="button"
      testID={`launch-${launcher().id}`}
      accessibilityLabel={launcher().label()}
      disabled={props.busy}
      class="h-10 flex-row items-center gap-2 rounded-lg border border-line bg-card px-3.5 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
      style={{ ...motionStyle("fast") }}
      onPress={() => {
        if (!props.busy) props.onPress?.();
      }}
    >
      {brand() ? (
        <BrandIcon brand={brand()!} size={14} tint={token("muted-foreground")} />
      ) : (
        <Glyph name={(launcher().glyph ?? "file") as GlyphName} size={14} tint={token("muted-foreground")} />
      )}
      <Text class="text-[12.5px] font-medium text-foreground">{props.busy ? "…" : launcher().label()}</Text>
    </View>
  );
}
