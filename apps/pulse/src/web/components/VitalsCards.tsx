import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";

/**
 * The Web Vitals thresholds, as web.dev publishes them.
 *
 * CLS is unitless and the collector scales it ×1000 to keep it an integer, so
 * its boundaries are 100/250 rather than 0.1/0.25.
 */
const METRICS = [
  { key: "lcp", label: "LCP", unit: "ms", good: 2500, poor: 4000 },
  { key: "inp", label: "INP", unit: "ms", good: 200, poor: 500 },
  { key: "cls", label: "CLS", unit: "", good: 100, poor: 250 },
  { key: "fcp", label: "FCP", unit: "ms", good: 1800, poor: 3000 },
  { key: "ttfb", label: "TTFB", unit: "ms", good: 800, poor: 1800 },
] as const;

export interface VitalsCardsProps {
  /** p75 per metric. A missing key means nothing was collected. */
  vitals: Record<string, number>;
}

/**
 * Web Vitals at p75 — the percentile the standard is defined on.
 *
 * A metric with no samples shows a dash, not a zero. "Fast" and "unmeasured"
 * are the two readings this page must never confuse, and zero would be the
 * best possible score.
 */
const VitalsCards = (props: VitalsCardsProps) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {METRICS.map((metric) => {
      const value = props.vitals[metric.key];
      const rating =
        value === undefined
          ? undefined
          : value <= metric.good
            ? "good"
            : value <= metric.poor
              ? "needs work"
              : "poor";
      const tone =
        rating === "good"
          ? "text-emerald-600 dark:text-emerald-400"
          : rating === "needs work"
            ? "text-amber-600 dark:text-amber-400"
            : rating === "poor"
              ? "text-destructive"
              : "text-muted-foreground";

      return (
        <Card key={metric.key}>
          <CardHeader className="pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {metric.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-semibold tabular-nums ${tone}`}>
              {value === undefined
                ? "—"
                : metric.unit === "ms"
                  ? `${Math.round(value)} ms`
                  : (value / 1000).toFixed(2)}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {rating ?? "no samples"} · p75
            </p>
          </CardContent>
        </Card>
      );
    })}
  </div>
);

export default VitalsCards;
