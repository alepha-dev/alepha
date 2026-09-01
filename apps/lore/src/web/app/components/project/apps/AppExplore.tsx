import {
  AdminAnalytics,
  type AnalyticsTransport,
} from "@alepha/ui/components/admin/admin-analytics";
import { useClient, useStore } from "alepha/react";
import { useMemo } from "react";

import type { SigilAnalyticsController } from "../../../../../api/controllers/SigilAnalyticsController.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";

/**
 * The query explorer, scoped to the open app.
 *
 * The whole page is the framework's admin query builder pointed at a different
 * endpoint. There is no Lore-specific analytics UI here and there must not be:
 * the panel reads dimensions and measures out of the descriptors it is handed,
 * so anything this page needs to teach it belongs in the descriptors.
 *
 * ⚠️ **`sigilId` is absent rather than hidden.** The scoped endpoint strips it
 * from the published descriptors, so the group-by chips, the filter editor and
 * the value probes never learn it exists, and the server refuses a body that
 * names it. Nothing here filters, and nothing here should start to: a control
 * this page hid would still be one anybody could post around.
 *
 * Where Analytics answers the questions worth putting on a page, this answers
 * the ones nobody anticipated. It is deliberately additive.
 */
export const AppExplore = () => {
  const client = useClient<SigilAnalyticsController>();
  const [project] = useStore(currentProjectAtom);
  const [sigil] = useStore(currentSigilAtom);

  const projectId = project?.id;
  const sigilId = sigil?.id;

  // Memoised on the two ids: the transport is an effect dependency inside the
  // panel, so a fresh object each render would re-fire every query forever.
  const transport = useMemo<AnalyticsTransport | undefined>(() => {
    if (projectId === undefined || sigilId === undefined) {
      return undefined;
    }
    const params = { projectId, sigilId };
    return {
      listDatasets: () => client.listAppDatasets({ params }),
      queryDataset: (dataset, body) =>
        client.queryAppDataset({
          params: { ...params, name: dataset },
          body,
        }),
      // What the request dialog names. The scope lives in this URL, which is
      // what keeps that dialog honest while the body says nothing about it.
      path: (dataset) =>
        `/api/projects/${projectId}/sigils/${sigilId}/analytics/datasets/${dataset}/query`,
    };
  }, [client, projectId, sigilId]);

  // The route's own loader has already proved both, so this is the render
  // before the atoms land rather than a real absence.
  if (!transport) {
    return <div className="min-h-0 flex-1" />;
  }

  return <AdminAnalytics transport={transport} />;
};

export default AppExplore;
