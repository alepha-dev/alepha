import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MonitorDetailResource } from "../../../../../api/schemas/monitorDetailResourceSchema.ts";
export interface MonitorLatencyChartProps {
  points: MonitorDetailResource["points"];
}
const MonitorLatencyChart = (props: MonitorLatencyChartProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const points = props.points;
  const max = Math.max(1, ...points.map((point) => point.latencyMs ?? 0));
  const x = (index: number) =>
    30 + (index / Math.max(1, points.length - 1)) * 640;
  const y = (latency: number) => 145 - (latency / max) * 120;
  return (
    <div>
      <h2 className="mb-2 font-semibold">{tr("uptime.chartTitle")}</h2>
      {!points.some((point) => point.latencyMs !== null) ? (
        <p className="text-muted-foreground py-8 text-sm">
          {tr("uptime.notMeasured")}
        </p>
      ) : (
        <svg
          viewBox="0 0 700 180"
          role="img"
          aria-label={tr("uptime.chartTitle")}
          className="text-primary h-auto w-full"
        >
          <line x1="30" y1="145" x2="670" y2="145" className="stroke-border" />
          <text x="30" y="15" fontSize="12" fill="currentColor">
            {tr("uptime.latencyValue", {
              args: [l(max, { number: { maximumFractionDigits: 1 } })],
            })}
          </text>
          {points.map((point, index) =>
            point.latencyMs === null ? null : (
              <g key={point.bucket}>
                {index > 0 && points[index - 1]!.latencyMs !== null && (
                  <line
                    x1={x(index - 1)}
                    y1={y(points[index - 1]!.latencyMs!)}
                    x2={x(index)}
                    y2={y(point.latencyMs)}
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                )}
                <circle
                  cx={x(index)}
                  cy={y(point.latencyMs)}
                  r="3"
                  fill="currentColor"
                >
                  <title>
                    {point.bucket}:{" "}
                    {tr("uptime.latencyValue", { args: [l(point.latencyMs)] })}
                  </title>
                </circle>
              </g>
            ),
          )}
          <text x="30" y="170" fontSize="11" fill="currentColor">
            {points[0]?.bucket}
          </text>
          <text
            x="670"
            y="170"
            textAnchor="end"
            fontSize="11"
            fill="currentColor"
          >
            {points.at(-1)?.bucket}
          </text>
        </svg>
      )}
      <p className="text-muted-foreground text-xs">{tr("uptime.chartNote")}</p>
    </div>
  );
};
export default MonitorLatencyChart;
