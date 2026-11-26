import { DashboardTileChart, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { ProjectErrorTrend } from "../../../../../api/schemas/projectErrorTrendSchema.ts";

export interface ProjectErrorTrendChartProps {
  /**
   * Absent while it loads, and when it could not be read: the block then
   * draws nothing, like an error that has no series.
   */
  trend?: ProjectErrorTrend;
}

/**
 * One error's occurrences per day over thirty days, each succeeded deploy a
 * dashed rule: did that deploy make it better or worse. Drawn by the
 * dashboard's chart tile, so the two read the same.
 *
 * Nothing at all for an error with no series (a monitor's outage, a use
 * case run, a project with no app): thirty zeros would say it stopped.
 */
const ProjectErrorTrendChart = (props: ProjectErrorTrendChartProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const trend = props.trend;
  if (!trend || trend.empty) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="error-trend">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{tr("errors.trend.title")}</h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          {l(trend.total)}
        </span>
      </div>
      <div className="flex h-32">
        <DashboardTileChart
          value={{ series: trend.series, markers: trend.markers }}
          chartStyle="bars"
        />
      </div>
    </section>
  );
};

export default ProjectErrorTrendChart;
