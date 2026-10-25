import { useI18n } from "alepha/react/i18n";

import { analyticsCompact, analyticsNumber } from "./analyticsModel.ts";
import { analyticsDonutArcs, analyticsSlotColor } from "./chartModel.ts";
import type { AnalyticsChartPoint } from "./chartModel.ts";

export interface AnalyticsChartDonutProps {
  points: AnalyticsChartPoint[];
  total: number;
}

/**
 * A share of one whole, offered only where that is what the data is: one
 * dimension, few enough slices to tell apart.
 */
export const AnalyticsChartDonut = (props: AnalyticsChartDonutProps) => {
  const { tr } = useI18n();
  const arcs = analyticsDonutArcs(props.points);

  return (
    <div className="flex items-center gap-8 py-1">
      <div className="relative size-[148px] flex-none">
        <svg viewBox="0 0 42 42" className="block size-full -rotate-90">
          <circle
            cx="21"
            cy="21"
            r="15.9"
            fill="none"
            stroke="var(--muted-foreground)"
            strokeOpacity={0.15}
            strokeWidth="6"
          />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx="21"
              cy="21"
              r="15.9"
              fill="none"
              stroke={analyticsSlotColor(arc.index)}
              strokeWidth="6"
              strokeDasharray={arc.dash}
              strokeDashoffset={arc.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-[18px] font-semibold tracking-[-0.01em] tabular-nums">
            {analyticsCompact(props.total)}
          </span>
          <span className="text-muted-foreground text-[10.5px]">
            {tr("admin.analytics.donutTotal", { default: "total" })}
          </span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[7px]">
        {props.points.map((point, index) => (
          <div key={point.key} className="flex items-center gap-2.5">
            <span
              style={{ background: analyticsSlotColor(index) }}
              className="size-[9px] flex-none rounded-[3px]"
            />
            <span className="min-w-0 truncate font-mono text-[11.5px]">
              {point.key}
            </span>
            <span className="flex-1" />
            <span className="font-mono text-[11.5px] tabular-nums">
              {analyticsNumber(point.value)}
            </span>
            <span className="text-muted-foreground w-11 text-right text-[11px] tabular-nums">
              {Math.round(point.share * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
