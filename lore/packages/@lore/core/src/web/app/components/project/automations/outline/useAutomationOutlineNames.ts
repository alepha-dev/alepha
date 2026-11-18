import { useClient, useQuery, useStore } from "alepha/react";

import type { ProjectChannelController } from "../../../../../../api/controllers/ProjectChannelController.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import { currentProjectAtom } from "../../../../atoms/currentProjectAtom.ts";
import { useAutomationOptionLabels } from "../useAutomationOptions.ts";

/**
 * Names by id, for what an action targets: configured channels, members,
 * folios. An id without a name is shown as it is.
 */
export interface AutomationOutlineNames {
  channels: Record<string, string>;
  members: Record<string, string>;
  folios: Record<string, string>;
}

/**
 * The names an outline shows for the ids its actions hold (#Q3847): the
 * members a notification reaches, the folios it appends to, the
 * configured channels. A name is a nicety, never a blocker.
 */
export const useAutomationOutlineNames = (
  graph: AutomationGraphValue | undefined,
): AutomationOutlineNames => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<ProjectChannelController>();
  const ids = (key: string, type: string) =>
    (graph?.nodes ?? [])
      .filter((node) => node.kind === "action" && node.type === type)
      .map((node) => node.config[key])
      .filter((value): value is string => typeof value === "string");
  const members = useAutomationOptionLabels(
    "member",
    ids("recipient", "notify"),
  );
  const folios = useAutomationOptionLabels(
    "folio",
    ids("folio", "appendFolio"),
  );
  const channels = useQuery(
    {
      key: ["automation-channels", project?.id ?? 0],
      enabled: !!project,
      handler: ({ signal }) =>
        api.listProjectChannels(
          { params: { projectId: project!.id } },
          { request: { signal } },
        ),
      onError: () => {},
    },
    [project?.id],
  );
  return {
    members: Object.fromEntries(members),
    folios: Object.fromEntries(folios),
    channels: Object.fromEntries(
      (channels.data?.items ?? []).map((item) => [item.id, item.name]),
    ),
  };
};
