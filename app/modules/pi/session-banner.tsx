import { signal, Text, token, View } from "nsh";
import { SHEET_FONT, SHEET_MONO } from "../../ui/fonts";
import { K, t } from "../../ui/i18n";
import { Glyph } from "../../ui/ui";
import type { SessionBanner, SessionBannerWarning } from "./protocol";
import { viewFor } from "./sessions";

/**
 * The transcript's first line (issue #20 §4.2): `pi <version> · model ·
 * thinking`, then the resource counts — warnings stay visible even folded.
 * It is the `List`'s header and scrolls away with the transcript; the empty
 * session's Hero draws none (there is no pi session yet, so no banner facts
 * either). Live `session.info` wins over the banner's first-frame values.
 */

/** The banner's open/close, per session id (a List header recycles too). */
const open = signal<Record<string, boolean>>({});

function toggle(id: string): void {
  open.set({ ...open(), [id]: !open()[id] });
}

export function SessionBanner(props: { sessionId: string; banner: () => SessionBanner | undefined }) {
  const banner = () => props.banner();
  const live = () => viewFor(props.sessionId);
  // The banner is a first-frame snapshot; the composer's model switch lands
  // in `session.info`, so the live view wins over the banner's old value.
  const model = () => live()?.model ?? banner()?.model;
  const thinking = () => live()?.thinkingLevel ?? banner()?.thinkingLevel;
  const skills = () => banner()?.skills ?? [];
  const extensions = () => banner()?.extensions ?? [];
  const warnings = () => banner()?.warnings ?? [];
  // A banner needs something to say: no facts, no banner (never a fake
  // `0 skills` row).
  if (!banner()) return null;
  const isOpen = () => open()[props.sessionId] ?? false;
  return (
    <View testID="session-banner" style={{ gap: 4, paddingBottom: 6, userSelect: "text" }}>
      <View
        role="button"
        testID="session-banner-toggle"
        accessibilityLabel={bannerSummary(banner()!, model(), thinking())}
        tooltip={bannerSummary(banner()!, model(), thinking())}
        class="flex-row items-center gap-2 rounded-md px-0.5 py-1 hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1"
        onPress={() => toggle(props.sessionId)}
      >
        <If when={!!model()}>
          <>
            <Text class="text-[12px] text-faint" style={{ fontFamily: SHEET_MONO }}>{`pi ${banner()!.version}`}</Text>
            <Text class="text-[12px] text-faint">·</Text>
            <Text
              class="text-[12px] font-medium text-foreground"
              style={{ fontFamily: SHEET_FONT }}
            >
              {model()!.id || model()!.name}
            </Text>
          </>
        </If>
        <If when={!model() && !!banner()?.version}>
          <Text class="text-[12px] text-faint" style={{ fontFamily: SHEET_MONO }}>{`pi ${banner()!.version}`}</Text>
        </If>
        <If when={!!thinking() && thinking() !== "off"}>
          <>
            <Text class="text-[12px] text-faint">·</Text>
            <Text class="text-[12px] text-muted-foreground" style={{ fontFamily: SHEET_FONT }}>
              {`thinking ${thinking()}`}
            </Text>
          </>
        </If>
        <View style={{ flex: 1 }} />
        <Text class="text-[11.5px] text-muted-foreground" style={{ fontFamily: SHEET_FONT }}>
          {countsLine(skills().length, extensions().length, warnings().length)}
        </Text>
        <If when={warnings().length > 0}>
          <View testID="session-banner-warnings" class="flex-row items-center gap-1">
            <Glyph name="alert" size={10} tint={token("warn")} />
          </View>
        </If>
        <Glyph name={isOpen() ? "caret-down" : "caret-right"} size={9} tint={token("faint")} />
      </View>
      <If when={isOpen()}>
        <View testID="session-banner-detail" style={{ gap: 8, paddingLeft: 12 }}>
          <Group
            testID="session-banner-skills"
            title={t(K.banner.skills, { count: skills().length })}
            rows={skills().map((skill) => ({
              key: `skill:${skill.name}`,
              name: skill.name,
              detail: skill.description ?? "",
            }))}
          />
          <Group
            title={t(K.banner.extensions, { count: extensions().length })}
            rows={extensions().map((extension) => ({
              key: `ext:${extension.name}`,
              name: extension.name,
              detail: extension.path ?? "",
            }))}
          />
          <If when={warnings().length > 0}>
            <Group
              title={t(K.banner.warnings, { count: warnings().length })}
              rows={warnings().map((warning, index) => ({
                key: `warn:${index}`,
                name: warningLabel(warning),
                detail: warning.message,
              }))}
            />
          </If>
        </View>
      </If>
    </View>
  );
}

function Group(props: {
  testID?: string;
  title: string;
  rows: Array<{ key: string; name: string; detail: string }>;
}) {
  return (
    <View testID={props.testID} style={{ gap: 2 }}>
      <Text class="text-[11px] font-semibold uppercase tracking-wide text-faint">{props.title}</Text>
      {props.rows.map((row) => (
        <View class="flex-row items-baseline gap-2">
          <Text class="text-[12px] text-foreground" style={{ fontFamily: SHEET_MONO }}>
            {row.name}
          </Text>
          <If when={!!row.detail}>
            <Text class="text-[11px] text-muted-foreground" style={{ fontFamily: SHEET_FONT, flex: 1, numberOfLines: 1 }}>
              {row.detail}
            </Text>
          </If>
        </View>
      ))}
    </View>
  );
}

function bannerSummary(
  banner: SessionBanner,
  model?: { id?: string; name?: string },
  thinking?: string,
): string {
  const parts = [`pi ${banner.version}`];
  if (model) parts.push(model.id || model.name || "");
  if (thinking && thinking !== "off") parts.push(`thinking ${thinking}`);
  parts.push(
    t(K.banner.skills, { count: banner.skills.length }),
    t(K.banner.extensions, { count: banner.extensions.length }),
  );
  if (banner.warnings.length > 0) parts.push(t(K.banner.warnings, { count: banner.warnings.length }));
  return parts.filter(Boolean).join(" · ");
}

function countsLine(skills: number, extensions: number, warnings: number): string {
  const parts = [t(K.banner.skills, { count: skills }), t(K.banner.extensions, { count: extensions })];
  if (warnings > 0) parts.push(t(K.banner.warnings, { count: warnings }));
  return parts.join(" · ");
}

function warningLabel(warning: SessionBannerWarning): string {
  return `${warning.severity} · ${warning.source}`;
}
