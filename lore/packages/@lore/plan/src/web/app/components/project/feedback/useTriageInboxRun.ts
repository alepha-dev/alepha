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
import { ListChecks } from "lucide-react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";

/**
 * **Triage feedback and errors** (#Q4240): the one triage run, an agent job
 * on one of the project's Agent hosts over the pending feedback and the
 * trusted error groups together (#Q4224), as entries of the robot menu.
 *
 * The same entries on the Feedback page and on the Errors page: Plan
 * registers this hook on core's `TriageRunRegistry`, which Ship reads.
 *
 * Offered only when the job can run: `feedback:triage` and an available
 * Agent host, read from the server with the hosts and agents to pick from
 * (#Q4223): one entry when there is one choice, one per host and agent
 * otherwise, the member's last pick first.
 */
export const useTriageInboxRun = (
  onStarted?: () => void,
): AgentPromptsMenuAction[] => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<FeedbackController>();
  const [project] = useStore(currentProjectAtom);
  const allowed = can("feedback:triage");

  const readiness = useQuery(
    {
      key: ["feedback-agent-triage", project?.id],
      enabled: allowed && !!project?.id,
      handler: () =>
        api.getFeedbackAgentTriage({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [api, project?.id, allowed],
  );

  const triage = useAction<[choice: AgentChoice], void>(
    {
      handler: async (_ctx, choice) => {
        if (!project) return;
        rememberAgentChoice(project.id, choice);
        const out = await api.triageInboxWithAgent({
          params: { projectId: project.id },
          body: choice,
        });
        toaster.show(
          out.global
            ? tr("feedback.agent.startedGlobal", {
                args: [String(out.skipped.length)],
              })
            : tr("feedback.agent.startedMany", {
                args: [String(out.started.length), String(out.skipped.length)],
              }),
          "success",
        );
        onStarted?.();
      },
    },
    [api, project?.id, toaster, tr, onStarted],
  );

  if (!allowed || !readiness.data?.ready || !project) return [];
  const choices = orderAgentChoices(project.id, readiness.data.choices);
  const many = choices.length > 1;
  return choices.map((choice) => ({
    key: `feedback-triage-inbox${many ? `-${choice.host}-${choice.agent ?? ""}` : ""}`,
    icon: ListChecks,
    label: many
      ? `${tr("feedback.agent.triageInbox")} (${agentChoiceText(choice)})`
      : tr("feedback.agent.triageInbox"),
    onSelect: () => void triage.run(choice),
    disabled: triage.loading,
  }));
};
