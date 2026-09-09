import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Inbox } from "lucide-react";

import type { ReleaseResource } from "@/api/schemas/releaseResourceSchema.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export interface ReleaseDefaultBadgeProps {
  release: ReleaseResource;
}

/**
 * The chip saying this release is where finished work lands when nobody said
 * where it should go.
 *
 * ⚠️ A SECOND, orthogonal chip beside the state chip, never a third value in
 * it. A default release is still `open` - see `releaseState.ts` - and folding
 * the two together would make the state filter on `ProjectReleases` lie:
 * filtering "open" would hide the default release, which is open.
 *
 * Its own glyph and its own tone, both chosen to be distinct from `open`
 * (amber `CircleDotDashed`) and `released` (emerald `CircleCheck`), because
 * it sits beside one of them. `Inbox` says what the release is being used
 * for rather than what state it is in.
 *
 * Renders nothing when the release is not the default, so a project that has
 * never pointed intake anywhere shows no chip at all - a normal, supported
 * state rather than an empty slot.
 */
const ReleaseDefaultBadge = (props: ReleaseDefaultBadgeProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const since = props.release.defaultSince;

  if (!since) return null;

  return (
    <Badge
      variant="tint"
      tone="info"
      // The date is why the column is a timestamp rather than a boolean.
      // ⚠️ `I18nLocalizeOptions` has `date` and `number` only, no `time`.
      title={String(
        tr("release.default.since", {
          args: [String(l(since, { date: "ll" }))],
        }),
      )}
    >
      <Inbox className="size-3" />
      {tr("release.default.badge")}
    </Badge>
  );
};

export default ReleaseDefaultBadge;
