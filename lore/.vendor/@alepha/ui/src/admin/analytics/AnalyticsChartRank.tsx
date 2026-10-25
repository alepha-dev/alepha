import { analyticsNumber } from "./analyticsModel.ts";
import type { AnalyticsChartPoint } from "./chartModel.ts";

export interface AnalyticsChartRankProps {
  points: AnalyticsChartPoint[];
  max: number;
}

/**
 * A horizontal ranking, for a categorical x-axis.
 *
 * Horizontal because the labels are dimension values: a path or a route needs
 * a line of its own, not a rotated sliver under a vertical bar.
 */
export const AnalyticsChartRank = (props: AnalyticsChartRankProps) => (
  <div className="flex flex-col gap-[5px]">
    {props.points.map((point) => (
      <div
        key={point.key}
        className="flex items-center gap-2.5"
        title={`${point.key} · ${analyticsNumber(point.value)}`}
      >
        <span className="max-w-[220px] min-w-0 flex-1 basis-[120px] truncate font-mono text-[11.5px]">
          {point.key}
        </span>
        <span className="bg-foreground/[.06] h-4 min-w-0 flex-1 overflow-hidden rounded-[3px]">
          <span
            style={{
              width: `${Math.max(1, (point.value / props.max) * 100)}%`,
            }}
            className="bg-primary block h-full"
          />
        </span>
        <span className="w-[78px] flex-none text-right font-mono text-[11.5px] tabular-nums">
          {analyticsNumber(point.value)}
        </span>
        <span className="text-muted-foreground w-10 flex-none text-right text-[11px] tabular-nums">
          {Math.round(point.share * 100)}%
        </span>
      </div>
    ))}
  </div>
);
