import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";

import { analyticsCompact, analyticsNumber } from "./analyticsModel.ts";
import type { AnalyticsRunResult } from "./analyticsTypes.ts";

export interface TotalsCardsProps {
  result: AnalyticsRunResult;
  days: number;
  compareLabel: string | null;
}

/**
 * One card per selected measure: the summed total over the whole window.
 *
 * These come from their own ungrouped query, not from summing the rows below,
 * which is what lets the truncation banner promise that the cards still cover
 * every group while the table does not.
 *
 * Every delta names its baseline. `+42%` on its own is unreadable, so the
 * sub-line carries the comparison and, with `compare to` off, the delta is an
 * en dash and the clause disappears rather than being quietly assumed.
 */
export const TotalsCards = (props: TotalsCardsProps) => {
  const { tr } = useI18n();

  return (
    <div className="flex flex-wrap gap-3 px-5 pt-[18px]">
      {props.result.measures.map((measure) => {
        const value = props.result.totals[measure] ?? 0;
        const before = props.result.baseline?.[measure];
        const percent =
          before === undefined || before === 0
            ? null
            : Math.round(((value - before) / before) * 100);
        const up = percent !== null && percent >= 0;

        return (
          <div
            key={measure}
            className="bg-card ring-border flex min-w-[210px] flex-1 basis-[210px] flex-col gap-[7px] rounded-xl p-3.5 ring-1 ring-inset"
          >
            <div className="flex items-center gap-2">
              <code className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
                sum({measure})
              </code>
              <span className="flex-1" />
              <Badge
                variant="tint"
                tone={percent === null ? "neutral" : up ? "success" : "warning"}
                className="h-[18px] flex-none px-[7px] text-[11px] tabular-nums"
              >
                {percent === null ? "–" : `${up ? "+" : ""}${percent}%`}
              </Badge>
            </div>
            <div className="text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] tabular-nums">
              {analyticsNumber(value)}
            </div>
            <div className="text-muted-foreground text-[11.5px]">
              {[
                tr("admin.analytics.cardDays", {
                  default: "$1 days",
                  args: [String(props.days)],
                }),
                tr("admin.analytics.cardPerDay", {
                  default: "$1 / day",
                  args: [analyticsCompact(Math.round(value / props.days))],
                }),
                props.compareLabel,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        );
      })}
    </div>
  );
};
