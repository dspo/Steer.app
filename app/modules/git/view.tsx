import { DiffView, Dialog, Input, Menu, MenuItem, MenuSeparator, type DiffLayout } from "nsh/base";
import { effect, List, Scroll, signal, Text, token, untracked, View } from "nsh";
import type { JSX } from "nsh";
import { containers } from "../../core/containers";
import { visiblePanels } from "../../core/dock";
import { languageFor } from "../../ui/languages";
import { K, t } from "../../ui/i18n";
import {
  changePaths,
  changes,
  checkoutBranch,
  commitChanges,
  createBranch,
  ERR_GIT_IDENTITY,
  ERR_GIT_NOT_REPO,
  gitBusy,
  gitFailureText,
  gitNotice,
  histories,
  initRepository,
  loadDiff,
  refreshChanges,
  refreshHistory,
  setAuthorIdentity,
  stagePaths,
  unstagePaths,
  type GitFailure,
  type GitNotice,
} from "./store";
import type { GitChange, GitDiff } from "../../domains/git";
import { Glyph, motionStyle, SheetAction as Action, SheetIconButton as IconButton, shadowDialog, shadowRaised } from "../../ui/ui";

/**
 * The repository sheets: Changes (branch, staged/unstaged/untracked groups,
 * stage and unstage, a real `DiffView` over `git diff`, and a commit line) and
 * History (the log and a branch menu that checks out).
 *
 * `zu/git` owns every repository call; this file owns the sheet's state — the
 * selected file, its patch, the layout and the commit draft. `DiffView` is
 * M8's sheet component in its `patch` mode: the same view that compares two
 * files reads `git diff`'s unified patch, so a worktree diff is real git
 * output, not a two-file comparison wearing a git label.
 */

/** The letter and tint of a change, in the repository's own vocabulary. */
const MARKS: Record<string, { letter: string; tint: string }> = {
  added: { letter: "A", tint: "up" },
  modified: { letter: "M", tint: "info" },
  deleted: { letter: "D", tint: "destructive" },
  renamed: { letter: "R", tint: "brand" },
  copied: { letter: "C", tint: "brand" },
  typechange: { letter: "T", tint: "warn" },
  conflicted: { letter: "U", tint: "destructive" },
  untracked: { letter: "?", tint: "faint" },
};

function mark(status: string): { letter: string; tint: string } {
  return MARKS[status] ?? { letter: "•", tint: "faint" };
}

/** A state line shared by both sheets: loading, empty or a specific failure. */
function GitErrorState(props: { error: GitFailure; busy: boolean; onRetry: () => void; onInit?: () => void }) {
  const canInit = props.error.code === ERR_GIT_NOT_REPO && !!props.onInit;
  return (
    <View testID="git-error" class="flex-1 items-center justify-center gap-2 px-6">
      <Glyph name="alert" size={20} tint={token("destructive")} />
      <Text testID="git-error-text" class="text-center text-[12px] text-muted-foreground">
        {gitFailureText(props.error)}
      </Text>
      <Text class="text-center text-[10px] font-mono text-faint">{props.error.code}</Text>
      <View class="flex-row items-center gap-2">
        <If when={canInit}>
          <Action
            testID="git-init"
            label={t(K.git.init)}
            primary
            disabled={props.busy}
            onPress={() => props.onInit?.()}
          />
        </If>
        <Action testID="git-retry" label={t(K.git.retry)} disabled={props.busy} onPress={props.onRetry} />
      </View>
    </View>
  );
}

/** The one-line result of the last action, above the sheets' content. */
function Notice(props: { notice: GitNotice }) {
  const error = props.notice.tone === "error";
  return (
    <View
      testID="git-notice"
      class="flex-row items-center gap-2 border-b border-line bg-inset px-3 py-1.5"
    >
      <Glyph name={error ? "alert" : "check"} size={11} tint={token(error ? "destructive" : "up")} />
      <Text class="text-[11px] text-muted-foreground" style={{ flex: 1, numberOfLines: 2 }}>
        {props.notice.text}
      </Text>
    </View>
  );
}

