import { capabilityOption, currentProjectAtom } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useEffect } from "react";

import type { EpicController } from "../../../../../api/controllers/EpicController.ts";
import type { EpicRefResource } from "../../../../../api/schemas/epicRefResourceSchema.ts";
import { currentEpicCountAtom } from "../../../atoms/currentEpicCountAtom.ts";
import { currentEpicsAtom } from "../../../atoms/currentEpicsAtom.ts";

/**
 * The current project's epic refs, read fresh, for a surface whose answer
 * depends on an epic's STATUS (#Q3759).
 *
 * `currentEpicsAtom` is a snapshot the project loader takes once, on entering
 * the project. Readying an epic (from the epics list, the epic page, or an
 * agent over MCP) never touches it, so a quest page opened afterwards still
 * read the epic as `draft` and withheld Accept, while the rail's assignee
 * picker, which asks the server, succeeded.
 *
 * This reads the refs under the `["epics", projectId]` key, the one every
 * epic status write already invalidates and the quest rail already reads,
 * so it costs no request the quest page did not make. Until it answers, the
 * loader's snapshot stands in. When it does answer, the snapshot is replaced
 * (and the sidebar's draft count recounted), so the other readers of the atom
 * stop disagreeing with the server too.
 */
export const useCurrentEpicRefs = (): EpicRefResource[] | undefined => {
  const epicApi = useClient<EpicController>();
  const [project] = useStore(currentProjectAtom);
  const [snapshot, setSnapshot] = useStore(currentEpicsAtom);
  const [, setDraftCount] = useStore(currentEpicCountAtom);
  const enabled = !!project?.id && capabilityOption(project, "plan", "epics");

  const query = useQuery(
    {
      key: ["epics", project?.id],
      enabled,
      handler: () =>
        epicApi.getEpicRefs({ params: { projectId: project?.id as number } }),
      // Quiet: the snapshot still answers, and the server stays the
      // authority on the accept itself.
      onError: () => {},
    },
    [epicApi, project?.id],
  );

  const fresh = query.data;
  useEffect(() => {
    if (!fresh) return;
    setSnapshot(fresh);
    setDraftCount({
      count: fresh.filter((epic) => epic.status === "draft").length,
    });
  }, [fresh]);

  return fresh ?? snapshot;
};
