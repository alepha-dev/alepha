import type {
  AdminAnalyticsController,
  AdminAnalyticsQuery,
} from "alepha/api/analytics";
import { useClient } from "alepha/react";
import { useEffect, useState } from "react";

import { ANALYTICS_MAX_LIMIT, analyticsWhere } from "./analyticsModel.ts";
import type { AnalyticsFilterChip, AnalyticsWindow } from "./analyticsTypes.ts";

export interface FilterValue {
  value: string;
  total: number;
}

export interface FilterValuesApi {
  /**
   * Observed values per dimension, biggest first. Empty until the probe for
   * that dimension has come back.
   */
  values: Record<string, FilterValue[]>;
  loading: boolean;
}

export interface FilterValuesInput {
  dataset?: string;
  dimensions: string[];
  window: AnalyticsWindow;
  filters: AnalyticsFilterChip[];
  measure: string;
  open: boolean;
}

/**
 * The values a dimension actually takes, in the window being queried.
 *
 * The schema never publishes them, and the only honest source is the data.
 * The closed query language can already ask for it: group by that one
 * dimension and read the keys back. Which is also why the picker needs a
 * free-text escape hatch: this list is what was observed, not what is
 * possible.
 *
 * One probe per dimension, each ignoring the filter already set on its own
 * dimension: reopening the `country` filter must still offer every country,
 * not only the one it is currently pinned to.
 */
export const useFilterValues = (input: FilterValuesInput): FilterValuesApi => {
  const client = useClient<AdminAnalyticsController>();
  // Keyed by the query it answers, so "still loading" is derived from a
  // mismatch rather than written by the effect that starts the fetch, and a
  // stale window's counts are never rendered as if they were current.
  const [probe, setProbe] = useState<{
    key: string;
    values: Record<string, FilterValue[]>;
  }>({ key: "", values: {} });

  const key = JSON.stringify([
    input.dataset,
    input.window,
    input.filters,
    input.measure,
    input.dimensions,
  ]);

  useEffect(() => {
    if (!input.open || !input.dataset || !input.measure) return;
    const [dataset, window, filters, measure, dimensions] = JSON.parse(key) as [
      string,
      AnalyticsWindow,
      AnalyticsFilterChip[],
      string,
      string[],
    ];
    let cancelled = false;

    const read = async (dim: string): Promise<[string, FilterValue[]]> => {
      const body: AdminAnalyticsQuery = {
        since: window.from,
        until: window.to,
        where: analyticsWhere(filters.filter((entry) => entry.dim !== dim)),
        groupBy: [dim],
        select: { [measure]: "sum" },
        orderBy: { key: measure, direction: "desc" },
        limit: ANALYTICS_MAX_LIMIT,
      };
      const result = await client.queryDataset({
        params: { name: dataset },
        body,
      });
      return [
        dim,
        result.rows.map((row) => ({
          value: String(row[dim]),
          total: Number(row[measure] ?? 0),
        })),
      ];
    };

    void Promise.all(
      dimensions.map((dim) =>
        read(dim).catch((): [string, FilterValue[]] => [dim, []]),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setProbe({ key, values: Object.fromEntries(entries) });
    });

    return () => {
      cancelled = true;
    };
  }, [client, input.open, input.dataset, input.measure, key]);

  const ready = probe.key === key;
  return { values: ready ? probe.values : {}, loading: !ready };
};