/** The branch line of both sheets: name, divergence and the workspace root. */
function BranchHeader(props: {
  title: string;
  branch: string;
  detached: boolean;
  unborn: boolean;
  ahead: number;
  behind: number;
  root: string;
  busy: boolean;
  onRefresh: () => void;
  trailing?: JSX.Element;
}) {
  return (
    <View class="flex-row items-center gap-2 border-b border-line bg-card px-3 py-1.5">
      <Glyph name="branch" size={12} tint={token("muted-foreground")} />
      <View style={{ flex: 1, gap: 1 }}>
        <View class="flex-row items-center gap-1.5">
          <Text testID="git-branch" class="text-[12px] font-semibold text-foreground" style={{ numberOfLines: 1 }}>
            {props.branch || props.title}
          </Text>
          <If when={props.detached}>
            <Text testID="git-detached" class="text-[10px] text-warn">
              {t(K.git.detached)}
            </Text>
          </If>
          <If when={props.unborn}>
            <Text testID="git-unborn" class="text-[10px] text-faint">
              {t(K.git.unborn)}
            </Text>
          </If>
          <If when={props.ahead > 0}>
            <Text testID="git-ahead" class="text-[10px] tabular-nums text-up" tooltip={t(K.git.ahead)}>
              {`↑${props.ahead}`}
            </Text>
          </If>
          <If when={props.behind > 0}>
            <Text testID="git-behind" class="text-[10px] tabular-nums text-warn" tooltip={t(K.git.behind)}>
              {`↓${props.behind}`}
            </Text>
          </If>
        </View>
        <Text class="text-[10px] font-mono text-faint" style={{ numberOfLines: 1 }}>
          {props.root}
        </Text>
      </View>
      {props.trailing ?? null}
      <IconButton
        testID="git-refresh"
        label={t(K.git.refresh)}
        glyph="pulse"
        disabled={props.busy}
        onPress={props.onRefresh}
      />
    </View>
  );
}

/** A group's heading: its name, count and one quiet bulk action. */
function GroupHeader(props: {
  title: string;
  count: number;
  busy: boolean;
  action?: { testID: string; label: string; onPress: () => void };
}) {
  return (
    <View class="flex-row items-center gap-2 px-1 pb-1 pt-3">
      <Text class="text-[10px] font-semibold tracking-wide text-faint" style={{ flex: 1 }}>
        {`${props.title} · ${props.count}`}
      </Text>
      <If when={!!props.action && props.count > 0}>
        <Action
          testID={props.action?.testID ?? ""}
          label={props.action?.label ?? ""}
          disabled={props.busy}
          onPress={() => props.action?.onPress()}
        />
      </If>
    </View>
  );
}

/** One changed path: its mark, its name (and where it came from), one action. */
function ChangeRow(props: {
  change: GitChange;
  group: "staged" | "unstaged";
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAction: () => void;
}) {
  const tint = mark(props.change.status);
  const actionLabel = props.group === "staged" ? t(K.git.unstage) : t(K.git.stage);
  const label = props.change.oldPath
    ? `${props.change.oldPath} → ${props.change.path}`
    : props.change.path;
  return (
    <View class="flex-row items-center">
      <View
        role="button"
        testID={`git-change-${props.group}-${props.change.path}`}
        accessibilityLabel={`${props.change.status} ${label}`}
        class={`h-7 flex-row items-center gap-1.5 rounded-lg px-1.5 ${
          props.selected ? "bg-accent" : "hover:bg-hover"
        } active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1`}
        style={{ flex: 1, ...motionStyle("fast") }}
        onPress={props.onSelect}
      >
        <Text class="w-3 text-[10px] font-semibold" style={{ color: token(tint.tint as any) }}>
          {tint.letter}
        </Text>
        <Text
          class={`text-[12px] ${props.selected ? "text-foreground" : "text-muted-foreground"}`}
          style={{ flex: 1, numberOfLines: 1 }}
        >
          {label}
        </Text>
      </View>
      <IconButton
        testID={`git-${props.group === "staged" ? "unstage" : "stage"}-${props.change.path}`}
        label={actionLabel}
        glyph={props.group === "staged" ? "minus" : "plus"}
        tint="faint"
        disabled={props.busy}
        onPress={props.onAction}
      />
    </View>
  );
}

