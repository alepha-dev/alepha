import { analyticsCompact, analyticsNumber } from "./analyticsModel.ts";
import type { AnalyticsHeatRow } from "./chartModel.ts";

export interface AnalyticsChartHeatProps {
  rows: AnalyticsHeatRow[];
}

/**
 * Day rows by hour-of-day columns: the payoff of grouping by both time keys,
 * and the one shape that plots two of them at once.
 */
export const AnalyticsChartHeat = (props: AnalyticsChartHeatProps) => (
  <div className="flex flex-col gap-0.5">
    {props.rows.map((row) => (
      <div key={row.day} className="flex items-center gap-1.5">
        <span className="text-muted-foreground w-[52px] flex-none font-mono text-[10.5px]">
          {row.label}
        </span>
        <span className="flex min-w-0 flex-1 gap-0.5">
          {row.cells.map((cell) => (
            <span
              key={cell.hour}
              style={{ opacity: cell.intensity }}
              title={`${row.day} ${String(cell.hour).padStart(2, "0")}:00 · ${analyticsNumber(cell.value)}`}
              className="bg-primary h-3.5 min-w-0 flex-1 rounded-[2px]"
            />
          ))}
        </span>
        <span className="text-muted-foreground w-[66px] flex-none text-right font-mono text-[10.5px] tabular-nums">
          {analyticsCompact(row.total)}
        </span>
      </div>
    ))}
    <div className="mt-1 flex items-center gap-1.5">
      <span className="w-[52px] flex-none" />
      <span className="relative h-3 min-w-0 flex-1">
        {[0, 6, 12, 18, 23].map((hour) => (
          <span
            key={hour}
            style={
              hour === 23
                ? { right: 0 }
                : {
                    left: `${(hour / 23) * 100}%`,
                    transform: hour === 0 ? undefined : "translateX(-50%)",
                  }
            }
            className="text-muted-foreground absolute top-0 text-[10px] whitespace-nowrap"
          >
            {hour}h
          </span>
        ))}
      </span>
      <span className="w-[66px] flex-none" />
    </div>
  </div>
);
