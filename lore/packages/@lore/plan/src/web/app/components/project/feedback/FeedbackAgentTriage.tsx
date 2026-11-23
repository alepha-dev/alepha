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
import { Bot, ListChecks } from "lucide-react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";

/**
 * **Triage with an agent** (#Q3988), as entries of the robot menu (#Q4126):
 * an agent job on one of the project's Agent hosts runs the project's
 * Triage prompt, on this item while it is pending, or on the whole inbox.
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

  const readiness = useQuery(
    {
      enabled: allowed && !!project?.id,
      handler: () =>
        api.getFeedbackAgentTriage({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [api, project?.id, allowed],
  );

  const triage = useAction<[one: boolean, choice: AgentChoice], void>(
    {
      handler: async (_ctx, one, choice) => {
        if (!project) return;
        rememberAgentChoice(project.id, choice);
        if (one) {
          const out = await api.triageFeedbackWithAgent({
            params: { projectId: project.id, feedbackId: feedback.id },
            body: choice,
          });
          if (out.skipped) toaster.show(out.skipped, "warning");
          else toaster.show(tr("feedback.agent.started"), "success");
        } else {
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
                  args: [
                    String(out.started.length),
                    String(out.skipped.length),
                  ],
                }),
            "success",
          );
        }
        onStarted?.();
      },
    },
    [api, project?.id, feedback.id, toaster, tr, onStarted],
  );

  if (!allowed || !readiness.data?.ready || !project) return [];
  const choices = orderAgentChoices(project.id, readiness.data.choices);
  const many = choices.length > 1;
  const label = (key: string, choice: AgentChoice) =>
    many ? `${tr(key)} (${agentChoiceText(choice)})` : tr(key);
  const suffix = (choice: AgentChoice) =>
    many ? `-${choice.host}-${choice.agent ?? ""}` : "";
  return [
    ...(feedback.status === "pending"
      ? choices.map((choice) => ({
          key: `feedback-triage${suffix(choice)}`,
          icon: Bot,
          label: label("feedback.agent.triage", choice),
          onSelect: () => void triage.run(true, choice),
          disabled: triage.loading,
        }))
      : []),
    ...choices.map((choice) => ({
      key: `feedback-triage-inbox${suffix(choice)}`,
      icon: ListChecks,
      label: label("feedback.agent.triageInbox", choice),
      onSelect: () => void triage.run(false, choice),
      disabled: triage.loading,
    })),
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
