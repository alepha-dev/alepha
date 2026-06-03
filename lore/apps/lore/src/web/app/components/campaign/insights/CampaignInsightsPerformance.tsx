import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useI18n } from "alepha/react/i18n";
import { Gauge } from "lucide-react";
import type { InsightsResource } from "@/api/controllers/InsightsController.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface CampaignInsightsPerformanceProps {
  data: InsightsResource;
}

type Rating = "good" | "needsImprovement" | "poor";
type VitalKey = "lcp" | "inp" | "cls" | "fcp" | "ttfb";

/**
 * Web-Vitals metrics with their standard "good" / "poor" p75 thresholds.
 * Anything at or below `good` is good, at or below `poor` needs work, above is
 * poor. `cls` is unitless; the others are milliseconds.
 */
const METRICS: {
  key: VitalKey;
  unit: "ms" | null;
  good: number;
  poor: number;
}[] = [
  { key: "lcp", unit: "ms", good: 2500, poor: 4000 },
  { key: "inp", unit: "ms", good: 200, poor: 500 },
  { key: "cls", unit: null, good: 0.1, poor: 0.25 },
  { key: "fcp", unit: "ms", good: 1800, poor: 3000 },
  { key: "ttfb", unit: "ms", good: 800, poor: 1800 },
];

// Literal key strings (not template-interpolated) so the i18n audit sees them.
const RATING_LABEL: Record<
  Rating,
  | "insights.vitals.good"
  | "insights.vitals.needsImprovement"
  | "insights.vitals.poor"
> = {
  good: "insights.vitals.good",
  needsImprovement: "insights.vitals.needsImprovement",
  poor: "insights.vitals.poor",
};

const RATING_DOT: Record<Rating, string> = {
  good: "bg-emerald-500",
  needsImprovement: "bg-amber-500",
  poor: "bg-red-500",
};

const RATING_TEXT: Record<Rating, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  needsImprovement: "text-amber-600 dark:text-amber-400",
  poor: "text-red-600 dark:text-red-400",
};

/**
 * Web-Vitals performance page (p75): one card per metric with its value and a
 * good / needs-work / poor rating. Rendered as the "Performance" segment of
 * the Insights page.
 */
const CampaignInsightsPerformance = (
  props: CampaignInsightsPerformanceProps,
) => {
  const { tr } = useI18n<I18n, "en">();
  const data = props.data;

  return (
    <div className="flex flex-col gap-4">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Gauge className="size-4" />
        <span>{tr("insights.vitals.title")}</span>
        <span className="text-xs">· {tr("insights.vitals.subtitle")}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRICS.map((metric) => {
          const raw = data.vitals[metric.key];
          const rating = rate(metric, raw);
          const display =
            raw === null
              ? tr("insights.vitals.empty")
              : metric.unit === "ms"
                ? `${raw.toLocaleString()} ms`
                : raw.toFixed(2);

          return (
            <Card key={metric.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground flex items-center justify-between text-sm font-medium">
                  <span className="uppercase tracking-wide">
                    {tr(`insights.vitals.${metric.key}`)}
                  </span>
                  {rating && (
                    <span
                      className={`flex items-center gap-1.5 text-xs font-medium ${RATING_TEXT[rating]}`}
                    >
                      <span
                        className={`size-2 rounded-full ${RATING_DOT[rating]}`}
                      />
                      {tr(RATING_LABEL[rating])}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold tabular-nums">{display}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Rate a metric value against its thresholds. Returns `null` when there is no
 * sample yet (so the card shows the empty placeholder without a rating).
 */
function rate(
  metric: { good: number; poor: number },
  value: number | null,
): Rating | null {
  if (value === null) return null;
  if (value <= metric.good) return "good";
  if (value <= metric.poor) return "needsImprovement";
  return "poor";
}

export default CampaignInsightsPerformance;
