import { cn, textLinkUnderlineClassName, useToast } from "@alepha/ui";
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
import { Link } from "alepha/react/router";
import { Bot } from "lucide-react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";
import { useTriageInboxRun } from "./useTriageInboxRun.ts";

/**
 * **Triage with an agent** (#Q3988), as entries of the robot menu (#Q4126):
 * an agent job on one of the project's Agent hosts runs the project's
 * Triage prompt on this item while it is pending, then the one triage run
 * over the feedback and the errors (`useTriageInboxRun`, #Q4240).
 *
 * Offered only when the job can run: `feedback:triage` and an available
 * Agent host, read from the server with the hosts and agents to pick from
 * (#Q4223): one entry when there is one choice, one per host and agent
 * otherwise, the member's last pick first.
 */
export const useFeedbackAgentTriage = (
  feedback: FeedbackResource,
  onStarted?: () => void,
): AgentPromptsMenuAction[] => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<FeedbackController>();
  const [project] = useStore(currentProjectAtom);
  const allowed = can("feedback:triage");
  const inbox = useTriageInboxRun(onStarted);

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
        const out = await api.triageFeedbackWithAgent({
          params: { projectId: project.id, feedbackId: feedback.id },
          body: choice,
        });
        if (out.skipped) toaster.show(out.skipped, "warning");
        else toaster.show(tr("feedback.agent.started"), "success");
        onStarted?.();
      },
    },
    [api, project?.id, feedback.id, toaster, tr, onStarted],
  );

  if (!allowed || !readiness.data?.ready || !project) return inbox;
  const choices = orderAgentChoices(project.id, readiness.data.choices);
  const many = choices.length > 1;
  return [
    ...(feedback.status === "pending"
      ? choices.map((choice) => ({
          key: `feedback-triage${many ? `-${choice.host}-${choice.agent ?? ""}` : ""}`,
          icon: Bot,
          label: many
            ? `${tr("feedback.agent.triage")} (${agentChoiceText(choice)})`
            : tr("feedback.agent.triage"),
          onSelect: () => void triage.run(choice),
          disabled: triage.loading,
        }))
      : []),
    ...inbox,
  ];
};

/**
 * The agent job that last triaged an item, linked to its page, which
 * streams the job's log.
 */
export const FeedbackAgentJobLink = ({
  feedback,
}: {
  feedback: FeedbackResource;
}) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  if (!feedback.agentJobId || !project) return null;
  const slug = project.slug ?? String(project.id);
  return (
    <Link
      href={`/${slug}/jobs/${feedback.agentJobId}`}
      className={cn(textLinkUnderlineClassName, "text-xs")}
      data-testid="feedback-agent-job"
    >
      {tr("feedback.agent.job")}
    </Link>
  );
};
