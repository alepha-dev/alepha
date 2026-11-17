import { currentProjectAtom, hasCapability } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";

import type { LiveQuestController } from "../../../../../api/controllers/LiveQuestController.ts";
import type { InstanceLiveQuests } from "../../../../../api/schemas/instanceLiveQuestsSchema.ts";

/**
 * What one deployed copy runs, in quests (#E154): its live set, the done
 * quests it does not run yet, and what each recent deployment put live and
 * took down. Shared by the instance page's card and the Deploy tab's runs,
 * under one query key, so the two read it once.
 */
export const useInstanceLiveQuests = (
  instanceId: string | undefined,
  /**
   * The copy's current run, when the caller knows it: a deploy that lands
   * changes it, and with it the key, so the quests are read again.
   */
  currentRunId?: string,
): InstanceLiveQuests | undefined => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<LiveQuestController>();
  const enabled = Boolean(
    project && instanceId && hasCapability(project, "ship"),
  );
  const { data } = useQuery(
    {
      enabled,
      key: ["instance-live-quests", project?.id, instanceId, currentRunId],
      handler: async () =>
        project && instanceId
          ? await api.getInstanceLiveQuests({
              params: { projectId: project.id, instanceId },
            })
          : undefined,
      // A failure costs the card, not the page.
      onError: () => {},
    },
    [api, project?.id, instanceId, currentRunId, enabled],
  );
  return data;
};
