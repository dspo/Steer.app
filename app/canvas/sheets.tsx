import { Text, token, View } from "nsh";
import { visiblePanels } from "../core/dock";
import { containerOfSheet } from "../core/containers";
import {
  moduleSheetGlyph,
  moduleSheetTabTitle,
  moduleSheetTitle,
  sheetNamesContainer as registryNamesContainer,
  sheetSpec,
} from "../core/registry";
import { Glyph, type GlyphName } from "../ui/ui";

/**
 * The canvas's sheet resolver (docs/sheet-module-ARCHITECTURE.md §4.2): the
 * dock holds ids (`kind:instance`), the module registry owns every kind, and
 * this file only looks one up. No kind is named here, and an unowned kind
 * draws a quiet placeholder (a layout from a newer build stays usable).
 */

/** A sheet's tab title. An unowned kind reads as its id. */
export function sheetTitle(id: string): string {
  return moduleSheetTitle(id) ?? id;
}

/**
 * A sheet's dock-tab title: the module's `tabTitle` (program voice) when it
 * projects one, else the sheet title. The container's name never reads this
 * (issue #73: an agent's title renames its tab, not its container).
 */
export function sheetTabTitle(id: string): string {
  return moduleSheetTabTitle(id) ?? sheetTitle(id);
}

/** Whether a sheet may name its container. */
export function sheetNamesContainer(id: string): boolean {
  return registryNamesContainer(id);
}

/** A sheet's tab glyph. */
export function sheetGlyph(id: string): GlyphName {
  return (moduleSheetGlyph(id) ?? "file") as GlyphName;
}

/** A sheet's body: the owning module's, or the unknown-kind placeholder. */
export function SheetBody(props: { id: string }) {
  const spec = sheetSpec(props.id);
  if (!spec) return <UnknownSheet id={props.id} />;
  return spec.body({
    id: props.id,
    containerId: containerOfSheet(props.id),
    visible: visiblePanels().includes(props.id),
  });
}

/** A sheet whose kind nothing owns: honest, quiet, closable. */
function UnknownSheet(props: { id: string }) {
  return (
    <View class="flex-1 items-center justify-center gap-2 bg-card" testID="sheet-unknown">
      <Glyph name="file" size={22} tint={token("faint")} />
      <Text class="text-[12px] text-muted-foreground">{props.id}</Text>
    </View>
  );
}
