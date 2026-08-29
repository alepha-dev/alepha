import { useI18n } from "alepha/react/i18n";
import { Gauge } from "lucide-react";

import type { I18n } from "../../../services/I18n.ts";
import AppAnalyticsEstimatedBadge from "./AppAnalyticsEstimatedBadge.tsx";
import AppInsightsControls from "./AppInsightsControls.tsx";
import { VITAL_METRICS, vitalThresholds } from "./appVitalMetrics.ts";
import AppVitalsCard from "./AppVitalsCard.tsx";
import AppVitalsPaths from "./AppVitalsPaths.tsx";
import { useAppInsights } from "./useAppInsights.ts";

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

      {/*
        The asymmetry between this tab and Analytics, said out loud rather than
        left to be discovered. Analytics gained an all / humans / bots toggle on
        2026-08-26; this tab cannot have one, because `sigil_vitals` declares
        `sigilId`, `metric`, `path` and `bucket` and nothing else. So the same
        app reads differently on the two tabs, and on one of this project's own
        apps roughly 85% of what Analytics reports as readership is automated.
        A crawler's LCP is a real fetch and not a reader's experience.

        Stating it is the v0 answer. The alternative is adding `traffic` to this
        dataset, which re-slots it by its own ordering and so belongs behind the
        pinned slot map rather than in front of it.
      */}
      <p className="text-muted-foreground text-xs">
        {tr("insights.vitals.trafficNote")}
      </p>

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
            {VITAL_METRICS.map((metric) => (
              <AppVitalsCard
                key={metric.metricKey}
                metricKey={metric.metricKey}
                unit={metric.unit}
                {...vitalThresholds(metric.metricKey)}
                data={data.vitals[metric.metricKey]}
              />
            ))}
          </div>

          {/* The half that says WHERE. */}
          <AppVitalsPaths />
        </>
      )}
    </div>
  );
};

export default AppVitals;
