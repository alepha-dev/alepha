import { useI18n } from "alepha/react/i18n";
import { Expand } from "lucide-react";

import { Badge } from "../../core/Badge.tsx";

export interface CoarsenedBadgeProps {
  coarsened: boolean;
}

/**
 * Whether a bucket at an edge of the window was read whole.
 *
 * Shown beside the sampling badge, for the same reason: it qualifies the
 * figures under it. A window starting at 08:30 over an hour tier reads the
 * whole 08:00 bucket rather than dropping it, so its readings before 08:30
 * are counted; the server says so with `coarsened`, and this badge is where
 * the explorer stops that from being silent. Nothing renders when the window
 * was exact.
 */
export const CoarsenedBadge = (props: CoarsenedBadgeProps) => {
  const { tr } = useI18n();
  if (!props.coarsened) return null;

  return (
    <Badge
      variant="tint"
      tone="warning"
      className="h-[22px] gap-1.5 px-2.5 text-[11px]"
      title={tr("admin.analytics.coarsenedHint", {
        default:
          "A bucket at an edge of this window extends past it and was read whole, so readings just outside the window are counted. Older data sits in coarser tiers.",
      })}
    >
      <Expand className="size-[11px]" />
      {tr("admin.analytics.coarsened", { default: "Edges coarsened" })}
    </Badge>
  );
};
