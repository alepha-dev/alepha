import { cn } from "@alepha/ui/lib/utils";

import { analyticsTicks } from "./chartModel.ts";
import type { AnalyticsChartPoint } from "./chartModel.ts";

export interface AnalyticsChartTicksProps {
  points: AnalyticsChartPoint[];
}

/**
 * The x-axis labels.
 *
 * Absolutely placed by percentage rather than one label per column: at ninety
 * bars a column is about ten pixels wide and no date would ever fit inside
 * one.
 */
export const AnalyticsChartTicks = (props: AnalyticsChartTicksProps) => (
  <div className="relative mx-0.5 mt-1.5 h-3.5">
    {analyticsTicks(props.points).map((tick) => (
      <div
        key={tick.key}
        style={
          tick.last
            ? { right: 0 }
            : {
                left: `${tick.position}%`,
                transform: tick.position === 0 ? undefined : "translateX(-50%)",
              }
        }
        className={cn(
          "text-muted-foreground absolute top-0 text-[10px] whitespace-nowrap tabular-nums",
        )}
      >
        {tick.label}
      </div>
    ))}
  </div>
);
