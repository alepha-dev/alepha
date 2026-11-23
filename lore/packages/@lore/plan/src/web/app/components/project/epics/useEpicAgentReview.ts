import { useToast } from "@alepha/ui";
import {
  type AgentPromptsMenuAction,
  currentProjectAtom,
  type I18n,
  useRank,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bot } from "lucide-react";

import type { EpicAgentController } from "../../../../../api/controllers/EpicAgentController.ts";

/**
 * **Review with Claude** (#Q4214), as an entry of the epic's robot menu: an
 * agent job on the project's Agent host runs the project's Review prompt on
 * this epic while its plan is open (`draft` or `ready`).
 *
 * Offered only when the job can run: `epic:write`, a default Agent host, and
 * that host's last agent check `available`, read from the server as for
 * Triage with Claude.
 */
export const useEpicAgentReview = (
  epic: { number: number; status: string },
  onStarted?: () => void,
): AgentPromptsMenuAction[] => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<EpicAgentController>();
  const [project] = useStore(currentProjectAtom);
  const open = epic.status === "draft" || epic.status === "ready";
  const allowed =
    open && Boolean(project?.defaultAgentHostId) && can("epic:write");

  const readiness = useQuery(
    {
      enabled: allowed && !!project?.id,
      handler: () =>
        api.getEpicAgentReview({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [api, project?.id, project?.defaultAgentHostId, allowed],
  );

  const review = useAction(
    {
      handler: async () => {
        if (!project) return;
        await api.reviewEpicWithAgent({
          params: { projectId: project.id, number: epic.number },
        });
        toaster.show(tr("epic.agent.started"), "success");
        onStarted?.();
      },
    },
    [api, project?.id, epic.number, toaster, tr, onStarted],
  );

  if (!allowed || !readiness.data?.ready) return [];
  return [
    {
      key: "epic-review",
      icon: Bot,
      label: tr("epic.agent.review"),
      onSelect: () => void review.run(),
      disabled: review.loading,
    },
  ];
};
