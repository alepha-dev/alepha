import { $inject, Alepha } from "alepha";
import { $page } from "alepha/react/router";
import { $client } from "alepha/server/links";

import type { QualityReportsController } from "../../api/controllers/QualityReportsController.ts";
import { reportsUrlSchema } from "../../api/schemas/reportsUrlSchema.ts";
import { $pageProjectSettings } from "./$pageProject.ts";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import { CoreRouter } from "./CoreRouter.ts";
import { ReportsTabRegistry } from "./registries/ReportsTabRegistry.ts";
import { ReportsUrlQuery } from "./services/ReportsUrlQuery.ts";

/**
 * Quality's pages, a part of Reports since Build went (#Q4217): the Quality
 * tab, with the route name and URL it had in Ship then in Build, and
 * General > Quality, the coverage target and alert (#Q4059). Both are
 * listed by `QualityShell` while Reports' `quality` option is on.
 */
export class QualityRouter {
  core = $inject(CoreRouter);
  alepha = $inject(Alepha);
  qualityApi = $client<QualityReportsController>();
  reportsUrl = $inject(ReportsUrlQuery);
  reportsTabs = $inject(ReportsTabRegistry);

  /**
   * Coverage and test totals pushed by CI, a tab of its own (#Q3070). The
   * one Reports tab whose data is INGESTED rather than derived, hence its
   * empty state.
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
   * General > Quality (#Q4059): the coverage target and the coverage alert.
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
