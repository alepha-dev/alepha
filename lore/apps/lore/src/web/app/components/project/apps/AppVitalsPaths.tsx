import { Badge } from "@alepha/ui/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useClient, useStore } from "alepha/react";
import { useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { InsightsController } from "@/api/controllers/InsightsController.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { VITAL_METRICS } from "./appVitalMetrics.ts";
import { useAppInsightsFilters } from "./useAppInsights.ts";

/**
 * Which page is slow, which is the only half of this tab anyone can act on.
 *
 * The five metric cards above say whether there is a problem; this says where.
 * `path` has been written on every vitals sample since the dataset existed and
 * no query had ever grouped by it, so the rows were already there.
 *
 * Ranked by the share of a path's samples that landed in a poor bucket, not by
 * its p75. A p75 is a bucket ceiling, so every path in the same bucket ties and
 * their order is arbitrary; the tail share separates them and is the number
 * that names the problem page. A path under the sample floor is ranked below
 * every path that clears it and marked, rather than dropped: "not enough data
 * about this page" is a real answer.
 */
const AppVitalsPaths = () => {
  const { tr } = useI18n<I18n, "en">();
  const insightsApi = useClient<InsightsController>();
  const [project] = useStore(currentProjectAtom);
  const [sigil] = useStore(currentSigilAtom);
  const { range, filters } = useAppInsightsFilters();

  // The same range control the tab already has, and no second one. `path` is
  // the one view filter `sigil_vitals` declares, so it is the only one of the
  // five that can narrow this.
  const path = filters.path;
  const enabled = Boolean(project && sigil && sigil.kinds.includes("beacon"));

  const { data } = useQuery(
    {
      enabled,
      key: ["app-vitals-paths", sigil?.id, range, path ?? ""],
      keepPreviousData: true,
      handler: async () => {
        if (!project || !sigil) {
          return undefined;
        }
        return await insightsApi.getVitalsPaths({
          params: { projectId: project.id },
          query: { range, sigilId: sigil.id, ...(path ? { path } : {}) },
        });
      },
    },
    [project?.id, sigil?.id, range, path, enabled],
  );

  if (!data) {
    return null;
  }

  const format = (metric: string, value: number) =>
    metric === "cls" ? value.toFixed(2) : value.toLocaleString();

  const rangeOf = (
    metric: string,
    entry: {
      samples: number;
      p75Lower: number | null;
      p75Upper: number | null;
    },
  ) => {
    // A metric this path has no sample for. Not zero, and not a range.
    if (entry.samples === 0) return "-";
    if (entry.p75Upper === null) {
      const bounds = data.boundaries[metric] ?? [];
      return tr("insights.vitals.over", {
        args: [format(metric, bounds[bounds.length - 1] ?? 0)],
      });
    }
    return tr("insights.vitals.range", {
      args: [
        format(metric, entry.p75Lower ?? 0),
        format(metric, entry.p75Upper),
      ],
    });
  };

  return (
    <Card data-testid="vitals-paths">
      <CardHeader>
        <CardTitle className="text-base">
          {tr("insights.vitals.byPath")}
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {data.rows.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {tr("insights.vitals.noSamples")}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left text-xs">
                <th className="pb-2 font-medium">
                  {tr("insights.vitals.path")}
                </th>
                <th className="pb-2 text-right font-medium">
                  {tr("insights.vitals.tail")}
                </th>
                <th className="pb-2 text-right font-medium">
                  {tr("insights.vitals.samplesColumn")}
                </th>
                {VITAL_METRICS.map((metric) => (
                  <th
                    key={metric.metricKey}
                    className="pb-2 text-right font-medium tracking-wide uppercase"
                  >
                    {tr(metric.labelKey)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.path} className="border-border/50 border-t">
                  <td className="max-w-0 truncate py-2 pr-4" title={row.path}>
                    {row.path}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    <span className="inline-flex items-center gap-2">
                      {row.tailShare}%
                      {/*
                        Marked rather than hidden, and already ranked below
                        every confident row by the endpoint - so it cannot top
                        the list unqualified, and it is still on the list.
                      */}
                      {!row.confident && (
                        <Badge variant="outline" className="text-xs">
                          {tr("insights.vitals.lowConfidence")}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="text-muted-foreground py-2 text-right tabular-nums">
                    {row.samples.toLocaleString()}
                  </td>
                  {VITAL_METRICS.map((metric) => (
                    <td
                      key={metric.metricKey}
                      className="py-2 text-right whitespace-nowrap tabular-nums"
                    >
                      {rangeOf(
                        metric.metricKey,
                        row.metrics[metric.metricKey] ?? {
                          samples: 0,
                          p75Lower: null,
                          p75Upper: null,
                        },
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/*
          `path` is the highest-cardinality dimension on this dataset, so the
          list is bounded rather than complete, and saying so is the whole
          affordance: a reader ranking pages by how bad they are has to know
          the tail was cut.
        */}
        {data.hasMore && (
          <p className="text-muted-foreground mt-3 text-xs">
            {tr("insights.vitals.morePaths")}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default AppVitalsPaths;
