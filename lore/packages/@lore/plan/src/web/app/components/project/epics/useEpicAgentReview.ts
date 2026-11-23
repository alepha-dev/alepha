import { useToast } from "@alepha/ui";
import {
  type AgentChoice,
  agentChoiceText,
  type AgentPromptsMenuAction,
  currentProjectAtom,
  type I18n,
  orderAgentChoices,
  rememberAgentChoice,
  useRank,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Bot } from "lucide-react";

import type { EpicAgentController } from "../../../../../api/controllers/EpicAgentController.ts";

/**
 * **Review with an agent** (#Q4214), as an entry of the epic's robot menu:
 * an agent job on one of the project's Agent hosts runs the project's Review
 * prompt on this epic while its plan is open (`draft` or `ready`).
 *
 * Offered only when the job can run: `epic:write` and an available Agent
 * host, read from the server with the choices as for triage (#Q4223).
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
  const allowed = open && can("epic:write");

  const readiness = useQuery(
    {
      enabled: allowed && !!project?.id,
      handler: () =>
        api.getEpicAgentReview({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [api, project?.id, allowed],
  );

  const review = useAction<[choice: AgentChoice], void>(
    {
      handler: async (_ctx, choice) => {
        if (!project) return;
        rememberAgentChoice(project.id, choice);
        await api.reviewEpicWithAgent({
          params: { projectId: project.id, number: epic.number },
          body: choice,
        });
        toaster.show(tr("epic.agent.started"), "success");
        onStarted?.();
      },
    },
    [api, project?.id, epic.number, toaster, tr, onStarted],
  );

  if (!allowed || !readiness.data?.ready || !project) return [];
  const choices = orderAgentChoices(project.id, readiness.data.choices);
  const many = choices.length > 1;
  return choices.map((choice) => ({
    key: many
      ? `epic-review-${choice.host}-${choice.agent ?? ""}`
      : "epic-review",
    icon: Bot,
    label: many
      ? `${tr("epic.agent.review")} (${agentChoiceText(choice)})`
      : tr("epic.agent.review"),
    onSelect: () => void review.run(choice),
    disabled: review.loading,
  }));
};
