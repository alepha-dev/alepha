import type { DashboardPickerContext } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";

import type { QuestController } from "../../../../../api/controllers/QuestController.ts";

/**
 * The board project's own quest tags, for a dashboard metric whose filter
 * is one, registered by `WorkShell` on core's `DashboardPickerRegistry`
 * (#E75, #Q2624). Fetched only while the catalogue is open; a failure costs
 * the filter its options, never the page.
 */
export const useDashboardQuestTags = (
  context: DashboardPickerContext,
): string[] => {
  const questApi = useClient<QuestController>();
  const { projectId, open } = context;

  const query = useQuery(
    {
      key: ["project-dashboard-tags", projectId],
      staleTime: [5, "minutes"],
      enabled: open && !!projectId,
      handler: async () =>
        await questApi
          .listQuestTags({ query: { projectId: projectId as number } })
          .catch((): string[] => []),
    },
    [questApi, projectId, open],
  );

  return query.data ?? [];
};
