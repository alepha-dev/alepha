import { cn } from "@alepha/ui";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import { scaleSeries } from "./dashboardSeriesScale.ts";

export interface DashboardSparklineProps {
  series: NonNullable<DashboardCardValue["series"]>;
  /**
   * Height in pixels, or absent to fill a parent that sizes it. The width is
   * always the container's.
   */
  height?: number;
  className?: string;
}

/**
 * A line with an area fill under it, and its last reading emphasised.
 *
 * Drawn to scale from a zero baseline (`scaleSeries`). The SVG stretches to
 * its box with `preserveAspectRatio="none"`, so the stroke opts out of the
 * stretch with `non-scaling-stroke`; the endpoint is an HTML dot placed in
 * percent over it, because a circle inside a non-uniformly scaled SVG is an
 * ellipse.
 *
 * One colour, `currentColor`, so the parent decides it and both themes come
 * from the token.
 */
const DashboardSparkline = (props: DashboardSparklineProps) => {
  const { points } = scaleSeries(props.series.map((point) => point.value));
  if (points.length === 0) return null;

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `0,100 ${line} 100,100`;
  const last = points[points.length - 1]!;

  return (
    <div
      className={cn("text-primary relative w-full", props.className)}
      style={props.height ? { height: props.height } : undefined}
      aria-hidden
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        <polygon points={area} className="fill-current opacity-15" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        data-testid="dashboard-sparkline-end"
        className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
        style={{ left: `${last.x}%`, top: `${last.y}%` }}
      />
    </div>
  );
};

export default DashboardSparkline;
