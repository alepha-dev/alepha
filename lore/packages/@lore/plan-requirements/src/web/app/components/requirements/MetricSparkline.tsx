import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";

export interface MetricSparklineProps {
  days: RequirementResource["metricDays"];
}

/**
 * The last 14 days of a metric requirement (#Q3773): one point per day
 * with a value, failing days in red. A plain SVG, no chart library.
 */
const MetricSparkline = (props: MetricSparklineProps) => {
  const points = props.days.filter((it) => it.value !== undefined);
  if (points.length === 0) return null;
  const width = 168;
  const height = 32;
  const values = points.map((it) => it.value ?? 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) =>
    points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
  const y = (value: number) =>
    height - 4 - ((value - min) / span) * (height - 8);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={points.map((it) => `${it.day}: ${it.value}`).join(", ")}
      data-testid="metric-sparkline"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.5}
        strokeWidth={1.5}
        points={points.map((it, i) => `${x(i)},${y(it.value ?? 0)}`).join(" ")}
      />
      {points.map((it, i) => (
        <circle
          key={it.day}
          cx={x(i)}
          cy={y(it.value ?? 0)}
          r={2.5}
          className={
            it.status === "failing"
              ? "fill-red-600 dark:fill-red-400"
              : "fill-green-600 dark:fill-green-400"
          }
        />
      ))}
    </svg>
  );
};

export default MetricSparkline;
