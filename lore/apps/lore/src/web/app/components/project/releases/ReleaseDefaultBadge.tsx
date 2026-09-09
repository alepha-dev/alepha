import { useI18n } from "alepha/react/i18n";
import { Inbox } from "lucide-react";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseDefaultBadgeProps {
  release: ReleaseResource;
}

/**
 * The glyph saying this release is where finished work lands when nobody said
 * where it should go.
 *
 * ⚠️ A SECOND, orthogonal marker, never a third value in the state chip. A
 * default release is still `open` - see `releaseState.ts` - and folding the
 * two together would make the state filter on `ProjectReleases` lie:
 * filtering "open" would hide the default release, which is open. That
 * reasoning is untouched by this being a glyph; what changed is only how the
 * role is DRAWN, not what it is.
 *
 * A glyph beside the TAG rather than a chip beside the state (feedback
 * #P2171). Two chips in one cell wrap, so the default release drew `Open`
 * above `Default` and stood twice as tall as a plain `Released` row beside
 * it - and a stack of two chips reads as two states rather than as one state
 * and one role. Moving it next to the identity it qualifies says "this
 * release" rather than "this state".
 *
 * `Inbox` is deliberately distinct from `open` (amber `CircleDotDashed`) and
 * `released` (emerald `CircleCheck`): it says what the release is being used
 * for rather than what state it is in.
 *
 * ⚠️ A bare glyph beside a version number says nothing to a reader, so the
 * label moves to `aria-label` rather than being dropped with the chip - the
 * rule #Q2017 recorded for the icon-only prompt trigger. The date stays on
 * `title`, which with an `aria-label` present is read as the description, so
 * both survive: the name says what it is, the description says since when.
 *
 * Renders nothing when the release is not the default, so a project that has
 * never pointed intake anywhere shows no glyph and no empty slot.
 */
const ReleaseDefaultBadge = (props: ReleaseDefaultBadgeProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const since = props.release.defaultSince;

  if (!since) return null;

  return (
    <span
      // `role="img"` or the label is dropped: the span is presentational
      // otherwise. Same treatment as `AppStatusDot`.
      role="img"
      aria-label={String(tr("release.default.badge"))}
      // The date is why the column is a timestamp rather than a boolean.
      // ⚠️ `I18nLocalizeOptions` has `date` and `number` only, no `time`.
      title={String(
        tr("release.default.since", {
          args: [String(l(since, { date: "ll" }))],
        }),
      )}
      // `text-blue-500`, the colour the chip's `tone="info"` used
      // (`border-blue-500/40 bg-blue-500/15`), now that there is no chip to
      // tint. ⚠️ NOT `text-info`: that token does not exist in this theme, so
      // the class is inert and the glyph silently inherits `--foreground`,
      // which is what the first version of this shipped with.
      className="shrink-0 text-blue-500"
    >
      <Inbox className="size-3.5" aria-hidden />
    </span>
  );
};

export default ReleaseDefaultBadge;
