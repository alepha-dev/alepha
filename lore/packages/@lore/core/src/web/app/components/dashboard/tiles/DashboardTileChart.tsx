import { cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
import { markerPosition, scaleSeries } from "./dashboardSeriesScale.ts";
import DashboardSparkline from "./DashboardSparkline.tsx";

export interface DashboardTileChartProps {
  value: DashboardCardValue;
  /**
   * `bars` for discrete days (a count per day), `area` for a running total.
   * From the catalogue's `chartStyle`.
   */
  chartStyle?: "area" | "bars";
}

/**
 * A `chart` tile: a series drawn to scale, with markers as dashed rules.
 *
 * Bars for counts per day, for the reason `HomeMomentum` gives: a line
 * interpolates between two measured days and draws readings nobody took.
 * An area for a cumulative series (a burn-up), where the in-between is
 * honest. Either way the baseline is zero.
 *
 * The axis says the busiest reading at the top and the first and last dates
 * under it, in the muted foreground of the theme; a marker (a deployment on
 * an error chart) is a dashed rule at its instant, named by its title.
 */
const DashboardTileChart = (props: DashboardTileChartProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const series = props.value.series ?? [];
  if (series.length === 0) return null;

  const { points, max } = scaleSeries(series.map((point) => point.value));
  const first = series[0]!.at;
  const last = series[series.length - 1]!.at;
  const markers = (props.value.markers ?? [])
    .map((marker) => ({
      ...marker,
      left: markerPosition(marker.at, first, last),
    }))
    .filter((marker) => marker.left !== undefined);

  return (
    <div className="flex w-full flex-1 flex-col gap-1" data-testid="tile-chart">
      <div className="text-muted-foreground flex justify-between text-[10.5px] tabular-nums">
        <span>{l(max)}</span>
      </div>
      <div className="relative min-h-12 flex-1">
        {props.chartStyle === "bars" ? (
          <div className="text-primary absolute inset-0 flex items-end gap-px">
            {points.map((point, index) => (
              <div
                key={series[index]!.at}
                data-testid="tile-chart-bar"
                className={cn(
                  "flex-1 rounded-t-xs bg-current",
                  series[index]!.value === 0 && "opacity-30",
                )}
                style={{ height: `${Math.max(2, 100 - point.y)}%` }}
                title={`${l(series[index]!.at, { date: "ll" })}: ${l(series[index]!.value)}`}
              />
            ))}
          </div>
        ) : (
          <DashboardSparkline
            series={series}
            className="absolute inset-0 h-full"
          />
        )}
        {markers.map((marker) => (
          <span
            key={`${marker.kind}-${marker.at}`}
            data-testid="tile-chart-marker"
            className="border-muted-foreground/60 absolute top-0 bottom-0 border-l border-dashed"
            style={{ left: `${marker.left}%` }}
            title={`${tr(`dashboard.marker.${marker.kind}` as never)} ${l(marker.at, { date: "lll" })}`}
          />
        ))}
      </div>
      <div className="text-muted-foreground flex justify-between text-[10.5px]">
        <span>{l(first, { date: "D MMM" })}</span>
        <span>{l(last, { date: "D MMM" })}</span>
      </div>
    </div>
  );
};

export default DashboardTileChart;
