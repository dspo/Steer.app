import { ChangesBody, HistoryBody } from "./view";
import { openChangesSheet, openHistorySheet } from "./store";
import { baseName } from "../../domains/fs";
import { activeContainerId, containers } from "../../core/containers";
import { K, t } from "../../ui/i18n";
import type { SheetModule } from "../../../contracts/module";

/** `· folder` suffix both git sheets share. */
function folderTitle(containerId: string | null, title: string): string {
  const container = containers().find((row) => row.id === containerId);
  const folder = container ? baseName(container.cwd) : "";
  return folder ? `${title} · ${folder}` : title;
}

/**
 * The git module: Changes (now) and History (past), both reading the `git`
 * domain. The two sheets stay separate (Q59); the module owns their entries.
 */
export const gitModule: SheetModule = {
  id: "git",
  capabilities: ["git"],
  titlebar: [
    {
      id: "open-changes",
      label: () => t(K.git.changesTitle),
      glyph: "diff",
      testID: "open-changes",
      order: 30,
      enabled: () => activeContainerId() !== null,
      onPress: () => openChangesSheet(),
    },
    {
      id: "open-history",
      label: () => t(K.git.historyTitle),
      glyph: "commit",
      testID: "open-history",
      order: 31,
      enabled: () => activeContainerId() !== null,
      onPress: () => openHistorySheet(),
    },
  ],
  intents: {
    "git.changes": (payload) => {
      const { containerId = activeContainerId() } = (payload ?? {}) as { containerId?: string | null };
      openChangesSheet(containerId);
      return containerId ? `changes:${containerId}` : null;
    },
    "git.history": (payload) => {
      const { containerId = activeContainerId() } = (payload ?? {}) as { containerId?: string | null };
      openHistorySheet(containerId);
      return containerId ? `history:${containerId}` : null;
    },
  },
  kinds: [
    {
      kind: "changes",
      glyph: "diff",
      tint: "muted-foreground",
      title: (id) => folderTitle(id.slice("changes:".length), t(K.sheet.changesTitle)),
      body: ({ containerId }) => <ChangesBody containerId={containerId ?? ""} />,
      parse: (id) => (id.startsWith("changes:") ? id.slice("changes:".length) : null),
    },
    {
      kind: "history",
      glyph: "commit",
      tint: "muted-foreground",
      title: (id) => folderTitle(id.slice("history:".length), t(K.sheet.historyTitle)),
      body: ({ containerId }) => <HistoryBody containerId={containerId ?? ""} />,
      parse: (id) => (id.startsWith("history:") ? id.slice("history:".length) : null),
    },
  ],
};
