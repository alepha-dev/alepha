import { currentProjectAtom } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";

import type { UseCaseController } from "../../../../api/controllers/UseCaseController.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import ListSkeleton from "../shared/ListSkeleton.tsx";
import RequirementsHover from "../shared/RequirementsHover.tsx";
import UseCasesList from "../usecases/UseCasesList.tsx";

/**
 * The Use cases tab of the Requirements page (#E153): the list, read under
 * the key the tab's count reads.
 */
const UseCasesTab = () => {
  const [project] = useStore(currentProjectAtom);
  const useCaseApi = useClient<UseCaseController>();
  const projectId = project?.id ?? 0;

  const useCases = useQuery<UseCaseResource[]>(
    {
      key: ["use-cases", projectId],
      enabled: projectId > 0,
      handler: async () =>
        await useCaseApi.getUseCases({ params: { projectId }, query: {} }),
    },
    [useCaseApi, projectId],
  );

  if (!project) return null;
  // The first load only: a refetch keeps the rows on screen.
  if (!useCases.data) return <ListSkeleton />;

  return (
    <RequirementsHover className="flex min-h-0 flex-1 flex-col">
      <UseCasesList useCases={useCases.data} />
    </RequirementsHover>
  );
};

export default UseCasesTab;
