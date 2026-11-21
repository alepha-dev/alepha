import { reportsUrlSchema } from "@lore/core/schemas";
import {
  $pageProjectSettings,
  CoreRouter,
  currentProjectAtom,
  ReportsTabRegistry,
  ReportsUrlQuery,
} from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

import type { QualityReportsController } from "../../api/controllers/QualityReportsController.ts";

/**
 * Build's pages: Reports' Quality tab, moved from Ship with the same route
 * name and URL (#E162). The epic draws no page for code.
 */
export class BuildRouter {
  core = $inject(CoreRouter);
  alepha = $inject(Alepha);
  qualityApi = $client<QualityReportsController>();
  reportsUrl = $inject(ReportsUrlQuery);
  reportsTabs = $inject(ReportsTabRegistry);

  /**
   * Coverage and test totals pushed by CI, a tab of its own (#Q3070) after a
   * day as the last section of Delivery (#Q3010). The one Reports tab whose
   * data is INGESTED rather than derived, hence its empty state.
   */
  reportsQuality = $page({
    parent: this.core.projectReports,
    name: "reportsQuality",
    prefetch: true,
    path: "/quality",
    schema: { query: reportsUrlSchema },
    lazy: () =>
      import("./components/project/reports/ReportsQuality.client.tsx"),
    loader: async ({ query }) => ({
      url: query,
      quality: await this.qualityApi.getReportsQuality({
        params: {
          id: this.alepha.store.get(currentProjectAtom)?.id ?? -1,
        },
        query: this.reportsUrl.toQuery(
          query,
          this.reportsTabs.honours("reportsQuality"),
        ),
      }),
    }),
  });

  /**
   * General > Quality (#Q4059): the coverage target and the coverage alert,
   * out of Ship's settings. Listed by `BuildShell` while `quality` is on.
   */
  projectSettingsQuality = $pageProjectSettings({
    name: "projectSettingsQuality",
    path: "/quality",
    head: (_props, previous) => ({
      title: `${previous?.title ?? ""} › Quality`,
    }),
    lazy: () =>
      import("./components/project/settings/ProjectSettingsQualityPage.tsx"),
  });
}
