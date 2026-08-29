import { useI18n } from "alepha/react/i18n";
import { Gauge } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";
import AppAnalyticsEstimatedBadge from "./AppAnalyticsEstimatedBadge.tsx";
import AppInsightsControls from "./AppInsightsControls.tsx";
import AppVitalsCard, { type AppVitalsCardProps } from "./AppVitalsCard.tsx";
import { useAppInsights } from "./useAppInsights.ts";

/**
 * Web-Vitals metrics with their standard "good" / "poor" p75 thresholds.
 * Anything at or below `good` is good, at or below `poor` needs work, above is
 * poor. `cls` is unitless; the others are milliseconds.
 */
const METRICS: Array<Omit<AppVitalsCardProps, "data">> = [
  { metricKey: "lcp", unit: "ms", good: 2500, poor: 4000 },
  { metricKey: "inp", unit: "ms", good: 200, poor: 500 },
  { metricKey: "cls", unit: null, good: 0.1, poor: 0.25 },
  { metricKey: "fcp", unit: "ms", good: 1800, poor: 3000 },
  { metricKey: "ttfb", unit: "ms", good: 800, poor: 1800 },
];

/**
 * Web-Vitals for one app: per metric, the range its p75 falls in, the number of
 * samples behind it, and the distribution both come from.
 *
 * It used to print a single figure per metric, and the figure was the upper
 * boundary of the bucket the percentile landed in. Across seven production apps
 * that made five of them report an LCP of exactly 1800 ms and a CLS of exactly
 * 0.05 - the algorithm showing through, not a fact about those apps. See
 * `vitalsMetricSchema` for the rest of the case; the summary is that bucket
 * counts cannot yield a point estimate, so this stops printing one.
 *
 * Fetches for itself. The window used to arrive pre-fetched from the
 * `projectApp` loader, which meant every other tab paid for it too; the range
 * control it belongs to now sits on this tab, sharing `?range=` with Analytics
 * so crossing between the two keeps one selection.
 *
 * No population toggle: `sigil_vitals` declares no `traffic` dimension, so the
 * control would be present and inert here.
 */
const AppVitals = () => {
  const { tr } = useI18n<I18n, "en">();
  const { data, loading, error, range, traffic, setFilters } = useAppInsights();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Gauge className="size-4" />
          <span>{tr("insights.vitals.title")}</span>
          <span className="text-xs">· {tr("insights.vitals.subtitle")}</span>
        </div>
        <AppInsightsControls
          range={range}
          traffic={traffic}
          loading={loading}
          onChange={setFilters}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {tr("insights.error")}
        </p>
      )}

      {!data ? null : (
        <>
          <AppAnalyticsEstimatedBadge
            estimated={data.estimated}
            sampleInterval={data.sampleInterval}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {METRICS.map((metric) => (
              <AppVitalsCard
                key={metric.metricKey}
                {...metric}
                data={data.vitals[metric.metricKey]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AppVitals;
