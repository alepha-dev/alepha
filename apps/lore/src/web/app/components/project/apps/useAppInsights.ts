import type { Infer } from "alepha";
import { useClient, useQuery, useStore } from "alepha/react";
import { useQueryParams } from "alepha/react/router";

import type { InsightsController } from "@/api/controllers/InsightsController.ts";

import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { appInsightsFiltersSchema } from "./appInsightsFiltersSchema.ts";

export type AppInsightsRange = "1d" | "7d" | "30d";
export type AppInsightsTraffic = "all" | "humans" | "bots";

export const APP_INSIGHTS_RANGES: AppInsightsRange[] = ["1d", "7d", "30d"];
export const APP_INSIGHTS_TRAFFICS: AppInsightsTraffic[] = [
  "all",
  "humans",
  "bots",
];

/**
 * The view dimensions the page can be narrowed by, in the order their chips
 * are drawn.
 *
 * One list, so a sixth dimension is added here and appears as a chip, a query
 * parameter and a leaderboard target without three separate edits.
 */
export const APP_INSIGHTS_FILTER_KEYS = [
  "path",
  "country",
  "referrer",
  "campaign",
  "device",
] as const;

export type AppInsightsFilterKey = (typeof APP_INSIGHTS_FILTER_KEYS)[number];

/**
 * The whole page state, read from and written to the URL.
 *
 * Split out of {@link useAppInsights} because two callers need the state
 * without the payload: `AppLayout` carries it across the tab bar, and the
 * dimension detail page carries it into its own query and back out again on a
 * row click. Neither wants a second copy of the insights request.
 */
export const useAppInsightsFilters = () => {
  const [params, setParams] = useQueryParams(appInsightsFiltersSchema, {
    format: "querystring",
  });

  const range: AppInsightsRange = params.range ?? "7d";
  const traffic: AppInsightsTraffic = params.traffic ?? "all";

  // Only the keys actually set, so an absent filter is an absent query
  // parameter rather than `undefined` spliced into a URL or a request.
  const filters: Partial<Record<AppInsightsFilterKey, string>> = {};
  for (const key of APP_INSIGHTS_FILTER_KEYS) {
    const value = params[key];
    if (value) {
      filters[key] = value;
    }
  }

  return {
    range,
    traffic,
    filters,
    /**
     * Rewrite the whole state. Passing the full object is deliberate: a merge
     * helper would make "clear this one filter" ambiguous between an absent
     * key and an undefined value.
     */
    setFilters: (next: Infer<typeof appInsightsFiltersSchema>) =>
      setParams(next),
  };
};

/**
 * The analytics a tab renders, for the app the page is about.
 *
 * Each tab calls this for itself. The `projectApp` loader used to fetch the
 * whole payload before anything rendered, which meant opening Settings — a
 * page with no number on it — paid for ten aggregate queries against Analytics
 * Engine. A tab that shows insights asks for them; a tab that does not, does
 * not.
 *
 * The window and the population come from the URL (see
 * {@link appInsightsFiltersSchema}), so the caller gets both the current values
 * and the setter that writes them back. Changing either changes the query key,
 * which is what refetches.
 *
 * Keyed on `(sigil, range, traffic)` so the two tabs that ask the same question
 * share one answer: crossing from Analytics to Vitals with the same filters
 * renders immediately from the cache and revalidates behind it, rather than
 * blanking the page for a round-trip.
 */
export const useAppInsights = () => {
  const insightsApi = useClient<InsightsController>();
  const [project] = useStore(currentProjectAtom);
  const [sigil] = useStore(currentSigilAtom);
  const { range, traffic, filters, setFilters } = useAppInsightsFilters();

  // The app's own capability, not the project's: Beacon off means there is
  // nothing collected to ask for, and the request would only 404.
  const enabled = Boolean(project && sigil && sigil.kinds.includes("beacon"));
  // The dimension filters are part of the question, so they are part of the
  // cache key. Serialized rather than spread so the key is one stable string
  // whatever order the URL happened to carry them in.
  const filterKey = APP_INSIGHTS_FILTER_KEYS.map(
    (key) => `${key}=${filters[key] ?? ""}`,
  ).join("&");

  const { data, loading, error } = useQuery(
    {
      enabled,
      key: ["app-insights", sigil?.id, range, traffic, filterKey],
      keepPreviousData: true,
      handler: async () => {
        if (!project || !sigil) {
          return undefined;
        }
        return await insightsApi.getInsights({
          params: { projectId: project.id },
          // `compare` costs a second pass over the same window, and the
          // endpoint has answered it since 2026-08-21 with nothing reading it.
          // It is asked for here rather than per tab because both tabs render
          // from one cache entry; Vitals ignores `previous` and pays a query
          // it would otherwise share with Analytics anyway.
          query: {
            ...filters,
            range,
            sigilId: sigil.id,
            traffic,
            compare: true,
          },
        });
      },
    },
    [project?.id, sigil?.id, range, traffic, filterKey, enabled],
  );

  return { data, loading, error, range, traffic, filters, setFilters };
};
