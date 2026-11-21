import { Button, cn, textLinkUnderlineClassName, useToast } from "@alepha/ui";
import { currentProjectAtom, type I18n, useRank } from "@lore/core/web";
import { useAction, useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Bot } from "lucide-react";

import type { FeedbackController } from "../../../../../api/controllers/FeedbackController.ts";
import type { FeedbackResource } from "../../../../../api/schemas/feedbackResourceSchema.ts";

export interface FeedbackAgentTriageProps {
  /** One item, or the whole inbox when absent. */
  feedback?: FeedbackResource;
  onStarted?: () => void;
  /** Icon only, for the inbox's narrow header band. */
  compact?: boolean;
}

/**
 * **Triage with Claude** (#Q3988): an agent job on the project's Agent host
 * runs the project's Triage prompt, on this item or on each pending one.
 * Hidden without a default Agent host, or without `feedback:triage`.
 */
const FeedbackAgentTriage = ({
  feedback,
  onStarted,
  compact,
}: FeedbackAgentTriageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { can } = useRank();
  const toaster = useToast();
  const api = useClient<FeedbackController>();
  const [project] = useStore(currentProjectAtom);

  const triage = useAction<[], void>(
    {
      handler: async () => {
        if (!project) return;
        if (feedback) {
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
            tr("feedback.agent.startedMany", {
              args: [String(out.started.length), String(out.skipped.length)],
            }),
            "success",
          );
        }
        onStarted?.();
      },
    },
    [api, project?.id, feedback?.id, toaster, tr],
  );

  if (!project?.defaultAgentHostId || !can("feedback:triage")) return null;
  const label = feedback
    ? tr("feedback.agent.triage")
    : tr("feedback.agent.triageInbox");
  return (
    <Button
      variant={compact ? "minimal" : "outlined"}
      size={compact ? "sm" : undefined}
      onClick={() => void triage.run()}
      disabled={triage.loading}
      aria-label={label}
      title={label}
      data-testid={
        feedback ? "feedback-agent-triage" : "feedback-agent-triage-inbox"
      }
    >
      <Bot className="size-4" />
      {compact ? null : label}
    </Button>
  );
};

/**
 * The agent job that last triaged an item, linked to its page.
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

export default FeedbackAgentTriage;