/** A changed path of one group. */
interface ChangeGroup {
  title: string;
  action?: { testID: string; label: string; onPress: () => void };
  rows: GitChange[];
  group: "staged" | "unstaged";
}

/**
 * One container's Changes sheet: a real worktree status, staging, a commit
 * line, and `git diff`'s patch in `DiffView`.
 */
export function ChangesBody(props: { containerId: string }) {
  const container = () => containers().find((row) => row.id === props.containerId);
  const root = () => container()?.cwd ?? "";
  const sheetId = () => `changes:${props.containerId}`;
  const visible = () => visiblePanels().includes(sheetId());
  const data = () => changes()[props.containerId];
  const status = () => data()?.status ?? null;
  const busyAction = () => gitBusy()[props.containerId] ?? null;
  const busy = () => busyAction() !== null;
  const notice = () => gitNotice()[props.containerId] ?? null;
  const phased = () => data()?.phase ?? "loading";
  const error = () => data()?.error ?? null;

  const selected = signal<{ path: string; staged: boolean } | null>(null);
  const layout = signal<DiffLayout>("split");
  const patch = signal<
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; diff: GitDiff }
    | { phase: "error"; error: GitFailure }
  >({ phase: "idle" });
  const message = signal("");
  const identityOpen = signal(false);
  const identityName = signal("");
  const identityEmail = signal("");
  const revision = signal(0);

  // The status is read when the sheet is shown (and on every refresh press):
  // a hidden sheet keeps the last one instead of polling a repository.
  effect(() => {
    if (!visible()) return;
    // The read of the store must not be tracked here: a refresh writes it.
    void untracked(() => refreshChanges(props.containerId));
  });

  // The patch follows the selected row, the status it belongs to and the
  // explicit reload; a result that arrives after the selection moved is
  // dropped.
  effect(() => {
    const target = selected();
    const current = status();
    revision();
    if (!target || !current) {
      patch.set({ phase: "idle" });
      return;
    }
    if (current.conflicted.some((row) => row.path === target.path)) {
      // A conflicted path's `git diff` is a combined diff, not the unified
      // patch this view reads: say what to do instead of showing it wrong.
      patch.set({
        phase: "error",
        error: { code: "ERR_GIT_CONFLICT", message: t(K.git.conflict) },
      });
      return;
    }
    let alive = true;
    patch.set({ phase: "loading" });
    void loadDiff(props.containerId, target.path, target.staged).then((result) => {
      if (!alive) return;
      if (result.error) {
        patch.set({ phase: "error", error: result.error });
        return;
      }
      const diff = result.diff ?? { patch: "", added: 0, deleted: 0 };
      patch.set({ phase: "ready", diff });
    });
    return () => {
      alive = false;
    };
  });

  // A row keeps its selection when its path changes groups (stage, unstage)
  // and is dropped when it leaves the repository's status. The selection is
  // read untracked: this effect writes it, and only a new status moves it.
  effect(() => {
    const current = status();
    if (!current) return;
    const target = untracked(selected);
    if (!target) return;
    const has = (rows: GitChange[]) => rows.some((row) => row.path === target.path);
    if (target.staged && has(current.staged)) return;
    if (!target.staged && (has(current.unstaged) || has(current.untracked) || has(current.conflicted))) {
      return;
    }
    if (has(current.staged)) {
      selected.set({ path: target.path, staged: true });
    } else if (has(current.unstaged) || has(current.untracked) || has(current.conflicted)) {
      selected.set({ path: target.path, staged: false });
    } else {
      selected.set(null);
    }
  });

  const stagedRows = () => status()?.staged ?? [];
  const unstagedRows = () => status()?.unstaged ?? [];
  const untrackedRows = () => status()?.untracked ?? [];
  const conflictedRows = () => status()?.conflicted ?? [];
  const stagedCount = () => stagedRows().length;
  const workingCount = () => unstagedRows().length + untrackedRows().length + conflictedRows().length;
  const canCommit = () => stagedCount() > 0 && message().trim().length > 0 && !busy();

  const stageAll = () => void stagePaths(props.containerId, []);
  const unstageAll = () => void unstagePaths(props.containerId, []);
  const reload = () => {
    void refreshChanges(props.containerId);
    revision.set(revision() + 1);
  };

  const commit = async () => {
    const text = message().trim();
    if (!text || stagedCount() === 0 || busy()) return;
    const result = await commitChanges(props.containerId, text);
    if (result.ok) {
      message.set("");
      identityOpen.set(false);
      selected.set(null);
      return;
    }
    if (result.error.code === ERR_GIT_IDENTITY) {
      // git has no author here: ask once, set it on this repository only,
      // and retry the same commit.
      identityOpen.set(true);
    }
  };

  const saveIdentity = async () => {
    if (!identityName().trim() || !identityEmail().trim()) return;
    const saved = await setAuthorIdentity(
      props.containerId,
      identityName().trim(),
      identityEmail().trim(),
    );
    if (!saved) return;
    identityOpen.set(false);
    await commit();
  };

  const groups = (): ChangeGroup[] =>
    [
      {
        title: t(K.git.staged),
        group: "staged" as const,
        rows: stagedRows(),
        action: { testID: "git-unstage-all", label: t(K.git.unstageAll), onPress: unstageAll },
      },
      {
        title: t(K.git.working),
        group: "unstaged" as const,
        rows: unstagedRows(),
        action: { testID: "git-stage-all", label: t(K.git.stageAll), onPress: stageAll },
      },
      {
        title: t(K.git.untracked),
        group: "unstaged" as const,
        rows: untrackedRows(),
        action: { testID: "git-stage-untracked", label: t(K.git.stageAll), onPress: stageAll },
      },
      {
        title: t(K.git.conflicted),
        group: "unstaged" as const,
        rows: conflictedRows(),
        action: { testID: "git-stage-conflicted", label: t(K.git.stageAll), onPress: stageAll },
      },
    ].filter((group) => group.rows.length > 0);

  const toggleRow = (change: GitChange, staged: boolean) => {
    void (staged
      ? unstagePaths(props.containerId, changePaths(change))
      : stagePaths(props.containerId, changePaths(change)));
  };

  const diffHeader = () => {
    const target = selected();
    if (!target) return "";
    return target.staged ? t(K.git.staged) : t(K.git.working);
  };

  return (
    <View class="flex-1 bg-card">
      <BranchHeader
        title={t(K.git.changesTitle)}
        branch={status()?.branch ?? ""}
        detached={status()?.detached ?? false}
        unborn={status()?.unborn ?? false}
        ahead={status()?.ahead ?? 0}
        behind={status()?.behind ?? 0}
        root={root()}
        busy={busy()}
        onRefresh={reload}
      />
      <If when={!!notice()}>
        <Notice notice={notice()!} />
      </If>

      <View class="flex-1 flex-row">
        <View class="border-r border-line" style={{ width: 300 }}>
          <If when={phased() === "loading"}>
            <View testID="git-loading" class="flex-1 items-center justify-center">
              <Text class="text-[12px] text-muted-foreground">{t(K.git.loading)}</Text>
            </View>
          </If>
          <If when={phased() === "error" && !!error()}>
            <GitErrorState
              error={error()!}
              busy={busy()}
              onRetry={reload}
              onInit={() => void initRepository(props.containerId)}
            />
          </If>
          <If when={phased() === "ready" || (phased() === "loading" && !!status())}>
            <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 8, paddingBottom: 8 }}>
              <If when={(status()?.clean ?? true) && groups().length === 0}>
                <View testID="git-clean" class="items-center gap-1 px-4 py-10">
                  <Glyph name="check" size={18} tint={token("up")} />
                  <Text class="text-[12px] font-medium text-foreground">{t(K.git.clean)}</Text>
                  <Text class="text-center text-[11px] text-faint">{t(K.git.cleanHint)}</Text>
                </View>
              </If>
              <Each of={groups()} key={(group) => `${group.group}:${group.title}`}>
                {(group) => {
                  const value = group();
                  return (
                    <View>
                      <GroupHeader
                        title={value.title}
                        count={value.rows.length}
                        busy={busy()}
                        action={value.action}
                      />
                      <Each of={value.rows} key={(row) => row.path}>
                        {(row) => {
                          const change = row();
                          return (
                            <ChangeRow
                              change={change}
                              group={value.group}
                              selected={selected()?.path === change.path && selected()?.staged === (value.group === "staged")}
                              busy={busy()}
                              onSelect={() => selected.set({ path: change.path, staged: value.group === "staged" })}
                              onAction={() => toggleRow(change, value.group === "staged")}
                            />
                          );
                        }}
                      </Each>
                    </View>
                  );
                }}
              </Each>
            </Scroll>
          </If>
        </View>

        <View style={{ flex: 1 }}>
          <If when={!selected()}>
            <View testID="git-no-selection" class="flex-1 items-center justify-center gap-1 px-6">
              <Glyph name="diff" size={20} tint={token("faint")} />
              <Text class="text-[12px] font-medium text-muted-foreground">{t(K.git.selectFile)}</Text>
              <Text class="text-center text-[11px] text-faint">{t(K.git.selectFileHint)}</Text>
            </View>
          </If>
          <If when={!!selected()}>
            <View class="flex-row items-center gap-2 border-b border-line px-3 py-1.5">
              <Glyph name="diff" size={12} tint={token("muted-foreground")} />
              <Text class="text-[11.5px] font-medium text-foreground" style={{ flex: 1, numberOfLines: 1 }}>
                {selected()?.path ?? ""}
              </Text>
              <Text testID="git-diff-mode" class="text-[10px] text-faint">
                {diffHeader()}
              </Text>
              <If when={patch().phase === "ready"}>
                <Text testID="git-diff-stats" class="text-[10.5px] tabular-nums text-muted-foreground">
                  {`+${(patch() as { diff: GitDiff }).diff.added} −${(patch() as { diff: GitDiff }).diff.deleted}`}
                </Text>
              </If>
              <Action
                testID="git-diff-split"
                label={t(K.diff.split)}
                primary={layout() === "split"}
                onPress={() => layout.set("split")}
              />
              <Action
                testID="git-diff-unified"
                label={t(K.diff.unified)}
                primary={layout() === "unified"}
                onPress={() => layout.set("unified")}
              />
            </View>
            <If when={patch().phase === "loading"}>
              <View testID="git-diff-loading" class="flex-1 items-center justify-center">
                <Text class="text-[12px] text-muted-foreground">{t(K.git.diffLoading)}</Text>
              </View>
            </If>
            <If when={patch().phase === "error"}>
              <View testID="git-diff-error" class="flex-1 items-center justify-center gap-1 px-6">
                <Glyph name="alert" size={18} tint={token("destructive")} />
                <Text class="text-center text-[12px] text-muted-foreground">
                  {gitFailureText((patch() as { error: GitFailure }).error)}
                </Text>
              </View>
            </If>
            <If when={patch().phase === "ready" && (patch() as { diff: GitDiff }).diff.patch.length === 0}>
              <View testID="git-diff-empty" class="flex-1 items-center justify-center px-6">
                <Text class="text-center text-[12px] text-muted-foreground">{t(K.git.noDiff)}</Text>
              </View>
            </If>
            <If when={patch().phase === "ready" && (patch() as { diff: GitDiff }).diff.patch.length > 0}>
              <DiffView
                testID="git-diff-view"
                class="flex-1"
                patch={(patch() as { diff: GitDiff }).diff.patch}
                language={languageFor(selected()?.path ?? "")}
                layout={layout()}
                inline="word"
                contextLines={3}
                lineNumbers
                background
                softWrap={false}
                fontSize={13}
                lineHeight={20}
              />
            </If>
          </If>
        </View>
      </View>

      <View class="border-t border-line bg-inset px-3 pb-2.5 pt-2">
        <View class="flex-row items-center gap-2">
          <Input
            testID="git-message"
            accessibilityLabel={t(K.git.commit)}
            value={message()}
            onChange={({ value }) => message.set(value)}
            onSubmit={() => void commit()}
            submitBehavior="submit"
            placeholder={t(K.git.commitPlaceholder)}
            style={{
              flex: 1,
              height: 30,
              paddingHorizontal: 10,
              fontSize: 12,
              color: token("foreground"),
              placeholderColor: token("faint"),
              caretColor: token("primary"),
              borderWidth: 1,
              borderColor: token("border"),
              borderRadius: 8,
              backgroundColor: token("background"),
            }}
          />
          <Action
            testID="git-commit"
            label={busyAction() === "commit" ? t(K.git.committing) : t(K.git.commit)}
            primary
            disabled={!canCommit()}
            onPress={() => void commit()}
          />
        </View>
        <View class="flex-row items-center gap-2 pt-1">
          <Text testID="git-staged-count" class="text-[10.5px] tabular-nums text-faint">
            {t(K.git.stagedCount, { count: stagedCount() })}
          </Text>
          <View style={{ flex: 1 }} />
          <Text class="text-[10px] text-faint">{t(K.git.commitHint)}</Text>
        </View>
      </View>

      <Dialog
        testID="git-identity-dialog"
        open={identityOpen()}
        animation="fade"
        class="m-auto w-[440px] gap-3 rounded-xl border border-border bg-card p-5"
        style={{ boxShadow: shadowDialog() }}
        backdropClass="bg-scrim"
        onCancel={() => identityOpen.set(false)}
      >
        <Text class="text-[15px] font-semibold text-foreground">{t(K.git.identityTitle)}</Text>
        <Text class="text-[11.5px] text-muted-foreground">{t(K.git.identityHint)}</Text>
        <Text class="text-[12px] text-muted-foreground">{t(K.git.identityName)}</Text>
        <Input
          testID="git-identity-name"
          accessibilityLabel={t(K.git.identityName)}
          autoFocus
          value={identityName()}
          onChange={({ value }) => identityName.set(value)}
          placeholder={t(K.git.identityNamePlaceholder)}
          style={{
            height: 34,
            paddingHorizontal: 10,
            fontSize: 12,
            color: token("foreground"),
            placeholderColor: token("faint"),
            caretColor: token("primary"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 8,
            backgroundColor: token("background"),
          }}
        />
        <Text class="text-[12px] text-muted-foreground">{t(K.git.identityEmail)}</Text>
        <Input
          testID="git-identity-email"
          accessibilityLabel={t(K.git.identityEmail)}
          value={identityEmail()}
          onChange={({ value }) => identityEmail.set(value)}
          placeholder={t(K.git.identityEmailPlaceholder)}
          style={{
            height: 34,
            paddingHorizontal: 10,
            fontSize: 12,
            color: token("foreground"),
            placeholderColor: token("faint"),
            caretColor: token("primary"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 8,
            backgroundColor: token("background"),
          }}
        />
        <View class="flex-row justify-end gap-2">
          <Action testID="git-identity-cancel" label={t(K.dialog.cancel)} onPress={() => identityOpen.set(false)} />
          <Action
            testID="git-identity-save"
            label={t(K.git.identitySave)}
            primary
            disabled={!identityName().trim() || !identityEmail().trim()}
            onPress={() => void saveIdentity()}
          />
        </View>
      </Dialog>
    </View>
  );
}

