import { useAlepha, useClient, useQuery } from "alepha/react";

import type { ProjectController } from "../../../../api/controllers/ProjectController.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { storeHomeOverview } from "../../services/homeOverviewWrite.ts";

/**
 * Fills `userProjectsAtom` when nothing has yet, for the account sections that
 * read it (Projects, Invitations).
 *
 * `CoreRouter.layout`'s loader fills it on every page under that layout, so a
 * dialog opened over one of them finds the list in memory and this fetches
 * nothing. A page outside that layout (sign-in, `/new-project`) has no list,
 * and the section loads it here, once.
 *
 * @returns whether the list is there to read.
 */
export const useUserProjects = (): boolean => {
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();
  const present = alepha.store.get(userProjectsAtom) !== undefined;
  const { data } = useQuery(
    {
      enabled: !present,
      handler: async () => {
        storeHomeOverview(alepha, await projectApi.getHomeOverview());
        return true;
      },
    },
    [projectApi],
  );
  return present || data === true;
};
