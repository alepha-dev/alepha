import type { DashboardPickerContext, DashboardScopeApp } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";

import type { SigilController } from "@/api/controllers/SigilController.ts";

/**
 * The apps a dashboard card can be scoped to, registered by `DeployShell`
 * on core's `DashboardPickerRegistry` (#E75, #Q2624). Fetched only while
 * the catalogue is open; a failure costs the picker its options, never the
 * page.
 */
export const useDashboardApps = (
  context: DashboardPickerContext,
): DashboardScopeApp[] => {
  const sigilApi = useClient<SigilController>();
  const { projectId, projectTitle, open } = context;

  const query = useQuery(
    {
      key: ["project-dashboard-apps", projectId],
      staleTime: [5, "minutes"],
      enabled: open && !!projectId,
      handler: async () =>
        await sigilApi
          .listSigils({ params: { projectId: projectId as number } })
          .then((res) =>
            res.items.map((sigil) => ({
              id: sigil.id,
              name: sigil.name,
              projectId: projectId as number,
              projectTitle,
              beacon: (sigil.kinds ?? []).includes("beacon"),
            })),
          )
          .catch((): DashboardScopeApp[] => []),
    },
    [sigilApi, projectId, open, projectTitle],
  );

  return query.data ?? [];
};
