import { currentProjectAtom } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";

import type { ProjectHostController } from "../../../../../api/controllers/ProjectHostController.ts";
import type { StackController } from "../../../../../api/controllers/StackController.ts";

/**
 * The project's stacks and the hosts lent to it, the two reads every stack
 * page starts from. Keyed `["stacks", projectId]`, which every stack write
 * invalidates.
 */
export const useProjectStacks = () => {
  const stackApi = useClient<StackController>();
  const hostApi = useClient<ProjectHostController>();
  const [project] = useStore(currentProjectAtom);

  const stacks = useQuery(
    {
      enabled: Boolean(project),
      key: ["stacks", project?.id],
      keepPreviousData: true,
      handler: async () => {
        if (!project) return undefined;
        return await stackApi.listStacks({ params: { projectId: project.id } });
      },
    },
    [project?.id],
  );

  const hosts = useQuery(
    {
      enabled: Boolean(project),
      key: ["project-hosts", project?.id],
      handler: async () => {
        if (!project) return undefined;
        return await hostApi.listProjectHosts({
          params: { projectId: project.id },
        });
      },
    },
    [project?.id],
  );

  return {
    project,
    stacks: stacks.data?.items ?? [],
    loading: stacks.loading,
    error: stacks.error,
    hosts: hosts.data?.items ?? [],
  };
};
