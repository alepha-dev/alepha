import { cn } from "@alepha/ui";
import { useI18n } from "alepha/react/i18n";
import { type MouseEvent, useState } from "react";

import type { DashboardCardValue } from "../../../../../api/schemas/dashboardCardValueSchema.ts";
import type { I18n } from "../../../services/I18n.ts";
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
 *
 * Hovered, the nearest day is marked with a dot like the last one, and a
 * tooltip gives its date and its count (#Q4239): the shape alone says
 * nothing of the numbers. Every tile that draws a sparkline gets it.
 */
const DashboardSparkline = (props: DashboardSparklineProps) => {
  const { l } = useI18n<I18n, "en">();
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  const { points } = scaleSeries(props.series.map((point) => point.value));
  if (points.length === 0) return null;

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `0,100 ${line} 100,100`;
  const last = points[points.length - 1]!;
  const hover = hovered === undefined ? undefined : points[hovered];
  const hoverPoint = hovered === undefined ? undefined : props.series[hovered];

  // The nearest day to the pointer, by its x: the points are evenly spaced.
  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = (event.clientX - box.left) / box.width;
    const index = Math.round(ratio * (points.length - 1));
    setHovered(Math.min(points.length - 1, Math.max(0, index)));
  };

  return (
    <div
      className={cn("text-primary relative w-full", props.className)}
      style={props.height ? { height: props.height } : undefined}
      data-testid="dashboard-sparkline"
      onMouseMove={onMouseMove}
      onMouseLeave={() => setHovered(undefined)}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
        aria-hidden
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
        aria-hidden
      />
      {hover && hoverPoint && (
        <>
          <span
            data-testid="dashboard-sparkline-hover"
            className="ring-background pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2"
            style={{ left: `${hover.x}%`, top: `${hover.y}%` }}
            aria-hidden
          />
          <span
            data-testid="dashboard-sparkline-tooltip"
            role="tooltip"
            className={cn(
              "bg-popover text-popover-foreground ring-foreground/10 pointer-events-none absolute top-0 z-10 -translate-y-full rounded-md px-2 py-1 text-xs whitespace-nowrap tabular-nums shadow-md ring-1",
              // Above the box, on the side away from the nearer edge, so it
              // never spills out of the tile sideways.
              hover.x > 50 ? "-translate-x-full" : "",
            )}
            style={{ left: `${hover.x}%` }}
          >
            {l(hoverPoint.at, { date: "ll" })}: {l(hoverPoint.value)}
          </span>
        </>
      )}
    </div>
  );
};

export default DashboardSparkline;
