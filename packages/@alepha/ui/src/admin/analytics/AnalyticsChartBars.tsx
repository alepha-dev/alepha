import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";

import { analyticsNumber } from "./analyticsModel.ts";
import type { AnalyticsChartPoint } from "./chartModel.ts";
import { analyticsSlotColor } from "./chartModel.ts";

export interface AnalyticsChartBarsProps {
  points: AnalyticsChartPoint[];
  slots: string[];
  max: number;
  /**
   * 100% share: the same stack, every column normalised to full height.
   */
  normalised: boolean;
}

/**
 * Vertical bars, stacked by the breakdown when there is one.
 *
 * The final bucket is drawn at 42% opacity when the window runs to today: it
 * is still filling, and the least trustworthy number on the chart must not
 * also be the most prominent one.
 */
export const AnalyticsChartBars = (props: AnalyticsChartBarsProps) => {
  const { tr } = useI18n();
  const dense = props.points.length > 120;

  return (
    <div
      className={cn(
        "border-border flex h-[208px] items-end overflow-hidden border-b px-0.5",
        dense ? "gap-px" : "gap-[3px]",
      )}
    >
      {props.points.map((point, index) => {
        const height = props.normalised
          ? 100
          : Math.max(2, Math.round((point.value / props.max) * 100));
        const last = index === props.points.length - 1;
        return (
          <div
            key={point.key}
            style={{ height: `${height}%` }}
            title={
              point.partial
                ? tr("admin.analytics.barPartial", {
                    default: "$1 · $2 · partial day, still filling",
                    args: [point.key, analyticsNumber(point.value)],
                  })
                : `${point.key} · ${analyticsNumber(point.value)}`
            }
            className={cn(
              "flex min-w-0 flex-1 flex-col justify-end",
              point.partial && "opacity-[.42]",
            )}
          >
            {point.segments.length > 0 ? (
              point.segments.map((segment, position) => (
                <div
                  key={segment.slot}
                  style={{
                    height: `${(segment.value / point.value) * 100}%`,
                    background: analyticsSlotColor(
                      props.slots.indexOf(segment.slot),
                    ),
                  }}
                  className={cn("w-full", position === 0 && "rounded-t-[3px]")}
                />
              ))
            ) : (
              <div
                className={cn(
                  "h-full w-full rounded-t-[3px]",
                  // The newest complete bucket is the one being read; the rest
                  // is the context it is read against.
                  last && !point.partial ? "bg-primary" : "bg-muted-foreground",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
