import { useClient, useQuery } from "alepha/react";

import type { LoomController } from "../../api/controllers/LoomController.ts";

/**
 * A project's state, collected on the server and polled every 8 seconds
 * while the page is open. Worktree status changes as agents commit, and CI
 * progress is what someone watches, so a manual refresh alone would always
 * be stale.
 */
export const useProjectState = (projectId: string | undefined) => {
  const api = useClient<LoomController>();
  return useQuery(
    {
      key: ["projectState", projectId],
      enabled: !!projectId,
      runEvery: [8, "seconds"],
      handler: async () =>
        api.getProjectState({ params: { id: projectId ?? "" } }),
    },
    [projectId],
  );
};
