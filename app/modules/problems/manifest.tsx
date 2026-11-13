import { ProblemsBody, openProblemsSheet } from "./view";
import { baseName } from "../../domains/fs";
import { activeContainerId, containers } from "../../core/containers";
import { K, t } from "../../ui/i18n";
import type { SheetModule } from "../../../contracts/module";

/**
 * The Problems sheet (`problems:{containerId}`): the `lsp` domain's
 * diagnostics for the files open in the container.
 */
export const problemsModule: SheetModule = {
  id: "problems",
  capabilities: ["lsp"],
  titlebar: [
    {
      id: "open-problems",
      label: () => t(K.lsp.problems),
      glyph: "alert",
      testID: "open-problems",
      order: 40,
      enabled: () => activeContainerId() !== null,
      onPress: () => openProblemsSheet(),
    },
  ],
  intents: {
    "problems.open": (payload) => {
      const { containerId = activeContainerId() } = (payload ?? {}) as { containerId?: string | null };
      openProblemsSheet(containerId);
      return containerId ? `problems:${containerId}` : null;
    },
  },
  kinds: [
    {
      kind: "problems",
      glyph: "alert",
      tint: "warn",
      title: (id) => {
        const container = containers().find((row) => row.id === id.slice("problems:".length));
        const folder = container ? baseName(container.cwd) : "";
        return folder ? `${t(K.sheet.problemsTitle)} · ${folder}` : t(K.sheet.problemsTitle);
      },
      body: ({ containerId }) => <ProblemsBody containerId={containerId ?? ""} />,
      parse: (id) => (id.startsWith("problems:") ? id.slice("problems:".length) : null),
    },
  ],
};
