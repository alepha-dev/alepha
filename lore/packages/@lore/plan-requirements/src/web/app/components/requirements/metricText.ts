import type { RequirementMetric } from "../../../../api/schemas/requirementMetricSchema.ts";

/**
 * A metric value with its unit (#Q3773): a percentage for availability, a
 * unitless score for CLS, milliseconds otherwise.
 */
export const formatMetricValue = (
  metric: RequirementMetric,
  value: number,
): string =>
  metric.kind === "availability"
    ? `${value}%`
    : metric.vital === "cls"
      ? String(value)
      : `${Math.round(value)} ms`;

/**
 * What a metric measures, in one line: `LCP p75 · /checkout/* · acme
 * production · ≤ 2500 ms`. Units and symbols only, no words to translate.
 */
export const metricLine = (metric: RequirementMetric): string => {
  const percentile =
    metric.kind === "availability"
      ? undefined
      : `p${metric.percentile ?? (metric.kind === "vital" ? 75 : 95)}`;
  const what =
    metric.kind === "vital" ? (metric.vital ?? "lcp").toUpperCase() : undefined;
  const target =
    metric.kind === "vital" ? (metric.path ?? "*") : metric.monitorId;
  const copy = [metric.app, metric.env ?? "production"]
    .filter(Boolean)
    .join(" ");
  const bound = `${metric.kind === "availability" ? "≥" : "≤"} ${formatMetricValue(metric, metric.threshold)}`;
  return [what, percentile, target, copy, bound].filter(Boolean).join(" · ");
};
