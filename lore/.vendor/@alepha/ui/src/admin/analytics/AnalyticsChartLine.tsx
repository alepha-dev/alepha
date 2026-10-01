import { analyticsLinePath } from "./chartModel.ts";
import type { AnalyticsChartPoint } from "./chartModel.ts";

export interface AnalyticsChartLineProps {
  points: AnalyticsChartPoint[];
  max: number;
}

/**
 * The same series as a line, over a 0-100 viewBox stretched to the pane.
 *
 * `preserveAspectRatio="none"` plus a non-scaling stroke: the geometry
 * distorts with the container, the stroke does not.
 */
export const AnalyticsChartLine = (props: AnalyticsChartLineProps) => {
  const path = analyticsLinePath(props.points, props.max);

  return (
    <div className="border-border h-[208px] border-b">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block h-full w-full"
      >
        <path d={path.area} fill="var(--primary)" fillOpacity={0.18} />
        <path
          d={path.line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={1.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
};
