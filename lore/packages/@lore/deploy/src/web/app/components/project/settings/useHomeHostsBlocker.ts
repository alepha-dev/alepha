import type { ProjectBlockedAct, I18n } from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ProjectEstateController } from "../../../../../api/controllers/ProjectEstateController.ts";

/**
 * Deploy's line on core's `ProjectBlockerRegistry` (#Q3281): the estates a
 * project is the home of block deleting it and turning Apps off, which the
 * server refuses (`DeployEstateHomeGuards`). Named here before the click,
 * from `listHomeEstates`. Quiet while loading and on a failure: the server
 * guard is the authority, this only says it first.
 */
export const useHomeEstatesBlocker = (
  projectId: number,
  act: ProjectBlockedAct,
): string | undefined => {
  const api = useClient<ProjectEstateController>();
  const { tr } = useI18n<I18n, "en">();
  const relevant =
    act === "delete" ||
    (typeof act === "object" && act.capabilityOff === "apps");

  const homed = useQuery(
    {
      enabled: relevant && projectId > 0,
      key: ["project-home-estates", projectId],
      handler: () => api.listHomeEstates({ params: { projectId } }),
      onError: () => {},
    },
    [api, projectId, relevant],
  ).data?.items;

  if (!relevant || !homed?.length) return undefined;
  const slugs = homed.map((estate) => estate.slug).join(", ");
  return act === "delete"
    ? tr("estates.blocker.delete", { args: [slugs] })
    : tr("estates.blocker.apps", { args: [slugs] });
};
