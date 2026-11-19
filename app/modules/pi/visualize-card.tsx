import { Text, token, View } from "nsh";
import { activeContainerId, containers } from "../../core/containers";
import { dispatchIntent } from "../../core/registry";
import { baseName } from "../../domains/fs";
import { pathToUri } from "../../domains/lsp";
import { SHEET_FONT } from "../../ui/fonts";
import { Glyph } from "../../ui/ui";
import { K, t } from "../../ui/i18n";
import { registerToolCard } from "./tool-cards";

/** The structured `details` the visualize tool promises (issue #15 §4.1). */
interface FileDetails {
  kind: "file";
  path: string;
  before?: string;
  caption?: string;
}

function detailsOf(value: unknown): FileDetails | null {
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  if (d.kind !== "file" || typeof d.path !== "string" || d.path.length === 0) return null;
  return {
    kind: "file",
    path: d.path,
    ...(typeof d.before === "string" && d.before.length > 0 ? { before: d.before } : {}),
    ...(typeof d.caption === "string" && d.caption.length > 0 ? { caption: d.caption } : {}),
  };
}

function safeWorkspacePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\")) return false;
  const parts = path.split(/[\\/]/);
  return !parts.includes("..");
}

/** A workspace-relative deliverable becomes an absolute file:// URL. */
function fileUrl(containerId: string, path: string): string | null {
  if (!safeWorkspacePath(path)) return null;
  const container = containers().find((row) => row.id === containerId);
  if (!container?.cwd) return null;
  const absolute = `${container.cwd.replace(/\/$/, "")}/${path}`;
  return pathToUri(absolute);
}

function openVisualization(containerId: string, path: string): void {
  if (!safeWorkspacePath(path)) return;
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".gif") || lower.endsWith(".svg") || lower.endsWith(".pdf")) {
    const url = fileUrl(containerId, path);
    if (url) dispatchIntent("browser.open", { containerId, url, direct: true }, { containerId });
    return;
  }
  dispatchIntent("editor.open", { containerId, path }, { containerId });
}

function openComparison(containerId: string, before: string, path: string): void {
  if (!safeWorkspacePath(before) || !safeWorkspacePath(path)) return;
  dispatchIntent("diff.open", { containerId, before, path }, { containerId });
}

/**
 * A tiny file-reference card: filename + caption + actions. It never
 * interpolates model text into HTML and never reads files itself; it only
 * dispatches to the existing panel modules.
 */
export const VisualizeCard = (props: { details: unknown; id?: string }) => {
  const containerId = () => activeContainerId();
  const card = () => detailsOf(props.details);
  return (
    <If when={card() !== null}>
      <View
        testID={props.id ?? "visualize-card"}
        class="rounded-lg border border-line bg-inset"
        style={{ paddingVertical: 8, paddingHorizontal: 10, gap: 3 }}
      >
        <View class="flex-row items-center gap-1.5">
          <Glyph name="file" size={12} tint={token("muted-foreground")} />
          <Text testID="visualize-filename" class="text-[13px] leading-[18px] text-foreground" style={{ fontFamily: SHEET_FONT, flex: 1 }}>
            {baseName(card()!.path)}
          </Text>
        </View>
        <If when={!!card()!.caption}>
          <Text testID="visualize-caption" class="text-[11px] leading-[15px] text-muted-foreground" style={{ fontFamily: SHEET_FONT }}>
            {card()!.caption ?? ""}
          </Text>
        </If>
        <View class="flex-row items-center gap-1.5" style={{ marginTop: 2 }}>
          <View
            role="button"
            testID={`${props.id ?? "visualize-card"}-open`}
            accessibilityLabel={t(K.visualize.open)}
            class="rounded-md border border-line focus-visible:outline-2 focus-visible:outline-ring"
            style={{ paddingVertical: 3, paddingHorizontal: 8 }}
            onPress={() => {
              const id = containerId();
              if (id) openVisualization(id, card()!.path);
            }}
          >
            <Text class="text-[12px] leading-[16px] text-foreground" style={{ fontFamily: SHEET_FONT }}>
              {t(K.visualize.open)}
            </Text>
          </View>
          <If when={!!card()!.before}>
            <View
              role="button"
              testID={`${props.id ?? "visualize-card"}-compare`}
              accessibilityLabel={t(K.visualize.compare)}
              class="rounded-md border border-line focus-visible:outline-2 focus-visible:outline-ring"
              style={{ paddingVertical: 3, paddingHorizontal: 8 }}
              onPress={() => {
                const id = containerId();
                if (id) openComparison(id, card()!.before ?? "", card()!.path);
              }}
            >
              <Text class="text-[12px] leading-[16px] text-foreground" style={{ fontFamily: SHEET_FONT }}>
                {t(K.visualize.compare)}
              </Text>
            </View>
          </If>
        </View>
        <If when={/\.html?$/i.test(card()!.path)}>
          <Text class="text-[10px] leading-[14px] text-faint" style={{ fontFamily: SHEET_FONT }}>
            {t(K.visualize.localScripts)}
          </Text>
        </If>
      </View>
    </If>
  );
};

/** Registered at module assembly time, beside the other built-in cards. */
export function registerVisualizeCard(): void {
  registerToolCard("visualize", ({ details, entryId }) => (
    <VisualizeCard details={details} id={entryId ? `visualize-${entryId}` : undefined} />
  ));
}
