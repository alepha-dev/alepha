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
  const [filters, setFilters] = useQueryParams(appInsightsFiltersSchema, {
    format: "querystring",
  });

  const range: AppInsightsRange = filters.range ?? "7d";
  const traffic: AppInsightsTraffic = filters.traffic ?? "all";
  // The app's own capability, not the project's: Beacon off means there is
  // nothing collected to ask for, and the request would only 404.
  const enabled = Boolean(project && sigil && sigil.kinds.includes("beacon"));

  const { data, loading, error } = useQuery(
    {
      enabled,
      key: ["app-insights", sigil?.id, range, traffic],
      keepPreviousData: true,
      handler: async () => {
        if (!project || !sigil) {
          return undefined;
        }
        return await insightsApi.getInsights({
          params: { projectId: project.id },
          query: { range, sigilId: sigil.id, traffic },
        });
      },
    },
    [project?.id, sigil?.id, range, traffic, enabled],
  );

  return {
    data,
    loading,
    error,
    range,
    traffic,
    setFilters: (next: Infer<typeof appInsightsFiltersSchema>) =>
      setFilters(next),
  };
};
