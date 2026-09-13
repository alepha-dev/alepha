import { Button } from "@alepha/ui/components/ui/button";
import { useI18n } from "alepha/react/i18n";
import { Scissors } from "lucide-react";

import {
  ANALYTICS_MAX_LIMIT,
  analyticsNextLimit,
  analyticsNumber,
} from "./analyticsModel.ts";

export interface TruncationBannerProps {
  limit: number;
  groupCount: number;
  groupCountCapped: boolean;
  onRaise: (limit: number) => void;
}

/**
 * What the limit cut, said loudly.
 *
 * A truncated top-N sitting under cards that show true totals means the two
 * disagree, and nothing else on the page says so. Every number here is
 * derived from the same run as the rows above it, never a second constant.
 */
export const TruncationBanner = (props: TruncationBannerProps) => {
  const { tr } = useI18n();
  const cut = Math.max(0, props.groupCount - props.limit);
  const total = props.groupCountCapped
    ? `${analyticsNumber(props.groupCount)}+`
    : analyticsNumber(props.groupCount);
  const next = analyticsNextLimit(props.limit);

  return (
    <div className="mx-5 mt-3 flex flex-none items-center gap-2.5 rounded-lg bg-amber-500/15 px-3 py-2.5 ring-1 ring-amber-500/40 ring-inset">
      <Scissors className="size-3.5 flex-none text-amber-500" />
      <span className="text-[12.5px]">
        {tr("admin.analytics.truncated", {
          default:
            "limit $1 cut $2 of $3 groups. The totals above still cover every group, so the table will not add up to them.",
          args: [String(props.limit), analyticsNumber(cut), total],
        })}
      </span>
      <span className="flex-1" />
      {props.limit !== ANALYTICS_MAX_LIMIT && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="flex-none whitespace-nowrap"
          onClick={() => props.onRaise(next)}
        >
          {tr("admin.analytics.raiseLimit", {
            default: "Raise to $1",
            args: [String(next)],
          })}
        </Button>
      )}
    </div>
  );
};