/** One commit row: its subject, then hash, author and date. */
function CommitRow(props: { commit: { short: string; subject: string; author: string; date: string } }) {
  const day = () => (props.commit.date.length >= 10 ? props.commit.date.slice(0, 10) : props.commit.date);
  return (
    <View testID={`git-commit-${props.commit.short}`} accessibilityLabel={`${props.commit.subject} ${props.commit.short}`} style={{ gap: 2, paddingVertical: 6, paddingHorizontal: 8 }}>
      <Text class="text-[12.5px] text-foreground" style={{ numberOfLines: 1 }}>
        {props.commit.subject}
      </Text>
      <View class="flex-row items-center gap-2">
        <Text class="text-[10px] font-mono text-faint">{props.commit.short}</Text>
        <Text class="text-[10px] text-faint" style={{ flex: 1, numberOfLines: 1 }}>
          {props.commit.author}
        </Text>
        <Text class="text-[10px] tabular-nums text-faint">{day()}</Text>
      </View>
    </View>
  );
}

/**
 * One container's History sheet: the log newest first and the branches as a
 * menu. Choosing a branch checks it out through `zu/git`, then changes,
 * history and the clean editors reload.
 */
export function HistoryBody(props: { containerId: string }) {
  const container = () => containers().find((row) => row.id === props.containerId);
  const root = () => container()?.cwd ?? "";
  const sheetId = () => `history:${props.containerId}`;
  const visible = () => visiblePanels().includes(sheetId());
  const data = () => histories()[props.containerId];
  const branches = () => data()?.branches ?? null;
  const commits = () => data()?.commits ?? [];
  const busy = () => (gitBusy()[props.containerId] ?? null) !== null;
  const notice = () => gitNotice()[props.containerId] ?? null;
  const error = () => data()?.error ?? null;
  const phased = () => data()?.phase ?? "loading";
  const status = () => changes()[props.containerId]?.status ?? null;
  const current = () => branches()?.current ?? "";
  const newBranchOpen = signal(false);
  const newBranchName = signal("");

  effect(() => {
    if (!visible()) return;
    void untracked(() => refreshHistory(props.containerId));
  });

  const pick = (name: string) => {
    if (!name || name === current()) return;
    void checkoutBranch(props.containerId, name);
  };

  const create = async () => {
    const name = newBranchName().trim();
    if (!name) return;
    const created = await createBranch(props.containerId, name);
    if (!created) return;
    newBranchOpen.set(false);
    newBranchName.set("");
  };

  return (
    <View class="flex-1 bg-card">
      <BranchHeader
        title={t(K.git.historyTitle)}
        branch={current()}
        detached={branches()?.detached ?? false}
        unborn={status()?.unborn ?? false}
        ahead={status()?.ahead ?? 0}
        behind={status()?.behind ?? 0}
        root={root()}
        busy={busy()}
        onRefresh={() => void refreshHistory(props.containerId)}
        trailing={
          <Menu
            trigger={
              <View
                role="button"
                testID="history-branch"
                accessibilityLabel={t(K.git.branchMenu)}
                tooltip={t(K.git.branchMenu)}
                class="h-7 flex-row items-center gap-1 rounded-lg border border-line px-2 hover:bg-hover active:opacity-70 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
                style={{ ...motionStyle("fast") }}
              >
                <Text class="text-[11px] font-medium text-foreground" style={{ numberOfLines: 1 }}>
                  {current() || t(K.git.branch)}
                </Text>
                <Glyph name="caret-down" size={9} tint={token("faint")} />
              </View>
            }
            popupClass="rounded-xl border border-border bg-popover p-1"
            popupStyle={{ boxShadow: shadowRaised() }}
          >
            <Each of={branches()?.local ?? []} key={(branch) => branch.name}>
              {(branch) => {
                const value = branch();
                return (
                  <MenuItem
                    testID={`history-checkout-${value.name}`}
                    checked={value.current}
                    role="menuitemradio"
                    class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
                    onSelect={() => pick(value.name)}
                  >
                    <Text class="text-[12px] text-foreground">{value.name}</Text>
                  </MenuItem>
                );
              }}
            </Each>
            <If when={(branches()?.local.length ?? 0) === 0}>
              <MenuItem disabled class="rounded-lg px-2.5 py-1.5">
                <Text class="text-[12px] text-muted-foreground">{t(K.git.noBranches)}</Text>
              </MenuItem>
            </If>
            <If when={(branches()?.remote.length ?? 0) > 0}>
              <MenuSeparator class="my-1 h-px bg-line" />
              <Each of={branches()?.remote ?? []} key={(branch) => branch.name}>
                {(branch) => (
                  <MenuItem disabled class="rounded-lg px-2.5 py-1.5">
                    <Text class="text-[11px] text-faint">{branch().name}</Text>
                  </MenuItem>
                )}
              </Each>
            </If>
            <MenuSeparator class="my-1 h-px bg-line" />
            <MenuItem
              testID="history-new-branch"
              class="rounded-lg px-2.5 py-1.5 hover:bg-hover focus:bg-hover active:bg-accent"
              onSelect={() => newBranchOpen.set(true)}
            >
              <Text class="text-[12px] text-foreground">{t(K.git.newBranch)}</Text>
            </MenuItem>
          </Menu>
        }
      />
      <If when={!!notice()}>
        <Notice notice={notice()!} />
      </If>

      <If when={phased() === "loading"}>
        <View testID="history-loading" class="flex-1 items-center justify-center">
          <Text class="text-[12px] text-muted-foreground">{t(K.git.loading)}</Text>
        </View>
      </If>
      <If when={phased() === "error" && !!error()}>
        <GitErrorState
          error={error()!}
          busy={busy()}
          onRetry={() => void refreshHistory(props.containerId)}
          onInit={() => void initRepository(props.containerId)}
        />
      </If>
      <If when={phased() === "ready"}>
        <List
          testID="history-list"
          each={commits()}
          keyExtractor={(commit) => commit.hash}
          estimatedItemSize={46}
          style={{ flex: 1 }}
          contentStyle={{ paddingHorizontal: 8, paddingVertical: 6, gap: 2 }}
          empty={
            <View testID="history-empty" class="items-center gap-1 px-4 py-10">
              <Glyph name="commit" size={18} tint={token("faint")} />
              <Text class="text-[12px] font-medium text-foreground">{t(K.git.historyEmpty)}</Text>
              <Text class="text-center text-[11px] text-faint">{t(K.git.historyEmptyHint)}</Text>
            </View>
          }
        >
          {(commit) => <CommitRow commit={commit()} />}
        </List>
      </If>

      <Dialog
        testID="git-new-branch-dialog"
        open={newBranchOpen()}
        animation="fade"
        class="m-auto w-[420px] gap-3 rounded-xl border border-border bg-card p-5"
        style={{ boxShadow: shadowDialog() }}
        backdropClass="bg-scrim"
        onCancel={() => newBranchOpen.set(false)}
      >
        <Text class="text-[15px] font-semibold text-foreground">{t(K.git.newBranchTitle)}</Text>
        <Text class="text-[11.5px] text-muted-foreground">{t(K.git.newBranchHint)}</Text>
        <Input
          testID="git-new-branch-name"
          accessibilityLabel={t(K.git.newBranchTitle)}
          autoFocus
          value={newBranchName()}
          onChange={({ value }) => newBranchName.set(value)}
          onSubmit={() => void create()}
          submitBehavior="submit"
          placeholder={t(K.git.newBranchPlaceholder)}
          style={{
            height: 34,
            paddingHorizontal: 10,
            fontSize: 12,
            color: token("foreground"),
            placeholderColor: token("faint"),
            caretColor: token("primary"),
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 8,
            backgroundColor: token("background"),
          }}
        />
        <View class="flex-row justify-end gap-2">
          <Action testID="git-new-branch-cancel" label={t(K.dialog.cancel)} onPress={() => newBranchOpen.set(false)} />
          <Action
            testID="git-new-branch-create"
            label={t(K.git.create)}
            primary
            disabled={!newBranchName().trim() || busy()}
            onPress={() => void create()}
          />
        </View>
      </Dialog>
    </View>
  );
}
