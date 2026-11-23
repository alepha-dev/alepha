import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ProjectHostController } from "../../../../../api/controllers/ProjectHostController.ts";
import type { ProjectBlockedAct } from "../../../registries/ProjectBlockerRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * Deploy's line on core's `ProjectBlockerRegistry` (#Q3281): the hosts a
 * project is the home of block deleting it, which the server refuses
 * (`HostHomeGuards`). Named here before the click,
 * from `listHomeHosts`. Quiet while loading and on a failure: the server
 * guard is the authority, this only says it first.
 */
export const useHomeHostsBlocker = (
  projectId: number,
  act: ProjectBlockedAct,
): string | undefined => {
  const api = useClient<ProjectHostController>();
  const { tr } = useI18n<I18n, "en">();
  // Only a delete: turning Ship off no longer touches a host (#E166).
  const relevant = act === "delete";

  const homed = useQuery(
    {
      enabled: relevant && projectId > 0,
      key: ["project-home-hosts", projectId],
      handler: () => api.listHomeHosts({ params: { projectId } }),
      onError: () => {},
    },
    [api, projectId, relevant],
  ).data?.items;

  if (!relevant || !homed?.length) return undefined;
  const slugs = homed.map((host) => host.slug).join(", ");
  return tr("hosts.blocker.delete", { args: [slugs] });
};
