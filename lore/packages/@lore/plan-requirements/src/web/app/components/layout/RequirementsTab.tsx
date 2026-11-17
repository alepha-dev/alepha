import { currentProjectAtom } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useRouterState } from "alepha/react/router";

import type { RequirementController } from "../../../../api/controllers/RequirementController.ts";
import type { RequirementResource } from "../../../../api/schemas/requirementResourceSchema.ts";
import RequirementsList from "../requirements/RequirementsList.tsx";
import ListSkeleton from "../shared/ListSkeleton.tsx";
import RequirementsHover from "../shared/RequirementsHover.tsx";
import RequirementsMatrixView from "../traceability/RequirementsMatrixView.tsx";

/**
 * The Requirements tab of the Requirements page (#E153): the list, or the
 * traceability matrix under `?view=matrix`. Both read the one list the
 * tab's count reads.
 */
const RequirementsTab = () => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<RequirementController>();
  const routerState = useRouterState();
  const projectId = project?.id ?? 0;
  const matrix =
    (routerState.query as Record<string, string> | undefined)?.view ===
    "matrix";

  const list = useQuery<RequirementResource[]>(
    {
      key: ["requirements", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirements({ params: { projectId }, query: {} }),
    },
    [api, projectId],
  );
  const releases = useQuery<
    Array<{ id: number; tag?: string; title?: string }>
  >(
    {
      key: ["requirements-releases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await api.getRequirementReleases({ params: { projectId } }),
    },
    [api, projectId],
  );

  if (!project) return null;
  // The first load only: a refetch keeps the rows on screen.
  if (!list.data || !releases.data) return <ListSkeleton />;

  return matrix ? (
    <RequirementsMatrixView requirements={list.data} releases={releases.data} />
  ) : (
    <RequirementsHover className="flex min-h-0 flex-1 flex-col">
      <RequirementsList requirements={list.data} releases={releases.data} />
    </RequirementsHover>
  );
};

export default RequirementsTab;
