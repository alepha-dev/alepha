import { cn, textLinkUnderlineClassName, useToast } from "@alepha/ui";
import {
  type AgentPromptsMenuAction,
  currentProjectAtom,
  type I18n,
  useRank,
} from "@lore/core/web";
import { useAction, useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Bot, ListChecks } from "lucide-react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";

/**
 * **Triage with Claude** (#Q3988), as entries of the robot menu (#Q4126):
 * an agent job on the project's Agent host runs the project's Triage prompt,
 * on this item while it is pending, or on each pending one.
 *
 * Offered only when the job can run: `feedback:triage`, a default Agent
 * host, and that host's last agent check `available`. The readiness is read
 * from the server, since the client only knows the host's id.
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
  const allowed =
    Boolean(project?.defaultAgentHostId) && can("feedback:triage");

  const readiness = useQuery(
    {
      enabled: allowed && !!project?.id,
      handler: () =>
        api.getFeedbackAgentTriage({
          params: { projectId: project?.id as number },
        }),
      onError: () => {},
    },
    [api, project?.id, project?.defaultAgentHostId, allowed],
  );

  const triage = useAction<[one: boolean], void>(
    {
      handler: async (_ctx, one) => {
        if (!project) return;
        if (one) {
          const out = await api.triageFeedbackWithAgent({
            params: { projectId: project.id, feedbackId: feedback.id },
          });
          if (out.skipped) toaster.show(out.skipped, "warning");
          else toaster.show(tr("feedback.agent.started"), "success");
        } else {
          const out = await api.triageInboxWithAgent({
            params: { projectId: project.id },
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

  if (!allowed || !readiness.data?.ready) return [];
  return [
    ...(feedback.status === "pending"
      ? [
          {
            key: "feedback-triage",
            icon: Bot,
            label: tr("feedback.agent.triage"),
            onSelect: () => void triage.run(true),
            disabled: triage.loading,
          },
        ]
      : []),
    {
      key: "feedback-triage-inbox",
      icon: ListChecks,
      label: tr("feedback.agent.triageInbox"),
      onSelect: () => void triage.run(false),
      disabled: triage.loading,
    },
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
